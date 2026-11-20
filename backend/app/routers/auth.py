"""Authenticated session endpoints for profile role retrieval & email verification sync."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import AuthenticatedUser, get_current_user
from app.db.database import get_db
from app.schemas.user import UserProfileResponse
from app.services.user_service import user_service

router = APIRouter(prefix="/auth", tags=["Authentication & Session"])


@router.get(
    "/me",
    response_model=UserProfileResponse,
    summary="Obtener perfil sincronizado, rol RBAC y estado de verificación de correo",
)
async def get_my_profile(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileResponse:
    return user_service.get_profile_by_uid(db, current_user.uid)


@router.post(
    "/sync-verification",
    response_model=UserProfileResponse,
    summary="Sincronizar confirmación de email desde Firebase Auth hacia PostgreSQL",
)
async def sync_my_email_verification(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileResponse:
    return user_service.sync_email_verification_from_firebase(db, current_user.uid)
