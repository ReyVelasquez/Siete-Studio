"""FastAPI application entrypoint for Siete Sticker Studio."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.firebase import FirebaseNotConfiguredError, initialize_firebase
from app.core.security import SecurityHeadersMiddleware
from app.routers import admin_orders, dashboard, health, image_processing, public_orders

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Attempt Firebase Admin initialization on startup without crashing local docs inspection."""
    try:
        initialize_firebase()
    except FirebaseNotConfiguredError as exc:
        logger.warning("Startup notice: %s", exc)
    yield


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.APP_NAME,
        version="1.0.0",
        description=(
            "API Fase 1 para gestión de pedidos públicos, control de ventas, "
            "autenticación Firebase y base modular para procesamiento de imágenes en Fase 2."
        ),
        docs_url="/docs" if settings.APP_ENV != "production" else None,
        redoc_url="/redoc" if settings.APP_ENV != "production" else None,
        lifespan=lifespan,
    )

    # Strict CORS driven strictly by environment variable CORS_ORIGINS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
        expose_headers=["Content-Disposition", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
    )

    app.add_middleware(SecurityHeadersMiddleware)

    api_prefix = settings.API_V1_PREFIX.rstrip("/")
    app.include_router(health.router, prefix=api_prefix)
    app.include_router(public_orders.router, prefix=api_prefix)
    app.include_router(admin_orders.router, prefix=api_prefix)
    app.include_router(dashboard.router, prefix=api_prefix)
    app.include_router(image_processing.router, prefix=api_prefix)

    @app.get("/", include_in_schema=False)
    async def root():
        return {"service": settings.APP_NAME, "api_prefix": api_prefix, "status": "running"}

    return app


app = create_app()
