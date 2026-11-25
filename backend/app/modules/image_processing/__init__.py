"""
Phase 2 Modular Image Processing Package.

Provides clean base interfaces and stubs prepared for:
- Image resolution & print-quality enhancement (OpenCV + NumPy)
- Automatic AI die-cut edge/contour detection (OpenCV + rembg / U2-Net)
- Optimal 2D print-sheet nesting / layout packing
"""

from app.modules.image_processing.base import (
    BaseImageProcessor,
    BgRemovalMode,
    ContourPoint,
    DieCutResult,
    EnhancementOptions,
    ImageAsset,
    LayoutMediaType,
    MaterialLayoutGroup,
    PlacedSticker,
    ProcessingResult,
    SheetLayoutPage,
    SheetLayoutResult,
    SheetSpec,
    StickerNestItem,
    check_phase2_dependencies,
)
from app.modules.image_processing.edge_detector import DieCutEdgeDetectorService
from app.modules.image_processing.enhancer import ImageEnhancerService
from app.modules.image_processing.layout_packer import (
    LayoutPackPayload,
    SheetLayoutPackerService,
)
from app.modules.image_processing.retouch import RetouchInpaintService

__all__ = [
    "BaseImageProcessor",
    "BgRemovalMode",
    "ContourPoint",
    "DieCutEdgeDetectorService",
    "DieCutResult",
    "EnhancementOptions",
    "ImageAsset",
    "ImageEnhancerService",
    "LayoutMediaType",
    "LayoutPackPayload",
    "MaterialLayoutGroup",
    "PlacedSticker",
    "ProcessingResult",
    "RetouchInpaintService",
    "SheetLayoutPackerService",
    "SheetLayoutPage",
    "SheetLayoutResult",
    "SheetSpec",
    "StickerNestItem",
    "check_phase2_dependencies",
]
