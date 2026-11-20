"""Firestore order persistence, sales calculation, and dashboard aggregation service."""

from __future__ import annotations

import logging
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.file_security import ValidatedImageFile
from app.core.firebase import FirebaseNotConfiguredError, get_firestore_client
from app.core.security import AuthenticatedUser
from app.schemas.dashboard import DashboardSummaryResponse
from app.schemas.order import (
    AdminQuickOrderCreateInput,
    OrderCreateInput,
    OrderImageInfo,
    OrderListResponse,
    OrderResponse,
    OrderSalesUpdateInput,
    OrderStatus,
    PaymentMethod,
    PublicOrderConfirmation,
    StickerMaterial,
    StickerShape,
)
from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

ORDERS_COLLECTION = "orders"
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


def _coerce_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def _doc_to_order_response(doc_id: str, data: Dict[str, Any]) -> OrderResponse:
    total_price = round(float(data.get("total_price", 0.0)), 2)
    advance_payment = round(float(data.get("advance_payment", 0.0)), 2)
    pending_balance = round(max(0.0, total_price - advance_payment), 2)

    image_raw = data.get("image") or {}
    image = OrderImageInfo(
        storage_path=image_raw.get("storage_path", ""),
        safe_filename=image_raw.get("safe_filename", ""),
        original_filename=image_raw.get("original_filename", "sticker"),
        content_type=image_raw.get("content_type", "image/png"),
        size_bytes=int(image_raw.get("size_bytes", 0)),
    )

    updated_at_raw = data.get("updated_at")
    updated_at = _coerce_datetime(updated_at_raw) if updated_at_raw else None

    return OrderResponse(
        id=doc_id,
        order_number=data["order_number"],
        referral_name=data["referral_name"],
        phone=data["phone"],
        material=StickerMaterial(data["material"]),
        vinyl_gloss_mode=data.get("vinyl_gloss_mode"),
        shape=StickerShape(data["shape"]),
        diameter_cm=data.get("diameter_cm"),
        dimensions=data.get("dimensions"),
        size_display=data.get("size_display", ""),
        quantity=int(data["quantity"]),
        image=image,
        received_at=_coerce_datetime(data["received_at"]),
        delivery_datetime=_coerce_datetime(data["delivery_datetime"]),
        status=OrderStatus(data.get("status", OrderStatus.PENDIENTE.value)),
        total_price=total_price,
        advance_payment=advance_payment,
        pending_balance=pending_balance,
        payment_method=PaymentMethod(data.get("payment_method", PaymentMethod.PENDIENTE.value)),
        notes=data.get("notes"),
        source=data.get("source", "public"),
        updated_at=updated_at,
        updated_by=data.get("updated_by"),
    )


