"""Master-Detail order persistence (SQLAlchemy 2.0 + Firestore sync), full CRUD, audit & KPIs."""

from __future__ import annotations

import logging
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from fastapi import HTTPException, status
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.config import get_settings
from app.core.file_security import ValidatedImageFile
from app.core.firebase import FirebaseNotConfiguredError, get_firestore_client
from app.core.security import AuthenticatedUser
from app.db.models import (
    Customer,
    Material,
    Order,
    OrderImage,
    OrderItem,
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
    OrderItemResponse,
    OrderListResponse,
    OrderPaymentItem,
    OrderResponse,
    OrderSalesUpdateInput,
    OrderStatus,
    OrderStatusHistoryItem,
    PaymentMethod,
    PrepressStatus,
    PublicOrderConfirmation,
    SizeMode,
    StickerMaterial,
    StickerShape,
    VinylGlossMode,
    parse_non_circular_dimensions,
)
from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

FIRESTORE_ORDERS_COLLECTION = "orders"
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


def _orm_item_to_response(item: OrderItem) -> OrderItemResponse:
    size_mode_val: Optional[SizeMode] = None
    height_val: Optional[float] = None
    width_val: Optional[float] = None
    if item.diameter_cm is None:
        size_mode_val, height_val, width_val = parse_non_circular_dimensions(
            item.dimensions,
            getattr(item, "size_mode", None),
            float(item.height_cm) if getattr(item, "height_cm", None) is not None else None,
            float(item.width_cm) if getattr(item, "width_cm", None) is not None else None,
        )

    return OrderItemResponse(
        id=str(item.id),
        position=int(item.position),
        material=item.material.name,
        vinyl_gloss_mode=VinylGlossMode(item.vinyl_gloss_mode) if item.vinyl_gloss_mode else None,
        shape=StickerShape(item.shape.name),
        diameter_cm=float(item.diameter_cm) if item.diameter_cm is not None else None,
        size_mode=size_mode_val,
        height_cm=height_val,
        width_cm=width_val,
        dimensions=item.dimensions,
        size_display=item.size_display,
        quantity=int(item.quantity),
        image=OrderImageInfo(
            storage_path=item.image_storage_path,
            safe_filename=item.image_safe_filename,
            original_filename=item.image_original_filename,
            content_type=item.image_content_type,
            size_bytes=int(item.image_size_bytes),
        ),
        enhanced_storage_path=item.enhanced_storage_path,
        die_cut_anchors_json=item.die_cut_anchors_json,
        die_cut_eps_path=item.die_cut_eps_path,
        prepress_status=PrepressStatus(item.prepress_status or "pendiente"),
    )


