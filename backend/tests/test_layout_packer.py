"""
Unit and integration tests for Phase 2 Module 3 (`SheetLayoutPackerService`) and
Phase 2 Module 1 AI Background Removal (`ai_rembg` lazy `u2netp` cache + `smart_subject` fallback).

Verifies:
1. No two placed stickers ever overlap on any sheet, and minimum inter-sticker distance >= `gap_cm`.
2. No placed sticker ever invades the safety margin (`margin_cm`, default `2.0 cm` for plotter marks)
   on any of the 4 sides (`left`, `top`, `right`, `bottom`) in both fixed-sheet and roll modes.
3. 90-degree rotation optimization on rectangular stickers increases area utilization and reduces
   sheet count, while circular/square stickers or `allow_rotation=False` never rotate.
4. Multi-design orders are grouped by material onto separate sheets/rolls, returning exact
   `(x, y, width, height, rotated, item_id)` coordinates per sheet, `total_sheets`,
   `utilization_percent`, and `waste_percent`.
5. `ai_rembg` mode lazily loads and caches the `u2netp` session on first use (0 startup overhead)
   and falls back cleanly to OpenCV `smart_subject` when `rembg` is not installed.
"""

from __future__ import annotations

import sys
from types import ModuleType, SimpleNamespace
from typing import List

import numpy as np
import pytest
from PIL import Image

from app.modules.image_processing import (
    LayoutPackPayload,
    PlacedSticker,
    SheetLayoutPackerService,
    SheetLayoutPage,
    SheetSpec,
    StickerNestItem,
)
from app.modules.image_processing.enhancer import (
    REMBG_DEFAULT_MODEL,
    _REMBG_SESSION_CACHE,
    clear_rembg_session_cache,
    get_rembg_session,
    remove_image_background_rgba,
)
from app.modules.image_processing.layout_packer import verify_sheet_geometry
from app.schemas.image_processing import PackLayoutRequest


# =============================================================================
# Geometric Invariant Helpers (Strict Non-Overlap & Safety Margin Checks)
# =============================================================================


def assert_no_margin_invasion_or_overlap(
    sheets: List[SheetLayoutPage],
    *,
    margin_cm: float,
    gap_cm: float,
    eps: float = 1e-5,
) -> None:
    """
    Exhaustively verify on every sheet that:
    1. Every sticker stays strictly within `[margin_cm, width_cm - margin_cm] x [margin_cm, height_cm - margin_cm]`.
    2. No two stickers on the same sheet overlap, and their edge-to-edge separation is at least `gap_cm`.
    """
    assert len(sheets) >= 1
    for sheet in sheets:
        assert sheet.width_cm > 2 * margin_cm
        assert sheet.height_cm >= 2 * margin_cm
        assert len(sheet.placements) == sheet.stickers_count

        for idx, p in enumerate(sheet.placements):
            assert p.width > 0 and p.height > 0
            assert p.x >= margin_cm - eps, (
                f"Pliego #{sheet.sheet_index}, sticker #{idx} ({p.item_id}): "
                f"x={p.x} invade margen izquierdo ({margin_cm} cm)"
            )
            assert p.y >= margin_cm - eps, (
                f"Pliego #{sheet.sheet_index}, sticker #{idx} ({p.item_id}): "
                f"y={p.y} invade margen superior ({margin_cm} cm)"
            )
            assert (p.x + p.width) <= (sheet.width_cm - margin_cm + eps), (
                f"Pliego #{sheet.sheet_index}, sticker #{idx} ({p.item_id}): "
                f"x+width={p.x + p.width} invade margen derecho ({sheet.width_cm - margin_cm} cm)"
            )
            assert (p.y + p.height) <= (sheet.height_cm - margin_cm + eps), (
                f"Pliego #{sheet.sheet_index}, sticker #{idx} ({p.item_id}): "
                f"y+height={p.y + p.height} invade margen inferior ({sheet.height_cm - margin_cm} cm)"
            )

        n = len(sheet.placements)
        for i in range(n):
            a = sheet.placements[i]
            ax1, ay1, ax2, ay2 = a.x, a.y, a.x + a.width, a.y + a.height
            for j in range(i + 1, n):
                b = sheet.placements[j]
                bx1, by1, bx2, by2 = b.x, b.y, b.x + b.width, b.y + b.height

                # 1. Zero area overlap
                inter_w = min(ax2, bx2) - max(ax1, bx1)
                inter_h = min(ay2, by2) - max(ay1, by1)
                assert not (inter_w > eps and inter_h > eps), (
                    f"Solapamiento en pliego #{sheet.sheet_index} entre "
                    f"#{i} ({a.item_id}: [{ax1},{ay1},{ax2},{ay2}]) y "
                    f"#{j} ({b.item_id}: [{bx1},{by1},{bx2},{by2}])"
                )

                # 2. Minimum gap_cm separation along at least one axis
                sep_x = max(0.0, max(ax1 - bx2, bx1 - ax2))
                sep_y = max(0.0, max(ay1 - by2, by1 - ay2))
                assert sep_x >= (gap_cm - eps) or sep_y >= (gap_cm - eps), (
                    f"Violación de gap_cm ({gap_cm} cm) en pliego #{sheet.sheet_index} entre "
                    f"#{i} ({a.item_id}) y #{j} ({b.item_id}): sep_x={sep_x:.4f}, sep_y={sep_y:.4f}"
                )


