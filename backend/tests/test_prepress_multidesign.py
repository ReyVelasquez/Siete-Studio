"""Unit & integration tests for non-destructive per-item prepress, DPI preflight, white border & ZIP export."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import httpx
import numpy as np
import pytest
from PIL import Image
from sqlalchemy import inspect, text
from sqlalchemy.orm import sessionmaker

from app.core.security import AuthenticatedUser, get_current_user
from app.db.database import build_engine, get_db
from app.db.seed import ensure_order_items_prepress_columns, init_db_and_seed
from app.main import app
from app.modules.image_processing import DieCutEdgeDetectorService, ImageAsset
from app.modules.image_processing.edge_detector import EdgeDetectionPayload
from app.routers.image_processing import (
    _build_eps_zip_entry_name,
    compute_effective_dpi_preflight,
)
from app.services import storage_service as storage_mod


def _make_sticker_png(
    width: int = 120,
    height: int = 120,
    color: tuple[int, int, int, int] = (30, 110, 230, 255),
    margin: int = 20,
) -> bytes:
    """Generate a transparent RGBA PNG with a centered opaque rectangle."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    arr = np.zeros((height, width, 4), dtype=np.uint8)
    arr[margin : height - margin, margin : width - margin] = color
    img = Image.fromarray(arr, mode="RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_mask_png(width: int = 120, height: int = 120) -> bytes:
    """Generate a simple white-stroke mask PNG for retouch/inpaint endpoint tests."""
    arr = np.zeros((height, width, 4), dtype=np.uint8)
    cy, cx = height // 2, width // 2
    arr[cy - 4 : cy + 4, cx - 8 : cx + 8] = (255, 255, 255, 255)
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def _request(method: str, path: str, **kwargs) -> httpx.Response:
    async def _run() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(_run())


def _tomorrow_iso() -> str:
    return (
        datetime.now(timezone(timedelta(minutes=-240))) + timedelta(days=1)
    ).replace(hour=15, minute=0, second=0, microsecond=0).isoformat()


def _setup_isolated_env(tmp_path: Path, monkeypatch, *, role: str = "operador"):
    db_file = tmp_path / "prepress_multidesign.db"
    test_engine = build_engine(f"sqlite:///{db_file.as_posix()}")
    init_db_and_seed(bind_engine=test_engine)
    testing_session = sessionmaker(autocommit=False, autoflush=False, bind=test_engine, future=True)

    def _override_get_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    uploads_dir = tmp_path / "uploads"
    monkeypatch.setattr(storage_mod, "LOCAL_UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(storage_mod.storage_service, "_should_use_firebase_bucket", lambda: False)

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid=f"{role}-uid",
        email=f"{role}@siete.studio",
        role=role,
        email_verified=True,
    )
    return test_engine, uploads_dir


def _create_two_design_order(
    *,
    img1_bytes: bytes,
    img2_bytes: bytes,
) -> dict:
    items_payload = [
        {
            "material": "Vinilo Brillo",
            "vinyl_gloss_mode": "En rollo",
            "shape": "Circular",
            "diameter_cm": 5,
            "quantity": 100,
        },
        {
            "material": "DTF UV",
            "shape": "Rectangular",
            "dimensions": "6x9 cm",
            "quantity": 50,
        },
    ]
    res = _request(
        "POST",
        "/api/v1/public/orders",
        data={
            "referral_name": "Lucía Méndez",
            "phone": "+59171234567",
            "delivery_datetime": _tomorrow_iso(),
            "items": json.dumps(items_payload),
        },
        files=[
            ("images", ("logo_circular.png", img1_bytes, "image/png")),
            ("images", ("etiqueta_dtf.png", img2_bytes, "image/png")),
        ],
    )
    assert res.status_code == 201, res.text
    return res.json()


# =============================================================================
# 1. Safe Migration & Schema Exposure Tests
# =============================================================================


def test_ensure_order_items_prepress_columns_migrates_legacy_sqlite_idempotently(tmp_path):
    db_file = tmp_path / "legacy_prepress.db"
    engine = build_engine(f"sqlite:///{db_file.as_posix()}")
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE order_items (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        order_id INTEGER NOT NULL,
                        position INTEGER NOT NULL DEFAULT 1,
                        image_storage_path VARCHAR(300) NOT NULL
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "INSERT INTO order_items (order_id, position, image_storage_path) "
                    "VALUES (1, 1, 'orders/2026/01/orig.png')"
                )
            )

        # First run adds the 4 missing non-destructive prepress columns
        ensure_order_items_prepress_columns(engine)
        # Second run must be a safe no-op (idempotent)
        ensure_order_items_prepress_columns(engine)

        col_names = {c["name"] for c in inspect(engine).get_columns("order_items")}
        assert {
            "enhanced_storage_path",
            "die_cut_anchors_json",
            "die_cut_eps_path",
            "prepress_status",
        }.issubset(col_names)

        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT enhanced_storage_path, die_cut_anchors_json, die_cut_eps_path, prepress_status "
                    "FROM order_items WHERE id = 1"
                )
            ).one()
            assert row[0] is None
            assert row[1] is None
            assert row[2] is None
            assert row[3] == "pendiente"
    finally:
        engine.dispose()


