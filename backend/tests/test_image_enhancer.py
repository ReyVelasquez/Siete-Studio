"""Automated tests for Phase 2 Module 1: OpenCV/NumPy Enhancement, Brightness/Contrast & CMYK."""

from __future__ import annotations

import asyncio
import io

import httpx
from PIL import Image

from app.core.security import AuthenticatedUser, get_current_user
from app.main import app
from app.modules.image_processing import EnhancementOptions, ImageAsset, ImageEnhancerService
from app.modules.image_processing.enhancer import EnhancePayload


def _make_sample_png_bytes(width: int = 80, height: int = 60, color=(40, 110, 220, 255)) -> bytes:
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    # Opaque sticker center with transparent border
    for y in range(10, height - 10):
        for x in range(10, width - 10):
            img.putpixel((x, y), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _request(method: str, path: str, **kwargs) -> httpx.Response:
    async def _run() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(_run())


def test_enhancer_upscales_preserves_alpha_and_embeds_300_dpi():
    service = ImageEnhancerService()
    assert service.is_available() is True

    raw = _make_sample_png_bytes(80, 60)
    asset = ImageAsset(order_id="1", content=raw, content_type="image/png", filename="sticker.png")
    opts = EnhancementOptions(
        target_dpi=300,
        upscale_factor=2.0,
        denoise_strength=20,
        sharpen_strength=35,
        auto_contrast=True,
        brightness=15,
        contrast=20,
        saturation=10,
        gamma=1.1,
    )

    result = asyncio.run(service.process(EnhancePayload(asset=asset, options=opts)))
    assert result.width_px == 160
    assert result.height_px == 120
    assert result.dpi == 300
    assert result.metadata["has_transparency"] is True

    out_img = Image.open(io.BytesIO(result.output_bytes))
    assert out_img.mode == "RGBA"
    assert out_img.size == (160, 120)
    # Corner must remain transparent
    assert out_img.getpixel((0, 0))[3] == 0
    # Center must remain opaque
    assert out_img.getpixel((80, 60))[3] == 255


def test_enhancer_cmyk_calibration_tac_limit_and_true_cmyk_tiff_export():
    service = ImageEnhancerService()
    # Very dark saturated patch to test CMYK channel shifts + TAC cap
    raw = _make_sample_png_bytes(60, 60, color=(20, 20, 25, 255))
    asset = ImageAsset(order_id="2", content=raw, content_type="image/png", filename="dark.png")

    opts = EnhancementOptions(
        target_dpi=300,
        upscale_factor=1.0,
        cyan=40,
        magenta=40,
        yellow=40,
        black=40,
        ink_limit_percent=260,
        output_format="tiff_cmyk",
    )

    result = asyncio.run(service.process(EnhancePayload(asset=asset, options=opts)))
    assert result.content_type == "image/tiff"
    assert result.extension == ".tif"
    # Total ink coverage must respect 260% limit
    assert result.cmyk_stats.max_tac_percent <= 260.5
    assert result.cmyk_stats.tac_warning is False

    out_img = Image.open(io.BytesIO(result.output_bytes))
    assert out_img.mode == "CMYK"
    dpi = out_img.info.get("dpi")
    assert dpi is not None and round(dpi[0]) == 300


def test_enhancer_upload_and_cmyk_export_endpoints():
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="test-uid", email="admin@siete.studio", role="admin", email_verified=True
    )
    try:
        sample = _make_sample_png_bytes(64, 64)
        res_preview = _request(
            "POST",
            "/api/v1/image-processing/enhance/upload",
            data={
                "target_dpi": "300",
                "upscale_factor": "2",
                "brightness": "10",
                "contrast": "15",
                "cyan": "12",
                "magenta": "-5",
                "yellow": "8",
                "black": "5",
                "ink_limit_percent": "280",
            },
            files={"image": ("test.png", sample, "image/png")},
        )
        assert res_preview.status_code == 200
        body = res_preview.json()
        assert body["output_width"] == 128
        assert body["preview_data_url"].startswith("data:image/png;base64,")
        assert body["cmyk_stats"]["max_tac_percent"] <= 280.5

        res_export = _request(
            "POST",
            "/api/v1/image-processing/enhance/export",
            data={
                "output_format": "jpeg_cmyk",
                "target_dpi": "300",
                "cyan": "10",
                "ink_limit_percent": "300",
            },
            files={"image": ("test.png", sample, "image/png")},
        )
        assert res_export.status_code == 200
        assert res_export.headers["content-type"] == "image/jpeg"
        assert "cmyk.jpg" in res_export.headers["content-disposition"]
        exported_img = Image.open(io.BytesIO(res_export.content))
        assert exported_img.mode == "CMYK"
    finally:
        app.dependency_overrides.clear()


def test_save_enhanced_image_back_to_order(tmp_path, monkeypatch):
    from datetime import datetime, timedelta, timezone
    from sqlalchemy.orm import sessionmaker

    from app.db.database import build_engine, get_db
    from app.db.seed import init_db_and_seed
    from app.services import storage_service as storage_mod

    db_file = tmp_path / "test_enhance_save.db"
    test_engine = build_engine(f"sqlite:///{db_file.as_posix()}")
    init_db_and_seed(bind_engine=test_engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine, future=True)

    def _override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr(storage_mod, "LOCAL_UPLOADS_DIR", tmp_path / "uploads")
    monkeypatch.setattr(storage_mod.storage_service, "_should_use_firebase_bucket", lambda: False)

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="admin-uid", email="admin@siete.studio", role="admin", email_verified=True
    )

    try:
        sample = _make_sample_png_bytes(60, 60)
        tomorrow = (datetime.now(timezone(timedelta(minutes=-240))) + timedelta(days=1)).replace(
            hour=14, minute=0, second=0, microsecond=0
        )
        created = _request(
            "POST",
            "/api/v1/admin/orders",
            data={
                "referral_name": "Marcos Vidal",
                "phone": "+59170001234",
                "material": "Vinilo Mate",
                "shape": "Circular",
                "diameter_cm": "5",
                "quantity": "100",
                "delivery_datetime": tomorrow.isoformat(),
            },
            files={"image": ("original.png", sample, "image/png")},
        )
        assert created.status_code == 201
        order_id = created.json()["id"]
        old_filename = created.json()["image"]["safe_filename"]

        saved = _request(
            "POST",
            "/api/v1/image-processing/enhance/save-to-order",
            json={
                "order_id": order_id,
                "target_dpi": 300,
                "upscale_factor": 2.0,
                "brightness": 8,
                "contrast": 10,
                "cyan": 5,
                "advance_status": "En Impresión",
            },
        )
        assert saved.status_code == 200
        body = saved.json()
        assert body["status"] == "En Impresión"
        # Non-destructive prepress: original image stays intact while enhanced_storage_path is populated
        assert body["image"]["safe_filename"] == old_filename
        assert body["items"][0]["enhanced_storage_path"] is not None
        assert body["items"][0]["prepress_status"] == "mejorado"
        assert len(body["status_history"]) >= 2

        orig_res = _request("GET", f"/api/v1/admin/orders/{order_id}/image", params={"variant": "original"})
        assert orig_res.status_code == 200
        assert Image.open(io.BytesIO(orig_res.content)).size == (60, 60)

        img_res = _request("GET", f"/api/v1/admin/orders/{order_id}/image", params={"variant": "enhanced"})
        assert img_res.status_code == 200
        enhanced_img = Image.open(io.BytesIO(img_res.content))
        assert enhanced_img.size == (120, 120)
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()