# =============================================================================
# 1. SheetLayoutPackerService Core Nesting, Margin & Non-Overlap Tests
# =============================================================================


def test_layout_packer_respects_default_2cm_safety_margin_and_gap_without_overlaps():
    service = SheetLayoutPackerService()
    assert service.is_available() is True

    # Standard SRA3 sheet: 32 x 45 cm, default 2.0 cm safety margin -> printable 28 x 41 cm
    sheet = SheetSpec(
        width_cm=32.0,
        height_cm=45.0,
        margin_cm=2.0,
        gap_cm=0.3,
        media_type="sheet",
        group_by_material=True,
        include_preview_svg=True,
    )
    items = [
        StickerNestItem(
            item_id="design-circ-5cm",
            width_cm=5.0,
            height_cm=5.0,
            quantity=18,
            material="Vinilo Brillo",
            shape="Circular",
        ),
        StickerNestItem(
            item_id="design-rect-8x4",
            width_cm=8.0,
            height_cm=4.0,
            quantity=14,
            material="Vinilo Brillo",
            shape="Rectangular",
        ),
        StickerNestItem(
            item_id="design-sq-6cm",
            width_cm=6.0,
            height_cm=6.0,
            quantity=10,
            material="Vinilo Brillo",
            shape="Cuadrado",
        ),
    ]

    result = service.pack(LayoutPackPayload(sheet=sheet, items=items))

    assert result.total_stickers == 42
    assert result.total_sheets >= 1
    assert result.margin_cm == 2.0
    assert result.gap_cm == 0.3
    assert result.usable_width_cm == 28.0
    assert result.usable_height_cm == 41.0
    assert 0.0 < result.utilization_percent <= 100.0
    assert round(result.utilization_percent + result.waste_percent, 2) == 100.0
    assert result.preview_svg is not None and "<svg" in result.preview_svg

    assert_no_margin_invasion_or_overlap(
        result.sheets,
        margin_cm=sheet.margin_cm,
        gap_cm=sheet.gap_cm,
    )

    # Circular and square items must never be flagged as rotated
    for p in result.placements:
        if p.item_id in ("design-circ-5cm", "design-sq-6cm"):
            assert p.rotated is False
            assert p.width == p.height