# =============================================================================
# 2. Real Effective DPI Preflight Unit Tests
# =============================================================================


@pytest.mark.parametrize(
    ("width_px", "height_px", "diameter_cm", "dimensions", "expected_dpi", "expected_status"),
    [
        # 5 cm circular = 1.9685 in -> 600 px => 304.8 DPI (ok)
        (600, 600, 5.0, None, 304.8, "ok"),
        # 5 cm circular -> 400 px => 203.2 DPI (warning)
        (400, 400, 5.0, None, 203.2, "warning"),
        # 5 cm circular -> 120 px => 61.0 DPI (critical)
        (120, 120, 5.0, None, 61.0, "critical"),
        # 6x9 cm rectangular (Alto=6, Ancho=9): 1080x720 px -> 304.8 DPI (ok)
        (1080, 720, None, "6x9 cm", 304.8, "ok"),
        # Swapped 90° orientation (720x1080 px for 6x9 cm) still yields 304.8 DPI (ok)
        (720, 1080, None, "6x9 cm", 304.8, "ok"),
        # 6x9 cm rectangular: 600x400 px -> 169.3 DPI (warning)
        (600, 400, None, "6x9 cm", 169.3, "warning"),
        # 6x9 cm rectangular: 300x200 px -> 84.7 DPI (critical)
        (300, 200, None, "6x9 cm", 84.7, "critical"),
    ],
)
def test_compute_effective_dpi_preflight_thresholds(
    width_px, height_px, diameter_cm, dimensions, expected_dpi, expected_status
):
    fake_item = SimpleNamespace(diameter_cm=diameter_cm, dimensions=dimensions)
    dpi, status_flag = compute_effective_dpi_preflight(width_px, height_px, fake_item)
    assert dpi == expected_dpi
    assert status_flag == expected_status


def test_zip_entry_name_formatting():
    fake_item_1 = SimpleNamespace(
        position=1,
        material=SimpleNamespace(name="Vinilo Brillo"),
        size_display="Ø 5 cm",
        quantity=100,
    )
    fake_item_2 = SimpleNamespace(
        position=2,
        material=SimpleNamespace(name="DTF UV"),
        size_display="6x9 cm",
        quantity=50,
    )
    assert _build_eps_zip_entry_name("ST-2026-0001", fake_item_1) == "ST-2026-0001_01_Vinilo_Brillo_5cm_x100.eps"
    assert _build_eps_zip_entry_name("ST-2026-0001", fake_item_2) == "ST-2026-0001_02_DTF_UV_6x9cm_x50.eps"


# =============================================================================
# 3. Morphological White Border (`cv2.dilate`) Unit Test
# =============================================================================


