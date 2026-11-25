"""Strict Pydantic v2 Master-Detail schemas for public & internal sticker orders and sales control."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.core.config import get_settings

PHONE_DIGITS_RE = re.compile(r"^\+?[0-9\s\-().]{7,25}$")
DIMENSIONS_RE = re.compile(
    r"^\s*(\d+(?:[.,]\d{1,2})?)\s*[xX×]\s*(\d+(?:[.,]\d{1,2})?)(?:\s*cm)?\s*$"
)
HEIGHT_ONLY_RE = re.compile(
    r"^\s*alto\s*[:=]?\s*(\d+(?:[.,]\d{1,2})?)(?:\s*cm)?(?:\s*\(prop\.?\))?\s*$",
    re.IGNORECASE,
)
WIDTH_ONLY_RE = re.compile(
    r"^\s*ancho\s*[:=]?\s*(\d+(?:[.,]\d{1,2})?)(?:\s*cm)?(?:\s*\(prop\.?\))?\s*$",
    re.IGNORECASE,
)
SINGLE_MEASURE_RE = re.compile(
    r"^\s*(\d+(?:[.,]\d{1,2})?)(?:\s*cm)?\s*$",
    re.IGNORECASE,
)
MAX_ORDER_ITEMS_LIMIT = 20
MAX_TOTAL_ORDER_QUANTITY = 1_000_000


class SizeMode(str, Enum):
    BOTH = "both"
    HEIGHT_ONLY = "height_only"
    WIDTH_ONLY = "width_only"


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


class PrepressStatus(str, Enum):
    PENDIENTE = "pendiente"
    MEJORADO = "mejorado"
    TROQUELADO = "troquelado"
    LISTO_PLIEGO = "listo_pliego"


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


def normalize_received_datetime(dt: Optional[datetime]) -> datetime:
    """Normalize optional reception datetime to UTC (defaults to current UTC timestamp)."""
    if dt is None:
        return datetime.now(timezone.utc)
    tz = _studio_tz()
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz).astimezone(timezone.utc)
    return dt.astimezone(timezone.utc)


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


def format_order_validation_error(exc: ValidationError) -> str:
    """Format Pydantic v2 validation errors with clear Spanish item-level prefixes."""
    messages: List[str] = []
    for err in exc.errors():
        msg = err.get("msg", "Valor inválido")
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, ") :]
        loc = err.get("loc", ())
        if len(loc) >= 2 and loc[0] == "items" and isinstance(loc[1], int):
            msg = f"Diseño #{loc[1] + 1}: {msg}"
        messages.append(msg)
    return " ".join(messages)


def parse_order_items_json(
    raw_items: str,
    *,
    max_bytes: Optional[int] = None,
) -> List[dict[str, Any]]:
    """Parse multipart form JSON string for `items` enforcing payload size limit before parsing."""
    limit_bytes = max_bytes if max_bytes is not None else get_settings().MAX_ITEMS_JSON_BYTES
    if len(raw_items.encode("utf-8")) > limit_bytes:
        raise ValueError(
            f"El campo 'items' supera el tamaño máximo permitido ({limit_bytes // 1024} KB)."
        )

    try:
        parsed = json.loads(raw_items)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ValueError(
            "El campo 'items' debe ser un arreglo JSON válido de diseños de stickers."
        ) from exc

    if not isinstance(parsed, list):
        raise ValueError("El campo 'items' debe ser una lista JSON (mínimo 1 diseño).")
    if len(parsed) == 0:
        raise ValueError("El pedido debe incluir al menos 1 diseño en la lista 'items'.")
    if any(not isinstance(entry, dict) for entry in parsed):
        raise ValueError("Cada elemento de 'items' debe ser un objeto JSON con sus especificaciones.")
    return parsed


def parse_non_circular_dimensions(
    dimensions: Optional[str],
    size_mode: Optional[str] = None,
    height_cm: Optional[float] = None,
    width_cm: Optional[float] = None,
) -> tuple[Optional[SizeMode], Optional[float], Optional[float]]:
    """
    Parse or infer `(size_mode, height_cm, width_cm)` from structured fields or a `dimensions` string
    (`"{h}x{w} cm"`, `"Alto {h} cm"`, `"Ancho {w} cm"`).
    """
    h = round(float(height_cm), 2) if height_cm is not None and float(height_cm) > 0 else None
    w = round(float(width_cm), 2) if width_cm is not None and float(width_cm) > 0 else None
    raw_mode = size_mode.value if isinstance(size_mode, SizeMode) else (str(size_mode).strip() if size_mode else None)

    if dimensions:
        cleaned = dimensions.strip()
        m_both = DIMENSIONS_RE.match(cleaned)
        if m_both:
            if h is None:
                h = round(float(m_both.group(1).replace(",", ".")), 2)
            if w is None:
                w = round(float(m_both.group(2).replace(",", ".")), 2)
            return SizeMode.BOTH, h, w

        m_h = HEIGHT_ONLY_RE.match(cleaned)
        if m_h:
            if h is None:
                h = round(float(m_h.group(1).replace(",", ".")), 2)
            return SizeMode.HEIGHT_ONLY, h, None

        m_w = WIDTH_ONLY_RE.match(cleaned)
        if m_w:
            if w is None:
                w = round(float(m_w.group(1).replace(",", ".")), 2)
            return SizeMode.WIDTH_ONLY, None, w

    if raw_mode == SizeMode.HEIGHT_ONLY.value and h is not None:
        return SizeMode.HEIGHT_ONLY, h, None
    if raw_mode == SizeMode.WIDTH_ONLY.value and w is not None:
        return SizeMode.WIDTH_ONLY, None, w
    if h is not None and w is not None:
        return SizeMode.BOTH, h, w
    if h is not None and w is None:
        return SizeMode.HEIGHT_ONLY, h, None
    if w is not None and h is None:
        return SizeMode.WIDTH_ONLY, None, w
    return None, None, None


class OrderItemCreateInput(BaseModel):
    """Strict business-rule validation for a single sticker design item within an order."""

    model_config = ConfigDict(str_strip_whitespace=True)

    material: StickerMaterial = Field(..., description="Material del sticker.")
    vinyl_gloss_mode: Optional[VinylGlossMode] = Field(
        default=None,
        description="Sub-opción obligatoria solo cuando material es 'Vinilo Brillo' ('En rollo' o 'Corte uno a uno').",
    )
    shape: StickerShape = Field(..., description="Forma del troquelado.")
    diameter_cm: Optional[float] = Field(
        default=None,
        gt=0,
        le=500,
        description="Diámetro en cm (obligatorio y exclusivo para forma 'Circular').",
    )
    size_mode: Optional[SizeMode] = Field(
        default=SizeMode.BOTH,
        description="Modo de medida para formas no circulares: 'both' (Alto x Ancho), 'height_only' (solo Alto) o 'width_only' (solo Ancho).",
    )
    height_cm: Optional[float] = Field(
        default=None,
        description="Alto en cm (0.5 a 500 cm) para formas no circulares.",
    )
    width_cm: Optional[float] = Field(
        default=None,
        description="Ancho en cm (0.5 a 500 cm) para formas no circulares.",
    )
    dimensions: Optional[str] = Field(
        default=None,
        max_length=40,
        description="Dimensiones en cm para formas no circulares (ej. '5x7 cm', 'Alto 8 cm' o 'Ancho 6.5 cm').",
    )
    quantity: int = Field(..., ge=1, le=1_000_000, description="Cantidad de unidades para este diseño.")
    image_index: Optional[int] = Field(
        default=None,
        ge=0,
        description="Índice opcional (0-based) en 'images[]' para reutilizar el mismo archivo de arte en distintas medidas.",
    )

    @field_validator("image_index", mode="before")
    @classmethod
    def empty_str_to_none_image_index(cls, v: Any) -> Any:
        if v == "" or v is None:
            return None
        return v

    @field_validator("vinyl_gloss_mode", mode="before")
    @classmethod
    def empty_str_to_none_gloss(cls, v: Any) -> Any:
        if v == "":
            return None
        return v

    @field_validator("size_mode", mode="before")
    @classmethod
    def normalize_size_mode_before(cls, v: Any) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            return SizeMode.BOTH
        return v

    @field_validator("diameter_cm", "height_cm", "width_cm", mode="before")
    @classmethod
    def empty_str_to_none_measure(cls, v: Any) -> Any:
        if v == "" or v is None:
            return None
        if isinstance(v, str):
            cleaned = v.strip().replace(",", ".")
            return cleaned if cleaned else None
        return v

    @field_validator("dimensions", mode="before")
    @classmethod
    def empty_str_to_none_dimensions(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @model_validator(mode="after")
    def validate_conditional_business_rules(self) -> "OrderItemCreateInput":
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

        # Rule 2: Circular requires ONLY diameter_cm; non-circular shapes use size_mode ('both' | 'height_only' | 'width_only')
        if self.shape == StickerShape.CIRCULAR:
            if self.diameter_cm is None:
                raise ValueError(
                    "Para stickers de forma 'Circular' debes especificar el diámetro en cm."
                )
            if (
                self.dimensions is not None
                or self.height_cm is not None
                or self.width_cm is not None
            ):
                raise ValueError(
                    "Para stickers de forma 'Circular' solo se debe enviar el campo diámetro (no Alto x Ancho)."
                )
            self.diameter_cm = round(float(self.diameter_cm), 2)
            if self.diameter_cm < 0.5 or self.diameter_cm > 500:
                raise ValueError("El diámetro debe estar entre 0.5 cm y 500 cm.")
            self.size_mode = None
            self.height_cm = None
            self.width_cm = None
        else:
            if self.diameter_cm is not None:
                raise ValueError(
                    f"Para la forma '{self.shape.value}' debes usar el campo Alto x Ancho y no diámetro."
                )

            mode = self.size_mode or SizeMode.BOTH
            # Auto-detect "Alto X cm" / "Ancho X cm" string when size_mode was left at default 'both'
            if (
                mode == SizeMode.BOTH
                and self.dimensions
                and self.height_cm is None
                and self.width_cm is None
            ):
                if HEIGHT_ONLY_RE.match(self.dimensions):
                    mode = SizeMode.HEIGHT_ONLY
                elif WIDTH_ONLY_RE.match(self.dimensions):
                    mode = SizeMode.WIDTH_ONLY

            if mode == SizeMode.BOTH:
                height: Optional[float] = self.height_cm
                width: Optional[float] = self.width_cm

                if height is None or width is None:
                    if not self.dimensions:
                        raise ValueError(
                            f"Para la forma '{self.shape.value}' debes indicar el tamaño en formato Alto x Ancho (ej. 5x7 cm)."
                        )
                    match = DIMENSIONS_RE.match(self.dimensions)
                    if not match:
                        raise ValueError(
                            "El tamaño debe seguir el formato 'Alto x Ancho' (ej. '5x7 cm' o '5.5x8')."
                        )
                    if height is None:
                        height = float(match.group(1).replace(",", "."))
                    if width is None:
                        width = float(match.group(2).replace(",", "."))

                height = round(float(height), 2)
                width = round(float(width), 2)
                if not (0.5 <= height <= 500 and 0.5 <= width <= 500):
                    raise ValueError("Tanto el alto como el ancho deben estar entre 0.5 cm y 500 cm.")

                self.size_mode = SizeMode.BOTH
                self.height_cm = height
                self.width_cm = width
                self.dimensions = f"{_format_num(height)}x{_format_num(width)} cm"

            elif mode == SizeMode.HEIGHT_ONLY:
                if self.width_cm is not None:
                    raise ValueError(
                        "En modo 'solo Alto' (height_only) solo debes especificar el alto en cm (no ancho)."
                    )
                height_val: Optional[float] = self.height_cm
                if height_val is None and self.dimensions:
                    m_h = HEIGHT_ONLY_RE.match(self.dimensions) or SINGLE_MEASURE_RE.match(self.dimensions)
                    if not m_h:
                        raise ValueError(
                            "En modo 'solo Alto' (height_only) debes indicar únicamente el alto en cm (ej. 'Alto 8 cm')."
                        )
                    height_val = float(m_h.group(1).replace(",", "."))

                if height_val is None:
                    raise ValueError(
                        f"Para la forma '{self.shape.value}' en modo 'solo Alto' (height_only) debes indicar el alto en cm."
                    )

                height_val = round(float(height_val), 2)
                if not (0.5 <= height_val <= 500):
                    raise ValueError("El alto debe estar entre 0.5 cm y 500 cm.")

                self.size_mode = SizeMode.HEIGHT_ONLY
                self.height_cm = height_val
                self.width_cm = None
                self.dimensions = f"Alto {_format_num(height_val)} cm"

            elif mode == SizeMode.WIDTH_ONLY:
                if self.height_cm is not None:
                    raise ValueError(
                        "En modo 'solo Ancho' (width_only) solo debes especificar el ancho en cm (no alto)."
                    )
                width_val: Optional[float] = self.width_cm
                if width_val is None and self.dimensions:
                    m_w = WIDTH_ONLY_RE.match(self.dimensions) or SINGLE_MEASURE_RE.match(self.dimensions)
                    if not m_w:
                        raise ValueError(
                            "En modo 'solo Ancho' (width_only) debes indicar únicamente el ancho en cm (ej. 'Ancho 6.5 cm')."
                        )
                    width_val = float(m_w.group(1).replace(",", "."))

                if width_val is None:
                    raise ValueError(
                        f"Para la forma '{self.shape.value}' en modo 'solo Ancho' (width_only) debes indicar el ancho en cm."
                    )

                width_val = round(float(width_val), 2)
                if not (0.5 <= width_val <= 500):
                    raise ValueError("El ancho debe estar entre 0.5 cm y 500 cm.")

                self.size_mode = SizeMode.WIDTH_ONLY
                self.height_cm = None
                self.width_cm = width_val
                self.dimensions = f"Ancho {_format_num(width_val)} cm"

        return self

    @property
    def size_display(self) -> str:
        if self.shape == StickerShape.CIRCULAR and self.diameter_cm is not None:
            return f"Ø {_format_num(self.diameter_cm)} cm"
        if self.size_mode == SizeMode.HEIGHT_ONLY and self.height_cm is not None:
            return f"Alto {_format_num(self.height_cm)} cm (prop.)"
        if self.size_mode == SizeMode.WIDTH_ONLY and self.width_cm is not None:
            return f"Ancho {_format_num(self.width_cm)} cm (prop.)"
        return self.dimensions or ""


_LEGACY_FLAT_ITEM_KEYS = (
    "material",
    "vinyl_gloss_mode",
    "shape",
    "diameter_cm",
    "size_mode",
    "height_cm",
    "width_cm",
    "dimensions",
    "quantity",
    "image_index",
)


class OrderCreateInput(BaseModel):
    """
    Master-Detail Pydantic v2 schema for creating a sticker order:
    - Master header: referral_name, phone, received_at, delivery_datetime (exact top-of-the-hour).
    - Detail collection: `items` (at least 1 validated `OrderItemCreateInput` design).
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    referral_name: str = Field(..., min_length=2, max_length=120, description="Nombre de referido del cliente.")
    phone: str = Field(..., min_length=7, max_length=25, description="Teléfono / WhatsApp del cliente.")
    received_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Fecha y hora de recepción del pedido (UTC; por defecto momento actual).",
    )
    delivery_datetime: datetime = Field(
        ...,
        description="Fecha y hora de entrega (obligatoriamente hora en punto :00 dentro del horario laboral).",
    )
    items: List[OrderItemCreateInput] = Field(
        ...,
        min_length=1,
        max_length=MAX_ORDER_ITEMS_LIMIT,
        description="Lista de diseños del pedido (mínimo 1 ítem).",
    )

    @model_validator(mode="before")
    @classmethod
    def adapt_legacy_single_item_payload(cls, data: Any) -> Any:
        """
        Maintain backward compatibility when callers send flat single-sticker fields
        without `items`, while strictly enforcing `items` min_length=1 whenever `items` is provided.
        """
        if not isinstance(data, dict):
            return data
        if "items" not in data and any(key in data for key in ("material", "shape", "quantity")):
            adapted = dict(data)
            item_dict = {key: adapted.pop(key) for key in _LEGACY_FLAT_ITEM_KEYS if key in adapted}
            adapted["items"] = [item_dict]
            return adapted
        return data

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("received_at", mode="before")
    @classmethod
    def empty_str_to_now_received_at(cls, v: Any) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            return datetime.now(timezone.utc)
        return v

    @field_validator("received_at")
    @classmethod
    def check_received_at(cls, v: datetime) -> datetime:
        return normalize_received_datetime(v)

    @field_validator("delivery_datetime")
    @classmethod
    def check_delivery_datetime(cls, v: datetime) -> datetime:
        return validate_exact_delivery_datetime(v, allow_past=False)

    @model_validator(mode="after")
    def validate_order_totals(self) -> "OrderCreateInput":
        if self.total_quantity > MAX_TOTAL_ORDER_QUANTITY:
            raise ValueError(
                f"La suma total de stickers del pedido no puede superar {MAX_TOTAL_ORDER_QUANTITY:,} unidades."
            )
        return self

    @property
    def primary_item(self) -> OrderItemCreateInput:
        return self.items[0]

    @property
    def items_count(self) -> int:
        return len(self.items)

    @property
    def total_quantity(self) -> int:
        return sum(item.quantity for item in self.items)

    # Backward-compatible read accessors mirroring primary item
    @property
    def material(self) -> StickerMaterial:
        return self.primary_item.material

    @property
    def vinyl_gloss_mode(self) -> Optional[VinylGlossMode]:
        return self.primary_item.vinyl_gloss_mode

    @property
    def shape(self) -> StickerShape:
        return self.primary_item.shape

    @property
    def diameter_cm(self) -> Optional[float]:
        return self.primary_item.diameter_cm

    @property
    def size_mode(self) -> Optional[SizeMode]:
        return self.primary_item.size_mode

    @property
    def height_cm(self) -> Optional[float]:
        return self.primary_item.height_cm

    @property
    def width_cm(self) -> Optional[float]:
        return self.primary_item.width_cm

    @property
    def dimensions(self) -> Optional[str]:
        return self.primary_item.dimensions

    @property
    def size_display(self) -> str:
        return self.primary_item.size_display

    @property
    def quantity(self) -> int:
        return self.total_quantity


