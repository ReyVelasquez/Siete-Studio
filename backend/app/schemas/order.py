"""Strict Pydantic v2 schemas for public & internal sticker orders and sales control."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.config import get_settings

PHONE_DIGITS_RE = re.compile(r"^\+?[0-9\s\-().]{7,25}$")
DIMENSIONS_RE = re.compile(
    r"^\s*(\d+(?:[.,]\d{1,2})?)\s*[xX×]\s*(\d+(?:[.,]\d{1,2})?)(?:\s*cm)?\s*$"
)


class StickerMaterial(str, Enum):
    VINILO_BRILLO = "Vinilo Brillo"
    VINILO_MATE = "Vinilo Mate"
    TRANSPARENTE = "Transparente"
    DTF_UV = "DTF UV"
    HOJAS_ADHESIVAS = "Hojas Adhesivas"


class VinylGlossMode(str, Enum):
    EN_ROLLO = "En rollo"
    CORTE_UNO_A_UNO = "Corte uno a uno"


class StickerShape(str, Enum):
    CIRCULAR = "Circular"
    RECTANGULAR = "Rectangular"
    CUADRADO = "Cuadrado"
    EN_SU_FORMA = "En su forma"


class OrderStatus(str, Enum):
    PENDIENTE = "Pendiente"
    EN_DISENO = "En Diseño"
    EN_IMPRESION = "En Impresión"
    TROQUELADO = "Troquelado"
    LISTO = "Listo"
    ENTREGADO = "Entregado"
    CANCELADO = "Cancelado"


class PaymentMethod(str, Enum):
    PENDIENTE = "Pendiente"
    EFECTIVO = "Efectivo"
    TRANSFERENCIA = "Transferencia"
    QR = "QR"
    TARJETA = "Tarjeta"
    MIXTO = "Mixto"


def _studio_tz() -> timezone:
    settings = get_settings()
    return timezone(timedelta(minutes=settings.TIMEZONE_OFFSET_MINUTES))


def _format_num(value: float) -> str:
    return f"{value:g}"


def normalize_phone(raw: str) -> str:
    """Validate and normalize phone/WhatsApp number."""
    cleaned = raw.strip()
    if not PHONE_DIGITS_RE.match(cleaned):
        raise ValueError(
            "Ingresa un número de teléfono/WhatsApp válido (solo dígitos y opcional '+' inicial)."
        )
    has_plus = cleaned.startswith("+")
    digits = re.sub(r"\D", "", cleaned)
    if not (7 <= len(digits) <= 15):
        raise ValueError("El número de teléfono debe tener entre 7 y 15 dígitos.")
    return f"+{digits}" if has_plus else digits


def validate_exact_delivery_datetime(dt: datetime, *, allow_past: bool = False) -> datetime:
    """Enforce exact top-of-the-hour (minute == 0) delivery time within operating hours."""
    settings = get_settings()
    tz = _studio_tz()

    if dt.tzinfo is None:
        local_dt = dt.replace(tzinfo=tz)
    else:
        local_dt = dt.astimezone(tz)

    if local_dt.minute != 0 or local_dt.second != 0 or local_dt.microsecond != 0:
        raise ValueError(
            "La hora de entrega debe ser una hora en punto (minutos exactamente en :00, ej. 09:00, 14:00)."
        )

    if not (settings.DELIVERY_HOUR_START <= local_dt.hour <= settings.DELIVERY_HOUR_END):
        raise ValueError(
            f"El horario de entrega permitido es de {settings.DELIVERY_HOUR_START:02d}:00 "
            f"a {settings.DELIVERY_HOUR_END:02d}:00."
        )

    if not allow_past:
        now_local = datetime.now(tz)
        # Allow booking the current exact hour only if it hasn't passed more than 5 minutes ago
        if local_dt < now_local - timedelta(minutes=5):
            raise ValueError("La fecha y hora de entrega no pueden estar en el pasado.")

    return local_dt.astimezone(timezone.utc)


class OrderCreateInput(BaseModel):
    """Strict business-rule validation for creating a sticker order."""

    model_config = ConfigDict(str_strip_whitespace=True)

    referral_name: str = Field(..., min_length=2, max_length=120)
    phone: str = Field(..., min_length=7, max_length=25)
    material: StickerMaterial
    vinyl_gloss_mode: Optional[VinylGlossMode] = None
    shape: StickerShape
    diameter_cm: Optional[float] = Field(default=None, gt=0, le=500)
    dimensions: Optional[str] = Field(default=None, max_length=40)
    quantity: int = Field(..., ge=1, le=1_000_000)
    delivery_datetime: datetime

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("vinyl_gloss_mode", mode="before")
    @classmethod
    def empty_str_to_none_gloss(cls, v):
        if v == "":
            return None
        return v

    @field_validator("diameter_cm", mode="before")
    @classmethod
    def empty_str_to_none_diameter(cls, v):
        if v == "" or v is None:
            return None
        return v

    @field_validator("dimensions", mode="before")
    @classmethod
    def empty_str_to_none_dimensions(cls, v):
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("delivery_datetime")
    @classmethod
    def check_delivery_datetime(cls, v: datetime) -> datetime:
        return validate_exact_delivery_datetime(v, allow_past=False)

    @model_validator(mode="after")
    def validate_conditional_business_rules(self) -> "OrderCreateInput":
        # Rule 1: Vinilo Brillo requires vinyl_gloss_mode; other materials forbid it
        if self.material == StickerMaterial.VINILO_BRILLO:
            if self.vinyl_gloss_mode is None:
                raise ValueError(
                    "Al seleccionar 'Vinilo Brillo' debes elegir una modalidad: "
                    "'En rollo' o 'Corte uno a uno'."
                )
        else:
            if self.vinyl_gloss_mode is not None:
                raise ValueError(
                    f"La modalidad '{self.vinyl_gloss_mode.value}' solo aplica para 'Vinilo Brillo'."
                )

        # Rule 2: Circular requires ONLY diameter_cm; other shapes require ONLY dimensions (Alto x Ancho)
        if self.shape == StickerShape.CIRCULAR:
            if self.diameter_cm is None:
                raise ValueError(
                    "Para stickers de forma 'Circular' debes especificar el diámetro en cm."
                )
            if self.dimensions is not None:
                raise ValueError(
                    "Para stickers de forma 'Circular' solo se debe enviar el campo diámetro (no Alto x Ancho)."
                )
            self.diameter_cm = round(float(self.diameter_cm), 2)
            if self.diameter_cm < 0.5 or self.diameter_cm > 500:
                raise ValueError("El diámetro debe estar entre 0.5 cm y 500 cm.")
        else:
            if not self.dimensions:
                raise ValueError(
                    f"Para la forma '{self.shape.value}' debes indicar el tamaño en formato Alto x Ancho (ej. 5x7 cm)."
                )
            if self.diameter_cm is not None:
                raise ValueError(
                    f"Para la forma '{self.shape.value}' debes usar el campo Alto x Ancho y no diámetro."
                )
            match = DIMENSIONS_RE.match(self.dimensions)
            if not match:
                raise ValueError(
                    "El tamaño debe seguir el formato 'Alto x Ancho' (ej. '5x7 cm' o '5.5x8')."
                )
            height = float(match.group(1).replace(",", "."))
            width = float(match.group(2).replace(",", "."))
            if not (0.5 <= height <= 500 and 0.5 <= width <= 500):
                raise ValueError("Tanto el alto como el ancho deben estar entre 0.5 cm y 500 cm.")
            self.dimensions = f"{_format_num(height)}x{_format_num(width)} cm"

        return self

    @property
    def size_display(self) -> str:
        if self.shape == StickerShape.CIRCULAR and self.diameter_cm is not None:
            return f"Ø {_format_num(self.diameter_cm)} cm"
        return self.dimensions or ""


class AdminQuickOrderCreateInput(OrderCreateInput):
    """Extended order creation schema for internal staff (with optional initial sales info)."""

    total_price: float = Field(default=0.0, ge=0, le=10_000_000)
    advance_payment: float = Field(default=0.0, ge=0, le=10_000_000)
    payment_method: PaymentMethod = PaymentMethod.PENDIENTE
    status: OrderStatus = OrderStatus.PENDIENTE
    notes: Optional[str] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_financials(self) -> "AdminQuickOrderCreateInput":
        self.total_price = round(self.total_price, 2)
        self.advance_payment = round(self.advance_payment, 2)
        if self.total_price > 0 and self.advance_payment > self.total_price:
            raise ValueError("El adelanto no puede superar el precio total.")
        return self


class OrderSalesUpdateInput(BaseModel):
    """Schema for updating sales control, payment tracking and production status."""

    model_config = ConfigDict(str_strip_whitespace=True)

    total_price: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    advance_payment: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    payment_method: Optional[PaymentMethod] = None
    status: Optional[OrderStatus] = None
    notes: Optional[str] = Field(default=None, max_length=1000)
    delivery_datetime: Optional[datetime] = None

    @field_validator("delivery_datetime")
    @classmethod
    def check_optional_delivery_dt(cls, v: Optional[datetime]) -> Optional[datetime]:
        if v is None:
            return None
        return validate_exact_delivery_datetime(v, allow_past=True)


class OrderImageInfo(BaseModel):
    storage_path: str
    safe_filename: str
    original_filename: str
    content_type: str
    size_bytes: int


class PublicOrderConfirmation(BaseModel):
    """Minimal safe response returned to anonymous public customers upon order creation."""

    id: str
    order_number: str
    referral_name: str
    phone: str
    material: StickerMaterial
    vinyl_gloss_mode: Optional[VinylGlossMode] = None
    shape: StickerShape
    diameter_cm: Optional[float] = None
    dimensions: Optional[str] = None
    size_display: str
    quantity: int
    received_at: datetime
    delivery_datetime: datetime
    status: OrderStatus
    message: str


class OrderResponse(BaseModel):
    """Complete order representation for the authenticated administrative panel."""

    id: str
    order_number: str
    referral_name: str
    phone: str
    material: StickerMaterial
    vinyl_gloss_mode: Optional[VinylGlossMode] = None
    shape: StickerShape
    diameter_cm: Optional[float] = None
    dimensions: Optional[str] = None
    size_display: str
    quantity: int
    image: OrderImageInfo
    received_at: datetime
    delivery_datetime: datetime
    status: OrderStatus
    total_price: float
    advance_payment: float
    pending_balance: float
    payment_method: PaymentMethod
    notes: Optional[str] = None
    source: str = "public"
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None


class OrderListResponse(BaseModel):
    items: List[OrderResponse]
    total: int
