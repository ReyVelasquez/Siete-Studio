"""Health and readiness check endpoints."""

from fastapi import APIRouter

from app.core.config import get_settings
from app.core.firebase import is_firebase_ready
from app.db.database import check_db_connection, get_db_dialect
from app.modules.image_processing import check_phase2_dependencies

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check():
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.APP_NAME,
        "environment": settings.APP_ENV,
        "database_dialect": get_db_dialect(),
        "database_ready": check_db_connection(),
        "firebase_ready": is_firebase_ready(),
        "phase2_dependencies": check_phase2_dependencies(),
    }
