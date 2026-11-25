"""Automated tests for Background Removal (PNG), Die-Cut Vector Modes & 2-Layer EPS Export."""

from __future__ import annotations

import asyncio
import io

import httpx
from PIL import Image, ImageDraw

from app.core.security import AuthenticatedUser, get_current_user
from app.main import app
from app.modules.image_processing import (
    DieCutEdgeDetectorService,
    EnhancementOptions,
    ImageAsset,
    ImageEnhancerService,
)
from app.modules.image_processing.edge_detector import EdgeDetectionPayload
from app.modules.image_processing.enhancer import EnhancePayload


def _make_opaque_white_bg_sticker() -> bytes:
    """Create a sticker graphic with a solid white background and an interior white dot."""
    img = Image.new("RGB", (140, 140), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.ellipse((28, 28, 112, 112), fill=(30, 80, 190))
    # Interior white eye/highlight that MUST remain opaque after exterior bg removal
    draw.ellipse((58, 58, 82, 82), fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _run_coro(coro):
    """Drive a single-step service coroutine synchronously without allocating an OS loopback socketpair."""
    try:
        coro.send(None)
    except StopIteration as exc:
        return exc.value
    finally:
        coro.close()
    raise RuntimeError("Coroutine yielded unexpectedly")


def _request(method: str, path: str, **kwargs) -> httpx.Response:
    async def _run() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(_run())


def test_background_removal_strips_exterior_and_preserves_interior_white():
    enhancer = ImageEnhancerService()
    raw = _make_opaque_white_bg_sticker()
    asset = ImageAsset(order_id="bg1", content=raw, content_type="image/png", filename="logo.png")
    opts = EnhancementOptions(
        remove_background=True,
        bg_mode="auto_color",
        bg_tolerance=28,
        bg_feather=1,
    )

    res = _run_coro(enhancer.process(EnhancePayload(asset=asset, options=opts)))
    assert res.metadata["background_removed"] is True
    assert res.metadata["has_transparency"] is True

    out = Image.open(io.BytesIO(res.output_bytes))
    assert out.mode == "RGBA"
    # Outer white corner MUST become transparent
    assert out.getpixel((2, 2))[3] == 0
    # Blue body MUST stay opaque
    assert out.getpixel((45, 70))[3] == 255
    # Interior white center MUST stay opaque (not punched out!)
    assert out.getpixel((70, 70))[3] == 255


def test_die_cut_modes_and_two_layer_eps_export():
    detector = DieCutEdgeDetectorService()
    raw = _make_opaque_white_bg_sticker()
    asset = ImageAsset(order_id="dc1", content=raw, content_type="image/png", filename="logo.png")

    # 1. En su forma (silhouette tracking)
    res_shape = _run_coro(
        detector.process(
            EdgeDetectionPayload(
                asset=asset, mode="en_su_forma", dpi=300, bleed_mm=2.5, corner_roundness=0.4
            )
        )
    )
    assert len(res_shape.anchors) >= 6
    assert res_shape.cut_path_d.startswith("M ") and res_shape.cut_path_d.endswith("Z")
    assert res_shape.background_removed is True

    # 2. Circular
    res_circle = _run_coro(
        detector.process(EdgeDetectionPayload(asset=asset, mode="circular", dpi=300, bleed_mm=3.0))
    )
    assert len(res_circle.anchors) == 8

    # 3. Polígono regular (Hexagon with rounded corners -> 6 * 2 = 12 fillet anchors)
    res_hex = _run_coro(
        detector.process(
            EdgeDetectionPayload(
                asset=asset,
                mode="poligono_regular",
                polygon_sides=6,
                corner_roundness=0.4,
                dpi=300,
            )
        )
    )
    assert len(res_hex.anchors) == 12

    # 4. Export 2-Layer PostScript Level 3 EPS
    eps_bytes = detector.export_two_layer_eps(
        res_shape.artwork_png_bytes,
        res_shape.anchors,
        width_px=res_shape.image_width,
        height_px=res_shape.image_height,
        dpi=300,
        title="STK-TEST-001",
    )
    eps_text = eps_bytes.decode("ascii")
    assert eps_text.startswith("%!PS-Adobe-3.0 EPSF-3.0")
    assert "%%Creator: Adobe Illustrator(R) 7.0" in eps_text
    assert "%AI5_FileFormat 3.0" in eps_text
    assert "%AI5_NumLayers: 2" in eps_text
    assert "%%DocumentCustomColors: (CutContour)" in eps_text
    assert eps_text.count("%AI5_BeginLayer") == 2
    assert eps_text.count("%AI5_EndLayer") == 2
    assert "(Capa 1 - Diseno) Ln" in eps_text
    assert "(Capa 2 - CutContour) Ln" in eps_text
    assert "%AI5_BeginRaster" in eps_text
    assert "%AI5_EndRaster" in eps_text
    # Transparent PNG artwork must be wrapped in an official AI7 vector clipping mask group
    # (`u / 0 A / q / <paint style> / <path> / h / W / n / ... / Q / U`) for true transparency!
    assert "\nu\n0 A\nq\n" in eps_text and "\nh\nW\nn\n" in eps_text and "\nQ\nU\n" in eps_text
    assert "0 1 0 0 (CutContour) 0 X" in eps_text
    assert "1 J 1 j 0.50 w 10 M []0 d" in eps_text
    # XI matrix MUST anchor top-left at ty = height_pt so Capa 1 & Capa 2 align 1:1!
    expected_h_pt = (res_shape.image_height / 300.0) * 72.0
    assert f"0 {expected_h_pt:.3f} ] 0 0 {res_shape.image_width} {res_shape.image_height}" in eps_text
    assert "\ns\n" in eps_text
    assert "<~" not in eps_text and "~>" not in eps_text
    assert "%%EOF" in eps_text

    # Custom cut stroke thickness (editable in Die-Cut Studio)
    eps_thick = detector.export_two_layer_eps(
        res_shape.artwork_png_bytes,
        res_shape.anchors,
        width_px=res_shape.image_width,
        height_px=res_shape.image_height,
        dpi=300,
        title="STK-THICK",
        cut_stroke_width_pt=1.25,
    ).decode("ascii")
    assert "1 J 1 j 1.25 w 10 M []0 d" in eps_thick

    # Validate exact `%`-prefixed CMYK hex stream byte count inside XI block
    raster_body = eps_text.split(" 8 4 0 0 0 0 XI\n", 1)[1].split("\n%AI5_EndRaster", 1)[0]
    hex_lines = raster_body.splitlines()
    assert all(line.startswith("%") for line in hex_lines)
    hex_digits = "".join(line[1:] for line in hex_lines)
    expected_hex_chars = res_shape.image_width * res_shape.image_height * 4 * 2
    assert len(hex_digits) == expected_hex_chars
    assert all(ch in "0123456789ABCDEF" for ch in hex_digits)


def test_die_cut_detect_and_export_eps_endpoints():
    from app.routers.image_processing import detect_die_cut_edges_upload, export_die_cut_file
    from app.schemas.image_processing import ExportDieCutRequest

    class _InMemoryUpload:
        def __init__(self, filename: str, content: bytes, content_type: str = "image/png") -> None:
            self.filename = filename
            self.content_type = content_type
            self._buf = io.BytesIO(content)

        async def read(self, size: int = -1) -> bytes:
            return self._buf.read(size)

    admin_user = AuthenticatedUser(
        uid="admin-uid", email="admin@siete.studio", role="admin", email_verified=True
    )
    raw = _make_opaque_white_bg_sticker()
    upload = _InMemoryUpload("sticker.png", raw, "image/png")

    detect_resp = _run_coro(
        detect_die_cut_edges_upload(
            image=upload,  # type: ignore[arg-type]
            mode="en_su_forma",
            cut_direction="outside",
            dpi=300,
            bleed_mm=2.5,
            white_border_mm=0.0,
            corner_roundness=0.4,
            smoothing_epsilon=0.004,
            polygon_sides=6,
            polygon_rotation_deg=0.0,
            remove_background=False,
            bg_tolerance=28,
            merge_islands=True,
            join_islands=None,
            border_mode="none",
            border_color=None,
            border_width_mm=2.0,
            border_cut_position="inside_base",
            border_offset_mm=1.5,
            target_width_cm=5.0,
            target_height_cm=5.0,
            fit_mode="contain_proportional",
        )
    )
    body = detect_resp.model_dump()
    assert len(body["anchors"]) >= 6
    assert body["artwork_data_url"].startswith("data:image/png;base64,")
    assert body["physical_width_cm"] == 5.0
    assert body["physical_height_cm"] == 5.0
    assert body["cut_width_cm"] == 5.0
    assert body["cut_height_cm"] == 5.0
    assert body["effective_px_per_mm"] > 0

    export_req = ExportDieCutRequest(
        artwork_data_url=body["artwork_data_url"],
        title="STK-TEST-EPS",
        image_width=body["image_width"],
        image_height=body["image_height"],
        dpi=300,
        anchors=body["anchors"],
        export_format="eps",
        target_width_cm=5.0,
        target_height_cm=5.0,
        fit_mode="contain_proportional",
    )
    export_res = _run_coro(
        export_die_cut_file(
            payload=export_req,
            current_user=admin_user,
            db=None,  # type: ignore[arg-type]
        )
    )
    assert export_res.status_code == 200
    assert export_res.media_type == "application/postscript"
    assert ".eps" in export_res.headers["content-disposition"]
    assert b"%!PS-Adobe-3.0 EPSF-3.0" in export_res.body
    assert b"(Capa 1 - Diseno) Ln" in export_res.body
    assert b"(Capa 2 - CutContour) Ln" in export_res.body
    _, _, w_pt, h_pt = _extract_eps_hires_bbox(export_res.body.decode("ascii"))
    assert abs(w_pt - 141.732) <= 0.5
    assert abs(h_pt - 141.732) <= 0.5


def _make_yellow_sticker_with_black_details() -> bytes:
    """Create a transparent PNG circular yellow sticker with black facial details."""
    img = Image.new("RGBA", (220, 220), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((20, 20, 200, 200), fill=(255, 212, 0, 255))
    draw.ellipse((70, 75, 92, 97), fill=(15, 15, 15, 255))
    draw.ellipse((128, 75, 150, 97), fill=(15, 15, 15, 255))
    draw.arc((68, 88, 152, 162), start=20, end=160, fill=(15, 15, 15, 255), width=8)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _anchors_bbox(anchors):
    xs = [a.x for a in anchors]
    ys = [a.y for a in anchors]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def test_die_cut_inside_vs_outside_across_all_modes():
    detector = DieCutEdgeDetectorService()
    raw = _make_yellow_sticker_with_black_details()
    asset = ImageAsset(order_id="dc-dir", content=raw, content_type="image/png", filename="smiley.png")

    for mode in ("en_su_forma", "circular", "poligono_regular"):
        res_out = _run_coro(
            detector.process(
                EdgeDetectionPayload(
                    asset=asset,
                    mode=mode,
                    cut_direction="outside",
                    dpi=300,
                    bleed_mm=2.5,
                    polygon_sides=6,
                )
            )
        )
        res_in = _run_coro(
            detector.process(
                EdgeDetectionPayload(
                    asset=asset,
                    mode=mode,
                    cut_direction="inside",
                    dpi=300,
                    bleed_mm=2.0,
                    polygon_sides=6,
                )
            )
        )
        assert res_out.cut_direction == "outside"
        assert res_in.cut_direction == "inside"
        _, _, w_out, h_out = _anchors_bbox(res_out.anchors)
        _, _, w_in, h_in = _anchors_bbox(res_in.anchors)
        # Inside cut contour MUST be strictly smaller than the artwork's 180px diameter
        assert w_in < 175 and h_in < 175, f"{mode}: inside contour not inset ({w_in}x{h_in})"
        # Outside cut contour MUST be strictly larger than the artwork's 180px diameter
        assert w_out > 185 and h_out > 185, f"{mode}: outside contour not expanded ({w_out}x{h_out})"


def test_die_cut_detects_base_color_and_renders_colored_border_in_eps_and_svg():
    from app.modules.image_processing.edge_detector import composite_border_onto_artwork

    detector = DieCutEdgeDetectorService()
    raw = _make_yellow_sticker_with_black_details()
    asset = ImageAsset(order_id="dc-border", content=raw, content_type="image/png", filename="smiley.png")

    res = _run_coro(
        detector.process(
            EdgeDetectionPayload(
                asset=asset,
                mode="en_su_forma",
                cut_direction="outside",
                dpi=300,
                bleed_mm=3.0,
                border_mode="base_color",
            )
        )
    )
    assert res.detected_base_color is not None
    assert len(res.palette_colors) >= 2
    # Must detect yellow as primary base color (high R & G, low B), NEVER black
    hx = res.detected_base_color.lstrip("#")
    r, g, b = int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16)
    assert r >= 235 and g >= 195 and b <= 30, f"Expected yellow base color, got {res.detected_base_color}"
    assert res.border_color == res.detected_base_color

    # Verify composited border fills the bleed ring around the sticker with yellow
    composited_bytes = composite_border_onto_artwork(
        res.artwork_png_bytes,
        res.anchors,
        width_px=res.image_width,
        height_px=res.image_height,
        border_color=res.border_color,
        cut_direction="outside",
        dpi=300,
    )
    comp_img = Image.open(io.BytesIO(composited_bytes)).convert("RGBA")
    # Check a pixel inside the bleed ring just outside the top of the yellow circle (center X, ~10px above artwork top)
    cx = res.image_width // 2
    bleed_sample_y = res.bounding_box_px[1] - 10
    ring_px = comp_img.getpixel((cx, bleed_sample_y))
    assert ring_px[3] > 200, f"Expected opaque border in bleed ring, got {ring_px}"
    assert ring_px[0] >= 230 and ring_px[1] >= 190 and ring_px[2] <= 35, f"Expected yellow border, got {ring_px}"

    # Verify SVG & EPS exports work cleanly with border_color
    svg_bytes = detector.export_two_layer_svg(
        res.artwork_png_bytes,
        res.anchors,
        width_px=res.image_width,
        height_px=res.image_height,
        dpi=300,
        border_color=res.border_color,
        cut_direction="outside",
    )
    svg_text = svg_bytes.decode("utf-8")
    assert 'id="DesignBorderFill"' in svg_text
    assert res.border_color in svg_text

    eps_bytes = detector.export_two_layer_eps(
        res.artwork_png_bytes,
        res.anchors,
        width_px=res.image_width,
        height_px=res.image_height,
        dpi=300,
        title="YELLOW-BORDER-TEST",
        border_color=res.border_color,
        cut_direction="outside",
    )
    assert b"%!PS-Adobe-3.0 EPSF-3.0" in eps_bytes
    assert b"(Capa 1 - Diseno) Ln" in eps_bytes
    assert b"(Capa 2 - CutContour) Ln" in eps_bytes
    assert b"<~" not in eps_bytes and b"~>" not in eps_bytes

    # Verify border_cut_position: "inside_base" extends colored base PAST CutContour,
    # whereas "outside_base" shrinks colored base INSIDE CutContour so blade cuts outside base
    res_circle = _run_coro(
        detector.process(
            EdgeDetectionPayload(
                asset=asset,
                mode="circular",
                cut_direction="outside",
                dpi=300,
                bleed_mm=3.5,
                border_mode="base_color",
                border_cut_position="inside_base",
                border_offset_mm=2.0,
            )
        )
    )
    top_cut_y = int(round(min(a.y for a in res_circle.anchors)))
    cx_c = res_circle.image_width // 2

    inside_base_bytes = composite_border_onto_artwork(
        res_circle.artwork_png_bytes,
        res_circle.anchors,
        width_px=res_circle.image_width,
        height_px=res_circle.image_height,
        border_color=res_circle.border_color,
        cut_direction="outside",
        border_cut_position="inside_base",
        border_offset_mm=2.0,
        dpi=300,
    )
    outside_base_bytes = composite_border_onto_artwork(
        res_circle.artwork_png_bytes,
        res_circle.anchors,
        width_px=res_circle.image_width,
        height_px=res_circle.image_height,
        border_color=res_circle.border_color,
        cut_direction="outside",
        border_cut_position="outside_base",
        border_offset_mm=2.0,
        dpi=300,
    )
    in_img = Image.open(io.BytesIO(inside_base_bytes)).convert("RGBA")
    out_img = Image.open(io.BytesIO(outside_base_bytes)).convert("RGBA")

    # 8px OUTSIDE CutContour: opaque yellow in inside_base, transparent in outside_base!
    outside_probe = (cx_c, max(0, top_cut_y - 8))
    assert in_img.getpixel(outside_probe)[3] > 200, "inside_base must extend colored base past CutContour"
    assert out_img.getpixel(outside_probe)[3] == 0, "outside_base must NOT paint outside CutContour"

    # 6px INSIDE CutContour: transparent gap in outside_base (since offset=2mm ≈ 24px), opaque yellow in inside_base!
    inside_probe = (cx_c, top_cut_y + 6)
    assert in_img.getpixel(inside_probe)[3] > 200
    assert out_img.getpixel(inside_probe)[3] < 40, "outside_base must leave clearance inside CutContour"


def test_smart_subject_background_removal_isolates_main_design_and_strips_corner_noise():
    """Verify smart_subject strips shaded backdrops + corner dust while preserving interior whites."""
    import numpy as np

    w, h = 180, 180
    # Subtle off-white gradient backdrop (235 -> 252) with a stray dark speck near corner
    arr = np.zeros((h, w, 3), dtype=np.uint8)
    for y in range(h):
        val = int(236 + (y / (h - 1)) * 16)
        arr[y, :, :] = val
    img = Image.fromarray(arr, mode="RGB")
    draw = ImageDraw.Draw(img)
    # Main centered sticker design (navy shield + interior white circle)
    draw.ellipse((40, 40, 140, 140), fill=(19, 45, 70))
    draw.ellipse((74, 74, 106, 106), fill=(255, 255, 255))
    # Tiny stray artifact clinging to top-left corner edge
    draw.rectangle((0, 0, 10, 10), fill=(80, 80, 80))

    buf = io.BytesIO()
    img.save(buf, format="PNG")

    enhancer = ImageEnhancerService()
    asset = ImageAsset(order_id="ss1", content=buf.getvalue(), content_type="image/png", filename="badge.png")
    opts = EnhancementOptions(
        remove_background=True,
        bg_mode="smart_subject",
        bg_tolerance=28,
        bg_feather=1,
    )
    res = _run_coro(enhancer.process(EnhancePayload(asset=asset, options=opts)))
    assert res.metadata["background_removed"] is True
    assert res.metadata["has_transparency"] is True

    out = Image.open(io.BytesIO(res.output_bytes)).convert("RGBA")
    # Shaded backdrop corners MUST be transparent
    assert out.getpixel((170, 10))[3] == 0
    assert out.getpixel((10, 170))[3] == 0
    # Tiny corner dust clinging to border MUST be removed
    assert out.getpixel((4, 4))[3] == 0
    # Main navy design MUST stay opaque
    assert out.getpixel((58, 90))[3] == 255
    # Interior white circle inside main design MUST remain opaque!
    assert out.getpixel((90, 90))[3] == 255


def test_eps_tux_like_transparent_cutout_has_zero_smear_rich_black_and_clean_edges():
    """
    Regression test for black+yellow+white artwork (like Tux penguin):
    - Exterior transparent pixels in EPS CMYK raster MUST be pure 0/0/0/0 (ZERO radial gray smear!)
    - Black body pixels MUST be Rich Black (C>=135, M>=115, Y>=115, K>=245, TAC<=280%), NOT dull 0/0/0/100
    - Vivid yellow feet MUST stay clean (Y>=240, C<=5, K<=5) and interior white belly MUST stay 0/0/0/0
    - Outer black silhouette boundary MUST have ZERO jagged white speckled dots
    - Layer 1 MUST wrap XI inside an official AI7 clipping mask group (`u / 0 A / q / ... / h / W / n / ... / Q / U`)
    """
    import numpy as np

    # Build a crisp high-contrast Tux-like graphic on white background with anti-aliased edges
    ss = 2
    base_size = 180
    hi = Image.new("RGB", (base_size * ss, base_size * ss), (255, 255, 255))
    draw = ImageDraw.Draw(hi)
    # Black body oval
    draw.ellipse((45 * ss, 25 * ss, 135 * ss, 145 * ss), fill=(0, 0, 0))
    # White interior belly
    draw.ellipse((65 * ss, 65 * ss, 115 * ss, 130 * ss), fill=(255, 255, 255))
    # Vivid yellow webbed feet protruding from bottom
    draw.ellipse((35 * ss, 125 * ss, 80 * ss, 160 * ss), fill=(255, 204, 0))
    draw.ellipse((100 * ss, 125 * ss, 145 * ss, 160 * ss), fill=(255, 204, 0))
    img = hi.resize((base_size, base_size), Image.Resampling.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="PNG")

    detector = DieCutEdgeDetectorService()
    asset = ImageAsset(order_id="tux1", content=buf.getvalue(), content_type="image/png", filename="tux.png")
    res = _run_coro(
        detector.process(
            EdgeDetectionPayload(
                asset=asset,
                mode="en_su_forma",
                cut_direction="outside",
                dpi=300,
                bleed_mm=2.5,
                corner_roundness=0.35,
                remove_background=True,
            )
        )
    )

    eps_bytes = detector.export_two_layer_eps(
        res.artwork_png_bytes,
        res.anchors,
        width_px=res.image_width,
        height_px=res.image_height,
        dpi=300,
        title="TUX-REGRESSION",
        cut_stroke_width_pt=0.5,
    )
    eps_text = eps_bytes.decode("ascii")

    # 1. Verify official AI7 clipping mask group structure
    assert "\nu\n0 A\nq\n0 O\n0 g\n0 R\n0 G\n" in eps_text
    assert "\nh\nW\nn\n%AI5_BeginRaster\n" in eps_text
    assert "\n%AI5_EndRaster\nN\nQ\nU\nLB\n%AI5_EndLayer" in eps_text

    # 2. Decode raw CMYK pixel buffer directly from XI hex stream
    raster_body = eps_text.split(" 8 4 0 0 0 0 XI\n", 1)[1].split("\n%AI5_EndRaster", 1)[0]
    hex_digits = "".join(line[1:] for line in raster_body.splitlines())
    raw_bytes = bytes.fromhex(hex_digits)
    cmyk = np.frombuffer(raw_bytes, dtype=np.uint8).reshape((res.image_height, res.image_width, 4))

    # 3. Far exterior corners MUST be pure 0/0/0/0 (ZERO radial gray/brown smear!)
    for (cx_p, cy_p) in [
        (2, 2),
        (res.image_width - 3, 2),
        (2, res.image_height - 3),
        (res.image_width - 3, res.image_height - 3),
    ]:
        assert tuple(int(v) for v in cmyk[cy_p, cx_p]) == (0, 0, 0, 0), (
            f"Expected zero-ink exterior at ({cx_p},{cy_p}), got {cmyk[cy_p, cx_p]}"
        )

    # Locate the original image offset inside the padded die-cut canvas
    art_img = Image.open(io.BytesIO(res.artwork_png_bytes)).convert("RGBA")
    art_alpha = np.array(art_img, dtype=np.uint8)[:, :, 3]
    pad_x = (res.image_width - base_size) // 2
    pad_y = (res.image_height - base_size) // 2

    # 4. Black head pixel MUST be deep Rich Black (C~60%, M~50%, Y~50%, K=100%), NOT dull 0/0/0/100!
    head_cmyk = tuple(int(v) for v in cmyk[pad_y + 42, pad_x + 90])
    assert head_cmyk[3] >= 245, f"Expected deep black K>=245, got {head_cmyk}"
    assert head_cmyk[0] >= 135 and head_cmyk[1] >= 115 and head_cmyk[2] >= 115, (
        f"Expected Rich Black UCA (not washed-out 0/0/0/100), got {head_cmyk}"
    )
    assert sum(head_cmyk) <= 720, f"TAC exceeded 280% print safety cap: {head_cmyk}"

    # 5. Interior white belly MUST stay pure 0/0/0/0 (zero ink)
    belly_cmyk = tuple(int(v) for v in cmyk[pad_y + 98, pad_x + 90])
    assert belly_cmyk == (0, 0, 0, 0), f"Expected pure white belly 0/0/0/0, got {belly_cmyk}"

    # 6. Vivid yellow foot MUST stay clean pure yellow (high Y, near-zero C & K)
    foot_cmyk = tuple(int(v) for v in cmyk[pad_y + 144, pad_x + 56])
    assert foot_cmyk[2] >= 240 and foot_cmyk[0] <= 5 and foot_cmyk[3] <= 5, (
        f"Expected clean vivid yellow foot, got {foot_cmyk}"
    )

    # 7. Scan top outer edge of black head (semi-transparent boundary) -> ZERO white speckled dots!
    col_x = pad_x + 90
    head_top_ys = np.where(art_alpha[:, col_x] >= 128)[0]
    assert len(head_top_ys) > 20
    top_edge_y = int(head_top_ys[0])
    for dy in range(0, 4):
        edge_px = tuple(int(v) for v in cmyk[top_edge_y + dy, col_x])
        assert edge_px[3] >= 220, (
            f"White/gray speckled fringe detected on black head edge at y+{dy}: {edge_px}"
        )


def _extract_eps_hires_bbox(eps_text: str) -> tuple[float, float, float, float]:
    for line in eps_text.splitlines():
        if line.startswith("%%HiResBoundingBox:"):
            parts = line.split(":", 1)[1].strip().split()
            return (float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3]))
    raise AssertionError("%%HiResBoundingBox not found in EPS output")


