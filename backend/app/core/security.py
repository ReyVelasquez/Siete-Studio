"""Authentication dependencies and HTTP security middleware."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.firebase import FirebaseNotConfiguredError, verify_firebase_id_token

logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer(auto_error=False)


class AuthenticatedUser(BaseModel):
    """Represents a verified Firebase user extracted from the JWT token."""

    uid: str
    email: Optional[str] = None
    name: Optional[str] = None
    email_verified: bool = False
    sign_in_provider: Optional[str] = None


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> AuthenticatedUser:
    """FastAPI dependency enforcing valid Firebase JWT authentication."""
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

    firebase_meta = decoded.get("firebase", {})
    return AuthenticatedUser(
        uid=decoded["uid"],
        email=decoded.get("email"),
        name=decoded.get("name"),
        email_verified=bool(decoded.get("email_verified", False)),
        sign_in_provider=firebase_meta.get("sign_in_provider"),
    )


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
