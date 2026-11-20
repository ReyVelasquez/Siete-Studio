"""Admin-only RBAC endpoints for user CRUD and administrator password restoration."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import AuthenticatedUser, require_admin
from app.db.database import get_db
from app.schemas.user import (
    AdminCreateUserInput,
    AdminRestorePasswordInput,
    AdminRestorePasswordResponse,
    AdminUpdateUserInput,
    UserListResponse,
    UserProfileResponse,
    UserRoleCode,
)
from app.services.user_service import user_service

router = APIRouter(
    prefix="/admin/users",
    tags=["Admin Users & Password Restoration"],
    dependencies=[Depends(require_admin)],
)


@router.get("", response_model=UserListResponse, summary="Listar usuarios registrados")
async def list_users(
    search: Optional[str] = Query(default=None, max_length=120),
    role: Optional[UserRoleCode] = Query(default=None),
    db: Session = Depends(get_db),
) -> UserListResponse:
    return user_service.list_users(db, search=search, role_code=role)


@router.post(
    "",
    response_model=UserProfileResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear nuevo usuario desde sesión de administrador",
)
async def create_user(
    payload: AdminCreateUserInput,
    db: Session = Depends(get_db),
) -> UserProfileResponse:
    return user_service.create_user_as_admin(db, payload)


@router.patch(
    "/{user_id}",
    response_model=UserProfileResponse,
    summary="Actualizar nombre, rol o estado activo de un usuario",
)
async def update_user(
    user_id: int,
    payload: AdminUpdateUserInput,
    current_admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserProfileResponse:
    return user_service.update_user_as_admin(
        db, user_id, payload, actor_uid=current_admin.uid
    )


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar usuario del sistema",
)
async def delete_user(
    user_id: int,
    current_admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    user_service.delete_user_as_admin(db, user_id, actor_uid=current_admin.uid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{user_id}/restore-password",
    response_model=AdminRestorePasswordResponse,
    summary="Restaurar contraseña de un usuario desde sesión del administrador",
)
async def restore_user_password(
    user_id: int,
    payload: AdminRestorePasswordInput,
    db: Session = Depends(get_db),
) -> AdminRestorePasswordResponse:
    return user_service.restore_password_as_admin(db, user_id, payload)