def _orm_to_order_response(order: Order) -> OrderResponse:
    total_price = round(float(order.total_price), 2)
    advance_payment = round(float(order.advance_payment), 2)
    pending_balance = round(max(0.0, total_price - advance_payment), 2)

    img = order.image
    legacy_image_info = OrderImageInfo(
        storage_path=img.storage_path if img else "",
        safe_filename=img.safe_filename if img else "",
        original_filename=img.original_filename if img else "sticker",
        content_type=img.content_type if img else "image/png",
        size_bytes=int(img.size_bytes) if img else 0,
    )

    if order.items:
        item_responses = [
            _orm_item_to_response(it)
            for it in sorted(order.items, key=lambda x: (x.position, x.id))
        ]
    else:
        # Backward-compatible synthesis for any legacy single-sticker DB row without order_items
        leg_mode: Optional[SizeMode] = None
        leg_h: Optional[float] = None
        leg_w: Optional[float] = None
        if order.diameter_cm is None:
            leg_mode, leg_h, leg_w = parse_non_circular_dimensions(
                order.dimensions,
                getattr(order, "size_mode", None),
                float(order.height_cm) if getattr(order, "height_cm", None) is not None else None,
                float(order.width_cm) if getattr(order, "width_cm", None) is not None else None,
            )
        item_responses = [
            OrderItemResponse(
                id=f"legacy-{order.id}-1",
                position=1,
                material=order.material.name,
                vinyl_gloss_mode=(
                    VinylGlossMode(order.vinyl_gloss_mode) if order.vinyl_gloss_mode else None
                ),
                shape=StickerShape(order.shape.name),
                diameter_cm=float(order.diameter_cm) if order.diameter_cm is not None else None,
                size_mode=leg_mode,
                height_cm=leg_h,
                width_cm=leg_w,
                dimensions=order.dimensions,
                size_display=order.size_display,
                quantity=int(order.quantity),
                image=legacy_image_info,
            )
        ]

    primary = item_responses[0]
    total_quantity = sum(it.quantity for it in item_responses)

    history_items = [
        OrderStatusHistoryItem(
            id=h.id,
            previous_status=h.previous_status,
            new_status=h.new_status,
            changed_by=h.changed_by_user.email if h.changed_by_user else "Sistema",
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
            recorded_by=p.recorded_by_user.email if p.recorded_by_user else "Sistema",
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
        received_at=_ensure_utc(order.received_at),
        delivery_datetime=_ensure_utc(order.delivery_datetime),
        status=OrderStatus(order.status),
        items=item_responses,
        items_count=len(item_responses),
        total_quantity=total_quantity,
        material=primary.material,
        vinyl_gloss_mode=primary.vinyl_gloss_mode,
        shape=primary.shape,
        diameter_cm=primary.diameter_cm,
        dimensions=primary.dimensions,
        size_display=primary.size_display,
        quantity=total_quantity,
        image=primary.image if primary.image.storage_path else legacy_image_info,
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


def build_firestore_order_document(order: OrderResponse) -> Dict[str, Any]:
    """
    Build the canonical Master-Detail Firestore document for collection `orders/{order_number}`:
    - Master header: referral_name, phone, received_at, delivery_datetime (:00), status, totals.
    - Detail array `items`: each design has its own material (+ vinyl_gloss_mode), shape,
      diameter_cm / dimensions / size_display, quantity, and dedicated `image` metadata.
    """
    return {
        "id": order.id,
        "order_number": order.order_number,
        "referral_name": order.referral_name,
        "phone": order.phone,
        "received_at": order.received_at,
        "delivery_datetime": order.delivery_datetime,
        "status": order.status.value,
        "source": order.source,
        "items_count": order.items_count,
        "total_quantity": order.total_quantity,
        "items": [
            {
                "id": item.id,
                "position": item.position,
                "material": item.material,
                "vinyl_gloss_mode": item.vinyl_gloss_mode.value if item.vinyl_gloss_mode else None,
                "shape": item.shape.value,
                "diameter_cm": item.diameter_cm,
                "size_mode": item.size_mode.value if item.size_mode else None,
                "height_cm": item.height_cm,
                "width_cm": item.width_cm,
                "dimensions": item.dimensions,
                "size_display": item.size_display,
                "quantity": item.quantity,
                "image": {
                    "storage_path": item.image.storage_path,
                    "safe_filename": item.image.safe_filename,
                    "original_filename": item.image.original_filename,
                    "content_type": item.image.content_type,
                    "size_bytes": item.image.size_bytes,
                },
                "enhanced_storage_path": item.enhanced_storage_path,
                "die_cut_anchors_json": item.die_cut_anchors_json,
                "die_cut_eps_path": item.die_cut_eps_path,
                "prepress_status": item.prepress_status.value,
            }
            for item in order.items
        ],
        "total_price": order.total_price,
        "advance_payment": order.advance_payment,
        "pending_balance": order.pending_balance,
        "payment_method": order.payment_method.value,
        "notes": order.notes,
        "updated_at": order.updated_at or order.received_at,
        "updated_by": order.updated_by,
    }


class OrderService:
    """Manages Master-Detail sticker orders with ACID SQL transactions + Firestore sync."""

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
    ) -> Tuple[Material, Shape]:
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
        """Eagerly load Master + Detail relationships without N+1 queries or Cartesian explosion."""
        return select(Order).options(
            joinedload(Order.customer),
            joinedload(Order.material),
            joinedload(Order.shape),
            joinedload(Order.image),
            joinedload(Order.updated_by_user),
            selectinload(Order.items).joinedload(OrderItem.material),
            selectinload(Order.items).joinedload(OrderItem.shape),
            selectinload(Order.status_history).joinedload(OrderStatusHistory.changed_by_user),
            selectinload(Order.payments).joinedload(Payment.recorded_by_user),
        )

    def _upload_item_images_atomically(
        self,
        images: Sequence[ValidatedImageFile],
        *,
        order_number: str,
    ) -> List[str]:
        """
        Upload unique item images once per file; clean up already-uploaded blobs if any upload fails.
        When multiple items share the same `ValidatedImageFile` instance (via `image_index`),
        uploads it to Storage only ONCE so all referencing `order_items` share its `storage_path`.
        """
        uploaded_paths: List[str] = []
        uploaded_ids: set[int] = set()
        uploaded_storage_paths: set[str] = set()
        try:
            for image in images:
                if id(image) in uploaded_ids or (
                    image.storage_path and image.storage_path in uploaded_storage_paths
                ):
                    continue
                storage_service.upload_order_image(image, order_number=order_number)
                uploaded_ids.add(id(image))
                uploaded_storage_paths.add(image.storage_path)
                uploaded_paths.append(image.storage_path)
        except Exception:
            for path in set(uploaded_paths):
                if path:
                    storage_service.delete_order_image(path)
            raise
        return uploaded_paths

    def _cleanup_uploaded_images(self, storage_paths: Sequence[str] | set[str]) -> None:
        unique_paths = {p for p in storage_paths if p}
        for path in unique_paths:
            storage_service.delete_order_image(path)

    def _sync_order_to_firestore(self, order_resp: OrderResponse) -> bool:
        """Mirror the Master-Detail order structure into Firestore `orders/{order_number}`."""
        settings = get_settings()
        if not settings.FIRESTORE_SYNC_ENABLED:
            return False

        try:
            fs_client = get_firestore_client()
            doc_payload = build_firestore_order_document(order_resp)
            fs_client.collection(FIRESTORE_ORDERS_COLLECTION).document(
                order_resp.order_number
            ).set(doc_payload)
            return True
        except FirebaseNotConfiguredError:
            logger.debug(
                "Firestore sync skipped for %s: Firebase Admin no configurado.",
                order_resp.order_number,
            )
            return False
        except Exception as exc:
            logger.warning(
                "No se pudo sincronizar el pedido %s en Firestore (%s). "
                "El pedido permanece persistido en la base de datos relacional.",
                order_resp.order_number,
                type(exc).__name__,
            )
            return False

    def _delete_order_from_firestore(self, order_number: str) -> None:
        """Best-effort removal of the mirrored Firestore Master-Detail order document."""
        settings = get_settings()
        if not settings.FIRESTORE_SYNC_ENABLED:
            return

        try:
            fs_client = get_firestore_client()
            fs_client.collection(FIRESTORE_ORDERS_COLLECTION).document(order_number).delete()
        except Exception as exc:
            logger.warning(
                "No se pudo eliminar el documento %s en Firestore (%s).",
                order_number,
                type(exc).__name__,
            )

    def _resolve_images_for_items(
        self,
        payload: OrderCreateInput,
        images: Sequence[ValidatedImageFile],
    ) -> List[ValidatedImageFile]:
        """
        Map each `OrderItemCreateInput` to its `ValidatedImageFile`.
        - When any item specifies `image_index`, validates `0 <= idx < len(images)` so multiple
          items (e.g. same artwork in 5 cm and 8 cm) reference the same uploaded `ValidatedImageFile`.
        - When `image_index` is omitted across all items, maintains 1:1 backward compatibility.
        """
        uses_image_index = any(item.image_index is not None for item in payload.items)
        if uses_image_index:
            if len(images) == 0:
                raise HTTPException(
                    status_code=422,
                    detail="Debes adjuntar al menos una imagen para los diseños del pedido.",
                )
            resolved: List[ValidatedImageFile] = []
            for pos, item in enumerate(payload.items):
                idx = item.image_index if item.image_index is not None else pos
                if idx < 0 or idx >= len(images):
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"Diseño #{pos + 1}: image_index={idx} fuera de rango "
                            f"(debe estar entre 0 y {len(images) - 1} para {len(images)} imagen(es))."
                        ),
                    )
                resolved.append(images[idx])
            return resolved

        if len(images) != len(payload.items):
            raise HTTPException(
                status_code=422,
                detail=(
                    "Debes adjuntar exactamente una imagen por cada diseño en 'items' "
                    f"(se recibieron {len(payload.items)} diseño(s) y {len(images)} imagen(es))."
                ),
            )
        return list(images)

    def _validate_images_match_items(
        self,
        payload: OrderCreateInput,
        images: Sequence[ValidatedImageFile],
    ) -> None:
        self._resolve_images_for_items(payload, images)

    def create_public_order(
        self,
        db: Session,
        payload: OrderCreateInput,
        images: Sequence[ValidatedImageFile] | ValidatedImageFile,
    ) -> PublicOrderConfirmation:
        image_list: List[ValidatedImageFile] = (
            [images] if isinstance(images, ValidatedImageFile) else list(images)
        )
        item_images = self._resolve_images_for_items(payload, image_list)

        received_at = _ensure_utc(payload.received_at)
        order_number = _generate_order_number(received_at.astimezone(_studio_tz()))

        uploaded_paths = self._upload_item_images_atomically(item_images, order_number=order_number)

        try:
            customer = self._upsert_customer(db, payload.referral_name, payload.phone)
            resolved_catalog: List[Tuple[Material, Shape]] = [
                self._get_material_and_shape(db, item.material.value, item.shape.value)
                for item in payload.items
            ]

            first_item = payload.items[0]
            first_mat, first_shape = resolved_catalog[0]
            first_image = item_images[0]

            order = Order(
                order_number=order_number,
                customer_id=customer.id,
                material_id=first_mat.id,
                vinyl_gloss_mode=(
                    first_item.vinyl_gloss_mode.value if first_item.vinyl_gloss_mode else None
                ),
                shape_id=first_shape.id,
                diameter_cm=first_item.diameter_cm,
                size_mode=first_item.size_mode.value if first_item.size_mode else None,
                height_cm=first_item.height_cm,
                width_cm=first_item.width_cm,
                dimensions=first_item.dimensions,
                size_display=first_item.size_display,
                quantity=payload.total_quantity,
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

            # Persist primary legacy image mirror for compatibility with single-image tooling
            db.add(
                OrderImage(
                    order_id=order.id,
                    storage_path=first_image.storage_path,
                    safe_filename=first_image.safe_filename,
                    original_filename=first_image.original_sanitized_name,
                    content_type=first_image.content_type,
                    size_bytes=first_image.size_bytes,
                )
            )

            # Persist every design item in Master-Detail `order_items`
            for position, (item_in, (mat_row, shape_row), img_file) in enumerate(
                zip(payload.items, resolved_catalog, item_images), start=1
            ):
                db.add(
                    OrderItem(
                        order_id=order.id,
                        position=position,
                        material_id=mat_row.id,
                        vinyl_gloss_mode=(
                            item_in.vinyl_gloss_mode.value if item_in.vinyl_gloss_mode else None
                        ),
                        shape_id=shape_row.id,
                        diameter_cm=item_in.diameter_cm,
                        size_mode=item_in.size_mode.value if item_in.size_mode else None,
                        height_cm=item_in.height_cm,
                        width_cm=item_in.width_cm,
                        dimensions=item_in.dimensions,
                        size_display=item_in.size_display,
                        quantity=item_in.quantity,
                        image_storage_path=img_file.storage_path,
                        image_safe_filename=img_file.safe_filename,
                        image_original_filename=img_file.original_sanitized_name,
                        image_content_type=img_file.content_type,
                        image_size_bytes=img_file.size_bytes,
                    )
                )

            db.add(
                OrderStatusHistory(
                    order_id=order.id,
                    previous_status=None,
                    new_status=OrderStatus.PENDIENTE.value,
                    comment=(
                        f"Pedido recibido desde el portal público "
                        f"({len(payload.items)} diseño(s), {payload.total_quantity} unidad(es))."
                    ),
                )
            )
            db.commit()
            order_id = order.id
        except HTTPException:
            db.rollback()
            self._cleanup_uploaded_images(uploaded_paths)
            raise
        except IntegrityError as exc:
            db.rollback()
            self._cleanup_uploaded_images(uploaded_paths)
            logger.exception("Relational integrity violation creating public order.")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Los datos del pedido incumplen una restricción de integridad.",
            ) from exc
        except Exception as exc:
            db.rollback()
            self._cleanup_uploaded_images(uploaded_paths)
            logger.exception("Error saving public order to relational DB.")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="No se pudo registrar el pedido en la base de datos.",
            ) from exc

        created_order = self.get_order_by_id(db, str(order_id))
        self._sync_order_to_firestore(created_order)

        primary = created_order.items[0]
        return PublicOrderConfirmation(
            id=created_order.id,
            order_number=created_order.order_number,
            referral_name=created_order.referral_name,
            phone=created_order.phone,
            received_at=created_order.received_at,
            delivery_datetime=created_order.delivery_datetime,
            status=created_order.status,
            items=created_order.items,
            items_count=created_order.items_count,
            total_quantity=created_order.total_quantity,
            material=primary.material,
            vinyl_gloss_mode=primary.vinyl_gloss_mode,
            shape=primary.shape,
            diameter_cm=primary.diameter_cm,
            dimensions=primary.dimensions,
            size_display=primary.size_display,
            quantity=created_order.total_quantity,
            message="Tu pedido fue recibido correctamente. Conserva tu número de orden para seguimiento.",
        )

    def create_admin_order(
        self,
        db: Session,
        payload: AdminQuickOrderCreateInput,
        images: Sequence[ValidatedImageFile] | ValidatedImageFile,
        user: AuthenticatedUser,
    ) -> OrderResponse:
        image_list: List[ValidatedImageFile] = (
            [images] if isinstance(images, ValidatedImageFile) else list(images)
        )
        item_images = self._resolve_images_for_items(payload, image_list)

        received_at = _ensure_utc(payload.received_at)
        order_number = _generate_order_number(received_at.astimezone(_studio_tz()))
        pending_balance = round(max(0.0, payload.total_price - payload.advance_payment), 2)

        uploaded_paths = self._upload_item_images_atomically(item_images, order_number=order_number)

        try:
            customer = self._upsert_customer(db, payload.referral_name, payload.phone)
            resolved_catalog: List[Tuple[Material, Shape]] = [
                self._get_material_and_shape(db, item.material.value, item.shape.value)
                for item in payload.items
            ]

            first_item = payload.items[0]
            first_mat, first_shape = resolved_catalog[0]
            first_image = item_images[0]

            order = Order(
                order_number=order_number,
                customer_id=customer.id,
                material_id=first_mat.id,
                vinyl_gloss_mode=(
                    first_item.vinyl_gloss_mode.value if first_item.vinyl_gloss_mode else None
                ),
                shape_id=first_shape.id,
                diameter_cm=first_item.diameter_cm,
                size_mode=first_item.size_mode.value if first_item.size_mode else None,
                height_cm=first_item.height_cm,
                width_cm=first_item.width_cm,
                dimensions=first_item.dimensions,
                size_display=first_item.size_display,
                quantity=payload.total_quantity,
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
                    storage_path=first_image.storage_path,
                    safe_filename=first_image.safe_filename,
                    original_filename=first_image.original_sanitized_name,
                    content_type=first_image.content_type,
                    size_bytes=first_image.size_bytes,
                )
            )

            for position, (item_in, (mat_row, shape_row), img_file) in enumerate(
                zip(payload.items, resolved_catalog, item_images), start=1
            ):
                db.add(
                    OrderItem(
                        order_id=order.id,
                        position=position,
                        material_id=mat_row.id,
                        vinyl_gloss_mode=(
                            item_in.vinyl_gloss_mode.value if item_in.vinyl_gloss_mode else None
                        ),
                        shape_id=shape_row.id,
                        diameter_cm=item_in.diameter_cm,
                        size_mode=item_in.size_mode.value if item_in.size_mode else None,
                        height_cm=item_in.height_cm,
                        width_cm=item_in.width_cm,
                        dimensions=item_in.dimensions,
                        size_display=item_in.size_display,
                        quantity=item_in.quantity,
                        image_storage_path=img_file.storage_path,
                        image_safe_filename=img_file.safe_filename,
                        image_original_filename=img_file.original_sanitized_name,
                        image_content_type=img_file.content_type,
                        image_size_bytes=img_file.size_bytes,
                    )
                )

            db.add(
                OrderStatusHistory(
                    order_id=order.id,
                    previous_status=None,
                    new_status=payload.status.value,
                    changed_by_user_id=user.db_user_id,
                    comment=(
                        f"Pedido rápido registrado desde el panel interno "
                        f"({len(payload.items)} diseño(s), {payload.total_quantity} unidad(es))."
                    ),
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
            self._cleanup_uploaded_images(uploaded_paths)
            raise
        except IntegrityError as exc:
            db.rollback()
            self._cleanup_uploaded_images(uploaded_paths)
            logger.exception("Relational integrity violation creating admin order.")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Los datos del pedido incumplen una restricción de integridad.",
            ) from exc
        except Exception as exc:
            db.rollback()
            self._cleanup_uploaded_images(uploaded_paths)
            logger.exception("Error saving admin quick order.")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="No se pudo registrar el pedido rápido.",
            ) from exc

        created_order = self.get_order_by_id(db, str(order_id))
        self._sync_order_to_firestore(created_order)
        return created_order

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
        conditions = []
        terminal_values = [s.value for s in TERMINAL_STATUSES]

        if only_pending:
            conditions.append(Order.status.notin_(terminal_values))
        if status_filter is not None:
            conditions.append(Order.status == status_filter.value)
        if material_filter is not None:
            mat_name = material_filter.value
            conditions.append(
                or_(
                    Order.items.any(OrderItem.material.has(Material.name == mat_name)),
                    and_(~Order.items.any(), Order.material.has(Material.name == mat_name)),
                )
            )
        if shape_filter is not None:
            shape_name = shape_filter.value
            conditions.append(
                or_(
                    Order.items.any(OrderItem.shape.has(Shape.name == shape_name)),
                    and_(~Order.items.any(), Order.shape.has(Shape.name == shape_name)),
                )
            )
        if delivery_date is not None:
            tz = _studio_tz()
            day_start_local = datetime(
                delivery_date.year, delivery_date.month, delivery_date.day, 0, 0, 0, tzinfo=tz
            )
            day_start_utc = day_start_local.astimezone(timezone.utc)
            day_end_utc = (day_start_local + timedelta(days=1)).astimezone(timezone.utc)
            bind = db.get_bind()
            if bind is not None and bind.dialect.name == "sqlite":
                day_start_utc = day_start_utc.replace(tzinfo=None)
                day_end_utc = day_end_utc.replace(tzinfo=None)
            conditions.append(Order.delivery_datetime >= day_start_utc)
            conditions.append(Order.delivery_datetime < day_end_utc)

        normalized_query = (search or "").strip()
        if normalized_query:
            escaped = (
                normalized_query.replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            pattern = f"%{escaped}%"
            conditions.append(
                or_(
                    Order.order_number.ilike(pattern, escape="\\"),
                    Order.customer.has(
                        or_(
                            Customer.referral_name.ilike(pattern, escape="\\"),
                            Customer.phone.ilike(pattern, escape="\\"),
                        )
                    ),
                )
            )

        count_stmt = select(func.count(Order.id))
        if conditions:
            count_stmt = count_stmt.where(*conditions)
        total = int(db.scalar(count_stmt) or 0)

        priority_expr = case((Order.status.in_(terminal_values), 1), else_=0)
        stmt = self._base_order_query()
        if conditions:
            stmt = stmt.where(*conditions)
        stmt = stmt.order_by(priority_expr.asc(), Order.delivery_datetime.asc()).limit(limit)

        rows = db.scalars(stmt).unique().all()
        return OrderListResponse(items=[_orm_to_order_response(row) for row in rows], total=total)

    def get_order_by_id(self, db: Session, order_id: str) -> OrderResponse:
        pk = self._resolve_order_pk(order_id)
        order = db.scalars(self._base_order_query().where(Order.id == pk)).unique().first()
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pedido no encontrado.",
            )
        return _orm_to_order_response(order)

    def get_order_item_image(
        self,
        db: Session,
        order_id: str,
        item_id: Optional[str] = None,
        *,
        variant: str = "original",
    ) -> Tuple[OrderResponse, OrderImageInfo, Optional[int]]:
        """Resolve either a specific item's image or the primary item's image (original or enhanced)."""
        order = self.get_order_by_id(db, order_id)
        target_item: Optional[OrderItemResponse] = None

        if item_id is None:
            target_item = order.items[0] if order.items else None
        else:
            for item in order.items:
                if item.id == str(item_id):
                    target_item = item
                    break
            if target_item is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Diseño de sticker no encontrado en este pedido.",
                )

        if variant == "enhanced":
            if target_item and target_item.enhanced_storage_path:
                safe_name = target_item.enhanced_storage_path.rsplit("/", 1)[-1]
                return (
                    order,
                    OrderImageInfo(
                        storage_path=target_item.enhanced_storage_path,
                        safe_filename=safe_name,
                        original_filename=f"{order.order_number}_enhanced.png",
                        content_type="image/png",
                        size_bytes=target_item.image.size_bytes,
                    ),
                    target_item.position,
                )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="El diseño seleccionado aún no cuenta con una versión mejorada.",
            )

        if target_item is not None:
            if not target_item.image.storage_path:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="El diseño seleccionado no cuenta con una imagen asociada.",
                )
            return order, target_item.image, target_item.position

        if not order.image.storage_path:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="El pedido no cuenta con una imagen asociada.",
            )
        return order, order.image, 1

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
            if len(order.items) == 1:
                order.items[0].quantity = payload.quantity

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

        updated_order = self.get_order_by_id(db, str(pk))
        self._sync_order_to_firestore(updated_order)
        return updated_order

    def delete_order(self, db: Session, order_id: str) -> None:
        """Delete order (CASCADE deletes items, image metadata, history & payments) + all image files."""
        pk = self._resolve_order_pk(order_id)
        order = (
            db.scalars(
                select(Order)
                .options(joinedload(Order.image), selectinload(Order.items))
                .where(Order.id == pk)
            )
            .unique()
            .first()
        )
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pedido no encontrado.",
            )

        order_number = order.order_number
        storage_paths: List[str] = []
        if order.image and order.image.storage_path:
            storage_paths.append(order.image.storage_path)
        for item in order.items or []:
            if item.image_storage_path:
                storage_paths.append(item.image_storage_path)
            if item.enhanced_storage_path:
                storage_paths.append(item.enhanced_storage_path)
            if item.die_cut_eps_path:
                storage_paths.append(item.die_cut_eps_path)

        unique_storage_paths = set(storage_paths)

        db.delete(order)
        db.commit()

        self._cleanup_uploaded_images(unique_storage_paths)
        self._delete_order_from_firestore(order_number)

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
