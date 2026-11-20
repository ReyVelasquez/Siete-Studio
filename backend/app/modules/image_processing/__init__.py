"""
Phase 2 Modular Image Processing Package.

Provides clean base interfaces and stubs prepared for:
- Image resolution & print-quality enhancement (OpenCV + NumPy)
- Automatic AI die-cut edge/contour detection (OpenCV + rembg / U2-Net)
- Optimal 2D print-sheet nesting / layout packing
"""

from app.modules.image_processing.base import (
    BaseImageProcessor,
    ContourPoint,
    DieCutResult,
    EnhancementOptions,
    ImageAsset,
    PlacedSticker,
    ProcessingResult,
    SheetLayoutResult,
    SheetSpec,
    StickerNestItem,
    check_phase2_dependencies,
)
from app.modules.image_processing.edge_detector import DieCutEdgeDetectorService
from app.modules.image_processing.enhancer import ImageEnhancerService
from app.modules.image_processing.layout_packer import SheetLayoutPackerService

__all__ = [
    "BaseImageProcessor",
    "ContourPoint",
    "DieCutEdgeDetectorService",
    "DieCutResult",
    "EnhancementOptions",
    "ImageAsset",
    "ImageEnhancerService",
    "PlacedSticker",
    "ProcessingResult",
    "SheetLayoutPackerService",
    "SheetLayoutResult",
    "SheetSpec",
    "StickerNestItem",
    "check_phase2_dependencies",
]
