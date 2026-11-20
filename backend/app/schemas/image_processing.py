"""Contracts for Phase 2 image processing, AI die-cut detection & sheet nesting."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class Phase2ModuleInfo(BaseModel):
    id: str
    name: str
    status: str = "planned_phase_2"
    stack: List[str]
    description: str
    endpoint: str


class ImageProcessingCapabilitiesResponse(BaseModel):
    phase: str = "Phase 1 (Interfaces Ready)"
    opencv_installed: bool
    numpy_installed: bool
    rembg_installed: bool
    modules: List[Phase2ModuleInfo]


class EnhanceImageRequest(BaseModel):
    order_id: str
    target_dpi: int = Field(default=300, ge=72, le=1200)
    upscale_factor: float = Field(default=2.0, ge=1.0, le=4.0)
    denoise: bool = True
    sharpen: bool = True


class DetectEdgesRequest(BaseModel):
    order_id: str
    remove_background: bool = True
    bleed_mm: float = Field(default=2.0, ge=0.0, le=15.0)
    smoothing_epsilon: float = Field(default=0.002, gt=0.0, le=0.1)
    export_format: str = Field(default="svg", pattern="^(svg|dxf|png_mask)$")


class PackLayoutItem(BaseModel):
    order_id: str
    width_mm: float = Field(..., gt=0)
    height_mm: float = Field(..., gt=0)
    quantity: int = Field(..., ge=1)
    allow_rotation: bool = True


class PackLayoutRequest(BaseModel):
    sheet_width_mm: float = Field(default=320.0, gt=0)
    sheet_height_mm: float = Field(default=450.0, gt=0)
    margin_mm: float = Field(default=10.0, ge=0)
    spacing_mm: float = Field(default=3.0, ge=0)
    items: List[PackLayoutItem] = Field(..., min_length=1)


class Phase2NotImplementedResponse(BaseModel):
    status: str = "not_implemented"
    phase: str = "Fase 2"
    module: str
    message: str
    planned_stack: List[str]
    request_echo: Optional[dict] = None