def test_edge_detector_white_border_mm_dilates_contour_and_renders_white_margin():
    service = DieCutEdgeDetectorService()
    assert service.is_available() is True

    # Colored square centered inside a transparent 160x160 canvas
    raw_png = _make_sticker_png(160, 160, color=(20, 80, 210, 255), margin=45)
    asset = ImageAsset(order_id="1", content=raw_png, content_type="image/png", filename="icon.png")

    res_no_border = asyncio.run(
        service.process(
            EdgeDetectionPayload(
                asset=asset,
                mode="en_su_forma",
                dpi=300,
                bleed_mm=0.0,
                white_border_mm=0.0,
            )
        )
    )
    res_with_border = asyncio.run(
        service.process(
            EdgeDetectionPayload(
                asset=asset,
                mode="en_su_forma",
                dpi=300,
                bleed_mm=0.0,
                white_border_mm=3.0,
            )
        )
    )

    # Unpadded source dimensions must be preserved for true DPI preflight
    assert res_no_border.source_width == 160
    assert res_no_border.source_height == 160
    assert res_with_border.source_width == 160
    assert res_with_border.source_height == 160
    assert res_with_border.white_border_mm == 3.0

    # Morphological dilation expands contour bounding box significantly
    _, _, bw_0, bh_0 = res_no_border.bounding_box_px
    _, _, bw_3, bh_3 = res_with_border.bounding_box_px
    assert bw_3 > bw_0 + 20
    assert bh_3 > bh_0 + 20

    # Rendered artwork PNG must contain opaque white pixels around the blue core
    out_rgba = np.array(Image.open(io.BytesIO(res_with_border.artwork_png_bytes)).convert("RGBA"))
    white_pixels = (
        (out_rgba[:, :, 0] >= 245)
        & (out_rgba[:, :, 1] >= 245)
        & (out_rgba[:, :, 2] >= 245)
        & (out_rgba[:, :, 3] >= 220)
    )
    assert int(np.count_nonzero(white_pixels)) > 500


# =============================================================================
# 4. Multi-Design `item_id`, Non-Destructive Editing & All 8 Endpoints Test
# =============================================================================


