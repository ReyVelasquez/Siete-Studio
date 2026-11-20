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

    # Firebase Admin credentials (never hardcoded)
    FIREBASE_CREDENTIALS_PATH: Optional[str] = None
    FIREBASE_CREDENTIALS_JSON: Optional[str] = None
    FIREBASE_STORAGE_BUCKET: Optional[str] = None
    STORAGE_BACKEND: str = Field(
        default="auto",
        pattern="^(auto|firebase|local)$",
        description="Storage backend: firebase, local, or auto (uses Firebase Storage if bucket exists).",
    )

    # Upload & Business Rules
    MAX_UPLOAD_SIZE_MB: int = Field(default=10, ge=1, le=25)
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