def test_layout_packer_90_degree_rotation_maximizes_rectangular_utilization():
    """
    On a sheet with printable area 18.6 x 27.6 cm (22.6 x 31.6 cm with 2.0 cm margin) and gap=0.3 cm:
    - 9 stickers of 9.0 x 6.0 cm:
      * Without rotation (9x6): only 2 cols (18.3 cm) x 4 rows (24.9 cm) = 8 fit on sheet #1 -> requires 2 sheets!
      * With 90° rotation (6x9): 3 cols (6*3 + 0.6 = 18.6 cm) x 3 rows (9*3 + 0.6 = 27.6 cm) = all 9 fit on 1 sheet!
    """
    service = SheetLayoutPackerService()
    sheet = SheetSpec(
        width_cm=22.6,
        height_cm=31.6,
        margin_cm=2.0,
        gap_cm=0.3,
        media_type="sheet",
    )

    # 1) With rotation enabled (default for Rectangular)
    res_rot = service.pack(
        LayoutPackPayload(
            sheet=sheet,
            items=[
                StickerNestItem(
                    item_id="rect-9x6",
                    width_cm=9.0,
                    height_cm=6.0,
                    quantity=9,
                    material="Vinilo Mate",
                    shape="Rectangular",
                    allow_rotation=True,
                )
            ],
        )
    )
    assert res_rot.total_sheets == 1
    assert res_rot.total_stickers == 9
    assert all(p.rotated is True for p in res_rot.placements)
    assert all(p.width == 6.0 and p.height == 9.0 for p in res_rot.placements)
    assert_no_margin_invasion_or_overlap(res_rot.sheets, margin_cm=2.0, gap_cm=0.3)

    # 2) With rotation explicitly disabled -> requires 2 sheets and lower utilization
    res_no_rot = service.pack(
        LayoutPackPayload(
            sheet=sheet,
            items=[
                StickerNestItem(
                    item_id="rect-9x6",
                    width_cm=9.0,
                    height_cm=6.0,
                    quantity=9,
                    material="Vinilo Mate",
                    shape="Rectangular",
                    allow_rotation=False,
                )
            ],
        )
    )
    assert res_no_rot.total_sheets == 2
    assert all(p.rotated is False for p in res_no_rot.placements)
    assert all(p.width == 9.0 and p.height == 6.0 for p in res_no_rot.placements)
    assert res_rot.utilization_percent > res_no_rot.utilization_percent
    assert_no_margin_invasion_or_overlap(res_no_rot.sheets, margin_cm=2.0, gap_cm=0.3)


def test_layout_packer_groups_designs_by_material_onto_independent_sheets():
    service = SheetLayoutPackerService()
    sheet = SheetSpec(width_cm=32.0, height_cm=45.0, margin_cm=2.0, gap_cm=0.3, group_by_material=True)
    items = [
        StickerNestItem(
            item_id="item-vb-1",
            width_cm=6.0,
            height_cm=6.0,
            quantity=6,
            material="Vinilo Brillo",
            shape="Cuadrado",
        ),
        StickerNestItem(
            item_id="item-dtf-1",
            width_cm=7.0,
            height_cm=5.0,
            quantity=5,
            material="DTF UV",
            shape="Rectangular",
        ),
        StickerNestItem(
            item_id="item-vb-2",
            width_cm=5.0,
            height_cm=8.0,
            quantity=4,
            material="Vinilo Brillo",
            shape="Rectangular",
        ),
    ]

    result = service.pack(LayoutPackPayload(sheet=sheet, items=items))

    assert result.total_stickers == 15
    assert result.total_sheets == 2
    assert len(result.material_groups) == 2

    vb_group = next(g for g in result.material_groups if g.material == "Vinilo Brillo")
    dtf_group = next(g for g in result.material_groups if g.material == "DTF UV")
    assert vb_group.stickers_count == 10
    assert vb_group.sheets_required == 1
    assert dtf_group.stickers_count == 5
    assert dtf_group.sheets_required == 1

    # Verify no sheet mixes materials
    for s in result.sheets:
        sheet_item_ids = {p.item_id for p in s.placements}
        if s.material == "Vinilo Brillo":
            assert sheet_item_ids == {"item-vb-1", "item-vb-2"}
        else:
            assert s.material == "DTF UV"
            assert sheet_item_ids == {"item-dtf-1"}

    assert_no_margin_invasion_or_overlap(result.sheets, margin_cm=2.0, gap_cm=0.3)


