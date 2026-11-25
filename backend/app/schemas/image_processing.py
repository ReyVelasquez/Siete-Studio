"""Contracts for Phase 2 image enhancement, background removal, die-cut vectors & EPS export."""

from __future__ import annotations

from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

DpiPreflightStatus = Literal["ok", "warning", "critical"]
BgRemovalModeLiteral = Literal["smart_subject", "auto_color", "grabcut", "ai_rembg"]
DieCutFitModeLiteral = Literal["contain_proportional", "exact_stretch"]
LayoutMediaTypeLiteral = Literal["sheet", "roll"]
StickerShapeLiteral = Literal["Circular", "Rectangular", "Cuadrado", "En su forma"]


class Phase2ModuleInfo(BaseModel):
    id: str
    name: str
    status: str = "planned_phase_2"
    stack: List[str]
    description: str
    endpoint: str


class ImageProcessingCapabilitiesResponse(BaseModel):
    phase: str = (
        "Fase 2 · Módulos 1, 2 y 3 Activos (OpenCV/rembg + CMYK + Troquelador EPS + Distribución en Pliego)"
    )
    opencv_installed: bool
    numpy_installed: bool
    pillow_installed: bool
    rembg_installed: bool
    onnxruntime_installed: bool = False
    shapely_installed: bool = False
    modules: List[Phase2ModuleInfo]


class EnhanceAdjustmentsBase(BaseModel):
    target_dpi: int = Field(default=300, ge=72, le=1200)
    upscale_factor: float = Field(default=1.0, ge=1.0, le=4.0)
    denoise_strength: int = Field(default=0, ge=0, le=100)
    sharpen_strength: int = Field(default=0, ge=0, le=100)
    auto_contrast: bool = False

    remove_background: bool = False
    bg_mode: BgRemovalModeLiteral = "smart_subject"
    bg_tolerance: int = Field(default=28, ge=5, le=90)
    bg_feather: int = Field(default=1, ge=0, le=5)

    brightness: int = Field(default=0, ge=-100, le=100)
    contrast: int = Field(default=0, ge=-100, le=100)
    saturation: int = Field(default=0, ge=-100, le=100)
    gamma: float = Field(default=1.0, ge=0.5, le=2.0)

    cyan: int = Field(default=0, ge=-50, le=50)
    magenta: int = Field(default=0, ge=-50, le=50)
    yellow: int = Field(default=0, ge=-50, le=50)
    black: int = Field(default=0, ge=-50, le=50)
    ink_limit_percent: int = Field(default=300, ge=200, le=400)


class EnhanceImageRequest(EnhanceAdjustmentsBase):
    order_id: str
    item_id: Optional[int] = Field(default=None, ge=1)
    output_format: Literal["png_rgb", "tiff_cmyk", "jpeg_cmyk"] = "png_rgb"


class SaveEnhancedToOrderRequest(EnhanceAdjustmentsBase):
    order_id: str
    item_id: Optional[int] = Field(default=None, ge=1)
    advance_status: Optional[
        Literal["En Diseño", "En Impresión", "Troquelado", "Listo"]
    ] = None


class CmykStatsResponse(BaseModel):
    avg_cyan: float
    avg_magenta: float
    avg_yellow: float
    avg_black: float
    max_tac_percent: float
    tac_warning: bool


class EnhanceImageResponse(BaseModel):
    source_label: str
    item_id: Optional[int] = None
    preview_data_url: str
    original_width: int
    original_height: int
    output_width: int
    output_height: int
    target_dpi: int
    physical_width_cm: float
    physical_height_cm: float
    effective_dpi: Optional[float] = None
    dpi_status: Optional[DpiPreflightStatus] = None
    cmyk_stats: CmykStatsResponse
    processing_time_ms: float
    has_transparency: bool
    background_removed: bool = False
    bg_mode_effective: Optional[BgRemovalModeLiteral] = None
    bg_fallback_used: bool = False
    bg_notice: Optional[str] = None


