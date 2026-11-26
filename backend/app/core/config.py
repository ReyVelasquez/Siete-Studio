"""Centralized environment-driven configuration using Pydantic Settings."""

from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Application settings loaded strictly from environment variables / .env."""

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    APP_NAME: str = "Siete Sticker Studio API"
    APP_ENV: str = "development"
    APP_DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Strict CORS whitelist (comma-separated string in .env)
    CORS_ORIGINS: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        description="Comma-separated list of allowed CORS origins.",
    )

    # Relational DBMS (PostgreSQL via SQLAlchemy 2.0 + psycopg, or local SQLite fallback)
    DATABASE_URL: str = Field(
        default="sqlite:///./siete_studio.db",
        description="SQLAlchemy database URI (PostgreSQL: postgresql+psycopg://user:pass@host:5432/siete_studio).",
    )
    INITIAL_ADMIN_EMAIL: Optional[str] = Field(
        default=None,
        description="Email automatically assigned 'admin' role when synced from Firebase Auth.",
    )

    # Firebase Admin credentials (never hardcoded)
    FIREBASE_CREDENTIALS_PATH: Optional[str] = Field(
        default=None,
        description="Local path to Firebase service account JSON file (recommended for local development).",
    )
    FIREBASE_CREDENTIALS_JSON: Optional[str] = Field(
        default=None,
        description="Firebase service account credentials as a single-line JSON string or Base64-encoded JSON (recommended for cloud).",
    )
    FIREBASE_STORAGE_BUCKET: Optional[str] = None
    CLOUDINARY_CLOUD_NAME: Optional[str] = Field(
        default=None,
        description="Cloudinary cloud name (required when STORAGE_BACKEND='cloudinary').",
    )
    CLOUDINARY_API_KEY: Optional[str] = Field(
        default=None,
        description="Cloudinary API key (required when STORAGE_BACKEND='cloudinary').",
    )
    CLOUDINARY_API_SECRET: Optional[str] = Field(
        default=None,
        description="Cloudinary API secret (required when STORAGE_BACKEND='cloudinary').",
    )
    STORAGE_BACKEND: str = Field(
    default="auto",
    pattern="^(auto|firebase|cloudinary|local)$",
    )
    CLOUDINARY_CLOUD_NAME: str | None = None
    CLOUDINARY_API_KEY: str | None = None
    CLOUDINARY_API_SECRET: str | None = None

    # Upload & Business Rules
    MAX_UPLOAD_SIZE_MB: int = Field(default=10, ge=1, le=25)
    MAX_ORDER_ITEMS: int = Field(default=20, ge=1, le=20)
    MAX_TOTAL_ORDER_UPLOAD_MB: int = Field(default=60, ge=1, le=200)
    MAX_ITEMS_JSON_BYTES: int = Field(default=65536, ge=1024, le=128 * 1024)
    FIRESTORE_SYNC_ENABLED: bool = Field(
        default=True,
        description="Mirror master-detail orders into Firestore 'orders' collection when Firebase is configured.",
    )
    DELIVERY_HOUR_START: int = Field(default=8, ge=0, le=23)
    DELIVERY_HOUR_END: int = Field(default=20, ge=0, le=23)
    TIMEZONE_OFFSET_MINUTES: int = Field(
        default=-240,
        ge=-720,
        le=840,
        description="Default studio UTC offset in minutes (e.g. -240 for UTC-4).",
    )

    # Rate Limiting for public order submission
    RATE_LIMIT_PUBLIC_ORDERS_REQUESTS: int = Field(default=10, ge=1, le=1000)
    RATE_LIMIT_PUBLIC_ORDERS_WINDOW_SECONDS: int = Field(default=60, ge=10, le=3600)
    TRUST_PROXY_HEADERS: bool = False

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse comma-separated CORS origins strictly, stripping whitespace and empty values."""
        origins = [
            origin.strip().rstrip("/")
            for origin in self.CORS_ORIGINS.split(",")
            if origin.strip()
        ]
        # Disallow wildcard when credentials are enabled
        return [o for o in origins if o != "*"]

    @property
    def max_upload_size_bytes(self) -> int:
        return self.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    @property
    def max_total_order_upload_bytes(self) -> int:
        return self.MAX_TOTAL_ORDER_UPLOAD_MB * 1024 * 1024

    @field_validator("DELIVERY_HOUR_END")
    @classmethod
    def validate_delivery_hours(cls, v: int, info) -> int:
        start = info.data.get("DELIVERY_HOUR_START", 8)
        if v < start:
            raise ValueError("DELIVERY_HOUR_END debe ser mayor o igual a DELIVERY_HOUR_START.")
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached settings singleton."""
    return Settings()
