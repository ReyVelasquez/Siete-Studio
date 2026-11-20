"""Protected Phase 2 stub endpoints for OpenCV / NumPy / AI image processing."""

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse

from app.core.security import get_current_user
from app.modules.image_processing import (
    DieCutEdgeDetectorService,
    ImageEnhancerService,
    SheetLayoutPackerService,
    check_phase2_dependencies,
)
from app.schemas.image_processing import (
    DetectEdgesRequest,
    EnhanceImageRequest,
    ImageProcessingCapabilitiesResponse,
    PackLayoutRequest,
    Phase2ModuleInfo,
    Phase2NotImplementedResponse,
)

router = APIRouter(
    prefix="/image-processing",
    tags=["Phase 2 - Image Processing (Stubs)"],
    dependencies=[Depends(get_current_user)],
)

enhancer_service = ImageEnhancerService()
edge_detector_service = DieCutEdgeDetectorService()
layout_packer_service = SheetLayoutPackerService()


@router.get(
    "/capabilities",
    response_model=ImageProcessingCapabilitiesResponse,
    summary="Estado de preparación de módulos de procesamiento de Fase 2",
)
async def get_image_processing_capabilities() -> ImageProcessingCapabilitiesResponse:
    deps = check_phase2_dependencies()
    return ImageProcessingCapabilitiesResponse(
        opencv_installed=deps["opencv"],
        numpy_installed=deps["numpy"],
        rembg_installed=deps["rembg"],
        modules=[
            Phase2ModuleInfo(
                id="enhancer",
                name="Mejora de Calidad y Resolución",
                stack=["OpenCV", "NumPy", "Pillow"],
                description=(
                    "Escalado inteligente a 300 DPI, reducción de ruido preservando bordes "
                    "y calibración de nitidez para impresión en vinilo y DTF UV."
                ),
                endpoint="/api/v1/image-processing/enhance",
            ),
            Phase2ModuleInfo(
                id="edge_detector",
                name="Troquelado Automático con IA",
                stack=["OpenCV", "NumPy", "rembg (U2-Net)"],
                description=(
                    "Segmentación automática de fondo con IA, extracción de silueta vectorial "
                    "suavizada y generación de sangrado/línea de corte (SVG/DXF)."
                ),
                endpoint="/api/v1/image-processing/detect-edges",
            ),
            Phase2ModuleInfo(
                id="layout_packer",
                name="Distribución Óptima en Pliego",
                stack=["NumPy", "2D Bin Packing / Nesting"],
                description=(
                    "Acomodo automático de múltiples pedidos en pliego o rollo con márgenes "
                    "de corte, marcas de registro y maximización de aprovechamiento."
                ),
                endpoint="/api/v1/image-processing/pack-layout",
            ),
        ],
    )


@router.post(
    "/enhance",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
    response_model=Phase2NotImplementedResponse,
    summary="[Fase 2 Stub] Mejorar calidad y resolución de imagen",
)
async def enhance_order_image(payload: EnhanceImageRequest) -> JSONResponse:
    body = Phase2NotImplementedResponse(
        module=enhancer_service.module_name,
        message=(
            "Endpoint preparado para Fase 2: ejecutará `ImageEnhancerService` con OpenCV y NumPy "
            "para llevar el arte a calidad de impresión."
        ),
        planned_stack=["opencv-python-headless", "numpy", "pillow"],
        request_echo=payload.model_dump(),
    )
    return JSONResponse(status_code=status.HTTP_501_NOT_IMPLEMENTED, content=body.model_dump())


@router.post(
    "/detect-edges",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
    response_model=Phase2NotImplementedResponse,
    summary="[Fase 2 Stub] Detección automática de bordes y línea de troquelado",
)
async def detect_die_cut_edges(payload: DetectEdgesRequest) -> JSONResponse:
    body = Phase2NotImplementedResponse(
        module=edge_detector_service.module_name,
        message=(
            "Endpoint preparado para Fase 2: ejecutará `DieCutEdgeDetectorService` con OpenCV y "
            "segmentación IA (rembg / U2-Net) para generar contornos de troquelado."
        ),
        planned_stack=["opencv-python-headless", "numpy", "rembg", "onnxruntime"],
        request_echo=payload.model_dump(),
    )
    return JSONResponse(status_code=status.HTTP_501_NOT_IMPLEMENTED, content=body.model_dump())


@router.post(
    "/pack-layout",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
    response_model=Phase2NotImplementedResponse,
    summary="[Fase 2 Stub] Distribución óptima de stickers en pliego",
)
async def pack_sheet_layout(payload: PackLayoutRequest) -> JSONResponse:
    body = Phase2NotImplementedResponse(
        module=layout_packer_service.module_name,
        message=(
            "Endpoint preparado para Fase 2: ejecutará `SheetLayoutPackerService` para anidar "
            "óptimamente los stickers seleccionados en pliegos de impresión."
        ),
        planned_stack=["numpy", "shapely", "2D MaxRects/Nesting"],
        request_echo=payload.model_dump(),
    )
    return JSONResponse(status_code=status.HTTP_501_NOT_IMPLEMENTED, content=body.model_dump())
