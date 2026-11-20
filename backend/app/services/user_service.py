"""User synchronization, RBAC user CRUD, and admin password restoration service."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import HTTPException, status
from firebase_admin import auth as firebase_auth
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.core.firebase import FirebaseNotConfiguredError, initialize_firebase
from app.db.models import Role, User
from app.db.seed import seed_catalog
from app.schemas.user import (
    AdminCreateUserInput,
    AdminPasswordRestoreMode,
    AdminRestorePasswordInput,
    AdminRestorePasswordResponse,
    AdminUpdateUserInput,
    UserListResponse,
    UserProfileResponse,
    UserRoleCode,
)

logger = logging.getLogger(__name__)


def _to_user_profile(user: User) -> UserProfileResponse:
    return UserProfileResponse(
        id=user.id,
        firebase_uid=user.firebase_uid,
        email=user.email,
        display_name=user.display_name,
        role=UserRoleCode(user.role.code),
        role_name=user.role.name,
        email_verified=bool(user.email_verified),
        is_active=bool(user.is_active),
        auth_provider=user.auth_provider,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


class UserService:
    """Manages relational user records synced with Firebase Authentication."""

    def _get_role(self, db: Session, code: str) -> Role:
        role = db.scalar(select(Role).where(Role.code == code))
        if not role:
            seed_catalog(db)
            role = db.scalar(select(Role).where(Role.code == code))
        if not role:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Rol '{code}' no encontrado en el catálogo.",
            )
        return role

    def sync_firebase_user(self, db: Session, decoded_token: Dict[str, Any]) -> User:
        """Upsert verified Firebase JWT user into PostgreSQL `users` table."""
        uid = decoded_token["uid"]
        email = (decoded_token.get("email") or f"{uid}@firebase.local").strip().lower()
        name = (decoded_token.get("name") or email.split("@")[0]).strip()[:120]
        email_verified = bool(decoded_token.get("email_verified", False))
        provider = (decoded_token.get("firebase") or {}).get("sign_in_provider") or "password"

        user = db.scalar(
            select(User).options(joinedload(User.role)).where(User.firebase_uid == uid)
        )
        if user is None:
            # Also match by email if an admin pre-created the record
            user = db.scalar(
                select(User).options(joinedload(User.role)).where(User.email == email)
            )

        settings = get_settings()
        initial_admin = (settings.INITIAL_ADMIN_EMAIL or "").strip().lower()

        if user is None:
            total_users = db.scalar(select(func.count(User.id))) or 0
            is_first_or_initial_admin = total_users == 0 or (
                bool(initial_admin) and email == initial_admin
            )
            role_code = "admin" if is_first_or_initial_admin else "operador"
            role = self._get_role(db, role_code)

            user = User(
                firebase_uid=uid,
                email=email,
                display_name=name,
                role_id=role.id,
                email_verified=email_verified,
                is_active=True,
                auth_provider=provider,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            user = db.scalar(
                select(User).options(joinedload(User.role)).where(User.id == user.id)
            )
            assert user is not None
            return user

        dirty = False
        if user.firebase_uid != uid:
            user.firebase_uid = uid
            dirty = True
        if user.email_verified != email_verified:
            user.email_verified = email_verified
            dirty = True
        if user.auth_provider != provider:
            user.auth_provider = provider
            dirty = True
        if decoded_token.get("name") and user.display_name != name:
            user.display_name = name
            dirty = True
        # Ensure configured initial admin always keeps admin role if currently operador
        if initial_admin and email == initial_admin and user.role.code != "admin":
            admin_role = self._get_role(db, "admin")
            user.role_id = admin_role.id
            dirty = True

        if dirty:
            db.commit()
            user = db.scalar(
                select(User).options(joinedload(User.role)).where(User.id == user.id)
            )
            assert user is not None

        return user

    def get_profile_by_uid(self, db: Session, uid: str) -> UserProfileResponse:
        user = db.scalar(
            select(User).options(joinedload(User.role)).where(User.firebase_uid == uid)
        )
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")
        return _to_user_profile(user)

    def sync_email_verification_from_firebase(
        self, db: Session, uid: str
    ) -> UserProfileResponse:
        """Query Firebase Admin directly for fresh email_verified flag and persist to SQL."""
        user = db.scalar(
            select(User).options(joinedload(User.role)).where(User.firebase_uid == uid)
        )
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")

        try:
            initialize_firebase()
            fb_user = firebase_auth.get_user(uid)
            user.email_verified = bool(fb_user.email_verified)
            db.commit()
            db.refresh(user)
        except FirebaseNotConfiguredError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Firebase Admin no está configurado en el servidor.",
            ) from exc
        except Exception as exc:
            logger.warning("Failed to refresh verification status for %s: %s", uid, exc)

        user = db.scalar(
            select(User).options(joinedload(User.role)).where(User.id == user.id)
        )
        assert user is not None
        return _to_user_profile(user)

    def list_users(
        self,
        db: Session,
        *,
        search: Optional[str] = None,
        role_code: Optional[UserRoleCode] = None,
    ) -> UserListResponse:
        stmt = select(User).options(joinedload(User.role)).order_by(User.created_at.desc())
        users = list(db.scalars(stmt).all())

        q = (search or "").strip().lower()
        filtered = []
        for u in users:
            if role_code and u.role.code != role_code.value:
                continue
            if q and q not in f"{u.display_name} {u.email}".lower():
                continue
            filtered.append(_to_user_profile(u))

        return UserListResponse(items=filtered, total=len(filtered))

    def create_user_as_admin(
        self, db: Session, payload: AdminCreateUserInput
    ) -> UserProfileResponse:
        """Create a new user in Firebase Auth and persist with role in PostgreSQL."""
        existing = db.scalar(select(User).where(User.email == payload.email))
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya existe un usuario registrado con ese correo electrónico.",
            )

        role = self._get_role(db, payload.role.value)

        try:
            initialize_firebase()
            fb_user = firebase_auth.create_user(
                email=payload.email,
                password=payload.password,
                display_name=payload.display_name,
                email_verified=payload.email_verified,
            )
        except FirebaseNotConfiguredError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Firebase Admin no está configurado para crear usuarios.",
            ) from exc
        except Exception as exc:
            msg = str(exc)
            if "EMAIL_EXISTS" in msg or "already exists" in msg.lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Ese correo ya existe en Firebase Authentication.",
                ) from exc
            logger.exception("Error creating Firebase user.")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No se pudo crear el usuario en Firebase Auth: {msg}",
            ) from exc

        db_user = User(
            firebase_uid=fb_user.uid,
            email=payload.email,
            display_name=payload.display_name,
            role_id=role.id,
            email_verified=payload.email_verified,
            is_active=True,
            auth_provider="password",
        )
        try:
            db.add(db_user)
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            try:
                firebase_auth.delete_user(fb_user.uid)
            except Exception:
                pass
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Conflicto de integridad al guardar el usuario en la base de datos.",
            ) from exc

        created = db.scalar(
            select(User).options(joinedload(User.role)).where(User.id == db_user.id)
        )
        assert created is not None
        return _to_user_profile(created)

    def update_user_as_admin(
        self,
        db: Session,
        user_id: int,
        payload: AdminUpdateUserInput,
        *,
        actor_uid: str,
    ) -> UserProfileResponse:
        user = db.scalar(select(User).options(joinedload(User.role)).where(User.id == user_id))
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")

        if user.firebase_uid == actor_uid:
            if payload.is_active is False:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No puedes desactivar tu propia cuenta de administrador.",
                )
            if payload.role is not None and payload.role != UserRoleCode.ADMIN:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No puedes quitarte a ti mismo el rol de administrador.",
                )

        if payload.display_name is not None:
            user.display_name = payload.display_name
        if payload.role is not None:
            role = self._get_role(db, payload.role.value)
            user.role_id = role.id
        if payload.is_active is not None:
            user.is_active = payload.is_active
        if payload.email_verified is not None:
            user.email_verified = payload.email_verified

        # Best-effort sync to Firebase Auth
        try:
            initialize_firebase()
            fb_updates: Dict[str, Any] = {}
            if payload.display_name is not None:
                fb_updates["display_name"] = payload.display_name
            if payload.is_active is not None:
                fb_updates["disabled"] = not payload.is_active
            if payload.email_verified is not None:
                fb_updates["email_verified"] = payload.email_verified
            if fb_updates:
                firebase_auth.update_user(user.firebase_uid, **fb_updates)
        except Exception as exc:
            logger.warning("Firebase user update skipped/failed for %s: %s", user.email, exc)

        db.commit()
        updated = db.scalar(select(User).options(joinedload(User.role)).where(User.id == user_id))
        assert updated is not None
        return _to_user_profile(updated)

    def delete_user_as_admin(self, db: Session, user_id: int, *, actor_uid: str) -> None:
        user = db.scalar(select(User).where(User.id == user_id))
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")

        if user.firebase_uid == actor_uid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No puedes eliminar tu propia cuenta activa.",
            )

        try:
            initialize_firebase()
            firebase_auth.delete_user(user.firebase_uid)
        except Exception as exc:
            logger.warning("Firebase delete_user skipped for %s: %s", user.email, exc)

        db.delete(user)
        db.commit()

    def restore_password_as_admin(
        self,
        db: Session,
        user_id: int,
        payload: AdminRestorePasswordInput,
    ) -> AdminRestorePasswordResponse:
        """
        Restore a user's password directly from an authenticated administrator session:
        - `temporary_password`: Sets a new password via Firebase Admin + revokes active sessions.
        - `reset_link`: Generates an official single-use Firebase password reset URL.
        """
        user = db.scalar(select(User).where(User.id == user_id))
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")

        try:
            initialize_firebase()
        except FirebaseNotConfiguredError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Firebase Admin no está configurado en el servidor.",
            ) from exc

        if payload.mode == AdminPasswordRestoreMode.TEMPORARY_PASSWORD:
            assert payload.new_password is not None
            try:
                firebase_auth.update_user(user.firebase_uid, password=payload.new_password)
                firebase_auth.revoke_refresh_tokens(user.firebase_uid)
            except Exception as exc:
                logger.exception("Admin password restoration failed for %s", user.email)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"No se pudo restaurar la contraseña en Firebase Auth: {exc}",
                ) from exc

            return AdminRestorePasswordResponse(
                user_id=user.id,
                email=user.email,
                mode=payload.mode,
                message=(
                    f"Contraseña restaurada correctamente para {user.email}. "
                    "Se revocaron las sesiones anteriores por seguridad."
                ),
            )

        # mode == RESET_LINK
        try:
            reset_link = firebase_auth.generate_password_reset_link(user.email)
        except Exception as exc:
            logger.exception("Failed to generate reset link for %s", user.email)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No se pudo generar el enlace de restauración: {exc}",
            ) from exc

        return AdminRestorePasswordResponse(
            user_id=user.id,
            email=user.email,
            mode=payload.mode,
            message=(
                f"Enlace seguro de restauración generado para {user.email}. "
                "Puedes copiarlo y enviárselo al usuario."
            ),
            reset_link=reset_link,
        )


user_service = UserService()
