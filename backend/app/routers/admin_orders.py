"""Protected administrative endpoints for Master-Detail order CRUD, sales control & artwork download."""

from __future__ import annotations

from datetime import date
from typing import Annotated, List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.security import AuthenticatedUser, require_staff
from app.db.database import get_db
from app.routers.public_orders import resolve_raw_order_items, validate_order_item_uploads
from app.schemas.order import (
    AdminQuickOrderCreateInput,
    OrderListResponse,
    OrderResponse,
    OrderSalesUpdateInput,
    OrderStatus,
    PaymentMethod,
    StickerMaterial,
    StickerShape,
    format_order_validation_error,
)
from app.services.order_service import order_service
from app.services.storage_service import storage_service

router = APIRouter(
    prefix="/admin/orders",
    tags=["Admin Orders & Sales"],
    dependencies=[Depends(require_staff)],
)


def _build_image_response(
    *,
    order_number: str,
    storage_path: str,
    safe_filename: str,
    position: Optional[int],
    download: bool,
) -> Response:
    data, content_type = storage_service.download_order_image(storage_path)
    ext = "." + safe_filename.rsplit(".", 1)[-1] if "." in safe_filename else ""
    suffix = f"-item-{position}" if position and position > 1 else ""
    download_name = f"{order_number}{suffix}{ext}"
    is_svg = content_type.lower().split(";", 1)[0].strip() == "image/svg+xml" or ext.lower() == ".svg"
    disposition = "attachment" if download else "inline"

    headers = {
        "Content-Disposition": f'{disposition}; filename="{download_name}"',
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
    }
    if is_svg:
        headers["Content-Security-Policy"] = "default-src 'none'; sandbox"

    return Response(
        content=data,
        media_type=content_type,
        headers=headers,
    )


