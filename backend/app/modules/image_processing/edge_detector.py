"""
Phase 2 Stub: Automatic Die-Cut Edge & Silhouette Detector (OpenCV + rembg / U2-Net).

Planned Pipeline:
1. Segment foreground subject using AI matting (`rembg` / U2-Net) when alpha is absent.
2. Extract clean binary alpha mask and apply morphological closing/dilation for bleed offset (`bleed_mm`).
3. Compute exterior contours (`cv2.findContours`) and smooth polygon via Douglas-Peucker (`cv2.approxPolyDP`).
4. Export plotter-ready cut line as SVG path or DXF contour with registration marks.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.modules.image_processing.base import (
    BaseImageProcessor,
    DieCutResult,
    ImageAsset,
    check_phase2_dependencies,
)


@dataclass(frozen=True)
class EdgeDetectionPayload:
    asset: ImageAsset
    remove_background: bool = True
    bleed_mm: float = 2.0
    smoothing_epsilon: float = 0.002
    export_format: str = "svg"


class DieCutEdgeDetectorService(BaseImageProcessor[EdgeDetectionPayload, DieCutResult]):
    """Detects sticker contour silhouettes and generates plotter die-cut paths."""

    module_name = "die_cut_edge_detector"

    def is_available(self) -> bool:
        deps = check_phase2_dependencies()
        return deps["opencv"] and deps["numpy"] and deps["rembg"]

    async def process(self, payload: EdgeDetectionPayload) -> DieCutResult:
        raise NotImplementedError(
            "Módulo de troquelado automático IA (OpenCV + rembg/U2-Net) reservado para Fase 2. "
            f"Parámetros recibidos: order_id={payload.asset.order_id}, "
            f"bleed_mm={payload.bleed_mm}, export={payload.export_format}."
        )
