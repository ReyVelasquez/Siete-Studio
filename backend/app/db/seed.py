"""Idempotent relational database initializer and initial catalog seeder."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import Base, SessionLocal, engine
from app.db.models import Material, Role, Shape

logger = logging.getLogger(__name__)

DEFAULT_ROLES = [
    {
        "code": "admin",
        "name": "Administrador",
        "description": "Control total del taller, usuarios, restauración de contraseñas, catálogos y ventas.",
    },
    {
        "code": "operador",
        "name": "Operador de Taller",
        "description": "Gestión diaria de pedidos, producción, ventas y descargas de artes.",
    },
    {
        "code": "cliente",
        "name": "Cliente",
        "description": "Acceso básico de seguimiento y gestión de cuenta personal.",
    },
]

DEFAULT_MATERIALS = [
    {
        "name": "Vinilo Brillo",
        "description": "Acabado brillante impermeable y colores vibrantes. Requiere elegir En rollo o Corte uno a uno.",
        "requires_gloss_mode": True,
        "base_unit_price": 1.50,
    },
    {
        "name": "Vinilo Mate",
        "description": "Superficie sedosa antirreflejo con tacto premium.",
        "requires_gloss_mode": False,
        "base_unit_price": 1.60,
    },
    {
        "name": "Transparente",
        "description": "Base cristalina ideal para envases, vidrio y acrílico.",
        "requires_gloss_mode": False,
        "base_unit_price": 1.80,
    },
    {
        "name": "DTF UV",
        "description": "Transfer con relieve táctil para superficies rígidas.",
        "requires_gloss_mode": False,
        "base_unit_price": 2.50,
    },
    {
        "name": "Hojas Adhesivas",
        "description": "Papel autoadhesivo económico para empaques y etiquetas.",
        "requires_gloss_mode": False,
        "base_unit_price": 0.80,
    },
]

DEFAULT_SHAPES = [
    {"name": "Circular", "is_circular": True},
    {"name": "Rectangular", "is_circular": False},
    {"name": "Cuadrado", "is_circular": False},
    {"name": "En su forma", "is_circular": False},
]


def seed_catalog(db: Session) -> None:
    """Insert initial roles, materials, and shapes if they do not exist yet."""
    for role_data in DEFAULT_ROLES:
        exists = db.scalar(select(Role).where(Role.code == role_data["code"]))
        if not exists:
            db.add(Role(**role_data))

    for mat_data in DEFAULT_MATERIALS:
        exists = db.scalar(select(Material).where(Material.name == mat_data["name"]))
        if not exists:
            db.add(Material(**mat_data))

    for shape_data in DEFAULT_SHAPES:
        exists = db.scalar(select(Shape).where(Shape.name == shape_data["name"]))
        if not exists:
            db.add(Shape(**shape_data))

    db.commit()


def init_db_and_seed(bind_engine=None) -> None:
    """Create all tables (with integrity constraints) and ensure catalog rows exist."""
    target_engine = bind_engine or engine
    Base.metadata.create_all(bind=target_engine)

    if bind_engine is not None:
        with Session(bind_engine) as db:
            seed_catalog(db)
    else:
        with SessionLocal() as db:
            seed_catalog(db)

    logger.info("Base de datos relacional (%s) inicializada y catálogos verificados.", target_engine.dialect.name)