def _extract_eps_cut_contour_bounds_pt(eps_text: str) -> tuple[float, float, float, float]:
    """Parse all (x, y) anchor coordinates inside Layer 2 (`(Capa 2 - CutContour) Ln`) in PostScript pt."""
    layer2_part = eps_text.split("(Capa 2 - CutContour) Ln", 1)[1].split("%AI5_EndLayer", 1)[0]
    xs: list[float] = []
    ys: list[float] = []
    for raw_line in layer2_part.splitlines():
        tokens = raw_line.strip().split()
        if len(tokens) == 3 and tokens[2] == "m":
            xs.append(float(tokens[0]))
            ys.append(float(tokens[1]))
        elif len(tokens) == 7 and tokens[6] == "c":
            xs.extend([float(tokens[0]), float(tokens[2]), float(tokens[4])])
            ys.extend([float(tokens[1]), float(tokens[3]), float(tokens[5])])
    assert xs and ys, "No CutContour Bezier coordinates found in Layer 2"
    return (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))


def test_eps_export_5x5cm_order_from_1300x1300px_image_matches_141_73pt_hires_bbox():
    """
    A 5x5 cm order exported from a 1300x1300 px PNG (even with wide transparent margins around
    the artwork) MUST produce an .EPS with %%HiResBoundingBox of ~141.73 x 141.73 pt (±0.5 pt)
    and scale the CutContour bounding box to ~141.73 x 141.73 pt.
    """
    import pytest

    # 1300x1300 px transparent canvas with a centered 780x780 px circular sticker subject
    img = Image.new("RGBA", (1300, 1300), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((260, 260, 1040, 1040), fill=(25, 115, 230, 255))
    draw.ellipse((460, 460, 840, 840), fill=(255, 220, 40, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    detector = DieCutEdgeDetectorService()
    asset = ImageAsset(
        order_id="ord-5x5",
        content=buf.getvalue(),
        content_type="image/png",
        filename="sticker_1300.png",
    )

    res = detector._detect_die_cut(
        EdgeDetectionPayload(
            asset=asset,
            mode="en_su_forma",
            cut_direction="outside",
            dpi=300,
            bleed_mm=2.5,
            target_width_cm=5.0,
            target_height_cm=5.0,
            fit_mode="contain_proportional",
        )
    )

    assert res.physical_width_cm == pytest.approx(5.0, abs=0.05)
    assert res.physical_height_cm == pytest.approx(5.0, abs=0.05)
    assert res.cut_width_cm == pytest.approx(5.0, abs=0.05)
    assert res.cut_height_cm == pytest.approx(5.0, abs=0.05)
    assert res.effective_px_per_mm > 15.0

    eps_text = detector.export_two_layer_eps(
        res.artwork_png_bytes,
        res.anchors,
        width_px=res.image_width,
        height_px=res.image_height,
        dpi=300,
        title="ORDER-5X5-CM",
        target_width_cm=5.0,
        target_height_cm=5.0,
        fit_mode="contain_proportional",
    ).decode("ascii")

    x0, y0, w_pt, h_pt = _extract_eps_hires_bbox(eps_text)
    assert x0 == pytest.approx(0.0, abs=1e-3)
    assert y0 == pytest.approx(0.0, abs=1e-3)
    # 5.0 cm * (72 / 2.54) = 141.732 pt (±0.5 pt)
    assert w_pt == pytest.approx(141.73, abs=0.5)
    assert h_pt == pytest.approx(141.73, abs=0.5)

    # Layer 2 CutContour itself must span ~141.73 x 141.73 pt (scaled from CutContour bbox, not canvas!)
    _, _, cut_w_pt, cut_h_pt = _extract_eps_cut_contour_bounds_pt(eps_text)
    assert cut_w_pt == pytest.approx(141.73, abs=1.5)
    assert cut_h_pt == pytest.approx(141.73, abs=1.5)

    # Verify SVG physical dimensions in cm
    svg_text = detector.export_two_layer_svg(
        res.artwork_png_bytes,
        res.anchors,
        width_px=res.image_width,
        height_px=res.image_height,
        dpi=300,
        target_width_cm=5.0,
        target_height_cm=5.0,
        fit_mode="contain_proportional",
    ).decode("utf-8")
    assert 'width="5.00cm" height="5.00cm"' in svg_text


def test_eps_export_5x7cm_order_with_vertical_image_auto_orients_to_141_73x198_43pt():
    """
    A 5x7 cm order with a vertical artwork design (height > width) MUST auto-orient the longer
    side of the order (7 cm -> 198.43 pt) with the vertical height of the artwork and the shorter
    side (5 cm -> 141.73 pt) with the width, preserving aspect ratio without distortion.
    """
    import re
    import pytest

    # Vertical canvas (500x760 px) with a vertical capsule/badge graphic (300x490 px -> ratio ~5:7.8)
    img = Image.new("RGBA", (500, 760), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((100, 135, 400, 625), radius=80, fill=(220, 45, 95, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    detector = DieCutEdgeDetectorService()
    asset = ImageAsset(
        order_id="ord-5x7",
        content=buf.getvalue(),
        content_type="image/png",
        filename="vertical_badge.png",
    )

    # Even if dimensions="5x7 cm" parses as width=7.0, height=5.0 (Alto=5 x Ancho=7),
    # auto-orientation must align vertical design -> 5.0 cm width x 7.0 cm height!
    res = detector._detect_die_cut(
        EdgeDetectionPayload(
            asset=asset,
            mode="en_su_forma",
            cut_direction="outside",
            dpi=300,
            bleed_mm=2.0,
            target_width_cm=7.0,
            target_height_cm=5.0,
            fit_mode="contain_proportional",
        )
    )

    assert res.physical_width_cm == pytest.approx(5.0, abs=0.05)
    assert res.physical_height_cm == pytest.approx(7.0, abs=0.05)

    eps_text = detector.export_two_layer_eps(
        res.artwork_png_bytes,
        res.anchors,
        width_px=res.image_width,
        height_px=res.image_height,
        dpi=300,
        title="ORDER-5X7-VERTICAL",
        target_width_cm=7.0,
        target_height_cm=5.0,
        fit_mode="contain_proportional",
    ).decode("ascii")

    _, _, w_pt, h_pt = _extract_eps_hires_bbox(eps_text)
    assert w_pt == pytest.approx(141.73, abs=0.5)
    assert h_pt == pytest.approx(198.43, abs=0.5)

    # Verify proportional scaling (scale_x == scale_y in AI7 XI matrix -> zero distortion!)
    m = re.search(r"\[\s*([0-9.]+)\s+0\s+0\s+([0-9.]+)\s+([-0-9.]+)\s+([-0-9.]+)\s*\]", eps_text)
    assert m is not None
    scale_x = float(m.group(1))
    scale_y = float(m.group(2))
    assert scale_x == pytest.approx(scale_y, rel=1e-5)


def test_opaque_black_background_en_su_forma_segments_subject_and_never_traces_canvas_rectangle():
    """
    An image with a solid opaque black background (`alpha == 255` everywhere) in `en_su_forma` mode
    MUST automatically detect the uniform opaque perimeter, segment the central sticker graphic,
    clamp Bezier handles to <= 0.33 * segment_length, and NEVER trace the 4/8-node outer rectangle.
    """
    import math

    w, h = 260, 260
    img = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    draw = ImageDraw.Draw(img)
    # Multi-lobed organic sticker subject on solid black backdrop (central emblem + two side wings)
    draw.ellipse((75, 65, 185, 195), fill=(40, 195, 250, 255))
    draw.ellipse((45, 100, 105, 160), fill=(255, 180, 30, 255))
    draw.ellipse((155, 100, 215, 160), fill=(255, 180, 30, 255))
    # Detached companion star/dot island above main emblem to verify smooth bridge joining
    draw.ellipse((116, 28, 144, 54), fill=(255, 90, 120, 255))

    buf = io.BytesIO()
    img.save(buf, format="PNG")

    detector = DieCutEdgeDetectorService()
    asset = ImageAsset(
        order_id="blk-bg",
        content=buf.getvalue(),
        content_type="image/png",
        filename="black_backdrop_sticker.png",
    )

    # Note: remove_background=False by default — automatic perimeter opacity check (>90% alpha>=250) must trigger!
    res = detector._detect_die_cut(
        EdgeDetectionPayload(
            asset=asset,
            mode="en_su_forma",
            cut_direction="outside",
            dpi=300,
            bleed_mm=2.5,
            corner_roundness=1.0,
            join_islands=True,
        )
    )

    assert res.background_removed is True
    # Must trace the organic silhouette (> 8 nodes), NEVER a 4-node or 8-node outer rectangle
    assert len(res.anchors) > 8

    cut_x0, cut_y0, cut_w, cut_h = _anchors_bbox(res.anchors)
    # CutContour width & height must wrap the subject + bleed (< 225 px), strictly smaller than the full canvas
    assert cut_w < w - 20 and cut_h < h - 20

    # Verify strict handle clamping: every handle length <= 0.33 * adjacent segment length (+rounding epsilon)
    n = len(res.anchors)
    for i in range(n):
        prev_a = res.anchors[(i - 1) % n]
        curr_a = res.anchors[i]
        next_a = res.anchors[(i + 1) % n]

        d_prev = math.hypot(curr_a.x - prev_a.x, curr_a.y - prev_a.y)
        d_next = math.hypot(next_a.x - curr_a.x, next_a.y - curr_a.y)
        in_len = math.hypot(curr_a.in_x - curr_a.x, curr_a.in_y - curr_a.y)
        out_len = math.hypot(curr_a.out_x - curr_a.x, curr_a.out_y - curr_a.y)

        assert in_len <= d_prev * 0.33 + 0.05, (
            f"Anchor #{i} incoming handle ({in_len:.2f}) exceeded 0.33 * d_prev ({d_prev:.2f})"
        )
        assert out_len <= d_next * 0.33 + 0.05, (
            f"Anchor #{i} outgoing handle ({out_len:.2f}) exceeded 0.33 * d_next ({d_next:.2f})"
        )


def test_detect_edges_and_export_automatically_read_order_item_physical_size_cm(tmp_path, monkeypatch):
    """
    When `order_id` and `item_id` are sent to `/detect-edges` and `/die-cut/export` without explicit
    `target_width_cm` / `target_height_cm`, the endpoints MUST automatically read the physical
    dimensions of the `OrderItem` (`5x7 cm`) and export an `.EPS` with `%%HiResBoundingBox`
    matching ~141.73 x 198.43 pt.
    """
    from datetime import datetime, timedelta, timezone
    import pytest
    from sqlalchemy.orm import sessionmaker

    from app.db.database import build_engine
    from app.db.models import Customer, Material, Order, OrderItem, Shape
    from app.db.seed import init_db_and_seed
    from app.routers.image_processing import detect_die_cut_edges, export_die_cut_file
    from app.schemas.image_processing import DetectEdgesRequest, ExportDieCutRequest
    from app.services import storage_service as storage_mod

    db_file = tmp_path / "test_diecut_order_scale.db"
    engine = build_engine(f"sqlite:///{db_file.as_posix()}")
    init_db_and_seed(bind_engine=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

    uploads_dir = tmp_path / "uploads"
    monkeypatch.setattr(storage_mod, "LOCAL_UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(storage_mod.storage_service, "_should_use_firebase_bucket", lambda: False)

    # Vertical artwork (480x720 px) saved to local storage
    img = Image.new("RGBA", (480, 720), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((90, 110, 390, 610), radius=70, fill=(30, 140, 230, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw_bytes = buf.getvalue()

    rel_path = "orders/2026/11/vertical_order_item.png"
    full_file = uploads_dir / rel_path
    full_file.parent.mkdir(parents=True, exist_ok=True)
    full_file.write_bytes(raw_bytes)

    db = SessionLocal()
    try:
        mat = db.query(Material).filter(Material.name == "Vinilo Brillo").first()
        shape_rect = db.query(Shape).filter(Shape.name == "Rectangular").first()
        assert mat and shape_rect

        customer = Customer(referral_name="Cliente Escala", phone="+59171112233")
        db.add(customer)
        db.flush()

        order = Order(
            order_number="ST-2026-0777",
            customer_id=customer.id,
            material_id=mat.id,
            vinyl_gloss_mode="Corte uno a uno",
            shape_id=shape_rect.id,
            diameter_cm=None,
            dimensions="5x7 cm",
            size_display="5x7 cm",
            quantity=50,
            delivery_datetime=(datetime.now(timezone.utc) + timedelta(days=1)).replace(
                minute=0, second=0, microsecond=0
            ),
            status="En Diseño",
        )
        db.add(order)
        db.flush()

        item = OrderItem(
            order_id=order.id,
            position=1,
            material_id=mat.id,
            vinyl_gloss_mode="Corte uno a uno",
            shape_id=shape_rect.id,
            diameter_cm=None,
            dimensions="5x7 cm",
            size_display="5x7 cm",
            quantity=50,
            image_storage_path=rel_path,
            image_safe_filename="vertical_order_item.png",
            image_original_filename="vertical_order_item.png",
            image_content_type="image/png",
            image_size_bytes=len(raw_bytes),
        )
        db.add(item)
        db.commit()

        detect_res = _run_coro(
            detect_die_cut_edges(
                payload=DetectEdgesRequest(
                    order_id=str(order.id),
                    item_id=item.id,
                    mode="en_su_forma",
                    bleed_mm=2.0,
                ),
                db=db,
            )
        )
        assert detect_res.physical_width_cm == pytest.approx(5.0, abs=0.05)
        assert detect_res.physical_height_cm == pytest.approx(7.0, abs=0.05)
        assert detect_res.target_width_cm == pytest.approx(5.0, abs=0.05)
        assert detect_res.target_height_cm == pytest.approx(7.0, abs=0.05)

        admin_user = AuthenticatedUser(
            uid="admin-uid", email="admin@siete.studio", role="admin", email_verified=True
        )
        export_res = _run_coro(
            export_die_cut_file(
                payload=ExportDieCutRequest(
                    order_id=str(order.id),
                    item_id=item.id,
                    artwork_data_url=detect_res.artwork_data_url,
                    image_width=detect_res.image_width,
                    image_height=detect_res.image_height,
                    dpi=300,
                    anchors=detect_res.anchors,
                    export_format="eps",
                ),
                current_user=admin_user,
                db=db,
            )
        )
        _, _, w_pt, h_pt = _extract_eps_hires_bbox(export_res.body.decode("ascii"))
        assert w_pt == pytest.approx(141.73, abs=0.5)
        assert h_pt == pytest.approx(198.43, abs=0.5)
    finally:
        db.close()
        engine.dispose()


def test_resolve_physical_size_cm_and_prepress_for_height_only_and_width_only_orders(
    tmp_path, monkeypatch
):
    """
    Verify proportional physical calculation (`resolve_physical_size_cm`), effective DPI preflight
    in `enhancer.py`, and die-cut detection / `.EPS` export in `edge_detector.py` for orders with
    `size_mode="height_only"` ("solo Alto") and `size_mode="width_only"` ("solo Ancho").
    """
    from datetime import datetime, timedelta, timezone
    import pytest
    from sqlalchemy.orm import sessionmaker

    from app.db.database import build_engine
    from app.db.models import Customer, Material, Order, OrderItem, Shape
    from app.db.seed import init_db_and_seed
    from app.modules.image_processing.edge_detector import PT_PER_CM, resolve_physical_size_cm
    from app.modules.image_processing.enhancer import compute_effective_dpi_for_item
    from app.routers.image_processing import (
        detect_die_cut_edges,
        enhance_order_image,
        export_die_cut_file,
    )
    from app.schemas.image_processing import (
        DetectEdgesRequest,
        EnhanceImageRequest,
        ExportDieCutRequest,
    )
    from app.services import storage_service as storage_mod

    # 1. Direct unit checks on resolve_physical_size_cm & compute_effective_dpi_for_item
    # height_only = 8 cm on a 1200x1600 px vertical image (aspect 3:4) -> width_cm = 6.0, height_cm = 8.0
    size_h_only = resolve_physical_size_cm(
        {"size_mode": "height_only", "height_cm": 8.0, "dimensions": "Alto 8 cm"},
        1200,
        1600,
    )
    assert size_h_only == (6.0, 8.0)
    eff_dpi_h, status_h = compute_effective_dpi_for_item(
        {"size_mode": "height_only", "height_cm": 8.0, "dimensions": "Alto 8 cm"},
        1200,
        1600,
    )
    # 1600 px / (8.0 / 2.54 in) = 508.0 DPI -> "ok"
    assert eff_dpi_h == pytest.approx(508.0, abs=0.2)
    assert status_h == "ok"

    # width_only = 10 cm on a 1000x500 px horizontal image (aspect 2:1) -> width_cm = 10.0, height_cm = 5.0
    size_w_only = resolve_physical_size_cm(
        {"size_mode": "width_only", "width_cm": 10.0, "dimensions": "Ancho 10 cm"},
        1000,
        500,
    )
    assert size_w_only == (10.0, 5.0)
    eff_dpi_w, status_w = compute_effective_dpi_for_item(
        {"size_mode": "width_only", "width_cm": 10.0, "dimensions": "Ancho 10 cm"},
        1000,
        500,
    )
    # 1000 px / (10.0 / 2.54 in) = 254.0 DPI -> "warning"
    assert eff_dpi_w == pytest.approx(254.0, abs=0.2)
    assert status_w == "warning"

    # 2. End-to-end DB + Prepress integration for height_only (Item #1) and width_only (Item #2)
    db_file = tmp_path / "test_proportional_size_modes.db"
    engine = build_engine(f"sqlite:///{db_file.as_posix()}")
    init_db_and_seed(bind_engine=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

    uploads_dir = tmp_path / "uploads"
    monkeypatch.setattr(storage_mod, "LOCAL_UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(storage_mod.storage_service, "_should_use_firebase_bucket", lambda: False)

    # Item 1 artwork: 600x400 px opaque badge (3:2 horizontal aspect ratio) for "Alto 8 cm" -> 12x8 cm
    img1 = Image.new("RGBA", (600, 400), (25, 130, 210, 255))
    buf1 = io.BytesIO()
    img1.save(buf1, format="PNG")
    raw_bytes1 = buf1.getvalue()
    rel_path1 = "orders/2026/11/item1_height_only.png"
    full_file1 = uploads_dir / rel_path1
    full_file1.parent.mkdir(parents=True, exist_ok=True)
    full_file1.write_bytes(raw_bytes1)

    # Item 2 artwork: 400x800 px opaque badge (1:2 vertical aspect ratio) for "Ancho 6.5 cm" -> 6.5x13 cm
    img2 = Image.new("RGBA", (400, 800), (220, 60, 90, 255))
    buf2 = io.BytesIO()
    img2.save(buf2, format="PNG")
    raw_bytes2 = buf2.getvalue()
    rel_path2 = "orders/2026/11/item2_width_only.png"
    full_file2 = uploads_dir / rel_path2
    full_file2.write_bytes(raw_bytes2)

    db = SessionLocal()
    try:
        mat = db.query(Material).filter(Material.name == "Vinilo Mate").first()
        shape_rect = db.query(Shape).filter(Shape.name == "Rectangular").first()
        assert mat and shape_rect

        customer = Customer(referral_name="Cliente Proporcional", phone="+59172223344")
        db.add(customer)
        db.flush()

        order = Order(
            order_number="ST-2026-0888",
            customer_id=customer.id,
            material_id=mat.id,
            vinyl_gloss_mode=None,
            shape_id=shape_rect.id,
            diameter_cm=None,
            size_mode="height_only",
            height_cm=8.0,
            width_cm=None,
            dimensions="Alto 8 cm",
            size_display="Alto 8 cm (prop.)",
            quantity=80,
            delivery_datetime=(datetime.now(timezone.utc) + timedelta(days=1)).replace(
                minute=0, second=0, microsecond=0
            ),
            status="En Diseño",
        )
        db.add(order)
        db.flush()

        item_h = OrderItem(
            order_id=order.id,
            position=1,
            material_id=mat.id,
            vinyl_gloss_mode=None,
            shape_id=shape_rect.id,
            diameter_cm=None,
            size_mode="height_only",
            height_cm=8.0,
            width_cm=None,
            dimensions="Alto 8 cm",
            size_display="Alto 8 cm (prop.)",
            quantity=40,
            image_storage_path=rel_path1,
            image_safe_filename="item1_height_only.png",
            image_original_filename="item1_height_only.png",
            image_content_type="image/png",
            image_size_bytes=len(raw_bytes1),
        )
        item_w = OrderItem(
            order_id=order.id,
            position=2,
            material_id=mat.id,
            vinyl_gloss_mode=None,
            shape_id=shape_rect.id,
            diameter_cm=None,
            size_mode="width_only",
            height_cm=None,
            width_cm=6.5,
            dimensions="Ancho 6.5 cm",
            size_display="Ancho 6.5 cm (prop.)",
            quantity=40,
            image_storage_path=rel_path2,
            image_safe_filename="item2_width_only.png",
            image_original_filename="item2_width_only.png",
            image_content_type="image/png",
            image_size_bytes=len(raw_bytes2),
        )
        db.add_all([item_h, item_w])
        db.commit()

        # Verify enhance_order_image calculates proportional physical size & effective DPI for height_only
        enh_h = _run_coro(
            enhance_order_image(
                payload=EnhanceImageRequest(order_id=str(order.id), item_id=item_h.id),
                db=db,
            )
        )
        assert enh_h.physical_width_cm == pytest.approx(12.0, abs=0.05)
        assert enh_h.physical_height_cm == pytest.approx(8.0, abs=0.05)
        assert enh_h.effective_dpi == pytest.approx(127.0, abs=0.5)
        assert enh_h.dpi_status == "critical"

        # Verify detect_die_cut_edges + export_die_cut_file for height_only ("Alto 8 cm", 600x400 -> ~12x8 cm)
        det_h = _run_coro(
            detect_die_cut_edges(
                payload=DetectEdgesRequest(
                    order_id=str(order.id),
                    item_id=item_h.id,
                    mode="en_su_forma",
                    bleed_mm=0.0,
                ),
                db=db,
            )
        )
        assert det_h.physical_height_cm == pytest.approx(8.0, abs=0.05)
        assert det_h.physical_width_cm == pytest.approx(12.0, abs=0.25)

        admin_user = AuthenticatedUser(
            uid="admin-uid", email="admin@siete.studio", role="admin", email_verified=True
        )
        exp_h = _run_coro(
            export_die_cut_file(
                payload=ExportDieCutRequest(
                    order_id=str(order.id),
                    item_id=item_h.id,
                    artwork_data_url=det_h.artwork_data_url,
                    image_width=det_h.image_width,
                    image_height=det_h.image_height,
                    dpi=300,
                    anchors=det_h.anchors,
                    export_format="eps",
                ),
                current_user=admin_user,
                db=db,
            )
        )
        _, _, w_pt_h, h_pt_h = _extract_eps_hires_bbox(exp_h.body.decode("ascii"))
        assert h_pt_h == pytest.approx(8.0 * PT_PER_CM, abs=0.8)
        assert w_pt_h == pytest.approx(det_h.physical_width_cm * PT_PER_CM, abs=1.0)

        # Verify detect_die_cut_edges + export_die_cut_file for width_only ("Ancho 6.5 cm", 400x800 -> ~6.5x13 cm)
        det_w = _run_coro(
            detect_die_cut_edges(
                payload=DetectEdgesRequest(
                    order_id=str(order.id),
                    item_id=item_w.id,
                    mode="en_su_forma",
                    bleed_mm=0.0,
                ),
                db=db,
            )
        )
        assert det_w.physical_width_cm == pytest.approx(6.5, abs=0.05)
        assert det_w.physical_height_cm == pytest.approx(13.0, abs=0.25)

        exp_w = _run_coro(
            export_die_cut_file(
                payload=ExportDieCutRequest(
                    order_id=str(order.id),
                    item_id=item_w.id,
                    artwork_data_url=det_w.artwork_data_url,
                    image_width=det_w.image_width,
                    image_height=det_w.image_height,
                    dpi=300,
                    anchors=det_w.anchors,
                    export_format="eps",
                ),
                current_user=admin_user,
                db=db,
            )
        )
        _, _, w_pt_w, h_pt_w = _extract_eps_hires_bbox(exp_w.body.decode("ascii"))
        assert w_pt_w == pytest.approx(6.5 * PT_PER_CM, abs=0.8)
        assert h_pt_w == pytest.approx(det_w.physical_height_cm * PT_PER_CM, abs=1.0)
    finally:
        db.close()
        engine.dispose()


def _extract_eps_layer2_cutcontour_coords(eps_text: str) -> list[tuple[float, float]]:
    """Parse all (x, y) coordinates from `m` and `c` commands in Layer 2 (`(Capa 2 - CutContour) Ln`)."""
    layer2_part = eps_text.split("(Capa 2 - CutContour) Ln", 1)[1].split("%AI5_EndLayer", 1)[0]
    coords: list[tuple[float, float]] = []
    for raw_line in layer2_part.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        tokens = line.split()
        if len(tokens) == 3 and tokens[2] in ("m", "L", "l"):
            coords.append((float(tokens[0]), float(tokens[1])))
        elif len(tokens) == 7 and tokens[6] in ("c", "C"):
            coords.append((float(tokens[0]), float(tokens[1])))
            coords.append((float(tokens[2]), float(tokens[3])))
            coords.append((float(tokens[4]), float(tokens[5])))
    return coords


def test_enhanced_storage_path_is_always_prioritized_and_cutcontour_stays_100pct_inside_bbox(
    tmp_path, monkeypatch
):
    """
    Verify Parte A:
    1. If an OrderItem has `enhanced_storage_path`, `resolve_item_artwork_bytes`, `detect-edges`,
       and `die-cut/export` (even without `artwork_data_url`) ALWAYS load the enhanced image and
       NEVER fall back to the unenhanced `image_storage_path`.
    2. Layer 1 (CMYK raster) and Layer 2 (`CutContour`) share the exact same physical frame and
       100% of `CutContour` coordinates (`m` and `c`) lie within `%%HiResBoundingBox`.
    """
    from datetime import datetime, timedelta, timezone
    import numpy as np
    import pytest
    from sqlalchemy.orm import sessionmaker

    from app.core.security import AuthenticatedUser
    from app.db.database import build_engine
    from app.db.models import Customer, Material, Order, OrderItem, Shape
    from app.db.seed import init_db_and_seed
    from app.modules.image_processing.edge_detector import PT_PER_CM
    from app.routers.image_processing import (
        detect_die_cut_edges,
        export_die_cut_file,
        resolve_item_artwork_bytes,
    )
    from app.schemas.image_processing import DetectEdgesRequest, ExportDieCutRequest
    from app.services import storage_service as storage_mod

    db_file = tmp_path / "test_enhanced_priority.db"
    engine = build_engine(f"sqlite:///{db_file.as_posix()}")
    init_db_and_seed(bind_engine=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

    uploads_dir = tmp_path / "uploads"
    monkeypatch.setattr(storage_mod, "LOCAL_UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(storage_mod.storage_service, "_should_use_firebase_bucket", lambda: False)

    # Original image: pure crimson RED circle (240, 15, 25) on transparent background (200x200)
    orig_img = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    draw_orig = ImageDraw.Draw(orig_img)
    draw_orig.ellipse((30, 30, 170, 170), fill=(240, 15, 25, 255))
    orig_buf = io.BytesIO()
    orig_img.save(orig_buf, format="PNG")
    orig_bytes = orig_buf.getvalue()
    orig_rel = "orders/2026/11/orig_crimson.png"
    (uploads_dir / orig_rel).parent.mkdir(parents=True, exist_ok=True)
    (uploads_dir / orig_rel).write_bytes(orig_bytes)

    # Enhanced image: high-res vivid EMERALD GREEN circle (0, 210, 75) on transparent background (360x360)
    enh_img = Image.new("RGBA", (360, 360), (0, 0, 0, 0))
    draw_enh = ImageDraw.Draw(enh_img)
    draw_enh.ellipse((45, 45, 315, 315), fill=(0, 210, 75, 255))
    enh_buf = io.BytesIO()
    enh_img.save(enh_buf, format="PNG")
    enh_bytes = enh_buf.getvalue()
    enh_rel = "orders/2026/11/enh_emerald.png"
    (uploads_dir / enh_rel).write_bytes(enh_bytes)

    db = SessionLocal()
    try:
        mat = db.query(Material).filter(Material.name == "Vinilo Brillo").first()
        shape_cut = db.query(Shape).filter(Shape.name == "En su forma").first()
        assert mat and shape_cut

        customer = Customer(referral_name="Cliente Fidelidad", phone="+59170099887")
        db.add(customer)
        db.flush()

        order = Order(
            order_number="ST-2026-0910",
            customer_id=customer.id,
            material_id=mat.id,
            vinyl_gloss_mode="Corte uno a uno",
            shape_id=shape_cut.id,
            dimensions="6x6 cm",
            size_display="6x6 cm",
            quantity=50,
            delivery_datetime=(datetime.now(timezone.utc) + timedelta(days=1)).replace(
                minute=0, second=0, microsecond=0
            ),
            status="En Diseño",
        )
        db.add(order)
        db.flush()

        item = OrderItem(
            order_id=order.id,
            position=1,
            material_id=mat.id,
            vinyl_gloss_mode="Corte uno a uno",
            shape_id=shape_cut.id,
            size_mode="both",
            width_cm=6.0,
            height_cm=6.0,
            dimensions="6x6 cm",
            size_display="6x6 cm",
            quantity=50,
            image_storage_path=orig_rel,
            enhanced_storage_path=enh_rel,
            image_safe_filename="sticker.png",
            image_original_filename="sticker.png",
            image_content_type="image/png",
            image_size_bytes=len(orig_bytes),
        )
        db.add(item)
        db.commit()

        # 1. Unified helper MUST return enhanced_storage_path bytes
        resolved_bytes = resolve_item_artwork_bytes(item)
        assert resolved_bytes == enh_bytes
        assert resolved_bytes != orig_bytes

        # 2. detect_die_cut_edges MUST use enhanced image and save die_cut_config_json
        det_res = _run_coro(
            detect_die_cut_edges(
                payload=DetectEdgesRequest(
                    order_id=str(order.id),
                    item_id=item.id,
                    mode="en_su_forma",
                    bleed_mm=2.0,
                    white_border_mm=2.0,
                ),
                db=db,
            )
        )
        db.refresh(item)
        assert item.die_cut_config_json is not None

        # 3. Export WITHOUT artwork_data_url -> must load enhanced_storage_path, compose white border,
        #    and keep 100% of CutContour coordinates inside %%HiResBoundingBox
        admin_user = AuthenticatedUser(
            uid="admin-uid", email="admin@siete.studio", role="admin", email_verified=True
        )
        exp_res = _run_coro(
            export_die_cut_file(
                payload=ExportDieCutRequest(
                    order_id=str(order.id),
                    item_id=item.id,
                    artwork_data_url=None,
                    image_width=det_res.image_width,
                    image_height=det_res.image_height,
                    dpi=300,
                    anchors=det_res.anchors,
                    export_format="eps",
                ),
                current_user=admin_user,
                db=db,
            )
        )
        eps_text = exp_res.body.decode("ascii")
        x0_pt, y0_pt, w_pt, h_pt = _extract_eps_hires_bbox(eps_text)
        assert x0_pt == pytest.approx(0.0, abs=1e-3)
        assert y0_pt == pytest.approx(0.0, abs=1e-3)
        assert w_pt == pytest.approx(6.0 * PT_PER_CM, abs=0.5)
        assert h_pt == pytest.approx(6.0 * PT_PER_CM, abs=0.5)

        # Verify 100% of CutContour coordinates lie inside [0, w_pt] x [0, h_pt]
        cut_coords = _extract_eps_layer2_cutcontour_coords(eps_text)
        assert len(cut_coords) >= 12
        for cx_pt, cy_pt in cut_coords:
            assert 0.0 <= cx_pt <= w_pt + 1e-3, f"CutContour X={cx_pt} outside [0, {w_pt}]"
            assert 0.0 <= cy_pt <= h_pt + 1e-3, f"CutContour Y={cy_pt} outside [0, {h_pt}]"

        # Verify CutContour spans the full physical target bbox (1:1 alignment with Layer 1)
        xs = [c[0] for c in cut_coords]
        ys = [c[1] for c in cut_coords]
        assert (max(xs) - min(xs)) == pytest.approx(w_pt, abs=2.5)
        assert (max(ys) - min(ys)) == pytest.approx(h_pt, abs=2.5)

        # Verify the embedded CMYK pixels come from the EMERALD GREEN enhanced image (high C & Y, low M),
        # NOT the crimson red original (which would have high M & Y, near-zero C)
        xi_header = eps_text.split("%AI5_BeginRaster\n", 1)[1].splitlines()[0]
        xi_tokens = xi_header.split("]")[-1].split()
        rast_w = int(xi_tokens[2])
        rast_h = int(xi_tokens[3])
        raster_body = eps_text.split(" 8 4 0 0 0 0 XI\n", 1)[1].split("\n%AI5_EndRaster", 1)[0]
        hex_digits = "".join(line[1:] for line in raster_body.splitlines())
        cmyk = np.frombuffer(bytes.fromhex(hex_digits), dtype=np.uint8).reshape((rast_h, rast_w, 4))
        center_cmyk = tuple(int(v) for v in cmyk[rast_h // 2, rast_w // 2])
        # Emerald green in CMYK has high Cyan (>140) and high Yellow (>140), low Magenta (<30)
        assert center_cmyk[0] >= 140 and center_cmyk[2] >= 140 and center_cmyk[1] <= 30, (
            f"Expected enhanced emerald-green CMYK at center, got {center_cmyk}"
        )
    finally:
        db.close()
        engine.dispose()


def test_export_order_production_multi_design_same_sheet_and_roll_separate_artboards(
    tmp_path, monkeypatch
):
    """
    Verify Parte B (`POST /api/v1/image-processing/orders/{order_id}/export-production`):
    1. Non-roll multi-design order (`Corte uno a uno` / `Vinilo Mate`):
       Exports ALL designs into 1 single `.EPS` on the SAME sheet (`X-Production-Layout: same_sheet`)
       without overlap (`gap_cm=0.5`, `margin_cm=1.0`), each at its exact physical measurement,
       and with 100% of `CutContour` coordinates inside `%%HiResBoundingBox`.
    2. `En rollo` multi-design order:
       - Default (`format="auto"` / `"pdf"`): exports 1 single multi-page vector `.PDF`
         (`X-Production-Layout: separate_artboards`) with `/Count 2` and `/Type /Page` per design,
         each sized to that design (+ margin), with Layer 1 and Layer 2 (`0.000 1.000 0.000 0.000 K`).
       - Explicit `format="eps"`: exports 1 single `.EPS` (`X-Production-Layout: separate_artboards`)
         placing each design in a separate artboard frame delimited by 3.0 cm (`roll_artboard_gap_cm=3.0`)
         with reference labels outside the `CutContour`.
    """
    from datetime import datetime, timedelta, timezone
    import pytest
    from sqlalchemy.orm import sessionmaker

    from app.core.security import AuthenticatedUser
    from app.db.database import build_engine
    from app.db.models import Customer, Material, Order, OrderItem, Shape
    from app.db.seed import init_db_and_seed
    from app.modules.image_processing.edge_detector import PT_PER_CM
    from app.routers.image_processing import (
        detect_die_cut_edges,
        export_order_production,
    )
    from app.schemas.image_processing import DetectEdgesRequest, ExportProductionRequest
    from app.services import storage_service as storage_mod

    db_file = tmp_path / "test_export_production.db"
    engine = build_engine(f"sqlite:///{db_file.as_posix()}")
    init_db_and_seed(bind_engine=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

    uploads_dir = tmp_path / "uploads"
    monkeypatch.setattr(storage_mod, "LOCAL_UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(storage_mod.storage_service, "_should_use_firebase_bucket", lambda: False)

    # Create two distinct enhanced sticker PNGs
    img_a = Image.new("RGBA", (240, 240), (0, 0, 0, 0))
    ImageDraw.Draw(img_a).ellipse((25, 25, 215, 215), fill=(20, 120, 230, 255))
    buf_a = io.BytesIO()
    img_a.save(buf_a, format="PNG")
    rel_a = "orders/2026/11/prod_a_enh.png"
    (uploads_dir / rel_a).parent.mkdir(parents=True, exist_ok=True)
    (uploads_dir / rel_a).write_bytes(buf_a.getvalue())

    img_b = Image.new("RGBA", (240, 320), (0, 0, 0, 0))
    ImageDraw.Draw(img_b).rounded_rectangle((30, 30, 210, 290), radius=35, fill=(235, 140, 20, 255))
    buf_b = io.BytesIO()
    img_b.save(buf_b, format="PNG")
    rel_b = "orders/2026/11/prod_b_enh.png"
    (uploads_dir / rel_b).write_bytes(buf_b.getvalue())

    db = SessionLocal()
    try:
        mat_gloss = db.query(Material).filter(Material.name == "Vinilo Brillo").first()
        shape_cut = db.query(Shape).filter(Shape.name == "En su forma").first()
        assert mat_gloss and shape_cut

        customer = Customer(referral_name="Cliente Produccion", phone="+59175544332")
        db.add(customer)
        db.flush()

        # ---------------------------------------------------------------------
        # CASE 1: Non-roll order ("Corte uno a uno") with 2 designs: 5x5 cm and 6x8 cm
        # ---------------------------------------------------------------------
        order_sheet = Order(
            order_number="ST-2026-0950",
            customer_id=customer.id,
            material_id=mat_gloss.id,
            vinyl_gloss_mode="Corte uno a uno",
            shape_id=shape_cut.id,
            dimensions="5x5 cm",
            size_display="5x5 cm",
            quantity=100,
            delivery_datetime=(datetime.now(timezone.utc) + timedelta(days=1)).replace(
                minute=0, second=0, microsecond=0
            ),
            status="En Diseño",
        )
        db.add(order_sheet)
        db.flush()

        item_s1 = OrderItem(
            order_id=order_sheet.id,
            position=1,
            material_id=mat_gloss.id,
            vinyl_gloss_mode="Corte uno a uno",
            shape_id=shape_cut.id,
            size_mode="both",
            width_cm=5.0,
            height_cm=5.0,
            dimensions="5x5 cm",
            size_display="5x5 cm",
            quantity=50,
            image_storage_path=rel_a,
            enhanced_storage_path=rel_a,
            image_safe_filename="design1.png",
            image_original_filename="design1.png",
            image_content_type="image/png",
            image_size_bytes=len(buf_a.getvalue()),
        )
        item_s2 = OrderItem(
            order_id=order_sheet.id,
            position=2,
            material_id=mat_gloss.id,
            vinyl_gloss_mode="Corte uno a uno",
            shape_id=shape_cut.id,
            size_mode="both",
            width_cm=6.0,
            height_cm=8.0,
            dimensions="6x8 cm",
            size_display="6x8 cm",
            quantity=50,
            image_storage_path=rel_b,
            enhanced_storage_path=rel_b,
            image_safe_filename="design2.png",
            image_original_filename="design2.png",
            image_content_type="image/png",
            image_size_bytes=len(buf_b.getvalue()),
        )
        db.add_all([item_s1, item_s2])
        db.commit()

        # Pre-detect item 1 so it has saved anchors + config in DB
        _run_coro(
            detect_die_cut_edges(
                payload=DetectEdgesRequest(
                    order_id=str(order_sheet.id),
                    item_id=item_s1.id,
                    mode="en_su_forma",
                    bleed_mm=2.0,
                ),
                db=db,
            )
        )

        admin_user = AuthenticatedUser(
            uid="admin-uid", email="admin@siete.studio", role="admin", email_verified=True
        )
        res_sheet = _run_coro(
            export_order_production(
                order_id=str(order_sheet.id),
                payload=ExportProductionRequest(format="auto", margin_cm=1.0, gap_cm=0.5),
                format=None,
                current_user=admin_user,
                db=db,
            )
        )
        assert res_sheet.media_type == "application/postscript"
        assert res_sheet.headers["X-Production-Layout"] == "same_sheet"
        assert res_sheet.headers["X-Designs-Count"] == "2"

        eps_sheet_text = res_sheet.body.decode("ascii")
        assert "%SIETE_LayoutMode: same_sheet" in eps_sheet_text
        assert "%SIETE_DesignsCount: 2" in eps_sheet_text
        assert eps_sheet_text.count("%AI5_BeginRaster") == 2

        # Sheet dimensions: margin=1.0cm, design1=5x5cm, gap=0.5cm, design2=6x8cm -> total_w = 1+5+0.5+6+1 = 13.5cm, total_h = 1+8+1 = 10.0cm
        _, _, sheet_w_pt, sheet_h_pt = _extract_eps_hires_bbox(eps_sheet_text)
        assert sheet_w_pt == pytest.approx(13.5 * PT_PER_CM, abs=0.8)
        assert sheet_h_pt == pytest.approx(10.0 * PT_PER_CM, abs=0.8)

        # Verify all CutContour coordinates lie 100% inside the sheet bbox and the 2 designs do not overlap horizontally
        sheet_coords = _extract_eps_layer2_cutcontour_coords(eps_sheet_text)
        assert len(sheet_coords) >= 24
        for cx_pt, cy_pt in sheet_coords:
            assert 0.0 <= cx_pt <= sheet_w_pt + 1e-3
            assert 0.0 <= cy_pt <= sheet_h_pt + 1e-3

        # Split Layer 2 strokes ("s") for Design 1 and Design 2 and confirm zero horizontal overlap (>= 0.5 cm gap)
        layer2_strokes = (
            eps_sheet_text.split("(Capa 2 - CutContour) Ln", 1)[1]
            .split("%AI5_EndLayer", 1)[0]
            .split("\ns\n")
        )
        d1_xs = [
            float(tok[0])
            for line in layer2_strokes[0].splitlines()
            if (tok := line.strip().split()) and len(tok) in (3, 7) and tok[-1] in ("m", "c")
        ]
        d2_xs = [
            float(tok[0])
            for line in layer2_strokes[1].splitlines()
            if (tok := line.strip().split()) and len(tok) in (3, 7) and tok[-1] in ("m", "c")
        ]
        assert max(d1_xs) + (0.5 * PT_PER_CM - 1.5) <= min(d2_xs), (
            f"Expected >=0.5cm gap between Design 1 (max_x={max(d1_xs)}) and Design 2 (min_x={min(d2_xs)})"
        )

        # ---------------------------------------------------------------------
        # CASE 2: "En rollo" order with 2 designs -> separate_artboards (.PDF default & .EPS frames)
        # ---------------------------------------------------------------------
        order_roll = Order(
            order_number="ST-2026-0951",
            customer_id=customer.id,
            material_id=mat_gloss.id,
            vinyl_gloss_mode="En rollo",
            shape_id=shape_cut.id,
            dimensions="5x5 cm",
            size_display="5x5 cm",
            quantity=100,
            delivery_datetime=(datetime.now(timezone.utc) + timedelta(days=1)).replace(
                minute=0, second=0, microsecond=0
            ),
            status="En Diseño",
        )
        db.add(order_roll)
        db.flush()

        item_r1 = OrderItem(
            order_id=order_roll.id,
            position=1,
            material_id=mat_gloss.id,
            vinyl_gloss_mode="En rollo",
            shape_id=shape_cut.id,
            size_mode="both",
            width_cm=5.0,
            height_cm=5.0,
            dimensions="5x5 cm",
            size_display="5x5 cm",
            quantity=50,
            image_storage_path=rel_a,
            enhanced_storage_path=rel_a,
            image_safe_filename="roll1.png",
            image_original_filename="roll1.png",
            image_content_type="image/png",
            image_size_bytes=len(buf_a.getvalue()),
        )
        item_r2 = OrderItem(
            order_id=order_roll.id,
            position=2,
            material_id=mat_gloss.id,
            vinyl_gloss_mode="En rollo",
            shape_id=shape_cut.id,
            size_mode="both",
            width_cm=6.0,
            height_cm=8.0,
            dimensions="6x8 cm",
            size_display="6x8 cm",
            quantity=50,
            image_storage_path=rel_b,
            enhanced_storage_path=rel_b,
            image_safe_filename="roll2.png",
            image_original_filename="roll2.png",
            image_content_type="image/png",
            image_size_bytes=len(buf_b.getvalue()),
        )
        db.add_all([item_r1, item_r2])
        db.commit()

        # 2a. Default for "En rollo" -> multi-page vector .PDF (1 artboard page per design)
        res_roll_pdf = _run_coro(
            export_order_production(
                order_id=str(order_roll.id),
                payload=ExportProductionRequest(format="auto", margin_cm=1.0),
                format=None,
                current_user=admin_user,
                db=db,
            )
        )
        assert res_roll_pdf.media_type == "application/pdf"
        assert res_roll_pdf.headers["X-Production-Layout"] == "separate_artboards"
        assert res_roll_pdf.headers["X-Production-Mode"] == "En rollo"
        assert res_roll_pdf.headers["X-Designs-Count"] == "2"
        assert res_roll_pdf.body.startswith(b"%PDF-1.4")
        assert b"/Type /Pages" in res_roll_pdf.body and b"/Count 2" in res_roll_pdf.body
        assert res_roll_pdf.body.count(b"/Type /Page ") == 2
        assert b"/Name (Capa 1 - Diseno)" in res_roll_pdf.body
        assert b"/Name (Capa 2 - CutContour)" in res_roll_pdf.body
        assert b"0.000 1.000 0.000 0.000 K" in res_roll_pdf.body

        # 2b. Explicit format="eps" for "En rollo" -> single .EPS with separate artboard frames (3 cm gap)
        res_roll_eps = _run_coro(
            export_order_production(
                order_id=str(order_roll.id),
                payload=ExportProductionRequest(
                    format="eps", margin_cm=1.0, roll_artboard_gap_cm=3.0
                ),
                format="eps",
                current_user=admin_user,
                db=db,
            )
        )
        assert res_roll_eps.media_type == "application/postscript"
        assert res_roll_eps.headers["X-Production-Layout"] == "separate_artboards"
        eps_roll_text = res_roll_eps.body.decode("ascii")
        assert "%SIETE_LayoutMode: separate_artboards" in eps_roll_text
        assert "% --- Artboard Frame #01:" in eps_roll_text
        assert "% --- Artboard Frame #02:" in eps_roll_text
        # Total width with 2 frames (5+2=7cm and 6+2=8cm) + 3.0cm artboard gap = 18.0 cm
        _, _, roll_w_pt, _ = _extract_eps_hires_bbox(eps_roll_text)
        assert roll_w_pt == pytest.approx(18.0 * PT_PER_CM, abs=0.8)
    finally:
        db.close()
        engine.dispose()




