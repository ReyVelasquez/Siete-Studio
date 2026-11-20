"""Relational SQLAlchemy 2.0 order persistence, full CRUD, audit history, and KPI aggregation."""

from __future__ import annotations

import logging
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.core.file_security import ValidatedImageFile
from app.core.security import AuthenticatedUser
from app.db.models import (
    Customer,
    Material,
    Order,
    OrderImage,
    OrderStatusHistory,
    Payment,
    Shape,
)
from app.db.seed import seed_catalog
from app.schemas.dashboard import DashboardSummaryResponse
from app.schemas.order import (
    AdminQuickOrderCreateInput,
    OrderCreateInput,
    OrderImageInfo,
    OrderListResponse,
    OrderPaymentItem,
    OrderResponse,
    OrderSalesUpdateInput,
    OrderStatus,
    OrderStatusHistoryItem,
    PaymentMethod,
    PublicOrderConfirmation,
    StickerMaterial,
    StickerShape,
    VinylGlossMode,
)
from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

ORDER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ACTIVE_PRODUCTION_STATUSES = {
    OrderStatus.EN_DISENO,
    OrderStatus.EN_IMPRESION,
    OrderStatus.TROQUELADO,
    OrderStatus.LISTO,
}
TERMINAL_STATUSES = {OrderStatus.ENTREGADO, OrderStatus.CANCELADO}


def _studio_tz() -> timezone:
    settings = get_settings()
    return timezone(timedelta(minutes=settings.TIMEZONE_OFFSET_MINUTES))


def _generate_order_number(now_local: datetime) -> str:
    suffix = "".join(secrets.choice(ORDER_CODE_ALPHABET) for _ in range(4))
    return f"STK-{now_local.strftime('%Y%m%d')}-{suffix}"


def _ensure_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _orm_to_order_response(order: Order) -> OrderResponse:
    total_price = round(float(order.total_price), 2)
    advance_payment = round(float(order.advance_payment), 2)
    pending_balance = round(max(0.0, total_price - advance_payment), 2)

    img = order.image
    image_info = OrderImageInfo(
        storage_path=img.storage_path if img else "",
        safe_filename=img.safe_filename if img else "",
        original_filename=img.original_filename if img else "sticker",
        content_type=img.content_type if img else "image/png",
        size_bytes=int(img.size_bytes) if img else 0,
    )

    history_items = [
        OrderStatusHistoryItem(
            id=h.id,
            previous_status=h.previous_status,
            new_status=h.new_status,
            changed_by=(
                h.changed_by_user.email if h.changed_by_user else "Sistema"
            ),
            comment=h.comment,
            changed_at=_ensure_utc(h.changed_at),
        )
        for h in (order.status_history or [])
    ]

    payment_items = [
        OrderPaymentItem(
            id=p.id,
            amount=round(float(p.amount), 2),
            payment_method=p.payment_method,
            recorded_by=(
                p.recorded_by_user.email if p.recorded_by_user else "Sistema"
            ),
            reference=p.reference,
            recorded_at=_ensure_utc(p.recorded_at),
        )
        for p in (order.payments or [])
    ]

    return OrderResponse(
        id=str(order.id),
        order_number=order.order_number,
        referral_name=order.customer.referral_name,
        phone=order.customer.phone,
        material=order.material.name,
        vinyl_gloss_mode=VinylGlossMode(order.vinyl_gloss_mode) if order.vinyl_gloss_mode else None,
        shape=StickerShape(order.shape.name),
        diameter_cm=float(order.diameter_cm) if order.diameter_cm is not None else None,
        dimensions=order.dimensions,
        size_display=order.size_display,
        quantity=int(order.quantity),
        image=image_info,
        received_at=_ensure_utc(order.received_at),
        delivery_datetime=_ensure_utc(order.delivery_datetime),
        status=OrderStatus(order.status),
        total_price=total_price,
        advance_payment=advance_payment,
        pending_balance=pending_balance,
        payment_method=PaymentMethod(order.payment_method),
        notes=order.notes,
        source=order.source,
        updated_at=_ensure_utc(order.updated_at) if order.updated_at else None,
        updated_by=order.updated_by_user.email if order.updated_by_user else None,
        status_history=history_items,
        payments=payment_items,
    )