class RetouchInpaintResponse(BaseModel):
    preview_data_url: str
    width: int
    height: int
    masked_pixels: int
    masked_percent: float
    mode: Literal[
        "inpaint_telea",
        "inpaint_ns",
        "watermark_clean",
        "erase_transparent",
    ]
    processing_time_ms: float
    has_transparency: bool
    detected_base_color: Optional[str] = None


class DetectWatermarkMaskResponse(BaseModel):
    mask_data_url: str
    width: int
    height: int
    detected_pixels: int
    detected_percent: float
    processing_time_ms: float


class BezierAnchorSchema(BaseModel):
    x: float
    y: float
    in_x: float
    in_y: float
    out_x: float
    out_y: float
    smooth: bool = True


class DetectEdgesRequest(BaseModel):
    order_id: str
    item_id: Optional[int] = Field(default=None, ge=1)
    mode: Literal["en_su_forma", "circular", "poligono_regular"] = "en_su_forma"
    cut_direction: Literal["outside", "inside"] = "outside"
    dpi: int = Field(default=300, ge=72, le=1200)
    bleed_mm: float = Field(default=2.5, ge=0.0, le=20.0)
    white_border_mm: float = Field(default=0.0, ge=0.0, le=10.0)
    corner_roundness: float = Field(default=0.35, ge=0.05, le=1.0)
    smoothing_epsilon: float = Field(default=0.004, ge=0.001, le=0.03)
    polygon_sides: int = Field(default=6, ge=3, le=12)
    polygon_rotation_deg: float = Field(default=0.0, ge=-180.0, le=180.0)
    remove_background: bool = False
    bg_tolerance: int = Field(default=28, ge=5, le=90)
    merge_islands: bool = True
    join_islands: Optional[bool] = None
    border_mode: Literal["none", "base_color", "white", "custom"] = "none"
    border_color: Optional[str] = Field(default=None, max_length=16)
    border_width_mm: float = Field(default=2.0, ge=0.5, le=12.0)
    border_cut_position: Literal["inside_base", "outside_base"] = "inside_base"
    border_offset_mm: float = Field(default=1.5, ge=0.0, le=10.0)
    cut_stroke_width_pt: float = Field(default=0.5, ge=0.1, le=5.0)
    target_width_cm: Optional[float] = Field(default=None, gt=0, le=500)
    target_height_cm: Optional[float] = Field(default=None, gt=0, le=500)
    fit_mode: DieCutFitModeLiteral = "contain_proportional"


class DetectEdgesResponse(BaseModel):
    source_label: str
    item_id: Optional[int] = None
    mode: Literal["en_su_forma", "circular", "poligono_regular"]
    cut_direction: Literal["outside", "inside"] = "outside"
    image_width: int
    image_height: int
    dpi: int
    physical_width_cm: float
    physical_height_cm: float
    cut_width_cm: float = 0.0
    cut_height_cm: float = 0.0
    effective_px_per_mm: float = 11.811
    target_width_cm: Optional[float] = None
    target_height_cm: Optional[float] = None
    fit_mode: DieCutFitModeLiteral = "contain_proportional"
    effective_dpi: Optional[float] = None
    dpi_status: Optional[DpiPreflightStatus] = None
    bleed_mm: float
    white_border_mm: float = 0.0
    artwork_data_url: str
    cut_path_d: str
    anchors: List[BezierAnchorSchema]
    background_removed: bool
    border_mode: Literal["none", "base_color", "white", "custom"] = "none"
    border_color: Optional[str] = None
    border_cut_position: Literal["inside_base", "outside_base"] = "inside_base"
    detected_base_color: Optional[str] = None
    palette_colors: List[str] = Field(default_factory=list)


