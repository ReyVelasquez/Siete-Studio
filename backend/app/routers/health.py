"""Health and readiness check endpoints."""

from fastapi import APIRouter

from app.core.config import get_settings
from app.core.firebase import is_firebase_ready
from app.modules.image_processing import check_phase2_dependencies

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check():
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.APP_NAME,
        "environment": settings.APP_ENV,
        "firebase_ready": is_firebase_ready(),
        "phase2_dependencies": check_phase2_dependencies(),
    }
