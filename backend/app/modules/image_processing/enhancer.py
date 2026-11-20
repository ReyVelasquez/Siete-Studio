"""
Phase 2 Stub: Image Resolution & Print-Quality Enhancer (OpenCV + NumPy).

Planned Pipeline:
1. Decode image bytes into NumPy BGR/BGRA array preserving alpha channel.
2. Edge-preserving denoising (`cv2.fastNlMeansDenoisingColored` / bilateral filter).
3. Bicubic / Lanczos / FSRCNN super-resolution upscaling to target 300 DPI.
4. Unsharp masking & subtle print-ready contrast calibration.
5. Encode lossless PNG preserving transparency metadata and DPI header.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.modules.image_processing.base import (
    BaseImageProcessor,
    EnhancementOptions,
    ImageAsset,
    ProcessingResult,
    check_phase2_dependencies,
)


@dataclass(frozen=True)
class EnhancePayload:
    asset: ImageAsset
    options: EnhancementOptions


class ImageEnhancerService(BaseImageProcessor[EnhancePayload, ProcessingResult]):
    """Enhances sticker artwork sharpness, noise profile, and DPI for print."""

    module_name = "image_enhancer"

    def is_available(self) -> bool:
        deps = check_phase2_dependencies()
        return deps["opencv"] and deps["numpy"]

    async def process(self, payload: EnhancePayload) -> ProcessingResult:
        raise NotImplementedError(
            "Módulo de mejora de imagen (OpenCV + NumPy) reservado para Fase 2. "
            f"Parámetros recibidos: order_id={payload.asset.order_id}, "
            f"target_dpi={payload.options.target_dpi}, upscale={payload.options.upscale_factor}x."
        )
