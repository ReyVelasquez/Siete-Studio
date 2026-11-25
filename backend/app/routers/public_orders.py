"""Public storefront endpoints for unauthenticated Master-Detail customer order intake."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, List, Optional, Sequence

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.file_security import ValidatedImageFile, validate_and_prepare_image
from app.core.rate_limit import enforce_public_order_rate_limit
from app.db.database import get_db
from app.schemas.order import (
    OrderCreateInput,
    OrderItemCreateInput,
    PublicOrderConfirmation,
    format_order_validation_error,
    parse_order_items_json,
)
from app.services.order_service import order_service

router = APIRouter(prefix="/public/orders", tags=["Public Orders"])


def resolve_raw_order_items(
    *,
    items_json: Optional[str],
    material: Optional[str],
    vinyl_gloss_mode: Optional[str],
    shape: Optional[str],
    diameter_cm: Optional[str],
    dimensions: Optional[str],
    quantity: Optional[int],
    size_mode: Optional[str] = None,
    height_cm: Optional[str] = None,
    width_cm: Optional[str] = None,
) -> List[dict[str, Any]]:
    """
    Resolve Master-Detail `items` from multipart form data.
    Enforces `MAX_ITEMS_JSON_BYTES` BEFORE parsing JSON and enforces `MAX_ORDER_ITEMS`.
    Seamlessly falls back to legacy single-sticker fields when `items` is omitted.
    """
    settings = get_settings()

    if items_json is not None and items_json.strip() != "":
        if len(items_json.encode("utf-8")) > settings.MAX_ITEMS_JSON_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=(
                    "El campo 'items' supera el tamaño máximo permitido "
                    f"({settings.MAX_ITEMS_JSON_BYTES // 1024} KB)."
                ),
            )

        try:
            raw_items = parse_order_items_json(
                items_json, max_bytes=settings.MAX_ITEMS_JSON_BYTES
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        if len(raw_items) > settings.MAX_ORDER_ITEMS:
            raise HTTPException(
                status_code=422,
                detail=f"Un pedido puede contener como máximo {settings.MAX_ORDER_ITEMS} diseños.",
            )
        return raw_items

    if items_json is not None and items_json.strip() == "":
        raise HTTPException(
            status_code=422,
            detail="El pedido debe incluir al menos 1 diseño en la lista 'items'.",
        )

    # Backward-compatible single-sticker fallback
    if material is None and shape is None and quantity is None:
        raise HTTPException(
            status_code=422,
            detail="Debes enviar la lista 'items' con al menos 1 diseño de sticker.",
        )

    return [
        {
            "material": material,
            "vinyl_gloss_mode": vinyl_gloss_mode,
            "shape": shape,
            "diameter_cm": diameter_cm,
            "size_mode": size_mode,
            "height_cm": height_cm,
            "width_cm": width_cm,
            "dimensions": dimensions,
            "quantity": quantity,
        }
    ]


async def validate_order_item_uploads(
    *,
    expected_count: int,
    images: Optional[Sequence[UploadFile]],
    legacy_image: Optional[UploadFile],
    items: Optional[Sequence[OrderItemCreateInput]] = None,
) -> List[ValidatedImageFile]:
    """
    Resolve and validate uploaded artwork files for `items` (extension, Content-Type vs magic
    bytes, allowlist SVG safety, per-file limit & cumulative `MAX_TOTAL_ORDER_UPLOAD_MB` budget).
    - When any item specifies `image_index`, allows multiple items (e.g. same artwork in different
      sizes) to reference the same entry in `images[]`, validating `0 <= image_index < len(uploads)`.
    - When `image_index` is omitted, enforces backward-compatible 1-image-per-item matching.
    Explicitly closes every `UploadFile` handle in a `finally` block to avoid leaking temp FDs.
    """
    all_handles: List[UploadFile] = []
    if images:
        all_handles.extend(images)
    if legacy_image is not None:
        all_handles.append(legacy_image)

    try:
        if images and legacy_image is not None:
            raise HTTPException(
                status_code=422,
                detail="Envía los archivos usando únicamente el campo 'images' (o 'image' para un solo diseño), no ambos.",
            )

        uploads = list(images) if images else ([legacy_image] if legacy_image is not None else [])
        settings = get_settings()
        uses_image_index = bool(items and any(item.image_index is not None for item in items))

        if uses_image_index and items is not None:
            if len(uploads) == 0:
                raise HTTPException(
                    status_code=422,
                    detail="Debes adjuntar al menos una imagen en 'images' para los diseños del pedido.",
                )
            if len(uploads) > settings.MAX_ORDER_ITEMS:
                raise HTTPException(
                    status_code=422,
                    detail=f"No se permiten más de {settings.MAX_ORDER_ITEMS} imágenes por pedido.",
                )
            for pos, item in enumerate(items):
                idx = item.image_index if item.image_index is not None else pos
                if idx < 0 or idx >= len(uploads):
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"Diseño #{pos + 1}: image_index={idx} fuera de rango "
                            f"(debe estar entre 0 y {len(uploads) - 1} para {len(uploads)} imagen(es) adjunta(s))."
                        ),
                    )
        else:
            if len(uploads) != expected_count:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Debes adjuntar exactamente una imagen por cada diseño en 'items' "
                        f"(se recibieron {expected_count} diseño(s) y {len(uploads)} imagen(es))."
                    ),
                )

        max_total_bytes = settings.max_total_order_upload_bytes
        accumulated_bytes = 0

        validated: List[ValidatedImageFile] = []
        for idx, upload in enumerate(uploads, start=1):
            remaining_budget = max(0, max_total_bytes - accumulated_bytes)
            try:
                prepared = await validate_and_prepare_image(
                    upload,
                    remaining_budget_bytes=remaining_budget,
                )
            except HTTPException as exc:
                detail = exc.detail
                if len(uploads) > 1 and isinstance(detail, str):
                    label = f"Archivo #{idx}" if uses_image_index else f"Diseño #{idx}"
                    detail = f"{label}: {detail}"
                raise HTTPException(status_code=exc.status_code, detail=detail) from exc
            accumulated_bytes += prepared.size_bytes
            validated.append(prepared)

        return validated
    finally:
        for upload in all_handles:
            try:
                await upload.close()
            except Exception:
                pass


@router.post(
    "",
    response_model=PublicOrderConfirmation,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(enforce_public_order_rate_limit)],
    summary="Registrar pedido público de stickers (Maestro-Detalle con múltiples diseños e imágenes)",
    description=(
        "Crea un pedido Maestro-Detalle mediante `multipart/form-data`. "
        "Envía los datos del cliente (`referral_name`, `phone`, `delivery_datetime` en hora en punto), "
        "el arreglo JSON `items` (mínimo 1 y máximo 20 diseños, máx. 64 KB) y las imágenes en `images` "
        "(máx. 60 MB acumulados; soporta `image_index` para reutilizar el mismo arte en varias medidas). "
        "La fecha de recepción se asigna estrictamente en el servidor en UTC."
    ),
)
async def create_public_order(
    referral_name: Annotated[str, Form(description="Nombre de referido del cliente.")],
    phone: Annotated[str, Form(description="Teléfono o WhatsApp del cliente.")],
    delivery_datetime: Annotated[
        str,
        Form(description="Fecha y hora de entrega en formato ISO-8601 con minutos en :00."),
    ],
    items: Annotated[
        Optional[str],
        Form(
            description=(
                "Arreglo JSON con los diseños del pedido (entre 1 y 20). Cada elemento requiere "
                "`material` (`vinyl_gloss_mode` si es 'Vinilo Brillo'), `shape`, `diameter_cm` "
                "(si es Circular) o `dimensions`, `quantity`, y opcionalmente `image_index`."
            )
        ),
    ] = None,
    images: Annotated[
        Optional[List[UploadFile]],
        File(description="Lista de imágenes subidas (1 por diseño o compartidas mediante `image_index`)."),
    ] = None,
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
    db: Session = Depends(get_db),
) -> PublicOrderConfirmation:
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

    # Strictly enforce server-generated UTC reception timestamp on public endpoint
    server_received_at = datetime.now(timezone.utc)

    try:
        validated_payload = OrderCreateInput(
            referral_name=referral_name,
            phone=phone,
            received_at=server_received_at,
            delivery_datetime=delivery_datetime,
            items=raw_items,
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
    return order_service.create_public_order(db, validated_payload, validated_images)