class AdminQuickOrderCreateInput(OrderCreateInput):
    """Extended Master-Detail order creation schema for internal staff (with initial sales info)."""

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
    """Schema for updating order specs, sales control, payment tracking and production status."""

    model_config = ConfigDict(str_strip_whitespace=True)

    referral_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    phone: Optional[str] = Field(default=None, min_length=7, max_length=25)
    quantity: Optional[int] = Field(default=None, ge=1, le=1_000_000)
    total_price: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    advance_payment: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    payment_method: Optional[PaymentMethod] = None
    status: Optional[OrderStatus] = None
    notes: Optional[str] = Field(default=None, max_length=1000)
    delivery_datetime: Optional[datetime] = None

    @field_validator("phone")
    @classmethod
    def check_optional_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return normalize_phone(v)

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


class OrderItemResponse(BaseModel):
    """Individual sticker design line item inside a Master-Detail order."""

    id: str
    position: int = Field(..., ge=1)
    material: str
    vinyl_gloss_mode: Optional[VinylGlossMode] = None
    shape: StickerShape
    diameter_cm: Optional[float] = None
    size_mode: Optional[SizeMode] = None
    height_cm: Optional[float] = None
    width_cm: Optional[float] = None
    dimensions: Optional[str] = None
    size_display: str
    quantity: int
    image: OrderImageInfo
    enhanced_storage_path: Optional[str] = None
    die_cut_anchors_json: Optional[str] = None
    die_cut_eps_path: Optional[str] = None
    prepress_status: PrepressStatus = PrepressStatus.PENDIENTE


