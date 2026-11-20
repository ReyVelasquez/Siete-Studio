"""Protected administrative endpoints for order management, sales control, and artwork download."""

from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import ValidationError

from app.core.file_security import validate_and_prepare_image
from app.core.security import AuthenticatedUser, get_current_user
from app.schemas.order import (
    AdminQuickOrderCreateInput,
    OrderListResponse,
    OrderResponse,
    OrderSalesUpdateInput,
    OrderStatus,
    PaymentMethod,
    StickerMaterial,
    StickerShape,
)
from app.services.order_service import order_service
from app.services.storage_service import storage_service

router = APIRouter(
    prefix="/admin/orders",
    tags=["Admin Orders & Sales"],
    dependencies=[Depends(get_current_user)],
)


def _format_validation_error(exc: ValidationError) -> str:
    messages = []
    for err in exc.errors():
        msg = err.get("msg", "Valor inválido")
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, ") :]
        messages.append(msg)
    return " ".join(messages)


@router.get("", response_model=OrderListResponse, summary="Listar pedidos con filtros y prioridad")
async def list_admin_orders(
    status_filter: Optional[OrderStatus] = Query(default=None, alias="status"),
    material: Optional[StickerMaterial] = Query(default=None),
    shape: Optional[StickerShape] = Query(default=None),
    search: Optional[str] = Query(default=None, max_length=120),
    only_pending: bool = Query(default=False),
    delivery_date: Optional[date] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
) -> OrderListResponse:
    return order_service.list_orders(
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
    summary="Crear pedido rápido desde el panel interno",
)
async def create_admin_quick_order(
    referral_name: str = Form(...),
    phone: str = Form(...),
    material: str = Form(...),
    vinyl_gloss_mode: Optional[str] = Form(default=None),
    shape: str = Form(...),
    diameter_cm: Optional[str] = Form(default=None),
    dimensions: Optional[str] = Form(default=None),
    quantity: int = Form(...),
    delivery_datetime: str = Form(...),
    total_price: float = Form(default=0.0),
    advance_payment: float = Form(default=0.0),
    payment_method: PaymentMethod = Form(default=PaymentMethod.PENDIENTE),
    order_status: OrderStatus = Form(default=OrderStatus.PENDIENTE, alias="status"),
    notes: Optional[str] = Form(default=None),
    image: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> OrderResponse:
    try:
        validated_payload = AdminQuickOrderCreateInput(
            referral_name=referral_name,
            phone=phone,
            material=material,
            vinyl_gloss_mode=vinyl_gloss_mode,
            shape=shape,
            diameter_cm=diameter_cm,
            dimensions=dimensions,
            quantity=quantity,
            delivery_datetime=delivery_datetime,
            total_price=total_price,
            advance_payment=advance_payment,
            payment_method=payment_method,
            status=order_status,
            notes=notes,
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=_format_validation_error(exc),
        ) from exc

    validated_image = await validate_and_prepare_image(image)
    return order_service.create_admin_order(validated_payload, validated_image, current_user)


@router.get("/{order_id}", response_model=OrderResponse, summary="Obtener detalle de pedido")
async def get_admin_order(order_id: str) -> OrderResponse:
    return order_service.get_order_by_id(order_id)


@router.patch(
    "/{order_id}",
    response_model=OrderResponse,
    summary="Actualizar ventas, pagos y estado de un pedido",
)
async def update_admin_order_sales(
    order_id: str,
    payload: OrderSalesUpdateInput,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> OrderResponse:
    return order_service.update_order_sales(order_id, payload, current_user)


@router.get(
    "/{order_id}/image",
    summary="Descargar o previsualizar imagen original del pedido de forma segura",
)
async def download_order_image(
    order_id: str,
    download: bool = Query(default=False),
) -> Response:
    order = order_service.get_order_by_id(order_id)
    if not order.image.storage_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El pedido no cuenta con una imagen asociada.",
        )

    data, content_type = storage_service.download_order_image(order.image.storage_path)
    ext = "." + order.image.safe_filename.rsplit(".", 1)[-1] if "." in order.image.safe_filename else ""
    download_name = f"{order.order_number}{ext}"
    disposition = "attachment" if download else "inline"

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Content-Disposition": f'{disposition}; filename="{download_name}"',
            "Cache-Control": "private, max-age=300",
        },
    )
