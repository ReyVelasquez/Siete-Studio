"""Protected Phase 2 endpoints: Non-Destructive Per-Item Prepress, CMYK, Retouch, Die-Cut EPS & ZIP Pack."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import re
import unicodedata
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Any, List, Literal, Optional, Tuple

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.file_security import validate_and_prepare_image
from app.core.security import AuthenticatedUser, require_staff
from app.db.database import get_db
from app.db.models import Order, OrderItem, OrderStatusHistory
from app.modules.image_processing import (
    DieCutEdgeDetectorService,
    EnhancementOptions,
    ImageAsset,
    ImageEnhancerService,
    LayoutPackPayload,
    RetouchInpaintService,
    SheetLayoutPackerService,
    SheetSpec,
    StickerNestItem,
    check_phase2_dependencies,
)
from app.modules.image_processing.base import BezierAnchor
from app.modules.image_processing.edge_detector import EdgeDetectionPayload
from app.modules.image_processing.enhancer import (
    EnhancePayload,
    compute_effective_dpi_for_item,
    resolve_physical_size_cm,
)
from app.schemas.image_processing import (
    BezierAnchorSchema,
    BgRemovalModeLiteral,
    CmykStatsResponse,
    DetectEdgesRequest,
    DetectEdgesResponse,
    DetectWatermarkMaskResponse,
    DieCutFitModeLiteral,
    DpiPreflightStatus,
    EnhanceImageRequest,
    EnhanceImageResponse,
    ExportDieCutRequest,
    ExportProductionRequest,
    ImageProcessingCapabilitiesResponse,
    MaterialLayoutGroupResponse,
    PackLayoutRequest,
    PackLayoutResponse,
    Phase2ModuleInfo,
    PlacedStickerResponse,
    RetouchInpaintResponse,
    SaveEnhancedToOrderRequest,
    SheetLayoutPageResponse,
)
from app.schemas.order import DIMENSIONS_RE, OrderResponse
from app.services.order_service import order_service
from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/image-processing",
    tags=["Phase 2 - Image Processing, CMYK & Die-Cut EPS"],
    dependencies=[Depends(require_staff)],
)

enhancer_service = ImageEnhancerService()
retouch_service = RetouchInpaintService()
edge_detector_service = DieCutEdgeDetectorService()
layout_packer_service = SheetLayoutPackerService()


# =============================================================================
# Non-Destructive OrderItem Resolution, Real DPI Preflight & ZIP Naming Helpers
# =============================================================================


def _resolve_order_and_item(
    db: Session,
    order_id: str,
    item_id: Optional[int] = None,
) -> Tuple[Order, OrderItem]:
    """
    Resolve an Order and target OrderItem for per-design prepress operations.
    When `item_id` is omitted, defaults to the item at `position == 1` (backward compatibility).
    If a legacy order has no `order_items` rows yet, synthesizes and persists item #1 from `order.image`.
    """
    try:
        order_pk = int(order_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado."
        ) from exc

    order = (
        db.scalars(
            select(Order)
            .options(
                joinedload(Order.image),
                joinedload(Order.material),
                joinedload(Order.shape),
                selectinload(Order.items).joinedload(OrderItem.material),
                selectinload(Order.items).joinedload(OrderItem.shape),
            )
            .where(Order.id == order_pk)
        )
        .unique()
        .first()
    )
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado."
        )

    ordered_items = sorted(order.items or [], key=lambda it: (it.position, it.id))

    if item_id is not None:
        for it in ordered_items:
            if it.id == int(item_id):
                if not it.image_storage_path:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="El diseño seleccionado no tiene una imagen almacenada.",
                    )
                return order, it
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Diseño (item_id={item_id}) no encontrado en este pedido.",
        )

    if ordered_items:
        target = next((it for it in ordered_items if it.position == 1), ordered_items[0])
        if not target.image_storage_path:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="El diseño principal del pedido no tiene una imagen almacenada.",
            )
        return order, target

    # Legacy single-image order fallback: materialize position=1 OrderItem without touching original
    if order.image and order.image.storage_path:
        legacy_item = OrderItem(
            order_id=order.id,
            position=1,
            material_id=order.material_id,
            vinyl_gloss_mode=order.vinyl_gloss_mode,
            shape_id=order.shape_id,
            diameter_cm=order.diameter_cm,
            dimensions=order.dimensions,
            size_display=order.size_display,
            quantity=order.quantity,
            image_storage_path=order.image.storage_path,
            image_safe_filename=order.image.safe_filename,
            image_original_filename=order.image.original_filename,
            image_content_type=order.image.content_type,
            image_size_bytes=order.image.size_bytes,
            image_uploaded_at=order.image.uploaded_at,
            prepress_status="pendiente",
        )
        db.add(legacy_item)
        db.flush()
        return order, legacy_item

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="El pedido seleccionado no tiene una imagen almacenada.",
    )


def resolve_item_artwork_asset(item: OrderItem) -> Tuple[bytes, str, str, bool]:
    """
    Unified artwork loader for `OrderItem`:
    ALWAYS prioritizes `item.enhanced_storage_path` when present and only falls back to
    `item.image_storage_path` when the item was never enhanced.
    Returns `(raw_bytes, content_type, filename, used_enhanced)`.
    """
    enhanced_path = getattr(item, "enhanced_storage_path", None)
    if enhanced_path and str(enhanced_path).strip():
        clean_enh = str(enhanced_path).strip()
        raw_bytes, content_type = storage_service.download_order_image(clean_enh)
        filename = clean_enh.split("?", 1)[0].rsplit("/", 1)[-1]
        return raw_bytes, content_type, filename, True

    orig_path = getattr(item, "image_storage_path", None)
    if not orig_path or not str(orig_path).strip():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El diseño seleccionado no tiene una imagen almacenada.",
        )
    clean_orig = str(orig_path).strip()
    raw_bytes, content_type = storage_service.download_order_image(clean_orig)
    filename = (
        getattr(item, "image_safe_filename", None)
        or clean_orig.split("?", 1)[0].rsplit("/", 1)[-1]
    )
    return raw_bytes, content_type, filename, False


def resolve_item_artwork_bytes(item: OrderItem) -> bytes:
    """
    Return the raw image bytes for `item`, prioritizing `item.enhanced_storage_path`
    over `item.image_storage_path` so Die-Cut Studio and `.EPS`/`.PDF` exports always operate
    on the identical enhanced pixel matrix.
    """
    raw_bytes, _, _, _ = resolve_item_artwork_asset(item)
    return raw_bytes


def _load_saved_item_die_cut_state(
    item: OrderItem,
) -> Tuple[Optional[List[BezierAnchor]], dict[str, Any]]:
    """
    Load persisted die-cut anchors and parameters (`white_border_mm`, `target_width_cm`,
    `target_height_cm`, `fit_mode`, `mode`, `bleed_mm`, etc.) from `OrderItem`.
    """
    cfg: dict[str, Any] = {}
    anchors_raw: Optional[List[dict[str, Any]]] = None

    raw_cfg_json = getattr(item, "die_cut_config_json", None)
    if raw_cfg_json:
        try:
            parsed_cfg = json.loads(raw_cfg_json)
            if isinstance(parsed_cfg, dict):
                cfg.update(parsed_cfg)
                if isinstance(parsed_cfg.get("anchors"), list):
                    anchors_raw = parsed_cfg["anchors"]
        except Exception:
            pass

    raw_anchors_json = getattr(item, "die_cut_anchors_json", None)
    if raw_anchors_json:
        try:
            parsed_anc = json.loads(raw_anchors_json)
            if isinstance(parsed_anc, list):
                anchors_raw = parsed_anc
            elif isinstance(parsed_anc, dict):
                cfg.update(parsed_anc)
                if isinstance(parsed_anc.get("anchors"), list):
                    anchors_raw = parsed_anc["anchors"]
        except Exception:
            pass

    anchors: Optional[List[BezierAnchor]] = None
    if anchors_raw and len(anchors_raw) >= 3:
        try:
            anchors = [
                BezierAnchor(
                    x=float(a["x"]),
                    y=float(a["y"]),
                    in_x=float(a["in_x"]),
                    in_y=float(a["in_y"]),
                    out_x=float(a["out_x"]),
                    out_y=float(a["out_y"]),
                    smooth=bool(a.get("smooth", True)),
                )
                for a in anchors_raw
            ]
        except Exception:
            anchors = None

    return anchors, cfg


def _parse_item_physical_size_cm(
    item: OrderItem,
    artwork_w_px: int | float = 0,
    artwork_h_px: int | float = 0,
) -> Optional[Tuple[float, float]]:
    """
    Return `(width_cm, height_cm)` physical target dimensions of an OrderItem,
    resolving proportional dimensions (`height_only` / `width_only`) via `resolve_physical_size_cm`.
    """
    w_px = float(artwork_w_px) if artwork_w_px and artwork_w_px > 0 else 0.0
    h_px = float(artwork_h_px) if artwork_h_px and artwork_h_px > 0 else 0.0

    if (w_px <= 0 or h_px <= 0) and getattr(item, "diameter_cm", None) is None:
        try:
            from PIL import Image

            raw_bytes = resolve_item_artwork_bytes(item)
            with Image.open(io.BytesIO(raw_bytes)) as pil_im:
                w_px, h_px = float(pil_im.width), float(pil_im.height)
        except Exception:
            w_px, h_px = 1000.0, 1000.0

    return resolve_physical_size_cm(item, w_px or 1000.0, h_px or 1000.0)


def compute_effective_dpi_preflight(
    width_px: int,
    height_px: int,
    item: Optional[OrderItem],
) -> Tuple[Optional[float], Optional[DpiPreflightStatus]]:
    """
    Calculate real effective print DPI against the physical sticker dimensions of `item`.
    Traffic light thresholds:
    - `ok`       : >= 300 DPI (print-shop optimal)
    - `warning`  : 150..299.9 DPI (acceptable / recommend upscale)
    - `critical` : < 150 DPI (low resolution warning)
    """
    effective_dpi, status_str = compute_effective_dpi_for_item(item, width_px, height_px)
    return effective_dpi, status_str  # type: ignore[return-value]


def _sanitize_filename_segment(raw: str) -> str:
    """Normalize a label into a safe ASCII filename segment for ZIP/EPS export."""
    cleaned = raw.replace("Ø", "").replace("ø", "").strip()
    cleaned = re.sub(r"\s+cm\b", "cm", cleaned, flags=re.IGNORECASE)
    ascii_text = unicodedata.normalize("NFKD", cleaned).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", ascii_text).strip("_")
    return slug or "item"


def _build_eps_zip_entry_name(order_number: str, item: OrderItem) -> str:
    """Format `{order_number}_{position:02d}_{material}_{size}_x{qty}.eps` safely."""
    safe_order = _sanitize_filename_segment(order_number)
    mat_name = item.material.name if item.material else "material"
    safe_mat = _sanitize_filename_segment(mat_name)
    safe_size = _sanitize_filename_segment(item.size_display or "medida")
    return f"{safe_order}_{int(item.position):02d}_{safe_mat}_{safe_size}_x{int(item.quantity)}.eps"


def _to_enhance_response(
    source_label: str,
    result,
    *,
    item: Optional[OrderItem] = None,
) -> EnhanceImageResponse:
    encoded = base64.b64encode(result.output_bytes).decode("ascii")
    effective_dpi, dpi_status = compute_effective_dpi_preflight(
        result.width_px, result.height_px, item
    )
    return EnhanceImageResponse(
        source_label=source_label,
        item_id=item.id if item is not None else None,
        preview_data_url=f"data:{result.content_type};base64,{encoded}",
        original_width=result.original_width,
        original_height=result.original_height,
        output_width=result.width_px,
        output_height=result.height_px,
        target_dpi=result.dpi,
        physical_width_cm=result.physical_width_cm,
        physical_height_cm=result.physical_height_cm,
        effective_dpi=effective_dpi,
        dpi_status=dpi_status,
        cmyk_stats=CmykStatsResponse(
            avg_cyan=result.cmyk_stats.avg_cyan,
            avg_magenta=result.cmyk_stats.avg_magenta,
            avg_yellow=result.cmyk_stats.avg_yellow,
            avg_black=result.cmyk_stats.avg_black,
            max_tac_percent=result.cmyk_stats.max_tac_percent,
            tac_warning=result.cmyk_stats.tac_warning,
        ),
        processing_time_ms=result.processing_time_ms,
        has_transparency=bool(result.metadata.get("has_transparency", False)),
        background_removed=bool(result.metadata.get("background_removed", False)),
        bg_mode_effective=result.metadata.get("bg_mode_effective"),  # type: ignore[arg-type]
        bg_fallback_used=bool(result.metadata.get("bg_fallback_used", False)),
        bg_notice=(
            str(result.metadata["bg_fallback_reason"])
            if result.metadata.get("bg_fallback_reason")
            else None
        ),
    )


def _to_die_cut_response(
    source_label: str,
    result,
    *,
    item: Optional[OrderItem] = None,
) -> DetectEdgesResponse:
    b64 = base64.b64encode(result.artwork_png_bytes or b"").decode("ascii")
    default_phys_w_cm = round((result.image_width / result.dpi) * 2.54, 2)
    default_phys_h_cm = round((result.image_height / result.dpi) * 2.54, 2)
    physical_w_cm = getattr(result, "physical_width_cm", 0.0) or default_phys_w_cm
    physical_h_cm = getattr(result, "physical_height_cm", 0.0) or default_phys_h_cm
    cut_w_cm = getattr(result, "cut_width_cm", 0.0) or physical_w_cm
    cut_h_cm = getattr(result, "cut_height_cm", 0.0) or physical_h_cm
    eff_px_per_mm = getattr(result, "effective_px_per_mm", 0.0) or round(result.dpi / 25.4, 4)

    # Use unpadded artwork pixel dimensions for true print DPI preflight
    src_w = result.source_width if getattr(result, "source_width", 0) > 0 else result.image_width
    src_h = result.source_height if getattr(result, "source_height", 0) > 0 else result.image_height
    effective_dpi, dpi_status = compute_effective_dpi_preflight(src_w, src_h, item)

    return DetectEdgesResponse(
        source_label=source_label,
        item_id=item.id if item is not None else None,
        mode=result.mode,
        cut_direction=result.cut_direction,
        image_width=result.image_width,
        image_height=result.image_height,
        dpi=result.dpi,
        physical_width_cm=physical_w_cm,
        physical_height_cm=physical_h_cm,
        cut_width_cm=cut_w_cm,
        cut_height_cm=cut_h_cm,
        effective_px_per_mm=eff_px_per_mm,
        target_width_cm=getattr(result, "target_width_cm", None),
        target_height_cm=getattr(result, "target_height_cm", None),
        fit_mode=getattr(result, "fit_mode", "contain_proportional"),
        effective_dpi=effective_dpi,
        dpi_status=dpi_status,
        bleed_mm=result.bleed_mm,
        white_border_mm=getattr(result, "white_border_mm", 0.0),
        artwork_data_url=f"data:image/png;base64,{b64}",
        cut_path_d=result.cut_path_d,
        anchors=[
            BezierAnchorSchema(
                x=a.x,
                y=a.y,
                in_x=a.in_x,
                in_y=a.in_y,
                out_x=a.out_x,
                out_y=a.out_y,
                smooth=a.smooth,
            )
            for a in result.anchors
        ],
        background_removed=result.background_removed,
        border_mode=result.border_mode,
        border_color=result.border_color,
        border_cut_position=result.border_cut_position,
        detected_base_color=result.detected_base_color,
        palette_colors=list(result.palette_colors or []),
    )


# =============================================================================
# Capabilities
# =============================================================================


@router.get(
    "/capabilities",
    response_model=ImageProcessingCapabilitiesResponse,
    summary="Estado de los módulos de procesamiento de imágenes (Fase 2)",
)
async def get_image_processing_capabilities() -> ImageProcessingCapabilitiesResponse:
    deps = check_phase2_dependencies()
    enhancer_ready = enhancer_service.is_available()
    edge_ready = edge_detector_service.is_available()
    layout_ready = layout_packer_service.is_available()
    return ImageProcessingCapabilitiesResponse(
        opencv_installed=deps["opencv"],
        numpy_installed=deps["numpy"],
        pillow_installed=deps["pillow"],
        rembg_installed=deps["rembg"],
        onnxruntime_installed=deps.get("onnxruntime", False),
        shapely_installed=deps.get("shapely", False),
        modules=[
            Phase2ModuleInfo(
                id="enhancer",
                name="Mejora de Calidad, Fondo Transparente (IA rembg / OpenCV) y CMYK",
                status="active" if enhancer_ready else "missing_dependencies",
                stack=[
                    "OpenCV",
                    "NumPy",
                    "Pillow (PNG + CMYK 300 DPI)",
                    "rembg (u2netp lazy-load)" if deps["rembg"] else "rembg (fallback OpenCV smart_subject)",
                ],
                description=(
                    "Remoción de fondo a PNG transparente (modo IA rembg u2netp con fallback a OpenCV smart_subject), "
                    "escalado Lanczos-4 hasta 4x, brillo/contraste/gamma, calibración CMYK, preflight DPI y exportación TIFF/PNG 300 DPI."
                ),
                endpoint="/api/v1/image-processing/enhance",
            ),
            Phase2ModuleInfo(
                id="edge_detector",
                name="Troquelador Vectorial y Exportación EPS",
                status="active" if edge_ready else "missing_dependencies",
                stack=["OpenCV", "NumPy", "Bezier Rounded + PostScript EPS"],
                description=(
                    "Generación de troquel circular, polígono regular o silueta con margen blanco "
                    "morfológico, editor interactivo tipo Illustrator y exportación en .EPS "
                    "de 2 capas (Capa 1 Diseño CMYK + Capa 2 Corte CutContour)."
                ),
                endpoint="/api/v1/image-processing/detect-edges",
            ),
            Phase2ModuleInfo(
                id="layout_packer",
                name="Distribución Óptima en Pliego y Rollo",
                status="active" if layout_ready else "missing_dependencies",
                stack=[
                    "MaxRects 2D Nesting",
                    "Shapely" if deps.get("shapely", False) else "Shapely / Geometría Analítica",
                    "NumPy",
                ],
                description=(
                    "Acomodo automático 2D MaxRects por material en pliego o rollo continuo con margen de seguridad "
                    "para marcas de registro (2.0 cm), separación entre stickers (gap_cm) y rotación de 90° en rectangulares."
                ),
                endpoint="/api/v1/image-processing/pack-layout",
            ),
        ],
    )


# =============================================================================
# Módulo 1 Activo: Mejora de Calidad, Fondo Transparente, CMYK & Preflight DPI
# =============================================================================


@router.post(
    "/enhance",
    response_model=EnhanceImageResponse,
    summary="Mejorar calidad, quitar fondo a PNG y calibrar CMYK de un diseño específico del pedido",
)
async def enhance_order_image(
    payload: EnhanceImageRequest,
    db: Session = Depends(get_db),
) -> EnhanceImageResponse:
    order, item = _resolve_order_and_item(db, payload.order_id, payload.item_id)

    # Always enhance from the untouched original upload for non-destructive iteration
    raw_bytes, content_type = storage_service.download_order_image(item.image_storage_path)
    asset = ImageAsset(
        order_id=str(order.id),
        content=raw_bytes,
        content_type=content_type,
        filename=item.image_safe_filename,
    )
    options = EnhancementOptions(
        target_dpi=payload.target_dpi,
        upscale_factor=payload.upscale_factor,
        denoise_strength=payload.denoise_strength,
        sharpen_strength=payload.sharpen_strength,
        auto_contrast=payload.auto_contrast,
        remove_background=payload.remove_background,
        bg_mode=payload.bg_mode,
        bg_tolerance=payload.bg_tolerance,
        bg_feather=payload.bg_feather,
        brightness=payload.brightness,
        contrast=payload.contrast,
        saturation=payload.saturation,
        gamma=payload.gamma,
        cyan=payload.cyan,
        magenta=payload.magenta,
        yellow=payload.yellow,
        black=payload.black,
        ink_limit_percent=payload.ink_limit_percent,
        output_format="png_rgb",
    )

    try:
        result = await enhancer_service.process(
            EnhancePayload(asset=asset, options=options, item=item)
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    label = (
        f"{order.order_number} · Diseño #{item.position}"
        if len(order.items or []) > 1
        else order.order_number
    )
    return _to_enhance_response(label, result, item=item)


@router.post(
    "/enhance/upload",
    response_model=EnhanceImageResponse,
    summary="Mejorar calidad, quitar fondo y calibrar CMYK de una imagen subida directamente",
)
async def enhance_uploaded_image(
    image: UploadFile = File(...),
    target_dpi: int = Form(default=300, ge=72, le=1200),
    upscale_factor: float = Form(default=1.0, ge=1.0, le=4.0),
    denoise_strength: int = Form(default=0, ge=0, le=100),
    sharpen_strength: int = Form(default=0, ge=0, le=100),
    auto_contrast: bool = Form(default=False),
    remove_background: bool = Form(default=False),
    bg_mode: BgRemovalModeLiteral = Form(default="smart_subject"),
    bg_tolerance: int = Form(default=28, ge=5, le=90),
    bg_feather: int = Form(default=1, ge=0, le=5),
    brightness: int = Form(default=0, ge=-100, le=100),
    contrast: int = Form(default=0, ge=-100, le=100),
    saturation: int = Form(default=0, ge=-100, le=100),
    gamma: float = Form(default=1.0, ge=0.5, le=2.0),
    cyan: int = Form(default=0, ge=-50, le=50),
    magenta: int = Form(default=0, ge=-50, le=50),
    yellow: int = Form(default=0, ge=-50, le=50),
    black: int = Form(default=0, ge=-50, le=50),
    ink_limit_percent: int = Form(default=300, ge=200, le=400),
) -> EnhanceImageResponse:
    validated = await validate_and_prepare_image(image)
    asset = ImageAsset(
        order_id="standalone",
        content=validated.content,
        content_type=validated.content_type,
        filename=validated.original_sanitized_name,
    )
    options = EnhancementOptions(
        target_dpi=target_dpi,
        upscale_factor=upscale_factor,
        denoise_strength=denoise_strength,
        sharpen_strength=sharpen_strength,
        auto_contrast=auto_contrast,
        remove_background=remove_background,
        bg_mode=bg_mode,
        bg_tolerance=bg_tolerance,
        bg_feather=bg_feather,
        brightness=brightness,
        contrast=contrast,
        saturation=saturation,
        gamma=gamma,
        cyan=cyan,
        magenta=magenta,
        yellow=yellow,
        black=black,
        ink_limit_percent=ink_limit_percent,
        output_format="png_rgb",
    )

    try:
        result = await enhancer_service.process(EnhancePayload(asset=asset, options=options))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return _to_enhance_response(validated.original_sanitized_name, result)


@router.post(
    "/enhance/export",
    summary="Exportar imagen mejorada lista para impresión (PNG 300 DPI, TIFF CMYK o JPG CMYK)",
)
async def export_enhanced_image(
    order_id: Optional[str] = Form(default=None),
    item_id: Optional[int] = Form(default=None, ge=1),
    image: Optional[UploadFile] = File(default=None),
    output_format: Literal["png_rgb", "tiff_cmyk", "jpeg_cmyk"] = Form(default="tiff_cmyk"),
    target_dpi: int = Form(default=300, ge=72, le=1200),
    upscale_factor: float = Form(default=1.0, ge=1.0, le=4.0),
    denoise_strength: int = Form(default=0, ge=0, le=100),
    sharpen_strength: int = Form(default=0, ge=0, le=100),
    auto_contrast: bool = Form(default=False),
    remove_background: bool = Form(default=False),
    bg_mode: BgRemovalModeLiteral = Form(default="smart_subject"),
    bg_tolerance: int = Form(default=28, ge=5, le=90),
    bg_feather: int = Form(default=1, ge=0, le=5),
    brightness: int = Form(default=0, ge=-100, le=100),
    contrast: int = Form(default=0, ge=-100, le=100),
    saturation: int = Form(default=0, ge=-100, le=100),
    gamma: float = Form(default=1.0, ge=0.5, le=2.0),
    cyan: int = Form(default=0, ge=-50, le=50),
    magenta: int = Form(default=0, ge=-50, le=50),
    yellow: int = Form(default=0, ge=-50, le=50),
    black: int = Form(default=0, ge=-50, le=50),
    ink_limit_percent: int = Form(default=300, ge=200, le=400),
    db: Session = Depends(get_db),
) -> Response:
    item: Optional[OrderItem] = None
    if order_id:
        order, item = _resolve_order_and_item(db, order_id, item_id)
        raw_bytes, content_type = storage_service.download_order_image(item.image_storage_path)
        suffix = f"-item{item.position:02d}" if item_id is not None or item.position > 1 else ""
        base_name = f"{order.order_number}{suffix}"
        asset = ImageAsset(
            order_id=str(order.id),
            content=raw_bytes,
            content_type=content_type,
            filename=item.image_safe_filename,
        )
    elif image is not None:
        validated = await validate_and_prepare_image(image)
        base_name = validated.original_sanitized_name.rsplit(".", 1)[0]
        asset = ImageAsset(
            order_id="standalone",
            content=validated.content,
            content_type=validated.content_type,
            filename=validated.original_sanitized_name,
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes indicar un pedido (`order_id`) o subir una imagen (`image`).",
        )

    options = EnhancementOptions(
        target_dpi=target_dpi,
        upscale_factor=upscale_factor,
        denoise_strength=denoise_strength,
        sharpen_strength=sharpen_strength,
        auto_contrast=auto_contrast,
        remove_background=remove_background,
        bg_mode=bg_mode,
        bg_tolerance=bg_tolerance,
        bg_feather=bg_feather,
        brightness=brightness,
        contrast=contrast,
        saturation=saturation,
        gamma=gamma,
        cyan=cyan,
        magenta=magenta,
        yellow=yellow,
        black=black,
        ink_limit_percent=ink_limit_percent,
        output_format=output_format,
    )

    try:
        result = await enhancer_service.process(
            EnhancePayload(asset=asset, options=options, item=item)
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    mode_tag = "cmyk" if output_format != "png_rgb" else "png"
    download_filename = f"{base_name}-{result.dpi}dpi-{mode_tag}{result.extension}"

    return Response(
        content=result.output_bytes,
        media_type=result.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{download_filename}"',
            "X-Print-DPI": str(result.dpi),
            "X-Print-Max-TAC": str(result.cmyk_stats.max_tac_percent),
        },
    )


@router.post(
    "/enhance/save-to-order",
    response_model=OrderResponse,
    summary="Guardar arte mejorado de forma no destructiva en `enhanced_storage_path` del diseño",
)
async def save_enhanced_image_to_order(
    payload: SaveEnhancedToOrderRequest,
    current_user: AuthenticatedUser = Depends(require_staff),
    db: Session = Depends(get_db),
) -> OrderResponse:
    order, item = _resolve_order_and_item(db, payload.order_id, payload.item_id)

    raw_bytes, content_type = storage_service.download_order_image(item.image_storage_path)
    asset = ImageAsset(
        order_id=str(order.id),
        content=raw_bytes,
        content_type=content_type,
        filename=item.image_safe_filename,
    )
    options = EnhancementOptions(
        target_dpi=payload.target_dpi,
        upscale_factor=payload.upscale_factor,
        denoise_strength=payload.denoise_strength,
        sharpen_strength=payload.sharpen_strength,
        auto_contrast=payload.auto_contrast,
        remove_background=payload.remove_background,
        bg_mode=payload.bg_mode,
        bg_tolerance=payload.bg_tolerance,
        bg_feather=payload.bg_feather,
        brightness=payload.brightness,
        contrast=payload.contrast,
        saturation=payload.saturation,
        gamma=payload.gamma,
        cyan=payload.cyan,
        magenta=payload.magenta,
        yellow=payload.yellow,
        black=payload.black,
        ink_limit_percent=payload.ink_limit_percent,
        output_format="png_rgb",
    )

    try:
        result = await enhancer_service.process(
            EnhancePayload(asset=asset, options=options, item=item)
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    now = datetime.now(timezone.utc)
    new_filename = f"enhanced_{uuid.uuid4().hex}.png"
    new_storage_path = f"orders/{now.year:04d}/{now.month:02d}/{new_filename}"

    stored_enhanced_path = (
        storage_service.upload_binary_artifact(
            new_storage_path,
            result.output_bytes,
            "image/png",
            metadata={
                "order_number": order.order_number,
                "item_id": str(item.id),
                "item_position": str(item.position),
                "variant": "enhanced",
            },
        )
        or new_storage_path
    )

    prev_enhanced_path = item.enhanced_storage_path
    try:
        previous_status = order.status
        # Non-destructive: original item.image_storage_path & order.image remain 100% untouched!
        item.enhanced_storage_path = stored_enhanced_path
        item.prepress_status = "mejorado"
        order.updated_by_user_id = current_user.db_user_id
        order.updated_at = now

        next_status = payload.advance_status or order.status
        order.status = next_status

        bg_tag = ", sin fondo PNG" if payload.remove_background else ""
        db.add(
            OrderStatusHistory(
                order_id=order.id,
                previous_status=previous_status,
                new_status=next_status,
                changed_by_user_id=current_user.db_user_id,
                comment=(
                    f"Diseño #{item.position} mejorado no destructivamente "
                    f"({result.width_px}x{result.height_px} px, {result.dpi} DPI{bg_tag}, "
                    f"TAC máx {result.cmyk_stats.max_tac_percent}%)."
                ),
            )
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        storage_service.delete_order_image(stored_enhanced_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo guardar la imagen mejorada en el diseño del pedido.",
        ) from exc

    # Clean up ONLY a superseded enhanced derivative (NEVER touch original item.image_storage_path)
    if (
        prev_enhanced_path
        and prev_enhanced_path != stored_enhanced_path
        and prev_enhanced_path != item.image_storage_path
    ):
        storage_service.delete_order_image(prev_enhanced_path)

    updated_order = order_service.get_order_by_id(db, str(order.id))
    order_service._sync_order_to_firestore(updated_order)
    return updated_order


@router.post(
    "/enhance/save-to-order/upload",
    response_model=OrderResponse,
    summary="Guardar arte retocado y calibrado de forma no destructiva en `enhanced_storage_path` del diseño",
)
async def save_uploaded_enhanced_image_to_order(
    order_id: str = Form(...),
    item_id: Optional[int] = Form(default=None, ge=1),
    image: UploadFile = File(...),
    advance_status: Optional[
        Literal["En Diseño", "En Impresión", "Troquelado", "Listo"]
    ] = Form(default=None),
    target_dpi: int = Form(default=300, ge=72, le=1200),
    upscale_factor: float = Form(default=1.0, ge=1.0, le=4.0),
    denoise_strength: int = Form(default=0, ge=0, le=100),
    sharpen_strength: int = Form(default=0, ge=0, le=100),
    auto_contrast: bool = Form(default=False),
    remove_background: bool = Form(default=False),
    bg_mode: BgRemovalModeLiteral = Form(default="smart_subject"),
    bg_tolerance: int = Form(default=28, ge=5, le=90),
    bg_feather: int = Form(default=1, ge=0, le=5),
    brightness: int = Form(default=0, ge=-100, le=100),
    contrast: int = Form(default=0, ge=-100, le=100),
    saturation: int = Form(default=0, ge=-100, le=100),
    gamma: float = Form(default=1.0, ge=0.5, le=2.0),
    cyan: int = Form(default=0, ge=-50, le=50),
    magenta: int = Form(default=0, ge=-50, le=50),
    yellow: int = Form(default=0, ge=-50, le=50),
    black: int = Form(default=0, ge=-50, le=50),
    ink_limit_percent: int = Form(default=300, ge=200, le=400),
    current_user: AuthenticatedUser = Depends(require_staff),
    db: Session = Depends(get_db),
) -> OrderResponse:
    order, item = _resolve_order_and_item(db, order_id, item_id)

    validated = await validate_and_prepare_image(image)
    asset = ImageAsset(
        order_id=str(order.id),
        content=validated.content,
        content_type=validated.content_type,
        filename=validated.original_sanitized_name,
    )
    options = EnhancementOptions(
        target_dpi=target_dpi,
        upscale_factor=upscale_factor,
        denoise_strength=denoise_strength,
        sharpen_strength=sharpen_strength,
        auto_contrast=auto_contrast,
        remove_background=remove_background,
        bg_mode=bg_mode,
        bg_tolerance=bg_tolerance,
        bg_feather=bg_feather,
        brightness=brightness,
        contrast=contrast,
        saturation=saturation,
        gamma=gamma,
        cyan=cyan,
        magenta=magenta,
        yellow=yellow,
        black=black,
        ink_limit_percent=ink_limit_percent,
        output_format="png_rgb",
    )

    try:
        result = await enhancer_service.process(
            EnhancePayload(asset=asset, options=options, item=item)
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    now = datetime.now(timezone.utc)
    new_filename = f"enhanced_{uuid.uuid4().hex}.png"
    new_storage_path = f"orders/{now.year:04d}/{now.month:02d}/{new_filename}"

    stored_enhanced_path = (
        storage_service.upload_binary_artifact(
            new_storage_path,
            result.output_bytes,
            "image/png",
            metadata={
                "order_number": order.order_number,
                "item_id": str(item.id),
                "item_position": str(item.position),
                "variant": "enhanced_retouched",
            },
        )
        or new_storage_path
    )

    prev_enhanced_path = item.enhanced_storage_path
    try:
        previous_status = order.status
        # Non-destructive: preserve original client image_storage_path intact
        item.enhanced_storage_path = stored_enhanced_path
        item.prepress_status = "mejorado"
        order.updated_by_user_id = current_user.db_user_id
        order.updated_at = now

        next_status = advance_status or order.status
        order.status = next_status

        bg_tag = ", sin fondo PNG" if remove_background else ""
        db.add(
            OrderStatusHistory(
                order_id=order.id,
                previous_status=previous_status,
                new_status=next_status,
                changed_by_user_id=current_user.db_user_id,
                comment=(
                    f"Diseño #{item.position} retocado y calibrado no destructivamente "
                    f"({result.width_px}x{result.height_px} px, {result.dpi} DPI{bg_tag}, "
                    f"TAC máx {result.cmyk_stats.max_tac_percent}%)."
                ),
            )
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        storage_service.delete_order_image(stored_enhanced_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo guardar la imagen retocada en el diseño del pedido.",
        ) from exc

    if (
        prev_enhanced_path
        and prev_enhanced_path != stored_enhanced_path
        and prev_enhanced_path != item.image_storage_path
    ):
        storage_service.delete_order_image(prev_enhanced_path)

    updated_order = order_service.get_order_by_id(db, str(order.id))
    order_service._sync_order_to_firestore(updated_order)
    return updated_order


# =============================================================================
# Retoque Inteligente: Borrador Mágico (Inpainting) & Remoción de Marcas de Agua
# =============================================================================


async def _resolve_source_image_bytes(
    order_id: Optional[str],
    item_id: Optional[int],
    image: Optional[UploadFile],
    db: Session,
) -> bytes:
    if image is not None:
        validated = await validate_and_prepare_image(image)
        return validated.content
    if order_id:
        _, item = _resolve_order_and_item(db, order_id, item_id)
        return resolve_item_artwork_bytes(item)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Debes indicar un pedido (`order_id`) o subir una imagen (`image`).",
    )


@router.post(
    "/retouch/inpaint",
    response_model=RetouchInpaintResponse,
    summary="Borrar elementos o marcas de agua conservando los colores de fondo (OpenCV Inpainting)",
)
async def retouch_inpaint_image(
    mask: UploadFile = File(...),
    image: Optional[UploadFile] = File(default=None),
    order_id: Optional[str] = Form(default=None),
    item_id: Optional[int] = Form(default=None, ge=1),
    mode: Literal[
        "inpaint_telea",
        "inpaint_ns",
        "watermark_clean",
        "erase_transparent",
    ] = Form(default="inpaint_telea"),
    inpaint_radius: int = Form(default=7, ge=1, le=30),
    mask_feather: int = Form(default=2, ge=0, le=10),
    mask_dilate: int = Form(default=2, ge=0, le=12),
    watermark_strength: int = Form(default=85, ge=20, le=100),
    base_color: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
) -> RetouchInpaintResponse:
    source_bytes = await _resolve_source_image_bytes(order_id, item_id, image, db)
    validated_mask = await validate_and_prepare_image(mask)

    try:
        res = await asyncio.to_thread(
            retouch_service.inpaint_sync,
            source_bytes,
            validated_mask.content,
            mode=mode,
            inpaint_radius=inpaint_radius,
            mask_feather=mask_feather,
            mask_dilate=mask_dilate,
            watermark_strength=watermark_strength,
            base_color=base_color,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    encoded = base64.b64encode(res.output_bytes).decode("ascii")
    return RetouchInpaintResponse(
        preview_data_url=f"data:image/png;base64,{encoded}",
        width=res.width,
        height=res.height,
        masked_pixels=res.masked_pixels,
        masked_percent=res.masked_percent,
        mode=res.mode,
        processing_time_ms=res.processing_time_ms,
        has_transparency=res.has_transparency,
        detected_base_color=res.detected_base_color,
    )


@router.post(
    "/retouch/detect-watermark",
    response_model=DetectWatermarkMaskResponse,
    summary="Detectar automáticamente trazos de marca de agua semitransparentes para editar en el borrador",
)
async def detect_watermark_mask(
    image: Optional[UploadFile] = File(default=None),
    order_id: Optional[str] = Form(default=None),
    item_id: Optional[int] = Form(default=None, ge=1),
    tone: Literal["light", "dark", "both"] = Form(default="light"),
    sensitivity: int = Form(default=55, ge=10, le=95),
    db: Session = Depends(get_db),
) -> DetectWatermarkMaskResponse:
    source_bytes = await _resolve_source_image_bytes(order_id, item_id, image, db)

    try:
        res = await asyncio.to_thread(
            retouch_service.detect_watermark_mask_sync,
            source_bytes,
            tone=tone,
            sensitivity=sensitivity,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    encoded = base64.b64encode(res.mask_png_bytes).decode("ascii")
    return DetectWatermarkMaskResponse(
        mask_data_url=f"data:image/png;base64,{encoded}",
        width=res.width,
        height=res.height,
        detected_pixels=res.detected_pixels,
        detected_percent=res.detected_percent,
        processing_time_ms=res.processing_time_ms,
    )


# =============================================================================
# Módulo 2 Activo: Troquelador Vectorial + Margen Blanco + Exportación EPS 2 Capas
# =============================================================================


@router.post(
    "/detect-edges",
    response_model=DetectEdgesResponse,
    summary="Generar trazado vectorial de troquelado con preflight DPI y persistencia de anclas en el diseño",
)
async def detect_die_cut_edges(
    payload: DetectEdgesRequest,
    db: Session = Depends(get_db),
) -> DetectEdgesResponse:
    order, item = _resolve_order_and_item(db, payload.order_id, payload.item_id)
    raw_bytes, content_type, source_filename, _ = resolve_item_artwork_asset(item)
    asset = ImageAsset(
        order_id=str(order.id),
        content=raw_bytes,
        content_type=content_type,
        filename=source_filename,
    )

    target_w_cm = payload.target_width_cm
    target_h_cm = payload.target_height_cm

    job = EdgeDetectionPayload(
        asset=asset,
        mode=payload.mode,
        cut_direction=payload.cut_direction,
        dpi=payload.dpi,
        bleed_mm=payload.bleed_mm,
        white_border_mm=payload.white_border_mm,
        corner_roundness=payload.corner_roundness,
        smoothing_epsilon=payload.smoothing_epsilon,
        polygon_sides=payload.polygon_sides,
        polygon_rotation_deg=payload.polygon_rotation_deg,
        remove_background=payload.remove_background,
        bg_tolerance=payload.bg_tolerance,
        merge_islands=payload.merge_islands,
        join_islands=payload.join_islands,
        border_mode=payload.border_mode,
        border_color=payload.border_color,
        border_width_mm=payload.border_width_mm,
        border_cut_position=payload.border_cut_position,
        border_offset_mm=payload.border_offset_mm,
        target_width_cm=target_w_cm,
        target_height_cm=target_h_cm,
        fit_mode=payload.fit_mode,
        item=item,
    )

    try:
        result = await edge_detector_service.process(job)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    label = (
        f"{order.order_number} · Diseño #{item.position}"
        if len(order.items or []) > 1
        else order.order_number
    )
    resp = _to_die_cut_response(label, result, item=item)

    # Persist detected Bezier anchors and full die-cut config non-destructively onto the target OrderItem
    try:
        anchors_dump = [a.model_dump() for a in resp.anchors]
        item.die_cut_anchors_json = json.dumps(anchors_dump)
        item.die_cut_config_json = json.dumps(
            {
                "anchors": anchors_dump,
                "mode": resp.mode,
                "cut_direction": resp.cut_direction,
                "image_width": resp.image_width,
                "image_height": resp.image_height,
                "dpi": resp.dpi,
                "bleed_mm": resp.bleed_mm,
                "white_border_mm": resp.white_border_mm,
                "remove_background": bool(payload.remove_background or resp.background_removed),
                "bg_tolerance": payload.bg_tolerance,
                "border_mode": resp.border_mode,
                "border_color": resp.border_color,
                "border_width_mm": payload.border_width_mm,
                "border_cut_position": resp.border_cut_position,
                "border_offset_mm": payload.border_offset_mm,
                "cut_stroke_width_pt": payload.cut_stroke_width_pt,
                "target_width_cm": resp.target_width_cm,
                "target_height_cm": resp.target_height_cm,
                "fit_mode": resp.fit_mode,
            }
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("No se pudieron persistir las anclas de troquel en item %s: %s", item.id, exc)

    return resp


@router.post(
    "/detect-edges/upload",
    response_model=DetectEdgesResponse,
    summary="Generar trazado vectorial de troquelado desde una imagen subida directamente",
)
async def detect_die_cut_edges_upload(
    image: UploadFile = File(...),
    mode: Literal["en_su_forma", "circular", "poligono_regular"] = Form(default="en_su_forma"),
    cut_direction: Literal["outside", "inside"] = Form(default="outside"),
    dpi: int = Form(default=300, ge=72, le=1200),
    bleed_mm: float = Form(default=2.5, ge=0.0, le=20.0),
    white_border_mm: float = Form(default=0.0, ge=0.0, le=10.0),
    corner_roundness: float = Form(default=0.35, ge=0.05, le=1.0),
    smoothing_epsilon: float = Form(default=0.004, ge=0.001, le=0.03),
    polygon_sides: int = Form(default=6, ge=3, le=12),
    polygon_rotation_deg: float = Form(default=0.0, ge=-180.0, le=180.0),
    remove_background: bool = Form(default=False),
    bg_tolerance: int = Form(default=28, ge=5, le=90),
    merge_islands: bool = Form(default=True),
    join_islands: Optional[bool] = Form(default=None),
    border_mode: Literal["none", "base_color", "white", "custom"] = Form(default="none"),
    border_color: Optional[str] = Form(default=None),
    border_width_mm: float = Form(default=2.0, ge=0.5, le=12.0),
    border_cut_position: Literal["inside_base", "outside_base"] = Form(default="inside_base"),
    border_offset_mm: float = Form(default=1.5, ge=0.0, le=10.0),
    target_width_cm: Optional[float] = Form(default=None, gt=0.0, le=500.0),
    target_height_cm: Optional[float] = Form(default=None, gt=0.0, le=500.0),
    fit_mode: DieCutFitModeLiteral = Form(default="contain_proportional"),
) -> DetectEdgesResponse:
    validated = await validate_and_prepare_image(image)
    asset = ImageAsset(
        order_id="standalone",
        content=validated.content,
        content_type=validated.content_type,
        filename=validated.original_sanitized_name,
    )
    job = EdgeDetectionPayload(
        asset=asset,
        mode=mode,
        cut_direction=cut_direction,
        dpi=dpi,
        bleed_mm=bleed_mm,
        white_border_mm=white_border_mm,
        corner_roundness=corner_roundness,
        smoothing_epsilon=smoothing_epsilon,
        polygon_sides=polygon_sides,
        polygon_rotation_deg=polygon_rotation_deg,
        remove_background=remove_background,
        bg_tolerance=bg_tolerance,
        merge_islands=merge_islands,
        join_islands=join_islands,
        border_mode=border_mode,
        border_color=border_color,
        border_width_mm=border_width_mm,
        border_cut_position=border_cut_position,
        border_offset_mm=border_offset_mm,
        target_width_cm=target_width_cm,
        target_height_cm=target_height_cm,
        fit_mode=fit_mode,
    )

    try:
        result = await edge_detector_service.process(job)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return _to_die_cut_response(validated.original_sanitized_name, result)


@router.post(
    "/die-cut/export",
    summary="Exportar troquelado final en 2 capas (.EPS o .SVG) y guardar anclas/EPS en el diseño del pedido",
)
async def export_die_cut_file(
    payload: ExportDieCutRequest,
    current_user: AuthenticatedUser = Depends(require_staff),
    db: Session = Depends(get_db),
) -> Response:
    artwork_bytes: Optional[bytes] = None
    base_title = payload.title
    resolved_order: Optional[Order] = None
    resolved_item: Optional[OrderItem] = None

    if payload.order_id:
        resolved_order, resolved_item = _resolve_order_and_item(
            db, payload.order_id, payload.item_id
        )
        suffix = f"-item{resolved_item.position:02d}" if resolved_item.position > 1 or payload.item_id else ""
        base_title = f"{resolved_order.order_number}{suffix}"

    if payload.artwork_data_url:
        if "," not in payload.artwork_data_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="artwork_data_url inválido.",
            )
        b64_part = payload.artwork_data_url.split(",", 1)[1]
        try:
            artwork_bytes = base64.b64decode(b64_part)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No se pudo decodificar la imagen del lienzo de troquelado.",
            ) from exc
    elif resolved_item is not None:
        artwork_bytes = resolve_item_artwork_bytes(resolved_item)

    if not artwork_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes proporcionar el arte de la Capa 1 para exportar el troquelado.",
        )

    _, saved_cfg = (
        _load_saved_item_die_cut_state(resolved_item)
        if resolved_item is not None
        else (None, {})
    )

    anchors = [
        BezierAnchor(
            x=a.x,
            y=a.y,
            in_x=a.in_x,
            in_y=a.in_y,
            out_x=a.out_x,
            out_y=a.out_y,
            smooth=a.smooth,
        )
        for a in payload.anchors
    ]

    target_w_cm = payload.target_width_cm
    target_h_cm = payload.target_height_cm
    if target_w_cm is None and saved_cfg.get("target_width_cm") is not None:
        target_w_cm = float(saved_cfg["target_width_cm"])
    if target_h_cm is None and saved_cfg.get("target_height_cm") is not None:
        target_h_cm = float(saved_cfg["target_height_cm"])
    if (target_w_cm is None or target_h_cm is None) and resolved_item is not None:
        item_size = _parse_item_physical_size_cm(resolved_item)
        if item_size is not None:
            if target_w_cm is None:
                target_w_cm = item_size[0]
            if target_h_cm is None:
                target_h_cm = item_size[1]

    eff_white_border_mm = (
        float(payload.white_border_mm)
        if payload.white_border_mm is not None
        else float(saved_cfg.get("white_border_mm", 0.0) or 0.0)
    )
    eff_bleed_mm = (
        float(payload.bleed_mm)
        if payload.bleed_mm is not None
        else float(saved_cfg.get("bleed_mm", 2.0) or 2.0)
    )
    eff_remove_bg = (
        bool(payload.remove_background)
        if payload.remove_background is not None
        else bool(saved_cfg.get("remove_background", True))
    )
    eff_bg_tol = (
        int(payload.bg_tolerance)
        if payload.bg_tolerance is not None
        else int(saved_cfg.get("bg_tolerance", 35) or 35)
    )
    eff_mode = str(payload.mode or saved_cfg.get("mode") or "En su forma")

    try:
        if payload.export_format == "svg":
            out_bytes = edge_detector_service.export_two_layer_svg(
                artwork_bytes,
                anchors,
                width_px=payload.image_width,
                height_px=payload.image_height,
                dpi=payload.dpi,
                border_color=payload.border_color,
                cut_direction=payload.cut_direction,
                border_width_mm=payload.border_width_mm,
                border_cut_position=payload.border_cut_position,
                border_offset_mm=payload.border_offset_mm,
                cut_stroke_width_pt=payload.cut_stroke_width_pt,
                target_width_cm=target_w_cm,
                target_height_cm=target_h_cm,
                fit_mode=payload.fit_mode,
                item=resolved_item,
            )
            media_type = "image/svg+xml"
            ext = ".svg"
        else:
            out_bytes = edge_detector_service.export_two_layer_eps(
                artwork_bytes,
                anchors,
                width_px=payload.image_width,
                height_px=payload.image_height,
                dpi=payload.dpi,
                title=base_title,
                border_color=payload.border_color,
                cut_direction=payload.cut_direction,
                border_width_mm=payload.border_width_mm,
                border_cut_position=payload.border_cut_position,
                border_offset_mm=payload.border_offset_mm,
                cut_stroke_width_pt=payload.cut_stroke_width_pt,
                target_width_cm=target_w_cm,
                target_height_cm=target_h_cm,
                fit_mode=payload.fit_mode,
                item=resolved_item,
                white_border_mm=eff_white_border_mm,
                remove_background=eff_remove_bg,
                bg_tolerance=eff_bg_tol,
                mode=eff_mode,
            )
            media_type = "application/postscript"
            ext = ".eps"
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # Persist anchors + die_cut_config_json + EPS artifact non-destructively onto OrderItem
    persisted_die_cut_path: Optional[str] = None
    if resolved_order is not None and resolved_item is not None:
        now = datetime.now(timezone.utc)
        new_eps_path: Optional[str] = None
        prev_eps_path = resolved_item.die_cut_eps_path

        if payload.export_format == "eps":
            candidate_eps_path = f"orders/{now.year:04d}/{now.month:02d}/diecut_{uuid.uuid4().hex}.eps"
            new_eps_path = (
                storage_service.upload_binary_artifact(
                    candidate_eps_path,
                    out_bytes,
                    "application/postscript",
                    metadata={
                        "order_number": resolved_order.order_number,
                        "item_id": str(resolved_item.id),
                        "item_position": str(resolved_item.position),
                        "variant": "die_cut_eps",
                    },
                )
                or candidate_eps_path
            )

        try:
            anchors_list = [a.model_dump() for a in payload.anchors]
            resolved_item.die_cut_anchors_json = json.dumps(anchors_list)
            resolved_item.die_cut_config_json = json.dumps(
                {
                    "anchors": anchors_list,
                    "image_width": payload.image_width,
                    "image_height": payload.image_height,
                    "mode": eff_mode,
                    "white_border_mm": eff_white_border_mm,
                    "bleed_mm": eff_bleed_mm,
                    "border_color": payload.border_color,
                    "cut_direction": payload.cut_direction,
                    "border_width_mm": payload.border_width_mm,
                    "border_cut_position": payload.border_cut_position,
                    "border_offset_mm": payload.border_offset_mm,
                    "remove_background": eff_remove_bg,
                    "bg_tolerance": eff_bg_tol,
                    "target_width_cm": target_w_cm,
                    "target_height_cm": target_h_cm,
                    "fit_mode": payload.fit_mode,
                    "dpi": payload.dpi,
                }
            )
            if new_eps_path is not None:
                resolved_item.die_cut_eps_path = new_eps_path
                resolved_item.prepress_status = (
                    "listo_pliego" if payload.advance_status == "Listo" else "troquelado"
                )

            resolved_order.updated_by_user_id = current_user.db_user_id
            resolved_order.updated_at = now

            if payload.advance_status:
                prev_status = resolved_order.status
                resolved_order.status = payload.advance_status
                db.add(
                    OrderStatusHistory(
                        order_id=resolved_order.id,
                        previous_status=prev_status,
                        new_status=payload.advance_status,
                        changed_by_user_id=current_user.db_user_id,
                        comment=(
                            f"Diseño #{resolved_item.position}: troquelado 2 capas exportado en "
                            f"{ext.upper()} ({len(anchors)} nodos, {payload.dpi} DPI)."
                        ),
                    )
                )
            db.commit()
            persisted_die_cut_path = new_eps_path
        except Exception as exc:
            logger.exception(
                "Error persistiendo artefactos de troquel en order=%s item=%s: %s",
                resolved_order.id,
                resolved_item.id,
                exc,
            )
            db.rollback()
            if new_eps_path:
                storage_service.delete_order_image(new_eps_path)
        else:
            if (
                new_eps_path
                and prev_eps_path
                and prev_eps_path != new_eps_path
                and prev_eps_path != resolved_item.image_storage_path
            ):
                storage_service.delete_order_image(prev_eps_path)
            updated_order = order_service.get_order_by_id(db, str(resolved_order.id))
            order_service._sync_order_to_firestore(updated_order)

    safe_base = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in base_title)[:60]
    filename = f"{safe_base}-troquel-2capas{ext}"

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-DieCut-Layers": "2 (Capa_1_Diseno, Capa_2_Corte_CutContour)",
    }
    if persisted_die_cut_path:
        headers["X-DieCut-Storage-Url"] = persisted_die_cut_path

    return Response(
        content=out_bytes,
        media_type=media_type,
        headers=headers,
    )


# =============================================================================
# Exportación de Paquete Multi-Diseño (.ZIP de archivos .EPS listos)
# =============================================================================


@router.get(
    "/orders/{order_id}/export-zip",
    summary="Empaquetar en un archivo .ZIP todos los .EPS de troquelado listos del pedido",
)
async def export_order_eps_zip(
    order_id: str,
    db: Session = Depends(get_db),
) -> Response:
    try:
        order_pk = int(order_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado."
        ) from exc

    order = (
        db.scalars(
            select(Order)
            .options(
                selectinload(Order.items).joinedload(OrderItem.material),
                selectinload(Order.items).joinedload(OrderItem.shape),
            )
            .where(Order.id == order_pk)
        )
        .unique()
        .first()
    )
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado."
        )

    ordered_items = sorted(order.items or [], key=lambda it: (it.position, it.id))
    ready_items = [it for it in ordered_items if it.die_cut_eps_path]
    if not ready_items:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El pedido no cuenta con archivos .EPS de troquelado listos para empaquetar.",
        )

    zip_buf = io.BytesIO()
    used_names: set[str] = set()
    packaged_count = 0

    with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for item in ready_items:
            eps_bytes, _ = storage_service.download_order_image(item.die_cut_eps_path)  # type: ignore[arg-type]
            entry_name = _build_eps_zip_entry_name(order.order_number, item)
            if entry_name in used_names:
                stem = entry_name[:-4]
                entry_name = f"{stem}_id{item.id}.eps"
            used_names.add(entry_name)
            zf.writestr(entry_name, eps_bytes)
            packaged_count += 1

    safe_order_name = _sanitize_filename_segment(order.order_number)
    zip_filename = f"{safe_order_name}_preprensa.zip"

    return Response(
        content=zip_buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{zip_filename}"',
            "X-Packaged-Items": str(packaged_count),
            "X-Total-Items": str(len(ordered_items)),
        },
    )


@router.post(
    "/orders/{order_id}/export-production",
    dependencies=[Depends(require_staff)],
    summary="Exportar archivo de producción unificado del pedido (.EPS en una hoja o .PDF/.EPS por mesas en rollo)",
)
async def export_order_production(
    order_id: str,
    payload: Optional[ExportProductionRequest] = Body(default=None),
    format: Optional[Literal["auto", "eps", "pdf", "zip"]] = Query(default=None),
    current_user: Optional[AuthenticatedUser] = Depends(require_staff),
    db: Session = Depends(get_db),
) -> Response:
    """
    Exporta todos los diseños de un pedido en un archivo de producción listo para plotter:
    - Trabajos que NO son en rollo (`Corte uno a uno`, `Vinilo Mate`, `Transparente`, `DTF UV`, etc.):
      Genera 1 solo `.EPS` con todos los diseños colocados en la misma hoja (`same_sheet`)
      sin solaparse (`gap_cm=0.5`, `margin_cm=1.0`), cada uno a su medida física exacta y con
      Capa 1 (arte mejorado CMYK) + Capa 2 (`CutContour`) alineadas 1:1.
    - Trabajos `En rollo`:
      Modo `separate_artboards`:
      * Por defecto (`format="pdf"` / `"auto"`): 1 solo `.PDF` vectorial multi-página donde cada
        diseño está en su propia mesa de trabajo separada con Capa 1 (300 DPI) y Capa 2 (`CutContour`
        Magenta CMYK `0 1 0 0`).
      * Si se solicita `format="eps"`: 1 solo `.EPS` con cada diseño en su propio marco/carril de
        mesa de trabajo separado por distancia fija (`3.0 cm`) y etiqueta de referencia fuera del `CutContour`.
      * Si se solicita `format="zip"`: paquete `.ZIP` con 1 `.EPS` independiente por diseño.
    """
    opts = payload or ExportProductionRequest()
    req_format: str = format or opts.format or "auto"
    if isinstance(req_format, str):
        req_format = req_format.lower().strip()
    else:
        req_format = "auto"

    try:
        order_pk = int(order_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado."
        ) from exc

    order = (
        db.scalars(
            select(Order)
            .options(
                selectinload(Order.items).joinedload(OrderItem.material),
                selectinload(Order.items).joinedload(OrderItem.shape),
                joinedload(Order.material),
                joinedload(Order.shape),
            )
            .where(Order.id == order_pk)
        )
        .unique()
        .first()
    )
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado."
        )

    if not order.items:
        # Materialize legacy single-item row if needed
        order, _ = _resolve_order_and_item(db, order_id, None)

    ordered_items = sorted(order.items or [], key=lambda it: (it.position, it.id))
    if not ordered_items:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El pedido no tiene diseños registrados para exportar.",
        )

    # Determine if this is an "En rollo" job
    order_mode = (getattr(order, "vinyl_gloss_mode", None) or "").strip().lower()
    is_roll_job = order_mode == "en rollo" or any(
        (getattr(it, "vinyl_gloss_mode", None) or "").strip().lower() == "en rollo"
        for it in ordered_items
    )

    # Option: ZIP with 1 independent .EPS per design
    if req_format == "zip":
        zip_buf = io.BytesIO()
        used_names: set[str] = set()
        packaged_count = 0
        with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for item in ordered_items:
                raw_bytes = resolve_item_artwork_bytes(item)
                saved_anchors, saved_cfg = _load_saved_item_die_cut_state(item)
                prepared = edge_detector_service.prepare_item_for_production(
                    raw_bytes,
                    item=item,
                    saved_anchors=saved_anchors,
                    saved_config=saved_cfg,
                    dpi=opts.dpi,
                )
                single_eps, _ = edge_detector_service.export_multi_design_eps(
                    [prepared],
                    title=f"{order.order_number}-item{item.position:02d}",
                    layout_mode="same_sheet",
                    margin_cm=0.0,
                    gap_cm=0.0,
                    cut_stroke_width_pt=opts.cut_stroke_width_pt,
                )
                entry_name = _build_eps_zip_entry_name(order.order_number, item)
                if entry_name in used_names:
                    stem = entry_name[:-4]
                    entry_name = f"{stem}_id{item.id}.eps"
                used_names.add(entry_name)
                zf.writestr(entry_name, single_eps)
                packaged_count += 1

        safe_order_name = _sanitize_filename_segment(order.order_number)
        zip_filename = f"{safe_order_name}_produccion_eps.zip"
        return Response(
            content=zip_buf.getvalue(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{zip_filename}"',
                "X-Production-Layout": "separate_files_zip",
                "X-Designs-Count": str(packaged_count),
            },
        )

    # Prepare all designs using enhanced_storage_path (prioritized) and saved die-cut state
    prepared_designs = []
    for item in ordered_items:
        raw_bytes = resolve_item_artwork_bytes(item)
        saved_anchors, saved_cfg = _load_saved_item_die_cut_state(item)
        prepared = edge_detector_service.prepare_item_for_production(
            raw_bytes,
            item=item,
            saved_anchors=saved_anchors,
            saved_config=saved_cfg,
            dpi=opts.dpi,
        )
        prepared_designs.append(prepared)

    safe_order_name = _sanitize_filename_segment(order.order_number)

    if is_roll_job:
        # Case 2 — Trabajos "En rollo" -> separate_artboards
        effective_format = "pdf" if req_format == "auto" else req_format
        if effective_format == "eps":
            eps_bytes, _ = edge_detector_service.export_multi_design_eps(
                prepared_designs,
                title=f"{order.order_number}-ROLLO",
                layout_mode="separate_artboards",
                margin_cm=opts.margin_cm,
                gap_cm=opts.gap_cm,
                artboard_gap_cm=opts.roll_artboard_gap_cm,
                cut_stroke_width_pt=opts.cut_stroke_width_pt,
            )
            filename = f"{safe_order_name}-produccion-rollo-artboards.eps"
            return Response(
                content=eps_bytes,
                media_type="application/postscript",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "X-Production-Layout": "separate_artboards",
                    "X-Production-Mode": "En rollo",
                    "X-Designs-Count": str(len(prepared_designs)),
                },
            )
        else:
            pdf_bytes, _ = edge_detector_service.export_multi_artboard_pdf(
                prepared_designs,
                title=f"{order.order_number}-ROLLO",
                margin_cm=opts.margin_cm,
                cut_stroke_width_pt=opts.cut_stroke_width_pt,
            )
            filename = f"{safe_order_name}-produccion-rollo-artboards.pdf"
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "X-Production-Layout": "separate_artboards",
                    "X-Production-Mode": "En rollo",
                    "X-Designs-Count": str(len(prepared_designs)),
                },
            )
    else:
        # Case 1 — Trabajos que NO son en rollo -> same_sheet (1 solo .EPS con todos los diseños en la misma hoja)
        effective_format = "eps" if req_format == "auto" else req_format
        if effective_format == "pdf":
            pdf_bytes, _ = edge_detector_service.export_multi_artboard_pdf(
                prepared_designs,
                title=f"{order.order_number}-PRODUCCION",
                margin_cm=opts.margin_cm,
                cut_stroke_width_pt=opts.cut_stroke_width_pt,
            )
            filename = f"{safe_order_name}-produccion.pdf"
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "X-Production-Layout": "separate_artboards",
                    "X-Production-Mode": order.vinyl_gloss_mode or "Corte uno a uno",
                    "X-Designs-Count": str(len(prepared_designs)),
                },
            )

        eps_bytes, _ = edge_detector_service.export_multi_design_eps(
            prepared_designs,
            title=f"{order.order_number}-PLIEGO",
            layout_mode="same_sheet",
            margin_cm=opts.margin_cm,
            gap_cm=opts.gap_cm,
            sheet_width_cm=opts.sheet_width_cm,
            cut_stroke_width_pt=opts.cut_stroke_width_pt,
        )
        filename = f"{safe_order_name}-produccion-hoja.eps"
        return Response(
            content=eps_bytes,
            media_type="application/postscript",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-Production-Layout": "same_sheet",
                "X-Production-Mode": order.vinyl_gloss_mode or "Corte uno a uno",
                "X-Designs-Count": str(len(prepared_designs)),
            },
        )


# =============================================================================
# Módulo 3 Activo: Distribución Óptima en Pliego y Rollo (SheetLayoutPackerService)
# =============================================================================


def _extract_nest_items_from_orders(
    db: Session,
    order_ids: List[str],
    *,
    material_filter: Optional[str] = None,
) -> List[StickerNestItem]:
    """Load `OrderItem` rows for the requested `order_ids` and convert them to physical `StickerNestItem` specs."""
    pks: List[int] = []
    for raw_id in order_ids:
        try:
            pks.append(int(raw_id))
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Pedido '{raw_id}' no encontrado.",
            ) from exc

    orders = (
        db.scalars(
            select(Order)
            .options(
                joinedload(Order.material),
                joinedload(Order.shape),
                selectinload(Order.items).joinedload(OrderItem.material),
                selectinload(Order.items).joinedload(OrderItem.shape),
            )
            .where(Order.id.in_(pks))
        )
        .unique()
        .all()
    )
    order_by_id = {o.id: o for o in orders}
    missing = [str(pk) for pk in pks if pk not in order_by_id]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pedido(s) no encontrado(s): {', '.join(missing)}.",
        )

    normalized_filter = material_filter.strip().lower() if material_filter else None
    extracted: List[StickerNestItem] = []

    for pk in pks:
        order = order_by_id[pk]
        ordered_items = sorted(order.items or [], key=lambda it: (it.position, it.id))
        if ordered_items:
            for it in ordered_items:
                mat_name = it.material.name if it.material else "General"
                if normalized_filter and mat_name.strip().lower() != normalized_filter:
                    continue
                size_cm = _parse_item_physical_size_cm(it)
                if size_cm is None:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"El diseño #{it.position} (item_id={it.id}) del pedido {order.order_number} "
                            "no tiene dimensiones físicas válidas en cm."
                        ),
                    )
                shape_name = it.shape.name if it.shape else "Rectangular"
                if shape_name not in ("Circular", "Rectangular", "Cuadrado", "En su forma"):
                    shape_name = "Rectangular"
                extracted.append(
                    StickerNestItem(
                        item_id=str(it.id),
                        order_id=str(order.id),
                        label=f"{order.order_number} · Diseño #{it.position}",
                        material=mat_name,
                        shape=shape_name,  # type: ignore[arg-type]
                        width_cm=size_cm[0],
                        height_cm=size_cm[1],
                        quantity=int(it.quantity),
                        allow_rotation=None,
                    )
                )
        else:
            # Legacy single-item order fallback
            mat_name = order.material.name if order.material else "General"
            if normalized_filter and mat_name.strip().lower() != normalized_filter:
                continue
            size_cm = _parse_item_physical_size_cm(order)  # type: ignore[arg-type]
            if size_cm is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El pedido {order.order_number} no tiene dimensiones físicas válidas en cm.",
                )
            shape_name = order.shape.name if order.shape else "Rectangular"
            if shape_name not in ("Circular", "Rectangular", "Cuadrado", "En su forma"):
                shape_name = "Rectangular"
            extracted.append(
                StickerNestItem(
                    item_id=f"order-{order.id}-1",
                    order_id=str(order.id),
                    label=order.order_number,
                    material=mat_name,
                    shape=shape_name,  # type: ignore[arg-type]
                    width_cm=size_cm[0],
                    height_cm=size_cm[1],
                    quantity=int(order.quantity),
                    allow_rotation=None,
                )
            )

    return extracted


@router.post(
    "/pack-layout",
    response_model=PackLayoutResponse,
    summary="Calcular distribución óptima de stickers en pliego o rollo maximizando aprovechamiento",
)
async def pack_sheet_layout(
    payload: PackLayoutRequest,
    db: Session = Depends(get_db),
) -> PackLayoutResponse:
    nest_items: List[StickerNestItem] = [
        StickerNestItem(
            item_id=it.item_id,
            order_id=it.order_id,
            label=it.label,
            material=it.material,
            shape=it.shape,
            width_cm=it.width_cm,
            height_cm=it.height_cm,
            quantity=it.quantity,
            allow_rotation=it.allow_rotation,
        )
        for it in payload.items
    ]

    requested_order_ids: List[str] = []
    if payload.order_id:
        requested_order_ids.append(payload.order_id)
    if payload.order_ids:
        for oid in payload.order_ids:
            if oid not in requested_order_ids:
                requested_order_ids.append(oid)

    if requested_order_ids:
        nest_items.extend(
            _extract_nest_items_from_orders(
                db,
                requested_order_ids,
                material_filter=payload.material_filter,
            )
        )

    if not nest_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes proporcionar al menos un diseño en `items` o un pedido con diseños válidos.",
        )

    sheet_spec = SheetSpec(
        width_cm=payload.sheet_width_cm,
        height_cm=payload.sheet_height_cm,
        margin_cm=payload.margin_cm,
        gap_cm=payload.gap_cm,
        media_type=payload.media_type or "sheet",
        group_by_material=payload.group_by_material,
        include_preview_svg=payload.include_preview_svg,
    )

    try:
        result = await asyncio.to_thread(
            layout_packer_service.pack,
            LayoutPackPayload(sheet=sheet_spec, items=nest_items),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return PackLayoutResponse(
        total_sheets=result.total_sheets,
        total_stickers=result.total_stickers,
        utilization_percent=result.utilization_percent,
        waste_percent=result.waste_percent,
        usable_utilization_percent=result.usable_utilization_percent,
        total_stickers_area_cm2=result.total_stickers_area_cm2,
        total_sheet_area_cm2=result.total_sheet_area_cm2,
        total_usable_area_cm2=result.total_usable_area_cm2,
        sheet_width_cm=result.sheet_width_cm,
        sheet_height_cm=result.sheet_height_cm,
        media_type=result.media_type,
        margin_cm=result.margin_cm,
        gap_cm=result.gap_cm,
        usable_width_cm=result.usable_width_cm,
        usable_height_cm=result.usable_height_cm,
        group_by_material=result.group_by_material,
        geometry_engine=result.geometry_engine,
        sheets=[
            SheetLayoutPageResponse(
                sheet_index=s.sheet_index,
                material=s.material,
                material_sheet_index=s.material_sheet_index,
                width_cm=s.width_cm,
                height_cm=s.height_cm,
                used_height_cm=s.used_height_cm,
                stickers_count=s.stickers_count,
                stickers_area_cm2=s.stickers_area_cm2,
                sheet_area_cm2=s.sheet_area_cm2,
                usable_area_cm2=s.usable_area_cm2,
                utilization_percent=s.utilization_percent,
                waste_percent=s.waste_percent,
                usable_utilization_percent=s.usable_utilization_percent,
                placements=[
                    PlacedStickerResponse(
                        item_id=p.item_id,
                        x=p.x,
                        y=p.y,
                        width=p.width,
                        height=p.height,
                        rotated=p.rotated,
                        sheet_index=p.sheet_index,
                        order_id=p.order_id,
                        material=p.material,
                        shape=p.shape,
                        label=p.label,
                        copy_index=p.copy_index,
                    )
                    for p in s.placements
                ],
            )
            for s in result.sheets
        ],
        material_groups=[
            MaterialLayoutGroupResponse(
                material=g.material,
                sheets_required=g.sheets_required,
                stickers_count=g.stickers_count,
                stickers_area_cm2=g.stickers_area_cm2,
                total_sheet_area_cm2=g.total_sheet_area_cm2,
                utilization_percent=g.utilization_percent,
                waste_percent=g.waste_percent,
                sheet_indices=g.sheet_indices,
            )
            for g in result.material_groups
        ],
        placements=[
            PlacedStickerResponse(
                item_id=p.item_id,
                x=p.x,
                y=p.y,
                width=p.width,
                height=p.height,
                rotated=p.rotated,
                sheet_index=p.sheet_index,
                order_id=p.order_id,
                material=p.material,
                shape=p.shape,
                label=p.label,
                copy_index=p.copy_index,
            )
            for p in result.placements
        ],
        preview_svg=result.preview_svg,
    )
