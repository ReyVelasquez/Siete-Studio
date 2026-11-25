"""Abstract base contracts and data transfer objects for Phase 2 image modules."""

from __future__ import annotations

import importlib.util
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Generic, List, Literal, Optional, Tuple, TypeVar

TInput = TypeVar("TInput")
TOutput = TypeVar("TOutput")

EnhanceOutputFormat = Literal["png_rgb", "tiff_cmyk", "jpeg_cmyk"]
BgRemovalMode = Literal["smart_subject", "auto_color", "grabcut", "ai_rembg"]
DieCutShapeMode = Literal["en_su_forma", "circular", "poligono_regular"]
DieCutDirection = Literal["outside", "inside"]
DieCutBorderMode = Literal["none", "base_color", "white", "custom"]
DieCutBorderCutPosition = Literal["inside_base", "outside_base"]
DieCutFitMode = Literal["contain_proportional", "exact_stretch"]
LayoutMediaType = Literal["sheet", "roll"]
StickerShapeName = Literal["Circular", "Rectangular", "Cuadrado", "En su forma"]


@dataclass(frozen=True)
class ImageAsset:
    """In-memory representation of a sticker source image loaded from Storage or upload."""

    order_id: str
    content: bytes
    content_type: str
    filename: str


@dataclass(frozen=True)
class EnhancementOptions:
    # Quality & Resolution (OpenCV + NumPy)
    target_dpi: int = 300
    upscale_factor: float = 1.0
    denoise_strength: int = 0       # 0..100
    sharpen_strength: int = 0       # 0..100
    auto_contrast: bool = False     # CLAHE adaptive contrast

    # Background Removal (PNG Transparency for Die-Cut)
    remove_background: bool = False
    bg_mode: BgRemovalMode = "auto_color"
    bg_tolerance: int = 28          # 5..90 LAB color distance threshold
    bg_feather: int = 1             # 0..5 edge softness px

    # Tone & Color Adjustments
    brightness: int = 0             # -100..+100
    contrast: int = 0               # -100..+100
    saturation: int = 0             # -100..+100
    gamma: float = 1.0              # 0.50..2.00

    # CMYK Print Color Calibration
    cyan: int = 0                   # -50..+50 (%)
    magenta: int = 0                # -50..+50 (%)
    yellow: int = 0                 # -50..+50 (%)
    black: int = 0                  # -50..+50 (%)
    ink_limit_percent: int = 300    # 200..400 (Total Area Coverage cap)

    output_format: EnhanceOutputFormat = "png_rgb"


@dataclass(frozen=True)
class CmykStats:
    """Computed CMYK ink distribution telemetry across opaque sticker pixels."""

    avg_cyan: float
    avg_magenta: float
    avg_yellow: float
    avg_black: float
    max_tac_percent: float
    tac_warning: bool


@dataclass(frozen=True)
class ProcessingResult:
    """Output artifact from an image enhancement pipeline."""

    output_bytes: bytes
    content_type: str
    extension: str
    original_width: int
    original_height: int
    width_px: int
    height_px: int
    dpi: int
    physical_width_cm: float
    physical_height_cm: float
    cmyk_stats: CmykStats
    processing_time_ms: float
    metadata: Dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ContourPoint:
    x: float
    y: float


@dataclass(frozen=True)
class BezierAnchor:
    """Editable Illustrator-style cubic Bezier anchor point with incoming/outgoing handles."""

    x: float
    y: float
    in_x: float
    in_y: float
    out_x: float
    out_y: float
    smooth: bool = True


@dataclass(frozen=True)
class DieCutResult:
    """Detected sticker silhouette and editable rounded vector cut-line output."""

    mode: DieCutShapeMode
    image_width: int
    image_height: int
    dpi: int
    bleed_mm: float
    cut_path_d: str
    cut_path_svg: str
    bounding_box_px: Tuple[int, int, int, int]
    anchors: List[BezierAnchor] = field(default_factory=list)
    contour_points: List[ContourPoint] = field(default_factory=list)
    artwork_png_bytes: Optional[bytes] = None
    background_removed: bool = False
    cut_direction: DieCutDirection = "outside"
    border_mode: DieCutBorderMode = "none"
    border_color: Optional[str] = None
    border_cut_position: DieCutBorderCutPosition = "inside_base"
    detected_base_color: Optional[str] = None
    palette_colors: List[str] = field(default_factory=list)
    white_border_mm: float = 0.0
    source_width: int = 0
    source_height: int = 0
    physical_width_cm: float = 0.0
    physical_height_cm: float = 0.0
    cut_width_cm: float = 0.0
    cut_height_cm: float = 0.0
    effective_px_per_mm: float = 11.811
    target_width_cm: Optional[float] = None
    target_height_cm: Optional[float] = None
    fit_mode: DieCutFitMode = "contain_proportional"