@router.get("", response_model=OrderListResponse, summary="Listar pedidos con filtros y prioridad")
async def list_admin_orders(
    status_filter: Annotated[Optional[OrderStatus], Query(alias="status")] = None,
    material: Annotated[Optional[StickerMaterial], Query()] = None,
    shape: Annotated[Optional[StickerShape], Query()] = None,
    search: Annotated[Optional[str], Query(max_length=120)] = None,
    only_pending: Annotated[bool, Query()] = False,
    delivery_date: Annotated[Optional[date], Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    db: Session = Depends(get_db),
) -> OrderListResponse:
    return order_service.list_orders(
        db,
        status_filter=status_filter,
        material_filter=material,
        shape_filter=shape,
        search=search,
        only_pending=only_pending,
        delivery_date=delivery_date,
        limit=limit,
    )


@router.post(
    "",
    response_model=OrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear pedido Maestro-Detalle rápido desde el panel interno",
    description=(
        "Registra un pedido desde el panel interno con uno o más diseños (`items` JSON) "
        "y sus imágenes correspondientes (`images`), además de datos iniciales de venta y estado. "
        "Mantiene compatibilidad con envío legado de un solo diseño."
    ),
)
async def create_admin_quick_order(
    referral_name: Annotated[str, Form()],
    phone: Annotated[str, Form()],
    delivery_datetime: Annotated[str, Form()],
    received_at: Annotated[Optional[str], Form()] = None,
    items: Annotated[Optional[str], Form()] = None,
    images: Annotated[Optional[List[UploadFile]], File()] = None,
    # Financial & internal workflow metadata
    total_price: Annotated[float, Form()] = 0.0,
    advance_payment: Annotated[float, Form()] = 0.0,
    payment_method: Annotated[PaymentMethod, Form()] = PaymentMethod.PENDIENTE,
    order_status: Annotated[OrderStatus, Form(alias="status")] = OrderStatus.PENDIENTE,
    notes: Annotated[Optional[str], Form()] = None,
    # Legacy single-item form fields (backward compatibility)
    material: Annotated[Optional[str], Form()] = None,
    vinyl_gloss_mode: Annotated[Optional[str], Form()] = None,
    shape: Annotated[Optional[str], Form()] = None,
    diameter_cm: Annotated[Optional[str], Form()] = None,
    size_mode: Annotated[Optional[str], Form()] = None,
    height_cm: Annotated[Optional[str], Form()] = None,
    width_cm: Annotated[Optional[str], Form()] = None,
    dimensions: Annotated[Optional[str], Form()] = None,
    quantity: Annotated[Optional[int], Form()] = None,
    image: Annotated[Optional[UploadFile], File()] = None,
    current_user: AuthenticatedUser = Depends(require_staff),
    db: Session = Depends(get_db),
) -> OrderResponse:
    raw_items = resolve_raw_order_items(
        items_json=items,
        material=material,
        vinyl_gloss_mode=vinyl_gloss_mode,
        shape=shape,
        diameter_cm=diameter_cm,
        size_mode=size_mode,
        height_cm=height_cm,
        width_cm=width_cm,
        dimensions=dimensions,
        quantity=quantity,
    )

    try:
        validated_payload = AdminQuickOrderCreateInput(
            referral_name=referral_name,
            phone=phone,
            received_at=received_at,
            delivery_datetime=delivery_datetime,
            items=raw_items,
            total_price=total_price,
            advance_payment=advance_payment,
            payment_method=payment_method,
            status=order_status,
            notes=notes,
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=format_order_validation_error(exc),
        ) from exc

    validated_images = await validate_order_item_uploads(
        expected_count=len(validated_payload.items),
        images=images,
        legacy_image=image,
        items=validated_payload.items,
    )
    return order_service.create_admin_order(db, validated_payload, validated_images, current_user)


@router.get("/{order_id}", response_model=OrderResponse, summary="Obtener detalle de pedido")
async def get_admin_order(
    order_id: str,
    db: Session = Depends(get_db),
) -> OrderResponse:
    return order_service.get_order_by_id(db, order_id)


@router.patch(
    "/{order_id}",
    response_model=OrderResponse,
    summary="Actualizar datos, ventas, pagos y estado de un pedido",
)
async def update_admin_order_sales(
    order_id: str,
    payload: OrderSalesUpdateInput,
    current_user: AuthenticatedUser = Depends(require_staff),
    db: Session = Depends(get_db),
) -> OrderResponse:
    return order_service.update_order_sales(db, order_id, payload, current_user)


@router.delete(
    "/{order_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar un pedido (ON DELETE CASCADE en diseños, imágenes, historial y pagos)",
)
async def delete_admin_order(
    order_id: str,
    db: Session = Depends(get_db),
) -> Response:
    order_service.delete_order(db, order_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{order_id}/image",
    summary="Descargar o previsualizar la imagen principal (o de un ítem vía ?item_id) del pedido",
)
async def download_order_image(
    order_id: str,
    item_id: Annotated[Optional[str], Query(description="ID opcional de un diseño específico")] = None,
    variant: Annotated[
        Optional[Literal["original", "enhanced"]],
        Query(description="Variante de imagen: 'original' (cliente) o 'enhanced' (preprensa)."),
    ] = None,
    version: Annotated[
        Optional[Literal["original", "enhanced"]],
        Query(description="Alias de variant: 'original' o 'enhanced'."),
    ] = None,
    download: Annotated[bool, Query()] = False,
    db: Session = Depends(get_db),
) -> Response:
    selected_variant: Literal["original", "enhanced"] = variant or version or "original"
    order, img_info, pos = order_service.get_order_item_image(
        db, order_id, item_id=item_id, variant=selected_variant
    )
    return _build_image_response(
        order_number=order.order_number,
        storage_path=img_info.storage_path,
        safe_filename=img_info.safe_filename,
        position=pos if item_id is not None else None,
        download=download,
    )


@router.get(
    "/{order_id}/items/{item_id}/image",
    summary="Descargar o previsualizar la imagen propia de un diseño específico del pedido",
)
async def download_order_item_image(
    order_id: str,
    item_id: str,
    variant: Annotated[
        Optional[Literal["original", "enhanced"]],
        Query(description="Variante de imagen: 'original' (cliente) o 'enhanced' (preprensa)."),
    ] = None,
    version: Annotated[
        Optional[Literal["original", "enhanced"]],
        Query(description="Alias de variant: 'original' o 'enhanced'."),
    ] = None,
    download: Annotated[bool, Query()] = False,
    db: Session = Depends(get_db),
) -> Response:
    selected_variant: Literal["original", "enhanced"] = variant or version or "original"
    order, img_info, pos = order_service.get_order_item_image(
        db, order_id, item_id=item_id, variant=selected_variant
    )
    return _build_image_response(
        order_number=order.order_number,
        storage_path=img_info.storage_path,
        safe_filename=img_info.safe_filename,
        position=pos,
        download=download,
    )
