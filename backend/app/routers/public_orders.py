"""Public storefront endpoints for unauthenticated customer order intake."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.file_security import validate_and_prepare_image
from app.core.rate_limit import enforce_public_order_rate_limit
from app.db.database import get_db
from app.schemas.order import OrderCreateInput, PublicOrderConfirmation
from app.services.order_service import order_service

router = APIRouter(prefix="/public/orders", tags=["Public Orders"])


def _format_validation_error(exc: ValidationError) -> str:
    messages = []
    for err in exc.errors():
        msg = err.get("msg", "Valor inválido")
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, ") :]
        messages.append(msg)
    return " ".join(messages)


@router.post(
    "",
    response_model=PublicOrderConfirmation,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(enforce_public_order_rate_limit)],
    summary="Registrar pedido público de stickers",
)
async def create_public_order(
    referral_name: str = Form(...),
    phone: str = Form(...),
    material: str = Form(...),
    vinyl_gloss_mode: Optional[str] = Form(default=None),
    shape: str = Form(...),
    diameter_cm: Optional[str] = Form(default=None),
    dimensions: Optional[str] = Form(default=None),
    quantity: int = Form(...),
    delivery_datetime: str = Form(...),
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> PublicOrderConfirmation:
    try:
        validated_payload = OrderCreateInput(
            referral_name=referral_name,
            phone=phone,
            material=material,
            vinyl_gloss_mode=vinyl_gloss_mode,
            shape=shape,
            diameter_cm=diameter_cm,
            dimensions=dimensions,
            quantity=quantity,
            delivery_datetime=delivery_datetime,
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=_format_validation_error(exc),
        ) from exc

    validated_image = await validate_and_prepare_image(image)
    return order_service.create_public_order(db, validated_payload, validated_image)
