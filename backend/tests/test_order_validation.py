"""Unit tests for strict Pydantic v2 business rules on sticker orders."""

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.schemas.order import (
    AdminQuickOrderCreateInput,
    OrderCreateInput,
    StickerMaterial,
    StickerShape,
    VinylGlossMode,
)


def _future_exact_hour(hour: int = 14) -> datetime:
    studio_tz = timezone(timedelta(minutes=-240))
    tomorrow = datetime.now(studio_tz) + timedelta(days=1)
    return tomorrow.replace(hour=hour, minute=0, second=0, microsecond=0)


def test_vinilo_brillo_requires_gloss_mode():
    with pytest.raises(ValidationError, match="Vinilo Brillo"):
        OrderCreateInput(
            referral_name="Camila Torres",
            phone="+59171234567",
            material=StickerMaterial.VINILO_BRILLO,
            vinyl_gloss_mode=None,
            shape=StickerShape.CIRCULAR,
            diameter_cm=5.0,
            quantity=100,
            delivery_datetime=_future_exact_hour(10),
        )


def test_vinilo_brillo_accepts_valid_modes():
    order = OrderCreateInput(
        referral_name="Camila Torres",
        phone="+591 7123-4567",
        material=StickerMaterial.VINILO_BRILLO,
        vinyl_gloss_mode=VinylGlossMode.EN_ROLLO,
        shape=StickerShape.CIRCULAR,
        diameter_cm=5.0,
        quantity=100,
        delivery_datetime=_future_exact_hour(10),
    )
    assert order.vinyl_gloss_mode == VinylGlossMode.EN_ROLLO
    assert order.phone == "+59171234567"
    assert order.size_display == "Ø 5 cm"


def test_non_gloss_material_rejects_gloss_mode():
    with pytest.raises(ValidationError, match="solo aplica para 'Vinilo Brillo'"):
        OrderCreateInput(
            referral_name="Diego Perez",
            phone="71234567",
            material=StickerMaterial.VINILO_MATE,
            vinyl_gloss_mode=VinylGlossMode.CORTE_UNO_A_UNO,
            shape=StickerShape.CUADRADO,
            dimensions="5x5 cm",
            quantity=50,
            delivery_datetime=_future_exact_hour(15),
        )


def test_circular_requires_diameter_and_rejects_dimensions():
    with pytest.raises(ValidationError, match="diámetro"):
        OrderCreateInput(
            referral_name="Ana Soto",
            phone="71234567",
            material=StickerMaterial.TRANSPARENTE,
            shape=StickerShape.CIRCULAR,
            dimensions="5x5 cm",
            quantity=30,
            delivery_datetime=_future_exact_hour(11),
        )


def test_non_circular_requires_single_dimensions_field_and_normalizes():
    order = OrderCreateInput(
        referral_name="Luis Rojas",
        phone="71234567",
        material=StickerMaterial.DTF_UV,
        shape=StickerShape.EN_SU_FORMA,
        dimensions="5.5 X 7",
        quantity=200,
        delivery_datetime=_future_exact_hour(16),
    )
    assert order.dimensions == "5.5x7 cm"
    assert order.diameter_cm is None


def test_delivery_time_rejects_non_zero_minutes():
    bad_dt = _future_exact_hour(14).replace(minute=30)
    with pytest.raises(ValidationError, match="hora en punto"):
        OrderCreateInput(
            referral_name="Sofia Vega",
            phone="71234567",
            material=StickerMaterial.HOJAS_ADHESIVAS,
            shape=StickerShape.RECTANGULAR,
            dimensions="6x9 cm",
            quantity=25,
            delivery_datetime=bad_dt,
        )


def test_admin_order_rejects_advance_greater_than_total():
    with pytest.raises(ValidationError, match="adelanto"):
        AdminQuickOrderCreateInput(
            referral_name="Carlos Mendez",
            phone="71234567",
            material=StickerMaterial.VINILO_MATE,
            shape=StickerShape.RECTANGULAR,
            dimensions="5x8 cm",
            quantity=50,
            delivery_datetime=_future_exact_hour(12),
            total_price=100.0,
            advance_payment=150.0,
        )
