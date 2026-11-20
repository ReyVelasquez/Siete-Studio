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
    """Resolve relative SQLite paths cleanly against BACKEND_DIR; pass PostgreSQL URLs untouched."""
    if raw_url.startswith("sqlite:///./"):
        rel = raw_url[len("sqlite:///./") :]
        abs_path = (BACKEND_DIR / rel).resolve()
        return f"sqlite:///{abs_path.as_posix()}"
    return raw_url


def build_engine(database_url: str | None = None) -> Engine:
    settings = get_settings()
    url = resolve_database_url(database_url or settings.DATABASE_URL)

    connect_args = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    eng = create_engine(
        url,
        connect_args=connect_args,
        pool_pre_ping=True,
        future=True,
    )

    if url.startswith("sqlite"):
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