def test_layout_packer_continuous_roll_mode_minimizes_consumed_length():
    service = SheetLayoutPackerService()
    # Roll width 60 cm with 2 cm safety margin -> 56 cm printable width
    sheet = SheetSpec(
        width_cm=60.0,
        height_cm=None,
        margin_cm=2.0,
        gap_cm=0.3,
        media_type="roll",
    )
    # 16 stickers of 10x6 cm: rotated to 6x10 cm fits 8 columns per row -> 2 rows = 20.3 cm content height (+4 cm margins = 24.3 cm)
    items = [
        StickerNestItem(
            item_id="roll-rect-10x6",
            width_cm=10.0,
            height_cm=6.0,
            quantity=16,
            material="Vinilo Brillo",
            shape="Rectangular",
        )
    ]

    result = service.pack(LayoutPackPayload(sheet=sheet, items=items))
    assert result.media_type == "roll"
    assert result.total_sheets == 1
    assert result.total_stickers == 16
    roll_page = result.sheets[0]
    assert roll_page.used_height_cm == pytest.approx(24.3, abs=0.05)
    assert roll_page.height_cm == roll_page.used_height_cm
    assert_no_margin_invasion_or_overlap(result.sheets, margin_cm=2.0, gap_cm=0.3)


def test_layout_packer_rejects_oversized_sticker_and_invalid_margins():
    service = SheetLayoutPackerService()
    sheet = SheetSpec(width_cm=32.0, height_cm=45.0, margin_cm=2.0, gap_cm=0.3)

    # Printable area is 28 x 41 cm; a 30 x 30 cm sticker cannot fit even rotated
    with pytest.raises(ValueError, match="supera el área imprimible"):
        service.pack(
            LayoutPackPayload(
                sheet=sheet,
                items=[
                    StickerNestItem(
                        item_id="huge-sticker",
                        width_cm=30.0,
                        height_cm=30.0,
                        quantity=1,
                    )
                ],
            )
        )

    # Margin 16 cm on a 32 cm wide sheet leaves 0 cm printable width
    with pytest.raises(ValueError, match="margen de seguridad"):
        service.pack(
            LayoutPackPayload(
                sheet=SheetSpec(width_cm=32.0, height_cm=45.0, margin_cm=16.0),
                items=[StickerNestItem(item_id="s1", width_cm=5.0, height_cm=5.0, quantity=1)],
            )
        )


def test_verify_sheet_geometry_detects_artificial_overlap_and_margin_breach():
    """Ensure `verify_sheet_geometry` catches both margin breaches and overlapping stickers."""
    overlapping_page = SheetLayoutPage(
        sheet_index=1,
        material="Vinilo Mate",
        material_sheet_index=1,
        width_cm=32.0,
        height_cm=45.0,
        used_height_cm=15.0,
        stickers_count=2,
        stickers_area_cm2=50.0,
        sheet_area_cm2=1440.0,
        usable_area_cm2=1148.0,
        utilization_percent=3.47,
        waste_percent=96.53,
        usable_utilization_percent=4.36,
        placements=[
            PlacedSticker(item_id="a", x=2.0, y=2.0, width=5.0, height=5.0, rotated=False),
            PlacedSticker(item_id="b", x=6.0, y=2.0, width=5.0, height=5.0, rotated=False),
        ],
    )
    with pytest.raises(ValueError, match="Solapamiento"):
        verify_sheet_geometry(overlapping_page, margin_cm=2.0, gap_cm=0.3)

    margin_breach_page = SheetLayoutPage(
        sheet_index=1,
        material="Vinilo Mate",
        material_sheet_index=1,
        width_cm=32.0,
        height_cm=45.0,
        used_height_cm=10.0,
        stickers_count=1,
        stickers_area_cm2=25.0,
        sheet_area_cm2=1440.0,
        usable_area_cm2=1148.0,
        utilization_percent=1.74,
        waste_percent=98.26,
        usable_utilization_percent=2.18,
        placements=[
            PlacedSticker(item_id="breach", x=1.5, y=2.0, width=5.0, height=5.0, rotated=False),
        ],
    )
    with pytest.raises(ValueError, match="margen de seguridad"):
        verify_sheet_geometry(margin_breach_page, margin_cm=2.0, gap_cm=0.3)