class OrderService:
    """Manages sticker orders with ACID transactions in PostgreSQL / SQLAlchemy."""

    def _resolve_order_pk(self, order_id: str) -> int:
        try:
            return int(order_id)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pedido no encontrado.",
            ) from exc

    def _upsert_customer(self, db: Session, referral_name: str, phone: str) -> Customer:
        customer = db.scalar(select(Customer).where(Customer.phone == phone))
        if customer:
            if customer.referral_name != referral_name:
                customer.referral_name = referral_name
            return customer

        customer = Customer(referral_name=referral_name, phone=phone)
        db.add(customer)
        db.flush()
        return customer

    def _get_material_and_shape(
        self, db: Session, material_name: str, shape_name: str
    ) -> tuple[Material, Shape]:
        material = db.scalar(select(Material).where(Material.name == material_name))
        shape = db.scalar(select(Shape).where(Shape.name == shape_name))
        if not material or not shape:
            seed_catalog(db)
            material = material or db.scalar(select(Material).where(Material.name == material_name))
            shape = shape or db.scalar(select(Shape).where(Shape.name == shape_name))

        if not material:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Material '{material_name}' no existe en el catálogo.",
            )
        if not shape:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Forma '{shape_name}' no existe en el catálogo.",
            )
        return material, shape

    def _base_order_query(self):
        return (
            select(Order)
            .options(
                joinedload(Order.customer),
                joinedload(Order.material),
                joinedload(Order.shape),
                joinedload(Order.image),
                joinedload(Order.updated_by_user),
                joinedload(Order.status_history).joinedload(OrderStatusHistory.changed_by_user),
                joinedload(Order.payments).joinedload(Payment.recorded_by_user),
            )
        )

    def create_public_order(
        self,
        db: Session,
        payload: OrderCreateInput,
        image: ValidatedImageFile,
    ) -> PublicOrderConfirmation:
        received_at = datetime.now(timezone.utc)
        order_number = _generate_order_number(received_at.astimezone(_studio_tz()))

        storage_service.upload_order_image(image, order_number=order_number)

        try:
            customer = self._upsert_customer(db, payload.referral_name, payload.phone)
            material, shape = self._get_material_and_shape(
                db, payload.material.value, payload.shape.value
            )

            order = Order(
                order_number=order_number,
                customer_id=customer.id,
                material_id=material.id,
                vinyl_gloss_mode=payload.vinyl_gloss_mode.value if payload.vinyl_gloss_mode else None,
                shape_id=shape.id,
                diameter_cm=payload.diameter_cm,
                dimensions=payload.dimensions,
                size_display=payload.size_display,
                quantity=payload.quantity,
                received_at=received_at,
                delivery_datetime=payload.delivery_datetime,
                status=OrderStatus.PENDIENTE.value,
                total_price=0.0,
                advance_payment=0.0,
                pending_balance=0.0,
                payment_method=PaymentMethod.PENDIENTE.value,
                notes=None,
                source="public",
            )
            db.add(order)
            db.flush()

            db.add(
                OrderImage(
                    order_id=order.id,
                    storage_path=image.storage_path,
                    safe_filename=image.safe_filename,
                    original_filename=image.original_sanitized_name,
                    content_type=image.content_type,
                    size_bytes=image.size_bytes,
                )
            )
            db.add(
                OrderStatusHistory(
                    order_id=order.id,
                    previous_status=None,
                    new_status=OrderStatus.PENDIENTE.value,
                    comment="Pedido recibido desde el portal público.",
                )
            )
            db.commit()
            db.refresh(order)
        except HTTPException:
            db.rollback()
            storage_service.delete_order_image(image.storage_path)
            raise
        except IntegrityError as exc:
            db.rollback()
            storage_service.delete_order_image(image.storage_path)
            logger.exception("Relational integrity violation creating public order.")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Los datos del pedido incumplen una restricción de integridad.",
            ) from exc
        except Exception as exc:
            db.rollback()
            storage_service.delete_order_image(image.storage_path)
            logger.exception("Error saving public order to relational DB.")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="No se pudo registrar el pedido en la base de datos.",
            ) from exc

        return PublicOrderConfirmation(
            id=str(order.id),
            order_number=order_number,
            referral_name=payload.referral_name,
            phone=payload.phone,
            material=payload.material.value,
            vinyl_gloss_mode=payload.vinyl_gloss_mode,
            shape=payload.shape,
            diameter_cm=payload.diameter_cm,
            dimensions=payload.dimensions,
            size_display=payload.size_display,
            quantity=payload.quantity,
            received_at=received_at,
            delivery_datetime=payload.delivery_datetime,
            status=OrderStatus.PENDIENTE,
            message="Tu pedido fue recibido correctamente. Conserva tu número de orden para seguimiento.",
        )

    def create_admin_order(
        self,
        db: Session,
        payload: AdminQuickOrderCreateInput,
        image: ValidatedImageFile,
        user: AuthenticatedUser,
    ) -> OrderResponse:
        received_at = datetime.now(timezone.utc)
        order_number = _generate_order_number(received_at.astimezone(_studio_tz()))
        pending_balance = round(max(0.0, payload.total_price - payload.advance_payment), 2)

        storage_service.upload_order_image(image, order_number=order_number)

        try:
            customer = self._upsert_customer(db, payload.referral_name, payload.phone)
            material, shape = self._get_material_and_shape(
                db, payload.material.value, payload.shape.value
            )

            order = Order(
                order_number=order_number,
                customer_id=customer.id,
                material_id=material.id,
                vinyl_gloss_mode=payload.vinyl_gloss_mode.value if payload.vinyl_gloss_mode else None,
                shape_id=shape.id,
                diameter_cm=payload.diameter_cm,
                dimensions=payload.dimensions,
                size_display=payload.size_display,
                quantity=payload.quantity,
                received_at=received_at,
                delivery_datetime=payload.delivery_datetime,
                status=payload.status.value,
                total_price=payload.total_price,
                advance_payment=payload.advance_payment,
                pending_balance=pending_balance,
                payment_method=payload.payment_method.value,
                notes=payload.notes,
                source="admin",
                created_by_user_id=user.db_user_id,
                updated_by_user_id=user.db_user_id,
            )
            db.add(order)
            db.flush()

            db.add(
                OrderImage(
                    order_id=order.id,
                    storage_path=image.storage_path,
                    safe_filename=image.safe_filename,
                    original_filename=image.original_sanitized_name,
                    content_type=image.content_type,
                    size_bytes=image.size_bytes,
                )
            )
            db.add(
                OrderStatusHistory(
                    order_id=order.id,
                    previous_status=None,
                    new_status=payload.status.value,
                    changed_by_user_id=user.db_user_id,
                    comment="Pedido rápido registrado desde el panel interno.",
                )
            )
            if payload.advance_payment > 0:
                pay_method = (
                    payload.payment_method.value
                    if payload.payment_method != PaymentMethod.PENDIENTE
                    else PaymentMethod.EFECTIVO.value
                )
                db.add(
                    Payment(
                        order_id=order.id,
                        amount=payload.advance_payment,
                        payment_method=pay_method,
                        recorded_by_user_id=user.db_user_id,
                        reference="Adelanto inicial",
                    )
                )

            db.commit()
            order_id = order.id
        except HTTPException:
            db.rollback()
            storage_service.delete_order_image(image.storage_path)
            raise
        except Exception as exc:
            db.rollback()
            storage_service.delete_order_image(image.storage_path)
            logger.exception("Error saving admin quick order.")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="No se pudo registrar el pedido rápido.",
            ) from exc

        return self.get_order_by_id(db, str(order_id))

    def _fetch_all_orders_ordered(self, db: Session) -> List[OrderResponse]:
        stmt = self._base_order_query().order_by(Order.delivery_datetime.asc())
        rows = db.scalars(stmt).unique().all()
        return [_orm_to_order_response(row) for row in rows]

    def list_orders(
        self,
        db: Session,
        *,
        status_filter: Optional[OrderStatus] = None,
        material_filter: Optional[StickerMaterial] = None,
        shape_filter: Optional[StickerShape] = None,
        search: Optional[str] = None,
        only_pending: bool = False,
        delivery_date: Optional[date] = None,
        limit: int = 200,
    ) -> OrderListResponse:
        orders = self._fetch_all_orders_ordered(db)
        tz = _studio_tz()
        normalized_query = (search or "").strip().lower()

        filtered: List[OrderResponse] = []
        for order in orders:
            if only_pending and order.status in TERMINAL_STATUSES:
                continue
            if status_filter and order.status != status_filter:
                continue
            if material_filter and order.material != material_filter.value:
                continue
            if shape_filter and order.shape != shape_filter:
                continue
            if delivery_date:
                order_local_date = order.delivery_datetime.astimezone(tz).date()
                if order_local_date != delivery_date:
                    continue
            if normalized_query:
                haystack = f"{order.referral_name} {order.phone} {order.order_number}".lower()
                if normalized_query not in haystack:
                    continue
            filtered.append(order)

        filtered.sort(
            key=lambda o: (
                1 if o.status in TERMINAL_STATUSES else 0,
                o.delivery_datetime,
            )
        )

        total = len(filtered)
        return OrderListResponse(items=filtered[:limit], total=total)

    def get_order_by_id(self, db: Session, order_id: str) -> OrderResponse:
        pk = self._resolve_order_pk(order_id)
        order = db.scalars(self._base_order_query().where(Order.id == pk)).unique().first()
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pedido no encontrado.",
            )
        return _orm_to_order_response(order)

    def update_order_sales(
        self,
        db: Session,
        order_id: str,
        payload: OrderSalesUpdateInput,
        user: AuthenticatedUser,
    ) -> OrderResponse:
        pk = self._resolve_order_pk(order_id)
        order = db.scalars(self._base_order_query().where(Order.id == pk)).unique().first()
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pedido no encontrado.",
            )

        previous_total = round(float(order.total_price), 2)
        previous_advance = round(float(order.advance_payment), 2)
        previous_status = order.status

        new_total = (
            round(payload.total_price, 2) if payload.total_price is not None else previous_total
        )
        new_advance = (
            round(payload.advance_payment, 2)
            if payload.advance_payment is not None
            else previous_advance
        )

        if new_total > 0 and new_advance > new_total:
            raise HTTPException(
                status_code=422,
                detail="El adelanto no puede ser mayor que el precio total del pedido.",
            )

        pending_balance = round(max(0.0, new_total - new_advance), 2)

        if payload.referral_name is not None:
            order.customer.referral_name = payload.referral_name
        if payload.phone is not None and payload.phone != order.customer.phone:
            existing_customer = db.scalar(
                select(Customer).where(Customer.phone == payload.phone)
            )
            if existing_customer:
                order.customer_id = existing_customer.id
            else:
                order.customer.phone = payload.phone
        if payload.quantity is not None:
            order.quantity = payload.quantity

        order.total_price = new_total
        order.advance_payment = new_advance
        order.pending_balance = pending_balance
        order.updated_by_user_id = user.db_user_id
        order.updated_at = datetime.now(timezone.utc)

        if payload.payment_method is not None:
            order.payment_method = payload.payment_method.value
        if payload.status is not None:
            order.status = payload.status.value
        if payload.notes is not None:
            order.notes = payload.notes
        if payload.delivery_datetime is not None:
            order.delivery_datetime = payload.delivery_datetime

        # Audit status transition
        if payload.status is not None and payload.status.value != previous_status:
            db.add(
                OrderStatusHistory(
                    order_id=order.id,
                    previous_status=previous_status,
                    new_status=payload.status.value,
                    changed_by_user_id=user.db_user_id,
                    comment=f"Cambio de estado de {previous_status} a {payload.status.value}.",
                )
            )

        # Audit incremental payment received
        advance_delta = round(new_advance - previous_advance, 2)
        if advance_delta > 0:
            effective_method = order.payment_method
            if effective_method == PaymentMethod.PENDIENTE.value:
                effective_method = PaymentMethod.EFECTIVO.value
            db.add(
                Payment(
                    order_id=order.id,
                    amount=advance_delta,
                    payment_method=effective_method,
                    recorded_by_user_id=user.db_user_id,
                    reference="Abono registrado desde panel",
                )
            )

        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Conflicto de integridad al actualizar el pedido.",
            ) from exc

        return self.get_order_by_id(db, str(pk))

    def delete_order(self, db: Session, order_id: str) -> None:
        """Delete order (CASCADE deletes image metadata, status history, and payments) + image file."""
        pk = self._resolve_order_pk(order_id)
        order = db.scalars(
            select(Order).options(joinedload(Order.image)).where(Order.id == pk)
        ).first()
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pedido no encontrado.",
            )

        storage_path = order.image.storage_path if order.image else None
        db.delete(order)
        db.commit()

        if storage_path:
            storage_service.delete_order_image(storage_path)

    def get_dashboard_summary(self, db: Session) -> DashboardSummaryResponse:
        orders = self._fetch_all_orders_ordered(db)
        tz = _studio_tz()
        now_local = datetime.now(tz)
        today_local = now_local.date()

        status_breakdown: Dict[str, int] = {s.value: 0 for s in OrderStatus}
        pending_orders_count = 0
        in_production_count = 0
        today_deliveries_count = 0
        overdue_deliveries_count = 0
        today_sales_total = 0.0
        today_collected_total = 0.0
        month_sales_total = 0.0
        month_collected_total = 0.0
        month_pending_balance = 0.0
        upcoming_active: List[OrderResponse] = []

        for order in orders:
            status_breakdown[order.status.value] = status_breakdown.get(order.status.value, 0) + 1

            delivery_local = order.delivery_datetime.astimezone(tz)
            received_local = order.received_at.astimezone(tz)

            if order.status == OrderStatus.PENDIENTE:
                pending_orders_count += 1
            if order.status in ACTIVE_PRODUCTION_STATUSES:
                in_production_count += 1

            if order.status not in TERMINAL_STATUSES:
                upcoming_active.append(order)
                if delivery_local.date() == today_local:
                    today_deliveries_count += 1
                if delivery_local < now_local:
                    overdue_deliveries_count += 1

            if order.status != OrderStatus.CANCELADO:
                if received_local.date() == today_local:
                    today_sales_total += order.total_price
                    today_collected_total += order.advance_payment
                if (
                    received_local.year == today_local.year
                    and received_local.month == today_local.month
                ):
                    month_sales_total += order.total_price
                    month_collected_total += order.advance_payment
                    month_pending_balance += order.pending_balance

        upcoming_active.sort(key=lambda o: o.delivery_datetime)

        return DashboardSummaryResponse(
            pending_orders_count=pending_orders_count,
            in_production_count=in_production_count,
            today_deliveries_count=today_deliveries_count,
            overdue_deliveries_count=overdue_deliveries_count,
            today_sales_total=round(today_sales_total, 2),
            today_collected_total=round(today_collected_total, 2),
            month_sales_total=round(month_sales_total, 2),
            month_collected_total=round(month_collected_total, 2),
            month_pending_balance=round(month_pending_balance, 2),
            status_breakdown=status_breakdown,
            upcoming_deliveries=upcoming_active[:8],
        )


order_service = OrderService()
