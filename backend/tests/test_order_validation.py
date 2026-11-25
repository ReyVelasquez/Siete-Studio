"""Unit tests for strict Pydantic v2 business rules on sticker orders."""

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.schemas.order import (
    AdminQuickOrderCreateInput,
    MAX_ORDER_ITEMS_LIMIT,
    OrderCreateInput,
    OrderItemCreateInput,
    SizeMode,
    StickerMaterial,
    StickerShape,
    VinylGlossMode,
    format_order_validation_error,
    parse_order_items_json,
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


def test_master_detail_order_requires_at_least_one_item():
    with pytest.raises(ValidationError):
        OrderCreateInput(
            referral_name="Lucia Morales",
            phone="+59171234567",
            delivery_datetime=_future_exact_hour(11),
            items=[],
        )


def test_master_detail_order_accepts_multiple_heterogeneous_items():
    received_local = _future_exact_hour(9) - timedelta(days=1)
    order = OrderCreateInput(
        referral_name="Mateo Vargas",
        phone="+591 7654-3210",
        received_at=received_local,
        delivery_datetime=_future_exact_hour(16),
        items=[
            OrderItemCreateInput(
                material=StickerMaterial.VINILO_BRILLO,
                vinyl_gloss_mode=VinylGlossMode.CORTE_UNO_A_UNO,
                shape=StickerShape.CIRCULAR,
                diameter_cm=5.5,
                quantity=100,
            ),
            OrderItemCreateInput(
                material=StickerMaterial.VINILO_MATE,
                shape=StickerShape.RECTANGULAR,
                dimensions="4 x 8.5",
                quantity=50,
            ),
            OrderItemCreateInput(
                material=StickerMaterial.DTF_UV,
                shape=StickerShape.EN_SU_FORMA,
                dimensions="6.5X9 cm",
                quantity=25,
            ),
        ],
    )
    assert order.items_count == 3
    assert order.total_quantity == 175
    assert order.phone == "+59176543210"
    assert order.received_at.tzinfo == timezone.utc
    assert order.delivery_datetime.tzinfo == timezone.utc
    assert order.items[0].size_display == "Ø 5.5 cm"
    assert order.items[0].vinyl_gloss_mode == VinylGlossMode.CORTE_UNO_A_UNO
    assert order.items[1].dimensions == "4x8.5 cm"
    assert order.items[1].diameter_cm is None
    assert order.items[2].dimensions == "6.5x9 cm"


def test_master_detail_validation_error_identifies_failing_item_number():
    with pytest.raises(ValidationError) as exc_info:
        OrderCreateInput(
            referral_name="Valeria Paz",
            phone="71234567",
            delivery_datetime=_future_exact_hour(14),
            items=[
                {
                    "material": "Vinilo Mate",
                    "shape": "Circular",
                    "diameter_cm": 4,
                    "quantity": 20,
                },
                {
                    "material": "Vinilo Brillo",
                    "shape": "Cuadrado",
                    "dimensions": "5x5 cm",
                    "quantity": 30,
                },
            ],
        )
    formatted = format_order_validation_error(exc_info.value)
    assert "Diseño #2:" in formatted
    assert "Vinilo Brillo" in formatted


def test_master_detail_order_enforces_max_10_items_limit():
    assert MAX_ORDER_ITEMS_LIMIT == 10
    eleven_items = [
        {
            "material": "Vinilo Mate",
            "shape": "Circular",
            "diameter_cm": 5,
            "quantity": 10,
        }
        for _ in range(11)
    ]
    with pytest.raises(ValidationError):
        OrderCreateInput(
            referral_name="Lucia Morales",
            phone="+59171234567",
            delivery_datetime=_future_exact_hour(11),
            items=eleven_items,
        )


def test_master_detail_order_rejects_total_quantity_over_one_million():
    with pytest.raises(ValidationError, match="1,000,000"):
        OrderCreateInput(
            referral_name="Pedido Gigante",
            phone="+59171234567",
            delivery_datetime=_future_exact_hour(14),
            items=[
                {
                    "material": "Vinilo Mate",
                    "shape": "Circular",
                    "diameter_cm": 5,
                    "quantity": 600_000,
                },
                {
                    "material": "Transparente",
                    "shape": "Cuadrado",
                    "dimensions": "5x5 cm",
                    "quantity": 500_000,
                },
            ],
        )


def test_parse_order_items_json_rejects_payload_exceeding_32kb():
    oversized = "[" + (" " * (32 * 1024 + 10)) + "]"
    with pytest.raises(ValueError, match="32 KB"):
        parse_order_items_json(oversized)


def test_non_circular_size_mode_both_accepts_structured_height_and_width():
    item = OrderItemCreateInput(
        material=StickerMaterial.VINILO_MATE,
        shape=StickerShape.RECTANGULAR,
        size_mode=SizeMode.BOTH,
        height_cm=5.5,
        width_cm=8,
        quantity=40,
    )
    assert item.size_mode == SizeMode.BOTH
    assert item.height_cm == 5.5
    assert item.width_cm == 8.0
    assert item.diameter_cm is None
    assert item.dimensions == "5.5x8 cm"
    assert item.size_display == "5.5x8 cm"


def test_non_circular_size_mode_height_only_normalizes_dimensions_and_display():
    item = OrderItemCreateInput(
        material=StickerMaterial.TRANSPARENTE,
        shape=StickerShape.EN_SU_FORMA,
        size_mode=SizeMode.HEIGHT_ONLY,
        height_cm=8,
        quantity=50,
    )
    assert item.size_mode == SizeMode.HEIGHT_ONLY
    assert item.height_cm == 8.0
    assert item.width_cm is None
    assert item.diameter_cm is None
    assert item.dimensions == "Alto 8 cm"
    assert item.size_display == "Alto 8 cm (prop.)"

    # Also supports string dimensions compatibility ("Alto 7.5 cm")
    item_from_str = OrderItemCreateInput(
        material=StickerMaterial.DTF_UV,
        shape=StickerShape.RECTANGULAR,
        dimensions="Alto 7.5 cm",
        quantity=30,
    )
    assert item_from_str.size_mode == SizeMode.HEIGHT_ONLY
    assert item_from_str.height_cm == 7.5
    assert item_from_str.width_cm is None
    assert item_from_str.dimensions == "Alto 7.5 cm"
    assert item_from_str.size_display == "Alto 7.5 cm (prop.)"


def test_non_circular_size_mode_width_only_normalizes_dimensions_and_display():
    item = OrderItemCreateInput(
        material=StickerMaterial.HOJAS_ADHESIVAS,
        shape=StickerShape.CUADRADO,
        size_mode=SizeMode.WIDTH_ONLY,
        width_cm=6.5,
        quantity=60,
    )
    assert item.size_mode == SizeMode.WIDTH_ONLY
    assert item.width_cm == 6.5
    assert item.height_cm is None
    assert item.diameter_cm is None
    assert item.dimensions == "Ancho 6.5 cm"
    assert item.size_display == "Ancho 6.5 cm (prop.)"

    # Also supports string dimensions compatibility ("Ancho 10 cm")
    item_from_str = OrderItemCreateInput(
        material=StickerMaterial.VINILO_MATE,
        shape=StickerShape.EN_SU_FORMA,
        dimensions="Ancho 10 cm",
        quantity=25,
    )
    assert item_from_str.size_mode == SizeMode.WIDTH_ONLY
    assert item_from_str.width_cm == 10.0
    assert item_from_str.height_cm is None
    assert item_from_str.dimensions == "Ancho 10 cm"
    assert item_from_str.size_display == "Ancho 10 cm (prop.)"


def test_non_circular_size_modes_reject_invalid_combinations():
    # height_only rejects width_cm
    with pytest.raises(ValidationError, match="solo Alto"):
        OrderItemCreateInput(
            material=StickerMaterial.VINILO_MATE,
            shape=StickerShape.RECTANGULAR,
            size_mode=SizeMode.HEIGHT_ONLY,
            height_cm=6,
            width_cm=4,
            quantity=10,
        )

    # width_only rejects height_cm
    with pytest.raises(ValidationError, match="solo Ancho"):
        OrderItemCreateInput(
            material=StickerMaterial.VINILO_MATE,
            shape=StickerShape.RECTANGULAR,
            size_mode=SizeMode.WIDTH_ONLY,
            height_cm=6,
            width_cm=4,
            quantity=10,
        )

    # both requires both height_cm and width_cm
    with pytest.raises(ValidationError, match="Alto x Ancho"):
        OrderItemCreateInput(
            material=StickerMaterial.VINILO_MATE,
            shape=StickerShape.RECTANGULAR,
            size_mode=SizeMode.BOTH,
            height_cm=6,
            quantity=10,
        )

    # Circular still rejects height_cm / width_cm
    with pytest.raises(ValidationError, match="diámetro"):
        OrderItemCreateInput(
            material=StickerMaterial.VINILO_MATE,
            shape=StickerShape.CIRCULAR,
            diameter_cm=5,
            height_cm=5,
            quantity=10,
        )