# =============================================================================
# 2. Requirement 1: `ai_rembg` Lazy Cache (`u2netp`) & Fallback to `smart_subject`
# =============================================================================


def _make_framed_sticker_rgb_alpha(width: int = 80, height: int = 80):
    """Create a white-background RGB array with a centered vivid blue sticker square."""
    rgb = np.full((height, width, 3), 250, dtype=np.uint8)
    rgb[20 : height - 20, 20 : width - 20] = (25, 100, 230)
    alpha = np.full((height, width), 255, dtype=np.uint8)
    return rgb, alpha


def test_ai_rembg_falls_back_cleanly_to_smart_subject_when_rembg_missing(monkeypatch):
    """When `rembg` is not installed, `mode='ai_rembg'` must fall back to OpenCV `smart_subject` without crashing."""
    clear_rembg_session_cache()
    monkeypatch.setitem(sys.modules, "rembg", None)

    rgb, alpha = _make_framed_sticker_rgb_alpha(80, 80)
    diagnostics = {}
    clean_rgb, new_alpha = remove_image_background_rgba(
        rgb,
        alpha,
        mode="ai_rembg",
        tolerance=28,
        feather=1,
        diagnostics=diagnostics,
    )

    assert diagnostics["bg_mode_requested"] == "ai_rembg"
    assert diagnostics["bg_mode_effective"] == "smart_subject"
    assert diagnostics["bg_fallback_used"] is True
    assert "smart_subject" in str(diagnostics.get("bg_fallback_reason", ""))

    # Outer white border must become transparent while center blue sticker stays opaque
    assert int(new_alpha[0, 0]) == 0
    assert int(new_alpha[40, 40]) == 255
    assert clean_rgb.shape == (80, 80, 3)


def test_ai_rembg_lazy_loads_and_caches_u2netp_session_on_first_use(monkeypatch):
    """Verify `u2netp` session is lazy-loaded only once and reused from `_REMBG_SESSION_CACHE`."""
    clear_rembg_session_cache()
    assert len(_REMBG_SESSION_CACHE) == 0

    session_calls: List[str] = []
    remove_calls: List[object] = []

    fake_rembg = ModuleType("rembg")

    def _fake_new_session(model_name: str):
        session_calls.append(model_name)
        return SimpleNamespace(model_name=model_name)

    def _fake_remove(pil_img, session=None):
        remove_calls.append(session)
        w, h = pil_img.size
        out = np.zeros((h, w, 4), dtype=np.uint8)
        out[18 : h - 18, 18 : w - 18] = (25, 100, 230, 255)
        return Image.fromarray(out, mode="RGBA")

    fake_rembg.new_session = _fake_new_session  # type: ignore[attr-defined]
    fake_rembg.remove = _fake_remove  # type: ignore[attr-defined]
    fake_ort = ModuleType("onnxruntime")

    monkeypatch.setitem(sys.modules, "rembg", fake_rembg)
    monkeypatch.setitem(sys.modules, "onnxruntime", fake_ort)

    rgb, alpha = _make_framed_sticker_rgb_alpha(72, 72)

    # First call initializes the u2netp session lazily
    diag1 = {}
    _, alpha1 = remove_image_background_rgba(rgb, alpha, mode="ai_rembg", feather=1, diagnostics=diag1)
    assert diag1["bg_mode_effective"] == "ai_rembg"
    assert diag1["bg_fallback_used"] is False
    assert diag1["bg_model"] == REMBG_DEFAULT_MODEL
    assert session_calls == ["u2netp"]
    assert "u2netp" in _REMBG_SESSION_CACHE
    assert int(alpha1[0, 0]) == 0
    assert int(alpha1[36, 36]) == 255

    # Second call MUST reuse cached session without calling new_session("u2netp") again
    diag2 = {}
    _, alpha2 = remove_image_background_rgba(rgb, alpha, mode="ai_rembg", feather=0, diagnostics=diag2)
    assert diag2["bg_mode_effective"] == "ai_rembg"
    assert session_calls == ["u2netp"]
    assert len(remove_calls) == 2
    assert remove_calls[0] is remove_calls[1]
    assert get_rembg_session("u2netp") is remove_calls[0]
    assert int(alpha2[36, 36]) == 255

    clear_rembg_session_cache()
    assert len(_REMBG_SESSION_CACHE) == 0


