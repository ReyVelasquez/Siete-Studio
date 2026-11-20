"""Pydantic v2 schemas for full CRUD management of sticker materials catalog."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class MaterialCreateInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(..., min_length=2, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)
    requires_gloss_mode: bool = False
    base_unit_price: float = Field(default=0.0, ge=0, le=100_000)
    is_active: bool = True


class MaterialUpdateInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)
    requires_gloss_mode: Optional[bool] = None
    base_unit_price: Optional[float] = Field(default=None, ge=0, le=100_000)
    is_active: Optional[bool] = None


class MaterialResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    requires_gloss_mode: bool
    base_unit_price: float
    is_active: bool
    orders_count: int = 0
    created_at: datetime
    updated_at: datetime


class MaterialListResponse(BaseModel):
    items: List[MaterialResponse]
    total: int
