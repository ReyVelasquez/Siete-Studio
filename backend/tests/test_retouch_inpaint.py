"""Automated tests for Content-Aware Eraser (Inpainting) & Watermark Removal Studio."""

from __future__ import annotations

import asyncio
import io

import httpx
import numpy as np
from PIL import Image, ImageDraw

from app.core.security import AuthenticatedUser, get_current_user
from app.main import app
from app.modules.image_processing import RetouchInpaintService


def _encode_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _request(method: str, path: str, **kwargs) -> httpx.Response:
    async def _run() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(_run())


def test_inpaint_telea_erases_object_and_preserves_solid_background_color():
    service = RetouchInpaintService()
    assert service.is_available() is True

    bg_color = (20, 145, 115, 255)
    img = Image.new("RGBA", (120, 120), bg_color)
    draw = ImageDraw.Draw(img)
    # Draw unwanted red-black blemish in center
    draw.rectangle([48, 48, 72, 72], fill=(220, 20, 20, 255))

    mask = Image.new("RGBA", (120, 120), (0, 0, 0, 0))
    mdraw = ImageDraw.Draw(mask)
    mdraw.rectangle([45, 45, 75, 75], fill=(1, 195, 142, 255))

    res = service.inpaint_sync(
        _encode_png(img),
        _encode_png(mask),
        mode="inpaint_telea",
        inpaint_radius=7,
        mask_feather=2,
        mask_dilate=2,
    )
    assert res.width == 120
    assert res.height == 120
    assert res.masked_pixels > 0

    out = Image.open(io.BytesIO(res.output_bytes)).convert("RGBA")
    center_px = out.getpixel((60, 60))
    # Reconstructed center pixel must match the surrounding green background color closely
    assert abs(center_px[0] - bg_color[0]) <= 12
    assert abs(center_px[1] - bg_color[1]) <= 12
    assert abs(center_px[2] - bg_color[2]) <= 12
    assert center_px[3] == 255


def test_inpaint_ns_preserves_multi_color_gradient_background():
    service = RetouchInpaintService()
    w, h = 140, 100
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    for x in range(w):
        t = x / (w - 1)
        arr[:, x, 0] = int(20 + 180 * t)
        arr[:, x, 1] = int(60 + 100 * (1 - t))
        arr[:, x, 2] = int(180 - 80 * t)
        arr[:, x, 3] = 255

    # Paint unwanted white bar in middle of gradient
    arr[42:58, 55:85, :3] = 255
    img = Image.fromarray(arr, mode="RGBA")

    mask = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(mask).rectangle([53, 40, 87, 60], fill=(1, 195, 142, 255))

    res = service.inpaint_sync(
        _encode_png(img),
        _encode_png(mask),
        mode="inpaint_ns",
        inpaint_radius=9,
        mask_feather=2,
        mask_dilate=2,
    )
    out = np.array(Image.open(io.BytesIO(res.output_bytes)).convert("RGBA"))
    # Compare reconstructed horizontal midline with clean row above (row 20)
    reconstructed_mid = out[50, 60:80, :3].astype(np.float32)
    clean_ref = out[20, 60:80, :3].astype(np.float32)
    mean_diff = float(np.mean(np.abs(reconstructed_mid - clean_ref)))
    assert mean_diff < 12.0


def test_watermark_clean_removes_semitransparent_watermark_preserving_background():
    service = RetouchInpaintService()
    bg = (24, 52, 92)
    img = Image.new("RGBA", (140, 100), (*bg, 255))
    overlay = Image.new("RGBA", (140, 100), (0, 0, 0, 0))
    ImageDraw.Draw(overlay).line([(20, 80), (120, 20)], fill=(255, 255, 255, 120), width=8)
    composited = Image.alpha_composite(img, overlay)

    mask = Image.new("RGBA", (140, 100), (0, 0, 0, 0))
    ImageDraw.Draw(mask).line([(16, 84), (124, 16)], fill=(1, 195, 142, 255), width=14)

    res = service.inpaint_sync(
        _encode_png(composited),
        _encode_png(mask),
        mode="watermark_clean",
        inpaint_radius=7,
        mask_feather=2,
        mask_dilate=2,
        watermark_strength=95,
    )
    out = Image.open(io.BytesIO(res.output_bytes)).convert("RGBA")
    px = out.getpixel((70, 50))
    # Must closely restore deep navy background instead of white watermark
    assert abs(px[0] - bg[0]) <= 18
    assert abs(px[1] - bg[1]) <= 18
    assert abs(px[2] - bg[2]) <= 18


