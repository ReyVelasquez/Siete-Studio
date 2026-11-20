"""Authentication dependencies (Firebase JWT + PostgreSQL RBAC sync) and HTTP security middleware."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.firebase import FirebaseNotConfiguredError, verify_firebase_id_token
from app.db.database import get_db
from app.services.user_service import user_service

logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer(auto_error=False)


class AuthenticatedUser(BaseModel):
    """Represents a verified Firebase user synced with PostgreSQL RBAC role."""

    uid: str
    db_user_id: Optional[int] = None
    email: Optional[str] = None
    name: Optional[str] = None
    role: str = "operador"
    email_verified: bool = False
    is_active: bool = True
    sign_in_provider: Optional[str] = None


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    """FastAPI dependency enforcing valid Firebase JWT authentication and SQL user sync."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticación requerido.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials.strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticación vacío.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        decoded = verify_firebase_id_token(token)
    except FirebaseNotConfiguredError as exc:
        logger.error("Firebase Admin error during token verification: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Servicio de autenticación no configurado en el servidor.",
        ) from exc
    except Exception as exc:
        logger.warning("Firebase token verification failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión inválida o expirada. Inicia sesión nuevamente.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    db_user = user_service.sync_firebase_user(db, decoded)
    if not db_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tu cuenta ha sido desactivada por un administrador.",
        )

    return AuthenticatedUser(
        uid=db_user.firebase_uid,
        db_user_id=db_user.id,
        email=db_user.email,
        name=db_user.display_name,
        role=db_user.role.code,
        email_verified=bool(db_user.email_verified),
        is_active=bool(db_user.is_active),
        sign_in_provider=db_user.auth_provider,
    )


async def require_admin(
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    """RBAC dependency restricting administrative endpoints strictly to `admin` role."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permisos insuficientes. Esta operación requiere rol de Administrador.",
        )
    return current_user


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach baseline OWASP HTTP security headers to every API response."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=()",
        )
        return response
