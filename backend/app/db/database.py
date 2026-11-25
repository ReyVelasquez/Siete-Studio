"""SQLAlchemy 2.0 database engine and session management (PostgreSQL primary + SQLite local fallback)."""

from __future__ import annotations

from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import BACKEND_DIR, get_settings


class Base(DeclarativeBase):
    """Declarative base for all relational ORM models."""


def resolve_database_url(raw_url: str) -> str:
    """Normalize cloud PostgreSQL URLs for psycopg v3 and resolve relative SQLite paths cleanly."""
    cleaned = raw_url.strip()

    if cleaned.startswith("postgres://"):
        return "postgresql+psycopg://" + cleaned[len("postgres://") :]

    if cleaned.startswith("postgresql://"):
        return "postgresql+psycopg://" + cleaned[len("postgresql://") :]

    if cleaned.startswith("sqlite:///./"):
        rel = cleaned[len("sqlite:///./") :]
        abs_path = (BACKEND_DIR / rel).resolve()
        return f"sqlite:///{abs_path.as_posix()}"

    return cleaned


def build_engine(database_url: str | None = None) -> Engine:
    settings = get_settings()
    url = resolve_database_url(database_url or settings.DATABASE_URL)

    is_sqlite = url.startswith("sqlite")
    connect_args: dict[str, object] = {}
    engine_kwargs: dict[str, object] = {
        "future": True,
    }

    if is_sqlite:
        connect_args["check_same_thread"] = False
    else:
        engine_kwargs["pool_pre_ping"] = True
        engine_kwargs["pool_recycle"] = 300

    eng = create_engine(
        url,
        connect_args=connect_args,
        **engine_kwargs,
    )

    if is_sqlite:
        @event.listens_for(eng, "connect")
        def _enable_sqlite_fk(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON;")
            cursor.close()

    return eng


engine: Engine = build_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a scoped SQLAlchemy session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_db_dialect() -> str:
    return engine.dialect.name


def check_db_connection() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