def test_erase_transparent_clears_alpha_only_under_mask():
    service = RetouchInpaintService()
    img = Image.new("RGBA", (80, 80), (1, 195, 142, 255))
    mask = Image.new("RGBA", (80, 80), (0, 0, 0, 0))
    ImageDraw.Draw(mask).rectangle([20, 20, 60, 60], fill=(255, 255, 255, 255))

    res = service.inpaint_sync(
        _encode_png(img),
        _encode_png(mask),
        mode="erase_transparent",
        mask_feather=0,
        mask_dilate=0,
    )
    assert res.has_transparency is True
    out = Image.open(io.BytesIO(res.output_bytes)).convert("RGBA")
    assert out.getpixel((40, 40))[3] == 0
    assert out.getpixel((5, 5))[3] == 255


def test_detect_watermark_mask_finds_light_semitransparent_strokes():
    service = RetouchInpaintService()
    img = Image.new("RGBA", (240, 160), (22, 46, 74, 255))
    wm = Image.new("RGBA", (240, 160), (0, 0, 0, 0))
    draw = ImageDraw.Draw(wm)
    draw.line([(20, 40), (220, 120)], fill=(255, 255, 255, 130), width=5)
    draw.line([(20, 120), (220, 40)], fill=(255, 255, 255, 130), width=5)
    composited = Image.alpha_composite(img, wm)

    res = service.detect_watermark_mask_sync(
        _encode_png(composited),
        tone="light",
        sensitivity=65,
    )
    assert res.width == 240
    assert res.height == 160
    assert res.detected_pixels > 200
    assert res.detected_percent > 0.5


def test_retouch_endpoints_require_auth_and_work_when_authenticated():
    img = Image.new("RGBA", (64, 64), (30, 80, 120, 255))
    mask = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    ImageDraw.Draw(mask).rectangle([20, 20, 44, 44], fill=(1, 195, 142, 255))

    # Unauthenticated must be blocked
    unauth = _request(
        "POST",
        "/api/v1/image-processing/retouch/inpaint",
        files={
            "image": ("design.png", _encode_png(img), "image/png"),
            "mask": ("mask.png", _encode_png(mask), "image/png"),
        },
        data={"mode": "inpaint_telea"},
    )
    assert unauth.status_code == 401

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="test-op-1",
        email="operador@siete.studio",
        name="Operador Test",
        role="operador",
        email_verified=True,
        db_user_id=1,
    )
    try:
        resp = _request(
            "POST",
            "/api/v1/image-processing/retouch/inpaint",
            files={
                "image": ("design.png", _encode_png(img), "image/png"),
                "mask": ("mask.png", _encode_png(mask), "image/png"),
            },
            data={
                "mode": "inpaint_telea",
                "inpaint_radius": "7",
                "mask_feather": "2",
                "mask_dilate": "2",
            },
        )
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        assert payload["preview_data_url"].startswith("data:image/png;base64,")
        assert payload["width"] == 64
        assert payload["height"] == 64
        assert payload["masked_pixels"] > 0

        wm_resp = _request(
            "POST",
            "/api/v1/image-processing/retouch/detect-watermark",
            files={"image": ("design.png", _encode_png(img), "image/png")},
            data={"tone": "light", "sensitivity": "55"},
        )
        assert wm_resp.status_code == 200, wm_resp.text
        wm_data = wm_resp.json()
        assert wm_data["mask_data_url"].startswith("data:image/png;base64,")
    finally:
        app.dependency_overrides.clear()


def test_black_dots_on_yellow_surface_restores_pure_yellow_not_black():
    """
    Regression test for user bug: erasing black dots on a yellow surface must fill with
    pure yellow even when the user's brush barely misses 2px of black fringe or sits right
    next to another black dot.
    """
    service = RetouchInpaintService()
    yellow = (255, 212, 0)
    img = Image.new("RGBA", (160, 160), (*yellow, 255))
    draw = ImageDraw.Draw(img)
    # Main black dot to erase (radius 10px centered at 60, 80)
    draw.ellipse([50, 70, 70, 90], fill=(8, 8, 8, 255))
    # Nearby black dot sitting just 4px away (centered at 82, 80)
    draw.ellipse([76, 74, 88, 86], fill=(8, 8, 8, 255))

    # Intentionally tight mask covering most of the main dot, leaving 2px dark fringe on boundary!
    mask = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(mask).ellipse([52, 72, 68, 88], fill=(1, 195, 142, 255))

    for mode in ("inpaint_telea", "inpaint_ns", "watermark_clean"):
        res = service.inpaint_sync(
            _encode_png(img),
            _encode_png(mask),
            mode=mode,
            inpaint_radius=8,
            mask_feather=2,
            mask_dilate=1,
            watermark_strength=92,
        )
        assert res.detected_base_color is not None
        out = Image.open(io.BytesIO(res.output_bytes)).convert("RGBA")
        # Erased dot center MUST be pure yellow, NEVER black!
        center = out.getpixel((60, 80))
        assert center[0] >= 225, f"{mode}: expected yellow R, got {center}"
        assert center[1] >= 185, f"{mode}: expected yellow G, got {center}"
        assert center[2] <= 40, f"{mode}: expected yellow B, got {center}"
        # Separate unmasked dot nearby must remain intact
        other_dot = out.getpixel((82, 80))
        assert other_dot[0] < 40 and other_dot[1] < 40 and other_dot[2] < 40