def test_multidesign_item_id_non_destructive_prepress_and_export_zip(tmp_path, monkeypatch):
    test_engine, uploads_dir = _setup_isolated_env(tmp_path, monkeypatch, role="operador")
    try:
        # Item #1: Circular 5 cm -> 120x120 px (~61 DPI critical; 2x upscale -> ~122 DPI critical; 4x -> ~244 DPI warning)
        img1_bytes = _make_sticker_png(120, 120, color=(220, 50, 50, 255), margin=20)
        # Item #2: Rectangular 6x9 cm -> 540x360 px (~152.4 DPI warning; 2x upscale -> 304.8 DPI ok)
        img2_bytes = _make_sticker_png(540, 360, color=(30, 160, 90, 255), margin=40)

        created = _create_two_design_order(img1_bytes=img1_bytes, img2_bytes=img2_bytes)
        order_id = created["id"]
        order_number = created["order_number"]
        assert len(created["items"]) == 2

        item1 = created["items"][0]
        item2 = created["items"][1]
        item1_id = int(item1["id"])
        item2_id = int(item2["id"])

        assert item1["prepress_status"] == "pendiente"
        assert item2["prepress_status"] == "pendiente"
        assert item1["enhanced_storage_path"] is None
        assert item2["enhanced_storage_path"] is None

        item1_orig_path = uploads_dir / item1["image"]["storage_path"]
        item2_orig_path = uploads_dir / item2["image"]["storage_path"]
        item1_orig_disk_bytes = item1_orig_path.read_bytes()
        item2_orig_disk_bytes = item2_orig_path.read_bytes()

        # Invalid item_id must return 404
        res_missing = _request(
            "POST",
            "/api/v1/image-processing/enhance",
            json={"order_id": order_id, "item_id": 999999, "upscale_factor": 1.0},
        )
        assert res_missing.status_code == 404

        # 1) /enhance targeting item #2 explicitly with 2x upscale -> 1080x720 px on 6x9 cm => 304.8 DPI ("ok")
        res_enh2 = _request(
            "POST",
            "/api/v1/image-processing/enhance",
            json={"order_id": order_id, "item_id": item2_id, "upscale_factor": 2.0, "target_dpi": 300},
        )
        assert res_enh2.status_code == 200, res_enh2.text
        enh2 = res_enh2.json()
        assert enh2["item_id"] == item2_id
        assert enh2["output_width"] == 1080
        assert enh2["output_height"] == 720
        assert enh2["effective_dpi"] == 304.8
        assert enh2["dpi_status"] == "ok"

        # 2) /enhance WITHOUT item_id -> backward-compatible fallback to position=1 (item #1: 120x120 @ 5cm => 61.0 critical)
        res_enh1_default = _request(
            "POST",
            "/api/v1/image-processing/enhance",
            json={"order_id": order_id, "upscale_factor": 1.0, "target_dpi": 300},
        )
        assert res_enh1_default.status_code == 200, res_enh1_default.text
        enh1 = res_enh1_default.json()
        assert enh1["item_id"] == item1_id
        assert enh1["output_width"] == 120
        assert enh1["effective_dpi"] == 61.0
        assert enh1["dpi_status"] == "critical"

        # 3) /enhance/export targeting item #2
        res_exp2 = _request(
            "POST",
            "/api/v1/image-processing/enhance/export",
            data={
                "order_id": order_id,
                "item_id": str(item2_id),
                "output_format": "png_rgb",
                "target_dpi": "300",
                "upscale_factor": "1.0",
            },
        )
        assert res_exp2.status_code == 200
        assert "item02" in res_exp2.headers["content-disposition"]
        assert Image.open(io.BytesIO(res_exp2.content)).size == (540, 360)

        # 4) /enhance/save-to-order targeting item #2 -> non-destructive save to enhanced_storage_path
        res_save2 = _request(
            "POST",
            "/api/v1/image-processing/enhance/save-to-order",
            json={
                "order_id": order_id,
                "item_id": item2_id,
                "upscale_factor": 2.0,
                "target_dpi": 300,
                "brightness": 5,
            },
        )
        assert res_save2.status_code == 200, res_save2.text
        saved_order = res_save2.json()
        saved_item1 = saved_order["items"][0]
        saved_item2 = saved_order["items"][1]

        # Item #1 MUST remain untouched
        assert saved_item1["prepress_status"] == "pendiente"
        assert saved_item1["enhanced_storage_path"] is None
        assert item1_orig_path.read_bytes() == item1_orig_disk_bytes

        # Item #2 MUST have enhanced_storage_path + prepress_status="mejorado" while original file stays intact
        assert saved_item2["prepress_status"] == "mejorado"
        assert saved_item2["enhanced_storage_path"] is not None
        assert saved_item2["enhanced_storage_path"] != saved_item2["image"]["storage_path"]
        assert saved_item2["image"]["storage_path"] == item2["image"]["storage_path"]
        assert item2_orig_path.read_bytes() == item2_orig_disk_bytes

        first_enhanced_path = uploads_dir / saved_item2["enhanced_storage_path"]
        assert first_enhanced_path.exists()
        assert Image.open(first_enhanced_path).size == (1080, 720)

        # Verify admin image endpoint serves original vs enhanced variant for item #2
        orig_dl = _request(
            "GET", f"/api/v1/admin/orders/{order_id}/items/{item2_id}/image?variant=original"
        )
        enh_dl = _request(
            "GET", f"/api/v1/admin/orders/{order_id}/items/{item2_id}/image?variant=enhanced"
        )
        assert orig_dl.status_code == 200 and Image.open(io.BytesIO(orig_dl.content)).size == (540, 360)
        assert enh_dl.status_code == 200 and Image.open(io.BytesIO(enh_dl.content)).size == (1080, 720)

        # 5) /enhance/save-to-order/upload targeting item #1 (non-destructive)
        retouched_upload = _make_sticker_png(400, 400, color=(230, 60, 60, 255), margin=40)
        res_save1_up = _request(
            "POST",
            "/api/v1/image-processing/enhance/save-to-order/upload",
            data={
                "order_id": order_id,
                "item_id": str(item1_id),
                "target_dpi": "300",
                "upscale_factor": "1.0",
            },
            files={"image": ("retouched_logo.png", retouched_upload, "image/png")},
        )
        assert res_save1_up.status_code == 200, res_save1_up.text
        saved_after_up = res_save1_up.json()
        assert saved_after_up["items"][0]["prepress_status"] == "mejorado"
        assert saved_after_up["items"][0]["enhanced_storage_path"] is not None
        assert saved_after_up["items"][0]["image"]["storage_path"] == item1["image"]["storage_path"]
        assert item1_orig_path.read_bytes() == item1_orig_disk_bytes

        # 6) /retouch/inpaint and /retouch/detect-watermark targeting item #1 (uses enhanced 400x400 image)
        mask_bytes = _make_mask_png(400, 400)
        res_inpaint = _request(
            "POST",
            "/api/v1/image-processing/retouch/inpaint",
            data={"order_id": order_id, "item_id": str(item1_id), "mode": "inpaint_telea"},
            files={"mask": ("mask.png", mask_bytes, "image/png")},
        )
        assert res_inpaint.status_code == 200, res_inpaint.text
        assert res_inpaint.json()["width"] == 400

        res_wm = _request(
            "POST",
            "/api/v1/image-processing/retouch/detect-watermark",
            data={"order_id": order_id, "item_id": str(item1_id), "tone": "light"},
        )
        assert res_wm.status_code == 200, res_wm.text
        assert res_wm.json()["width"] == 400

        # Before exporting EPS, /export-zip must return 404 (no EPS files ready yet)
        res_zip_empty = _request("GET", f"/api/v1/image-processing/orders/{order_id}/export-zip")
        assert res_zip_empty.status_code == 404

        # 7) /detect-edges with white_border_mm for BOTH items -> computes real DPI & persists anchors
        res_edges1 = _request(
            "POST",
            "/api/v1/image-processing/detect-edges",
            json={
                "order_id": order_id,
                "item_id": item1_id,
                "mode": "circular",
                "dpi": 300,
                "bleed_mm": 1.5,
                "white_border_mm": 2.0,
            },
        )
        assert res_edges1.status_code == 200, res_edges1.text
        edges1 = res_edges1.json()
        assert edges1["item_id"] == item1_id
        assert edges1["white_border_mm"] == 2.0
        # Uses enhanced 400x400 unpadded pixels against 5 cm circular => 203.2 DPI ("warning")
        assert edges1["effective_dpi"] == 203.2
        assert edges1["dpi_status"] == "warning"

        # Validation: white_border_mm > 10 must be rejected (422)
        res_bad_wb = _request(
            "POST",
            "/api/v1/image-processing/detect-edges",
            json={"order_id": order_id, "item_id": item1_id, "white_border_mm": 12.5},
        )
        assert res_bad_wb.status_code == 422

        res_edges2 = _request(
            "POST",
            "/api/v1/image-processing/detect-edges",
            json={
                "order_id": order_id,
                "item_id": item2_id,
                "mode": "en_su_forma",
                "dpi": 300,
                "bleed_mm": 2.0,
                "white_border_mm": 3.0,
            },
        )
        assert res_edges2.status_code == 200, res_edges2.text
        edges2 = res_edges2.json()
        assert edges2["item_id"] == item2_id
        assert edges2["white_border_mm"] == 3.0
        # Uses enhanced 1080x720 unpadded pixels against 6x9 cm => 304.8 DPI ("ok")
        assert edges2["effective_dpi"] == 304.8
        assert edges2["dpi_status"] == "ok"

        # 8) /die-cut/export for BOTH items -> persists die_cut_anchors_json, die_cut_eps_path & prepress_status
        res_eps1 = _request(
            "POST",
            "/api/v1/image-processing/die-cut/export",
            json={
                "order_id": order_id,
                "item_id": item1_id,
                "artwork_data_url": edges1["artwork_data_url"],
                "image_width": edges1["image_width"],
                "image_height": edges1["image_height"],
                "dpi": 300,
                "anchors": edges1["anchors"],
                "export_format": "eps",
            },
        )
        assert res_eps1.status_code == 200, res_eps1.text
        assert res_eps1.content.startswith(b"%!PS-Adobe-3.0 EPSF-3.0")

        res_eps2 = _request(
            "POST",
            "/api/v1/image-processing/die-cut/export",
            json={
                "order_id": order_id,
                "item_id": item2_id,
                "artwork_data_url": edges2["artwork_data_url"],
                "image_width": edges2["image_width"],
                "image_height": edges2["image_height"],
                "dpi": 300,
                "anchors": edges2["anchors"],
                "export_format": "eps",
                "advance_status": "Listo",
            },
        )
        assert res_eps2.status_code == 200, res_eps2.text
        assert res_eps2.content.startswith(b"%!PS-Adobe-3.0 EPSF-3.0")

        # Verify persisted prepress fields on OrderResponse via admin endpoint
        order_detail = _request("GET", f"/api/v1/admin/orders/{order_id}").json()
        d_item1 = order_detail["items"][0]
        d_item2 = order_detail["items"][1]
        assert d_item1["prepress_status"] == "troquelado"
        assert d_item1["die_cut_eps_path"] is not None
        assert len(json.loads(d_item1["die_cut_anchors_json"])) == len(edges1["anchors"])
        assert d_item2["prepress_status"] == "listo_pliego"
        assert d_item2["die_cut_eps_path"] is not None
        assert len(json.loads(d_item2["die_cut_anchors_json"])) == len(edges2["anchors"])

        # Original files on disk MUST STILL be byte-for-byte identical!
        assert item1_orig_path.read_bytes() == item1_orig_disk_bytes
        assert item2_orig_path.read_bytes() == item2_orig_disk_bytes

        # 9) GET /api/v1/image-processing/orders/{order_id}/export-zip
        res_zip = _request("GET", f"/api/v1/image-processing/orders/{order_id}/export-zip")
        assert res_zip.status_code == 200, res_zip.text
        assert res_zip.headers["content-type"] == "application/zip"
        assert res_zip.headers["x-packaged-items"] == "2"
        assert res_zip.headers["x-total-items"] == "2"

        expected_name_1 = f"{order_number}_01_Vinilo_Brillo_5cm_x100.eps"
        expected_name_2 = f"{order_number}_02_DTF_UV_6x9cm_x50.eps"
        with zipfile.ZipFile(io.BytesIO(res_zip.content), mode="r") as zf:
            names = zf.namelist()
            assert names == [expected_name_1, expected_name_2]
            assert zf.read(expected_name_1).startswith(b"%!PS-Adobe-3.0 EPSF-3.0")
            assert zf.read(expected_name_2).startswith(b"%!PS-Adobe-3.0 EPSF-3.0")
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()


def test_export_zip_enforces_staff_rbac(tmp_path, monkeypatch):
    test_engine, _ = _setup_isolated_env(tmp_path, monkeypatch, role="cliente")
    try:
        # Role `cliente` MUST receive 403 Forbidden
        res_client = _request("GET", "/api/v1/image-processing/orders/1/export-zip")
        assert res_client.status_code == 403

        # Unauthenticated MUST receive 401
        app.dependency_overrides.pop(get_current_user, None)
        res_anon = _request("GET", "/api/v1/image-processing/orders/1/export-zip")
        assert res_anon.status_code == 401
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()
