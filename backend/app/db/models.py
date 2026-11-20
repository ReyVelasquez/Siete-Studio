"""SQLAlchemy 2.0 ORM models mirroring database/schema_postgresql.sql (3FN + integrity constraints)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (
        CheckConstraint("code IN ('admin', 'operador', 'cliente')", name="chk_roles_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    users: Mapped[List["User"]] = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (Index("idx_users_role_id", "role_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    firebase_uid: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False
    )
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    auth_provider: Mapped[str] = mapped_column(String(50), default="password", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    role: Mapped["Role"] = relationship("Role", back_populates="users")


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (Index("idx_customers_phone", "phone"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    referral_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(25), unique=True, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    orders: Mapped[List["Order"]] = relationship("Order", back_populates="customer")


class Material(Base):
    __tablename__ = "materials"
    __table_args__ = (CheckConstraint("base_unit_price >= 0", name="chk_materials_price"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    requires_gloss_mode: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    base_unit_price: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    orders: Mapped[List["Order"]] = relationship("Order", back_populates="material")


class Shape(Base):
    __tablename__ = "shapes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    is_circular: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    orders: Mapped[List["Order"]] = relationship("Order", back_populates="shape")


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint(
            "vinyl_gloss_mode IS NULL OR vinyl_gloss_mode IN ('En rollo', 'Corte uno a uno')",
            name="chk_orders_gloss_mode",
        ),
        CheckConstraint(
            "(diameter_cm IS NOT NULL AND dimensions IS NULL) "
            "OR (diameter_cm IS NULL AND dimensions IS NOT NULL)",
            name="chk_orders_size_xor",
        ),
        CheckConstraint(
            "diameter_cm IS NULL OR (diameter_cm >= 0.5 AND diameter_cm <= 500)",
            name="chk_orders_diameter_range",
        ),
        CheckConstraint("quantity >= 1 AND quantity <= 1000000", name="chk_orders_quantity"),
        CheckConstraint(
            "status IN ('Pendiente','En Diseño','En Impresión','Troquelado','Listo','Entregado','Cancelado')",
            name="chk_orders_status",
        ),
        CheckConstraint(
            "total_price >= 0 AND advance_payment >= 0 AND pending_balance >= 0",
            name="chk_orders_money_non_negative",
        ),
        CheckConstraint(
            "total_price = 0 OR advance_payment <= total_price",
            name="chk_orders_advance_le_total",
        ),
        CheckConstraint(
            "payment_method IN ('Pendiente','Efectivo','Transferencia','QR','Tarjeta','Mixto')",
            name="chk_orders_payment_method",
        ),
        CheckConstraint("source IN ('public', 'admin')", name="chk_orders_source"),
        Index("idx_orders_delivery_datetime", "delivery_datetime"),
        Index("idx_orders_status", "status"),
        Index("idx_orders_customer_id", "customer_id"),
        Index("idx_orders_material_id", "material_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_number: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False
    )
    material_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("materials.id", ondelete="RESTRICT"), nullable=False
    )
    vinyl_gloss_mode: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    shape_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("shapes.id", ondelete="RESTRICT"), nullable=False
    )
    diameter_cm: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    dimensions: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    size_display: Mapped[str] = mapped_column(String(50), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    delivery_datetime: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="Pendiente", nullable=False)
    total_price: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)
    advance_payment: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)
    pending_balance: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(30), default="Pendiente", nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="public", nullable=False)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    customer: Mapped["Customer"] = relationship("Customer", back_populates="orders")
    material: Mapped["Material"] = relationship("Material", back_populates="orders")
    shape: Mapped["Shape"] = relationship("Shape", back_populates="orders")
    image: Mapped[Optional["OrderImage"]] = relationship(
        "OrderImage", back_populates="order", uselist=False, cascade="all, delete-orphan"
    )
    status_history: Mapped[List["OrderStatusHistory"]] = relationship(
        "OrderStatusHistory",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="OrderStatusHistory.changed_at.desc()",
    )
    payments: Mapped[List["Payment"]] = relationship(
        "Payment",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="Payment.recorded_at.desc()",
    )
    updated_by_user: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[updated_by_user_id]
    )


class OrderImage(Base):
    __tablename__ = "order_images"
    __table_args__ = (
        CheckConstraint(
            "content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')",
            name="chk_order_images_mime",
        ),
        CheckConstraint("size_bytes > 0 AND size_bytes <= 10485760", name="chk_order_images_size"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    storage_path: Mapped[str] = mapped_column(String(300), nullable=False)
    safe_filename: Mapped[str] = mapped_column(String(160), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(160), nullable=False)
    content_type: Mapped[str] = mapped_column(String(60), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    order: Mapped["Order"] = relationship("Order", back_populates="image")


class OrderStatusHistory(Base):
    __tablename__ = "order_status_history"
    __table_args__ = (Index("idx_order_status_history_order_id", "order_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    previous_status: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    new_status: Mapped[str] = mapped_column(String(30), nullable=False)
    changed_by_user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    order: Mapped["Order"] = relationship("Order", back_populates="status_history")
    changed_by_user: Mapped[Optional["User"]] = relationship("User")


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="chk_payments_amount"),
        CheckConstraint(
            "payment_method IN ('Efectivo', 'Transferencia', 'QR', 'Tarjeta', 'Mixto')",
            name="chk_payments_method",
        ),
        Index("idx_payments_order_id", "order_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(30), nullable=False)
    recorded_by_user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reference: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    order: Mapped["Order"] = relationship("Order", back_populates="payments")
    recorded_by_user: Mapped[Optional["User"]] = relationship("User")