@dataclass(frozen=True)
class SheetSpec:
    """Physical sheet or vinyl roll dimensions and plotter margins in centimeters."""

    width_cm: float = 32.0
    height_cm: Optional[float] = 45.0
    margin_cm: float = 2.0
    gap_cm: float = 0.3
    media_type: LayoutMediaType = "sheet"
    group_by_material: bool = True
    include_preview_svg: bool = False


@dataclass(frozen=True)
class StickerNestItem:
    """Design footprint and quantity to pack onto print sheets or vinyl rolls (cm)."""

    item_id: str
    width_cm: float
    height_cm: float
    quantity: int
    material: str = "General"
    shape: StickerShapeName = "Rectangular"
    allow_rotation: Optional[bool] = None
    order_id: Optional[str] = None
    label: Optional[str] = None


@dataclass(frozen=True)
class PlacedSticker:
    """Placed sticker coordinates (cm) relative to the sheet/roll top-left origin."""

    item_id: str
    x: float
    y: float
    width: float
    height: float
    rotated: bool = False
    sheet_index: int = 1
    order_id: Optional[str] = None
    material: str = "General"
    shape: StickerShapeName = "Rectangular"
    label: Optional[str] = None
    copy_index: int = 1


@dataclass(frozen=True)
class SheetLayoutPage:
    """Single packed sheet or vinyl roll segment with placements and area metrics."""

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
    placements: List[PlacedSticker] = field(default_factory=list)


@dataclass(frozen=True)
class MaterialLayoutGroup:
    """Aggregated packing summary for a single material batch."""

    material: str
    sheets_required: int
    stickers_count: int
    stickers_area_cm2: float
    total_sheet_area_cm2: float
    utilization_percent: float
    waste_percent: float
    sheet_indices: List[int] = field(default_factory=list)


@dataclass(frozen=True)
class SheetLayoutResult:
    """Complete multi-sheet or roll nesting calculation with efficiency telemetry."""

    total_sheets: int
    total_stickers: int
    utilization_percent: float
    waste_percent: float
    usable_utilization_percent: float
    total_stickers_area_cm2: float
    total_sheet_area_cm2: float
    total_usable_area_cm2: float
    sheet_width_cm: float
    sheet_height_cm: Optional[float]
    media_type: LayoutMediaType
    margin_cm: float
    gap_cm: float
    usable_width_cm: float
    usable_height_cm: Optional[float]
    group_by_material: bool
    geometry_engine: Literal["shapely", "analytical"] = "analytical"
    sheets: List[SheetLayoutPage] = field(default_factory=list)
    material_groups: List[MaterialLayoutGroup] = field(default_factory=list)
    placements: List[PlacedSticker] = field(default_factory=list)
    preview_svg: Optional[str] = None


class BaseImageProcessor(ABC, Generic[TInput, TOutput]):
    """Common interface for all Phase 2 processing engines."""

    module_name: str = "base"

    @abstractmethod
    def is_available(self) -> bool:
        """Return True when required scientific/CV libraries are installed."""

    @abstractmethod
    async def process(self, payload: TInput) -> TOutput:
        """Execute processing pipeline."""


def check_phase2_dependencies() -> Dict[str, bool]:
    """Detect Phase 2 CV/AI/Geometry packages without importing heavy binaries at startup."""
    return {
        "opencv": importlib.util.find_spec("cv2") is not None,
        "numpy": importlib.util.find_spec("numpy") is not None,
        "rembg": importlib.util.find_spec("rembg") is not None,
        "onnxruntime": importlib.util.find_spec("onnxruntime") is not None,
        "shapely": importlib.util.find_spec("shapely") is not None,
        "pillow": importlib.util.find_spec("PIL") is not None,
    }