class ExportDieCutRequest(BaseModel):
    order_id: Optional[str] = None
    item_id: Optional[int] = Field(default=None, ge=1)
    artwork_data_url: Optional[str] = None
    title: str = Field(default="SIETE_Sticker_DieCut", max_length=80)
    image_width: int = Field(..., ge=16, le=8192)
    image_height: int = Field(..., ge=16, le=8192)
    dpi: int = Field(default=300, ge=72, le=1200)
    anchors: List[BezierAnchorSchema] = Field(..., min_length=3, max_length=500)
    export_format: Literal["eps", "svg"] = "eps"
    advance_status: Optional[Literal["Troquelado", "Listo"]] = None
    mode: Literal["en_su_forma", "circular", "poligono_regular"] = "en_su_forma"
    bleed_mm: float = Field(default=2.5, ge=0.0, le=20.0)
    white_border_mm: float = Field(default=0.0, ge=0.0, le=10.0)
    remove_background: bool = False
    bg_tolerance: int = Field(default=28, ge=5, le=90)
    border_color: Optional[str] = Field(default=None, max_length=16)
    cut_direction: Literal["outside", "inside"] = "outside"
    border_width_mm: float = Field(default=2.0, ge=0.5, le=12.0)
    border_cut_position: Literal["inside_base", "outside_base"] = "inside_base"
    border_offset_mm: float = Field(default=1.5, ge=0.0, le=10.0)
    cut_stroke_width_pt: float = Field(default=0.5, ge=0.1, le=5.0)
    target_width_cm: Optional[float] = Field(default=None, gt=0, le=500)
    target_height_cm: Optional[float] = Field(default=None, gt=0, le=500)
    fit_mode: DieCutFitModeLiteral = "contain_proportional"


class ExportProductionRequest(BaseModel):
    """Configuration for unified multi-design order production export (`export-production`)."""

    format: Literal["auto", "eps", "pdf", "zip"] = Field(
        default="auto",
        description=(
            "Formato de salida: 'auto' elige '.eps' en una sola hoja para trabajos no-rollo "
            "y '.pdf' multi-página (mesas de trabajo separadas) para trabajos 'En rollo'."
        ),
    )
    sheet_width_cm: Optional[float] = Field(
        default=None,
        gt=0,
        le=500,
        description="Ancho máximo de hoja en cm para acomodo de diseños no-rollo (automático si se omite).",
    )
    margin_cm: float = Field(
        default=1.0,
        ge=0.0,
        le=10.0,
        description="Margen de seguridad perimetral en cm (por defecto 1.0 cm).",
    )
    gap_cm: float = Field(
        default=0.5,
        ge=0.0,
        le=10.0,
        description="Separación entre diseños en la misma hoja en cm (por defecto 0.5 cm).",
    )
    roll_artboard_gap_cm: float = Field(
        default=3.0,
        ge=0.5,
        le=20.0,
        description="Distancia fija en cm entre mesas/carriles separados cuando se exporta rollo en .EPS (por defecto 3.0 cm).",
    )
    dpi: int = Field(default=300, ge=72, le=1200)
    cut_stroke_width_pt: float = Field(default=0.5, ge=0.1, le=5.0)


