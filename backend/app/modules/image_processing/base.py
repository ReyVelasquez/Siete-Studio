"""Abstract base contracts and data transfer objects for Phase 2 image modules."""

from __future__ import annotations

import importlib.util
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Generic, List, Optional, Tuple, TypeVar

TInput = TypeVar("TInput")
TOutput = TypeVar("TOutput")


@dataclass(frozen=True)
class ImageAsset:
    """In-memory representation of a sticker source image loaded from Firebase Storage."""

    order_id: str
    content: bytes
    content_type: str
    filename: str


@dataclass(frozen=True)
class EnhancementOptions:
    target_dpi: int = 300
    upscale_factor: float = 2.0
    denoise: bool = True
    sharpen: bool = True


@dataclass(frozen=True)
class ProcessingResult:
    """Output artifact from an image enhancement pipeline."""

    output_bytes: bytes
    content_type: str
    width_px: int
    height_px: int
    dpi: int
    metadata: Dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ContourPoint:
    x: float
    y: float


@dataclass(frozen=True)
class DieCutResult:
    """Detected sticker silhouette and cut-line vector output."""

    cut_path_svg: str
    bounding_box_px: Tuple[int, int, int, int]
    bleed_mm: float
    contour_points: List[ContourPoint] = field(default_factory=list)
    preview_mask_png: Optional[bytes] = None


@dataclass(frozen=True)
class SheetSpec:
    width_mm: float = 320.0
    height_mm: float = 450.0
    margin_mm: float = 10.0
    spacing_mm: float = 3.0


@dataclass(frozen=True)
class StickerNestItem:
    order_id: str
    width_mm: float
    height_mm: float
    quantity: int
    allow_rotation: bool = True


@dataclass(frozen=True)
class PlacedSticker:
    order_id: str
    sheet_index: int
    x_mm: float
    y_mm: float
    width_mm: float
    height_mm: float
    rotated_90: bool = False


@dataclass(frozen=True)
class SheetLayoutResult:
    sheets_required: int
    utilization_percent: float
    placements: List[PlacedSticker] = field(default_factory=list)
    preview_svg: Optional[str] = None


class BaseImageProcessor(ABC, Generic[TInput, TOutput]):
    """Common interface for all Phase 2 asynchronous/synchronous processing engines."""

    module_name: str = "base"

    @abstractmethod
    def is_available(self) -> bool:
        """Return True when required scientific/CV libraries are installed."""

    @abstractmethod
    async def process(self, payload: TInput) -> TOutput:
        """Execute processing pipeline (implemented in Phase 2)."""


def check_phase2_dependencies() -> Dict[str, bool]:
    """Detect optional Phase 2 CV/AI packages without importing heavy binaries at startup."""
    return {
        "opencv": importlib.util.find_spec("cv2") is not None,
        "numpy": importlib.util.find_spec("numpy") is not None,
        "rembg": importlib.util.find_spec("rembg") is not None,
        "pillow": importlib.util.find_spec("PIL") is not None,
    }
