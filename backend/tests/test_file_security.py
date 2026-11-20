"""Unit tests for binary magic-byte MIME verification and SVG XSS sanitization."""

import pytest
from fastapi import HTTPException

from app.core.file_security import detect_real_image_type


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