class PackLayoutItem(BaseModel):
    """Physical design specification (in cm) for 2D sheet or roll nesting."""

    item_id: str = Field(..., min_length=1, max_length=80, description="Identificador único del diseño.")
    order_id: Optional[str] = Field(default=None, max_length=80)
    label: Optional[str] = Field(default=None, max_length=120)
    material: str = Field(default="General", max_length=80, description="Material para agrupar pliegos.")
    shape: StickerShapeLiteral = "Rectangular"
    diameter_cm: Optional[float] = Field(default=None, gt=0, le=500)
    width_cm: float = Field(..., gt=0, le=500, description="Ancho físico del sticker en cm.")
    height_cm: float = Field(..., gt=0, le=500, description="Alto físico del sticker en cm.")
    quantity: int = Field(..., ge=1, le=5000, description="Cantidad de copias de este diseño.")
    allow_rotation: Optional[bool] = Field(
        default=None,
        description="Permitir rotación de 90° (por defecto True en rectangulares, False en circulares/cuadrados).",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_item_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        adapted = dict(data)
        if "item_id" not in adapted or adapted["item_id"] is None or str(adapted["item_id"]).strip() == "":
            if adapted.get("order_id") is not None:
                adapted["item_id"] = str(adapted["order_id"]).strip()
        else:
            adapted["item_id"] = str(adapted["item_id"]).strip()

        if adapted.get("diameter_cm") is not None:
            d = float(adapted["diameter_cm"])
            adapted.setdefault("width_cm", d)
            adapted.setdefault("height_cm", d)
            if "shape" not in adapted:
                adapted["shape"] = "Circular"

        if "width_cm" not in adapted and adapted.get("width_mm") is not None:
            adapted["width_cm"] = round(float(adapted.pop("width_mm")) / 10.0, 4)
        if "height_cm" not in adapted and adapted.get("height_mm") is not None:
            adapted["height_cm"] = round(float(adapted.pop("height_mm")) / 10.0, 4)

        if not adapted.get("material"):
            adapted["material"] = "General"
        return adapted

    @field_validator("item_id", mode="before")
    @classmethod
    def coerce_item_id_str(cls, v: Any) -> str:
        return str(v).strip()


class PackLayoutRequest(BaseModel):
    """Request payload for `POST /api/v1/image-processing/pack-layout` (dimensions in cm)."""

    media_type: Optional[LayoutMediaTypeLiteral] = Field(
        default=None,
        description="Modo de soporte: 'sheet' (pliego fijo) o 'roll' (rollo continuo).",
    )
    sheet_width_cm: float = Field(
        default=32.0,
        gt=0,
        le=500,
        description="Ancho del pliego o rollo en cm (ej. 32.0 para SRA3 o 60.0 para rollo).",
    )
    sheet_height_cm: Optional[float] = Field(
        default=None,
        gt=0,
        le=2000,
        description="Alto del pliego en cm (ej. 45.0 para SRA3). Omitir en modo rollo continuo.",
    )
    roll_width_cm: Optional[float] = Field(
        default=None,
        gt=0,
        le=500,
        description="Atajo para modo rollo continuo indicando el ancho del rollo en cm.",
    )
    margin_cm: float = Field(
        default=2.0,
        ge=0.0,
        le=25.0,
        description="Margen de seguridad perimetral en cm para marcas de registro del plotter (por defecto 2.0 cm).",
    )
    gap_cm: float = Field(
        default=0.3,
        ge=0.0,
        le=10.0,
        description="Separación mínima entre stickers en cm (por defecto 0.3 cm).",
    )
    group_by_material: bool = Field(
        default=True,
        description="Agrupar automáticamente los diseños por mismo material en pliegos independientes.",
    )
    include_preview_svg: bool = Field(
        default=False,
        description="Generar diagrama SVG de imposición con marcas de registro.",
    )
    order_id: Optional[str] = Field(
        default=None,
        description="ID de pedido opcional para cargar automáticamente sus diseños desde la base de datos.",
    )
    order_ids: Optional[List[str]] = Field(
        default=None,
        description="Lista opcional de IDs de pedidos para anidar múltiples pedidos del mismo material.",
    )
    material_filter: Optional[str] = Field(
        default=None,
        max_length=80,
        description="Filtro opcional de material al cargar diseños desde pedidos.",
    )
    items: List[PackLayoutItem] = Field(
        default_factory=list,
        description="Lista de diseños con sus medidas físicas en cm y cantidades.",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_sheet_dimensions(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        adapted = dict(data)
        has_explicit_width_cm = "sheet_width_cm" in adapted and adapted["sheet_width_cm"] is not None
        has_explicit_height_cm = "sheet_height_cm" in adapted and adapted["sheet_height_cm"] is not None
        has_roll_width_cm = "roll_width_cm" in adapted and adapted["roll_width_cm"] is not None

        if not has_explicit_width_cm and adapted.get("sheet_width_mm") is not None:
            adapted["sheet_width_cm"] = round(float(adapted.pop("sheet_width_mm")) / 10.0, 4)
            has_explicit_width_cm = True
        if not has_explicit_height_cm and adapted.get("sheet_height_mm") is not None:
            adapted["sheet_height_cm"] = round(float(adapted.pop("sheet_height_mm")) / 10.0, 4)
            has_explicit_height_cm = True
        if "margin_cm" not in adapted and adapted.get("margin_mm") is not None:
            adapted["margin_cm"] = round(float(adapted.pop("margin_mm")) / 10.0, 4)
        if "gap_cm" not in adapted and adapted.get("spacing_mm") is not None:
            adapted["gap_cm"] = round(float(adapted.pop("spacing_mm")) / 10.0, 4)

        if has_roll_width_cm:
            adapted["sheet_width_cm"] = float(adapted["roll_width_cm"])
            adapted.setdefault("media_type", "roll")
        elif adapted.get("media_type") == "roll":
            pass
        elif has_explicit_width_cm and not has_explicit_height_cm and adapted.get("media_type") is None:
            adapted["media_type"] = "roll"
        else:
            adapted.setdefault("media_type", "sheet")
            if adapted["media_type"] == "sheet" and not has_explicit_height_cm:
                adapted["sheet_height_cm"] = 45.0

        return adapted


class PlacedStickerResponse(BaseModel):
    """Coordinates and orientation of a single placed sticker instance (in cm)."""

    item_id: str
    x: float
    y: float
    width: float
    height: float
    rotated: bool = False
    sheet_index: int = 1
    order_id: Optional[str] = None
    material: str = "General"
    shape: StickerShapeLiteral = "Rectangular"
    label: Optional[str] = None
    copy_index: int = 1


class SheetLayoutPageResponse(BaseModel):
    """Single packed sheet or vinyl roll strip with its placed stickers and efficiency metrics."""

    sheet_index: int
    material: str
    material_sheet_index: int
    width_cm: float
    height_cm: float
    used_height_cm: float
    stickers_count: int
    stickers_area_cm2: float
    sheet_area_cm2: float
    usable_area_cm2: float
    utilization_percent: float
    waste_percent: float
    usable_utilization_percent: float
    placements: List[PlacedStickerResponse]


class MaterialLayoutGroupResponse(BaseModel):
    """Per-material imposition summary when packing multi-material orders."""

    material: str
    sheets_required: int
    stickers_count: int
    stickers_area_cm2: float
    total_sheet_area_cm2: float
    utilization_percent: float
    waste_percent: float
    sheet_indices: List[int]


class PackLayoutResponse(BaseModel):
    """Complete 2D imposition response returned by `POST /api/v1/image-processing/pack-layout`."""

    total_sheets: int
    total_stickers: int
    utilization_percent: float
    waste_percent: float
    usable_utilization_percent: float
    total_stickers_area_cm2: float
    total_sheet_area_cm2: float
    total_usable_area_cm2: float
    sheet_width_cm: float
    sheet_height_cm: Optional[float] = None
    media_type: LayoutMediaTypeLiteral
    margin_cm: float
    gap_cm: float
    usable_width_cm: float
    usable_height_cm: Optional[float] = None
    group_by_material: bool = True
    geometry_engine: Literal["shapely", "analytical"] = "analytical"
    sheets: List[SheetLayoutPageResponse]
    material_groups: List[MaterialLayoutGroupResponse]
    placements: List[PlacedStickerResponse]
    preview_svg: Optional[str] = None


class Phase2NotImplementedResponse(BaseModel):
    status: str = "not_implemented"
    phase: str = "Fase 2"
    module: str
    message: str
    planned_stack: List[str]
    request_echo: Optional[dict] = None
