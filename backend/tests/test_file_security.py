"""Unit tests for binary magic-byte MIME verification, extension/MIME cross-checks & allowlist SVG hardening."""

import asyncio
import io

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.core.file_security import detect_real_image_type, validate_and_prepare_image


def test_detect_png_signature():
    sample_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    mime, ext = detect_real_image_type(sample_png)
    assert mime == "image/png"
    assert ext == ".png"


def test_detect_jpeg_signature():
    sample_jpg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01"
    mime, ext = detect_real_image_type(sample_jpg)
    assert mime == "image/jpeg"
    assert ext == ".jpg"


def test_detect_webp_signature():
    sample_webp = b"RIFF\x24\x00\x00\x00WEBPVP8 "
    mime, ext = detect_real_image_type(sample_webp)
    assert mime == "image/webp"
    assert ext == ".webp"


def test_detect_safe_svg():
    safe_svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'
    mime, ext = detect_real_image_type(safe_svg)
    assert mime == "image/svg+xml"
    assert ext == ".svg"


def test_reject_malicious_svg_with_script():
    malicious_svg = (
        b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    )
    with pytest.raises(HTTPException) as exc_info:
        detect_real_image_type(malicious_svg)
    assert exc_info.value.status_code == 400


def test_reject_spoofed_executable_bytes():
    fake_png = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff"
    with pytest.raises(HTTPException) as exc_info:
        detect_real_image_type(fake_png)
    assert exc_info.value.status_code == 400


@pytest.mark.parametrize(
    "payload",
    [
        b'<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="x" values="1;2"/></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="href" to="javascript:alert(1)"/></svg>',
        b'<?xml-stylesheet type="text/xsl" href="https://evil.example/a.xsl"?><svg xmlns="http://www.w3.org/2000/svg"/>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><use href="vbscript:msgbox(1)"/></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/pixel.png"/></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><style>path { fill: url(https://evil.example/x.svg#a); }</style><path d="M0 0"/></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("http://evil.example/a.css");</style></svg>',
    ],
)
def test_allowlist_svg_blocks_dangerous_elements_schemes_and_external_urls(payload: bytes):
    with pytest.raises(HTTPException) as exc_info:
        detect_real_image_type(payload)
    assert exc_info.value.status_code == 400


def test_allowlist_svg_accepts_safe_internal_refs_and_inline_raster():
    safe_svg = (
        b'<?xml version="1.0" encoding="UTF-8"?>'
        b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        b'<defs><clipPath id="clip1"><circle cx="50" cy="50" r="40"/></clipPath></defs>'
        b'<g id="Capa_1" data-name="Capa 1">'
        b'<image x="0" y="0" width="100" height="100" href="data:image/png;base64,iVBORw0KGgo="/>'
        b'<path d="M10 10 L90 90 Z" fill="none" stroke="#EC008C" clip-path="url(#clip1)"/>'
        b"</g></svg>"
    )
    mime, ext = detect_real_image_type(safe_svg)
    assert mime == "image/svg+xml"
    assert ext == ".svg"


def _make_upload(filename: str, content: bytes, content_type: str) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(content),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


def test_validate_upload_enforces_extension_and_mime_cross_check():
    valid_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00"
    valid_jpg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00"

    # 1. Disallowed extension (.exe)
    with pytest.raises(HTTPException) as exc1:
        asyncio.run(validate_and_prepare_image(_make_upload("virus.exe", valid_png, "image/png")))
    assert exc1.value.status_code == 400

    # 2. Extension (.png) does not match magic bytes (JPEG)
    with pytest.raises(HTTPException) as exc2:
        asyncio.run(validate_and_prepare_image(_make_upload("spoof.png", valid_jpg, "image/jpeg")))
    assert exc2.value.status_code == 400

    # 3. Declared Content-Type (text/html) does not match real magic bytes (PNG)
    with pytest.raises(HTTPException) as exc3:
        asyncio.run(validate_and_prepare_image(_make_upload("logo.png", valid_png, "text/html")))
    assert exc3.value.status_code == 400

    # 4. Cumulative order budget exceeded -> 413
    with pytest.raises(HTTPException) as exc4:
        asyncio.run(
            validate_and_prepare_image(
                _make_upload("logo.png", valid_png, "image/png"),
                remaining_budget_bytes=8,
            )
        )
    assert exc4.value.status_code == 413

    # 5. Legitimate matching extension + MIME + magic bytes passes
    prepared = asyncio.run(validate_and_prepare_image(_make_upload("ok.png", valid_png, "image/png")))
    assert prepared.content_type == "image/png"
    assert prepared.extension == ".png"
