"""Idempotent relational database initializer and initial catalog seeder."""

from __future__ import annotations

import logging

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session, joinedload

from app.db.database import Base, SessionLocal, engine
from app.db.models import Material, Order, OrderItem, Role, Shape

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


def backfill_legacy_order_items(db: Session) -> None:
    """Idempotently migrate pre-existing single-sticker orders into `order_items`."""
    legacy_orders = (
        db.scalars(
            select(Order)
            .options(joinedload(Order.image), joinedload(Order.items))
        )
        .unique()
        .all()
    )
    created = 0
    for order in legacy_orders:
        if order.items:
            continue
        img = order.image
        if not img or not img.storage_path or img.size_bytes <= 0:
            continue
        db.add(
            OrderItem(
                order_id=order.id,
                position=1,
                material_id=order.material_id,
                vinyl_gloss_mode=order.vinyl_gloss_mode,
                shape_id=order.shape_id,
                diameter_cm=order.diameter_cm,
                dimensions=order.dimensions,
                size_display=order.size_display,
                quantity=order.quantity,
                image_storage_path=img.storage_path,
                image_safe_filename=img.safe_filename,
                image_original_filename=img.original_filename,
                image_content_type=img.content_type,
                image_size_bytes=img.size_bytes,
                image_uploaded_at=img.uploaded_at,
            )
        )
        created += 1
    if created:
        db.commit()
        logger.info("Migración Maestro-Detalle: %d pedido(s) previo(s) sincronizados en order_items.", created)


def ensure_order_items_prepress_columns(target_engine) -> None:
    """Idempotently add non-destructive prepress and sizing columns to existing `orders` and `order_items` tables."""
    inspector = inspect(target_engine)
    table_names = set(inspector.get_table_names())

    if "orders" in table_names:
        existing_order_cols = {col["name"] for col in inspector.get_columns("orders")}
        order_ddl_by_column = {
            "size_mode": "ALTER TABLE orders ADD COLUMN size_mode VARCHAR(20)",
            "height_cm": "ALTER TABLE orders ADD COLUMN height_cm NUMERIC(6, 2)",
            "width_cm": "ALTER TABLE orders ADD COLUMN width_cm NUMERIC(6, 2)",
        }
        missing_order_cols = [col for col in order_ddl_by_column if col not in existing_order_cols]
        if missing_order_cols:
            with target_engine.begin() as conn:
                for col in missing_order_cols:
                    conn.execute(text(order_ddl_by_column[col]))
            logger.info(
                "Migración no destructiva: columnas de medida agregadas en orders (%s).",
                ", ".join(missing_order_cols),
            )

    if "order_items" not in table_names:
        return

    existing_cols = {col["name"] for col in inspector.get_columns("order_items")}
    ddl_by_column = {
        "size_mode": "ALTER TABLE order_items ADD COLUMN size_mode VARCHAR(20)",
        "height_cm": "ALTER TABLE order_items ADD COLUMN height_cm NUMERIC(6, 2)",
        "width_cm": "ALTER TABLE order_items ADD COLUMN width_cm NUMERIC(6, 2)",
        "enhanced_storage_path": "ALTER TABLE order_items ADD COLUMN enhanced_storage_path VARCHAR(300)",
        "die_cut_anchors_json": "ALTER TABLE order_items ADD COLUMN die_cut_anchors_json TEXT",
        "die_cut_config_json": "ALTER TABLE order_items ADD COLUMN die_cut_config_json TEXT",
        "die_cut_eps_path": "ALTER TABLE order_items ADD COLUMN die_cut_eps_path VARCHAR(300)",
        "prepress_status": "ALTER TABLE order_items ADD COLUMN prepress_status VARCHAR(30) NOT NULL DEFAULT 'pendiente'",
    }

    missing = [col for col in ddl_by_column if col not in existing_cols]
    if not missing:
        return

    with target_engine.begin() as conn:
        for col in missing:
            conn.execute(text(ddl_by_column[col]))
    logger.info(
        "Migración no destructiva: columnas de preprensa agregadas en order_items (%s).",
        ", ".join(missing),
    )


def init_db_and_seed(bind_engine=None) -> None:
    """Create all tables (with integrity constraints) and ensure catalog rows exist."""
    target_engine = bind_engine or engine
    Base.metadata.create_all(bind=target_engine)
    ensure_order_items_prepress_columns(target_engine)

    if bind_engine is not None:
        with Session(bind_engine) as db:
            seed_catalog(db)
            backfill_legacy_order_items(db)
    else:
        with SessionLocal() as db:
            seed_catalog(db)
            backfill_legacy_order_items(db)

    logger.info("Base de datos relacional (%s) inicializada y catálogos verificados.", target_engine.dialect.name)