def test_pack_layout_schema_normalization_and_defaults():
    """Verify `PackLayoutRequest` defaults (`margin_cm=2.0`, `gap_cm=0.3`) and circular/roll shortcuts."""
    req = PackLayoutRequest(
        sheet_width_cm=32.0,
        sheet_height_cm=45.0,
        items=[
            {"item_id": 101, "diameter_cm": 5.0, "quantity": 25, "material": "Vinilo Brillo"},
            {"item_id": "102", "width_cm": 8.0, "height_cm": 4.5, "quantity": 10, "material": "Vinilo Brillo"},
        ],
    )
    assert req.margin_cm == 2.0
    assert req.gap_cm == 0.3
    assert req.media_type == "sheet"
    assert req.items[0].item_id == "101"
    assert req.items[0].shape == "Circular"
    assert req.items[0].width_cm == 5.0 and req.items[0].height_cm == 5.0

    roll_req = PackLayoutRequest(
        roll_width_cm=60.0,
        items=[{"item_id": "r1", "width_cm": 10.0, "height_cm": 6.0, "quantity": 12}],
    )
    assert roll_req.media_type == "roll"
    assert roll_req.sheet_width_cm == 60.0
    assert roll_req.sheet_height_cm is None


def test_pack_layout_router_integration_with_multidesign_db_order(tmp_path):
    """
    Verify `_extract_nest_items_from_orders` and `SheetLayoutPackerService` end-to-end
    against a real SQLAlchemy relational database containing a multi-material order.
    """
    from datetime import datetime, timedelta, timezone
    from sqlalchemy.orm import sessionmaker

    from app.db.database import build_engine
    from app.db.models import Customer, Material, Order, OrderItem, Shape
    from app.db.seed import init_db_and_seed
    from app.routers.image_processing import _extract_nest_items_from_orders

    db_file = tmp_path / "test_pack_orders.db"
    engine = build_engine(f"sqlite:///{db_file.as_posix()}")
    init_db_and_seed(bind_engine=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

    db = SessionLocal()
    try:
        mat_vb = db.query(Material).filter(Material.name == "Vinilo Brillo").first()
        mat_dtf = db.query(Material).filter(Material.name == "DTF UV").first()
        shape_circ = db.query(Shape).filter(Shape.name == "Circular").first()
        shape_rect = db.query(Shape).filter(Shape.name == "Rectangular").first()
        assert mat_vb and mat_dtf and shape_circ and shape_rect

        customer = Customer(referral_name="Taller Impresión", phone="+59170009999")
        db.add(customer)
        db.flush()

        delivery_dt = (datetime.now(timezone.utc) + timedelta(days=1)).replace(
            minute=0, second=0, microsecond=0
        )
        order = Order(
            order_number="ST-2026-0900",
            customer_id=customer.id,
            material_id=mat_vb.id,
            vinyl_gloss_mode="En rollo",
            shape_id=shape_circ.id,
            diameter_cm=5.0,
            dimensions=None,
            size_display="Ø 5 cm",
            quantity=35,
            delivery_datetime=delivery_dt,
            status="En Impresión",
        )
        db.add(order)
        db.flush()

        item1 = OrderItem(
            order_id=order.id,
            position=1,
            material_id=mat_vb.id,
            vinyl_gloss_mode="En rollo",
            shape_id=shape_circ.id,
            diameter_cm=5.0,
            dimensions=None,
            size_display="Ø 5 cm",
            quantity=20,
            image_storage_path="orders/2026/11/a.png",
            image_safe_filename="a.png",
            image_original_filename="a.png",
            image_content_type="image/png",
            image_size_bytes=1024,
        )
        item2 = OrderItem(
            order_id=order.id,
            position=2,
            material_id=mat_dtf.id,
            vinyl_gloss_mode=None,
            shape_id=shape_rect.id,
            diameter_cm=None,
            dimensions="6x9 cm",
            size_display="6x9 cm",
            quantity=15,
            image_storage_path="orders/2026/11/b.png",
            image_safe_filename="b.png",
            image_original_filename="b.png",
            image_content_type="image/png",
            image_size_bytes=1024,
        )
        db.add_all([item1, item2])
        db.commit()

        extracted = _extract_nest_items_from_orders(db, [str(order.id)])
        assert len(extracted) == 2

        service = SheetLayoutPackerService()
        result = service.pack(
            LayoutPackPayload(
                sheet=SheetSpec(
                    width_cm=32.0,
                    height_cm=45.0,
                    margin_cm=2.0,
                    gap_cm=0.3,
                    group_by_material=True,
                ),
                items=extracted,
            )
        )
        assert result.total_stickers == 35
        assert len(result.material_groups) == 2
        assert {g.material for g in result.material_groups} == {"Vinilo Brillo", "DTF UV"}
        assert_no_margin_invasion_or_overlap(result.sheets, margin_cm=2.0, gap_cm=0.3)
    finally:
        db.close()
        engine.dispose()


def test_enhancer_service_pipeline_ai_rembg_fallback_and_response_metadata(monkeypatch):
    """Verify `ImageEnhancerService._run_pipeline` with `bg_mode='ai_rembg'` populates fallback telemetry."""
    import io

    from app.modules.image_processing import EnhancementOptions, ImageAsset, ImageEnhancerService
    from app.routers.image_processing import _to_enhance_response

    clear_rembg_session_cache()
    monkeypatch.setitem(sys.modules, "rembg", None)

    rgb, alpha = _make_framed_sticker_rgb_alpha(64, 64)
    rgba = np.dstack([rgb, alpha])
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")

    service = ImageEnhancerService()
    asset = ImageAsset(order_id="1", content=buf.getvalue(), content_type="image/png", filename="test.png")
    opts = EnhancementOptions(
        target_dpi=300,
        upscale_factor=1.0,
        remove_background=True,
        bg_mode="ai_rembg",
        bg_tolerance=28,
        bg_feather=1,
    )
    res = service._run_pipeline(asset, opts)
    assert res.metadata["background_removed"] is True
    assert res.metadata["bg_mode_requested"] == "ai_rembg"
    assert res.metadata["bg_mode_effective"] == "smart_subject"
    assert res.metadata["bg_fallback_used"] is True
    assert res.metadata["has_transparency"] is True

    api_resp = _to_enhance_response("ST-2026-0001", res)
    assert api_resp.background_removed is True
    assert api_resp.bg_mode_effective == "smart_subject"
    assert api_resp.bg_fallback_used is True
    assert api_resp.bg_notice is not None and "smart_subject" in api_resp.bg_notice