class OrderService:
    """Manages order lifecycle, Firestore storage, sales calculations, and KPIs."""

    def _collection(self):
        try:
            db = get_firestore_client()
            return db.collection(ORDERS_COLLECTION)
        except FirebaseNotConfiguredError as exc:
            logger.error("Firestore unavailable: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Base de datos Firestore no configurada en el servidor.",
            ) from exc

    def create_public_order(
        self,
        payload: OrderCreateInput,
        image: ValidatedImageFile,
    ) -> PublicOrderConfirmation:
        """Create an order submitted through the unauthenticated public storefront."""
        received_at = datetime.now(timezone.utc)
        order_number = _generate_order_number(received_at.astimezone(_studio_tz()))

        storage_service.upload_order_image(image, order_number=order_number)

        doc_data: Dict[str, Any] = {
            "order_number": order_number,
            "referral_name": payload.referral_name,
            "phone": payload.phone,
            "material": payload.material.value,
            "vinyl_gloss_mode": payload.vinyl_gloss_mode.value if payload.vinyl_gloss_mode else None,
            "shape": payload.shape.value,
            "diameter_cm": payload.diameter_cm,
            "dimensions": payload.dimensions,
            "size_display": payload.size_display,
            "quantity": payload.quantity,
            "image": {
                "storage_path": image.storage_path,
                "safe_filename": image.safe_filename,
                "original_filename": image.original_sanitized_name,
                "content_type": image.content_type,
                "size_bytes": image.size_bytes,
            },
            "received_at": received_at,
            "delivery_datetime": payload.delivery_datetime,
            "status": OrderStatus.PENDIENTE.value,
            "total_price": 0.0,
            "advance_payment": 0.0,
            "pending_balance": 0.0,
            "payment_method": PaymentMethod.PENDIENTE.value,
            "notes": None,
            "source": "public",
            "updated_at": received_at,
            "updated_by": None,
        }

        try:
            col = self._collection()
            _, doc_ref = col.add(doc_data)
        except HTTPException:
            storage_service.delete_order_image(image.storage_path)
            raise
        except Exception as exc:
            storage_service.delete_order_image(image.storage_path)
            logger.exception("Error saving public order to Firestore.")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="No se pudo registrar el pedido en la base de datos.",
            ) from exc

        return PublicOrderConfirmation(
            id=doc_ref.id,
            order_number=order_number,
            referral_name=payload.referral_name,
            phone=payload.phone,
            material=payload.material,
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
        payload: AdminQuickOrderCreateInput,
        image: ValidatedImageFile,
        user: AuthenticatedUser,
    ) -> OrderResponse:
        """Create an order internally from the admin dashboard (Quick Order)."""
        received_at = datetime.now(timezone.utc)
        order_number = _generate_order_number(received_at.astimezone(_studio_tz()))
        pending_balance = round(max(0.0, payload.total_price - payload.advance_payment), 2)

        storage_service.upload_order_image(image, order_number=order_number)

        doc_data: Dict[str, Any] = {
            "order_number": order_number,
            "referral_name": payload.referral_name,
            "phone": payload.phone,
            "material": payload.material.value,
            "vinyl_gloss_mode": payload.vinyl_gloss_mode.value if payload.vinyl_gloss_mode else None,
            "shape": payload.shape.value,
            "diameter_cm": payload.diameter_cm,
            "dimensions": payload.dimensions,
            "size_display": payload.size_display,
            "quantity": payload.quantity,
            "image": {
                "storage_path": image.storage_path,
                "safe_filename": image.safe_filename,
                "original_filename": image.original_sanitized_name,
                "content_type": image.content_type,
                "size_bytes": image.size_bytes,
            },
            "received_at": received_at,
            "delivery_datetime": payload.delivery_datetime,
            "status": payload.status.value,
            "total_price": payload.total_price,
            "advance_payment": payload.advance_payment,
            "pending_balance": pending_balance,
            "payment_method": payload.payment_method.value,
            "notes": payload.notes,
            "source": "admin",
            "updated_at": received_at,
            "updated_by": user.email or user.uid,
        }

        try:
            col = self._collection()
            _, doc_ref = col.add(doc_data)
        except HTTPException:
            storage_service.delete_order_image(image.storage_path)
            raise
        except Exception as exc:
            storage_service.delete_order_image(image.storage_path)
            logger.exception("Error saving admin quick order to Firestore.")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="No se pudo registrar el pedido rápido.",
            ) from exc

        return _doc_to_order_response(doc_ref.id, doc_data)

    def _fetch_all_orders_ordered(self) -> List[OrderResponse]:
        """Fetch orders sorted by delivery_datetime priority (ascending)."""
        col = self._collection()
        try:
            docs = col.order_by("delivery_datetime").stream()
            orders: List[OrderResponse] = []
            for doc in docs:
                data = doc.to_dict()
                if data:
                    orders.append(_doc_to_order_response(doc.id, data))
            return orders
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Error listing orders from Firestore.")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="No se pudieron consultar los pedidos.",
            ) from exc

    def list_orders(
        self,
        *,
        status_filter: Optional[OrderStatus] = None,
        material_filter: Optional[StickerMaterial] = None,
        shape_filter: Optional[StickerShape] = None,
        search: Optional[str] = None,
        only_pending: bool = False,
        delivery_date: Optional[date] = None,
        limit: int = 200,
    ) -> OrderListResponse:
        """List orders with delivery priority sorting and multi-criteria filtering."""
        orders = self._fetch_all_orders_ordered()
        tz = _studio_tz()
        normalized_query = (search or "").strip().lower()

        filtered: List[OrderResponse] = []
        for order in orders:
            if only_pending and order.status in TERMINAL_STATUSES:
                continue
            if status_filter and order.status != status_filter:
                continue
            if material_filter and order.material != material_filter:
                continue
            if shape_filter and order.shape != shape_filter:
                continue
            if delivery_date:
                order_local_date = order.delivery_datetime.astimezone(tz).date()
                if order_local_date != delivery_date:
                    continue
            if normalized_query:
                haystack = (
                    f"{order.referral_name} {order.phone} {order.order_number}"
                ).lower()
                if normalized_query not in haystack:
                    continue
            filtered.append(order)

        # Priority sort: active orders first by earliest delivery, terminal orders after
        filtered.sort(
            key=lambda o: (
                1 if o.status in TERMINAL_STATUSES else 0,
                o.delivery_datetime,
            )
        )

        total = len(filtered)
        return OrderListResponse(items=filtered[:limit], total=total)

    def get_order_by_id(self, order_id: str) -> OrderResponse:
        col = self._collection()
        doc = col.document(order_id).get()
        if not doc.exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pedido no encontrado.",
            )
        return _doc_to_order_response(doc.id, doc.to_dict() or {})

    def update_order_sales(
        self,
        order_id: str,
        payload: OrderSalesUpdateInput,
        user: AuthenticatedUser,
    ) -> OrderResponse:
        """Update sales control fields, recalculate pending_balance, and update status."""
        col = self._collection()
        doc_ref = col.document(order_id)
        snapshot = doc_ref.get()
        if not snapshot.exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pedido no encontrado.",
            )

        current = snapshot.to_dict() or {}
        new_total = (
            round(payload.total_price, 2)
            if payload.total_price is not None
            else round(float(current.get("total_price", 0.0)), 2)
        )
        new_advance = (
            round(payload.advance_payment, 2)
            if payload.advance_payment is not None
            else round(float(current.get("advance_payment", 0.0)), 2)
        )

        if new_total > 0 and new_advance > new_total:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="El adelanto no puede ser mayor que el precio total del pedido.",
            )

        pending_balance = round(max(0.0, new_total - new_advance), 2)
        now = datetime.now(timezone.utc)

        updates: Dict[str, Any] = {
            "total_price": new_total,
            "advance_payment": new_advance,
            "pending_balance": pending_balance,
            "updated_at": now,
            "updated_by": user.email or user.uid,
        }

        if payload.payment_method is not None:
            updates["payment_method"] = payload.payment_method.value
        if payload.status is not None:
            updates["status"] = payload.status.value
        if payload.notes is not None:
            updates["notes"] = payload.notes
        if payload.delivery_datetime is not None:
            updates["delivery_datetime"] = payload.delivery_datetime

        doc_ref.update(updates)
        merged = {**current, **updates}
        return _doc_to_order_response(order_id, merged)

    def get_dashboard_summary(self) -> DashboardSummaryResponse:
        """Compute KPI cards and upcoming priority queue for the dashboard home."""
        orders = self._fetch_all_orders_ordered()
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