class OrderStatusHistoryItem(BaseModel):
    id: int
    previous_status: Optional[str] = None
    new_status: str
    changed_by: Optional[str] = None
    comment: Optional[str] = None
    changed_at: datetime


class OrderPaymentItem(BaseModel):
    id: int
    amount: float
    payment_method: str
    recorded_by: Optional[str] = None
    reference: Optional[str] = None
    recorded_at: datetime


class PublicOrderConfirmation(BaseModel):
    """Safe Master-Detail confirmation returned to public customers upon order creation."""

    id: str
    order_number: str
    referral_name: str
    phone: str
    received_at: datetime
    delivery_datetime: datetime
    status: OrderStatus
    items: List[OrderItemResponse] = Field(default_factory=list)
    items_count: int = 1
    total_quantity: int = 1
    # Backward-compatible primary summary fields (mirrors item #1 + total quantity)
    material: str
    vinyl_gloss_mode: Optional[VinylGlossMode] = None
    shape: StickerShape
    diameter_cm: Optional[float] = None
    dimensions: Optional[str] = None
    size_display: str
    quantity: int
    message: str


class OrderResponse(BaseModel):
    """Complete Master-Detail order representation for the authenticated administrative panel."""

    id: str
    order_number: str
    referral_name: str
    phone: str
    received_at: datetime
    delivery_datetime: datetime
    status: OrderStatus
    items: List[OrderItemResponse] = Field(default_factory=list)
    items_count: int = 1
    total_quantity: int = 1
    # Backward-compatible primary summary fields (mirrors item #1 + total quantity)
    material: str
    vinyl_gloss_mode: Optional[VinylGlossMode] = None
    shape: StickerShape
    diameter_cm: Optional[float] = None
    dimensions: Optional[str] = None
    size_display: str
    quantity: int
    image: OrderImageInfo
    total_price: float
    advance_payment: float
    pending_balance: float
    payment_method: PaymentMethod
    notes: Optional[str] = None
    source: str = "public"
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None
    status_history: List[OrderStatusHistoryItem] = Field(default_factory=list)
    payments: List[OrderPaymentItem] = Field(default_factory=list)


class OrderListResponse(BaseModel):
    items: List[OrderResponse]
    total: int