def test_explicit_base_color_override_prevents_adjacent_black_bleed():
    service = RetouchInpaintService()
    yellow = (255, 215, 0)
    img = Image.new("RGBA", (120, 120), (*yellow, 255))
    draw = ImageDraw.Draw(img)
    # Thick black border occupying left half, black spot right next to it on yellow side
    draw.rectangle([0, 0, 48, 120], fill=(10, 10, 10, 255))
    draw.ellipse([50, 50, 68, 68], fill=(10, 10, 10, 255))

    mask = Image.new("RGBA", (120, 120), (0, 0, 0, 0))
    ImageDraw.Draw(mask).ellipse([49, 49, 69, 69], fill=(1, 195, 142, 255))

    res = service.inpaint_sync(
        _encode_png(img),
        _encode_png(mask),
        mode="inpaint_telea",
        inpaint_radius=8,
        mask_feather=1,
        mask_dilate=1,
        base_color="#FFD700",
    )
    assert res.detected_base_color == "#FFD700"
    out = Image.open(io.BytesIO(res.output_bytes)).convert("RGBA")
    px = out.getpixel((59, 59))
    assert px[0] >= 230 and px[1] >= 190 and px[2] <= 35


def test_two_color_seam_preserves_both_yellow_and_blue_when_erasing_black_dot():
    service = RetouchInpaintService()
    img = Image.new("RGBA", (140, 120), (255, 212, 0, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([70, 0, 140, 120], fill=(20, 90, 210, 255))
    # Black dot directly on the seam
    draw.ellipse([63, 53, 77, 67], fill=(10, 10, 10, 255))

    mask = Image.new("RGBA", (140, 120), (0, 0, 0, 0))
    ImageDraw.Draw(mask).ellipse([61, 51, 79, 69], fill=(1, 195, 142, 255))

    res = service.inpaint_sync(
        _encode_png(img),
        _encode_png(mask),
        mode="inpaint_telea",
        inpaint_radius=7,
        mask_feather=1,
        mask_dilate=1,
    )
    out = Image.open(io.BytesIO(res.output_bytes)).convert("RGBA")
    left_px = out.getpixel((65, 60))
    right_px = out.getpixel((75, 60))
    # Left stays yellow, right stays blue
    assert left_px[0] > 200 and left_px[1] > 165 and left_px[2] < 60
    assert right_px[2] > 160 and right_px[0] < 70


def test_tiny_brush_erases_only_small_area_preserving_exact_brush_size():
    """
    Regression test: lowering brush size to a small dot (6px diameter) must ONLY erase
    that small dot and NOT blow up to 18-22px via fringe absorption when mask_dilate=0.
    """
    service = RetouchInpaintService()
    yellow = (255, 212, 0)
    img = Image.new("RGBA", (140, 140), (*yellow, 255))
    draw = ImageDraw.Draw(img)
    # 28x28 black square in center (56..84)
    draw.rectangle([56, 56, 84, 84], fill=(10, 10, 10, 255))

    # Tiny 6px diameter brush dot centered at (70, 70) -> radius 3px
    mask = Image.new("RGBA", (140, 140), (0, 0, 0, 0))
    ImageDraw.Draw(mask).ellipse([67, 67, 73, 73], fill=(1, 195, 142, 255))

    res = service.inpaint_sync(
        _encode_png(img),
        _encode_png(mask),
        mode="inpaint_telea",
        inpaint_radius=8,
        mask_feather=1,
        mask_dilate=0,
    )
    out = Image.open(io.BytesIO(res.output_bytes)).convert("RGBA")
    # Center of tiny 6px dot MUST become pure yellow
    center = out.getpixel((70, 70))
    assert center[0] >= 225 and center[1] >= 185 and center[2] <= 40, f"Expected yellow center, got {center}"
    # Pixel 7px away from center (still inside black square, outside 3px brush) MUST stay black!
    outside_brush = out.getpixel((77, 70))
    assert outside_brush[0] < 35 and outside_brush[1] < 35 and outside_brush[2] < 35, (
        f"Tiny brush bled outside its radius! Got {outside_brush}"
    )
