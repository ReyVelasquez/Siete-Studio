"""Secure uploaded file verification: magic-byte MIME check, SVG sanitization & UUID renaming."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

from fastapi import HTTPException, UploadFile, status

from app.core.config import get_settings

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"
RIFF_SIGNATURE = b"RIFF"
WEBP_SIGNATURE = b"WEBP"

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".svg"}

# Dangerous patterns disallowed inside uploaded SVG files (prevents stored XSS / XXE)
SVG_FORBIDDEN_PATTERNS = [
    re.compile(r"<\s*script\b", re.IGNORECASE),
    re.compile(r"<\s*foreignObject\b", re.IGNORECASE),
    re.compile(r"<\s*iframe\b", re.IGNORECASE),
    re.compile(r"<\s*object\b", re.IGNORECASE),
    re.compile(r"<\s*embed\b", re.IGNORECASE),
    re.compile(r"<!\s*ENTITY\b", re.IGNORECASE),
    re.compile(r"<!\s*DOCTYPE\b", re.IGNORECASE),
    re.compile(r"\bon[a-z]+\s*=", re.IGNORECASE),
    re.compile(r"javascript\s*:", re.IGNORECASE),
    re.compile(r"data\s*:\s*text/html", re.IGNORECASE),
]


@dataclass(frozen=True)
class ValidatedImageFile:
    """Result of strict server-side image validation."""

    content: bytes
    content_type: str
    extension: str
    size_bytes: int
    safe_filename: str
    storage_path: str
    original_sanitized_name: str


def sanitize_original_filename(filename: str | None) -> str:
    """Keep only safe ASCII characters for display metadata (never used as storage key)."""
    if not filename:
        return "sticker"
    base = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", base).strip("._")
    return (cleaned or "sticker")[:100]


def detect_real_image_type(data: bytes) -> tuple[str, str]:
    """
    Detect true image MIME type and canonical extension from raw file bytes.
    Never trusts client Content-Type headers or file extensions.
    """
    if len(data) < 12:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo está vacío o dañado.",
        )

    # 1. PNG
    if data.startswith(PNG_SIGNATURE):
        return "image/png", ".png"

    # 2. JPEG
    if data.startswith(JPEG_SIGNATURE):
        return "image/jpeg", ".jpg"

    # 3. WEBP (RIFF + 4-byte chunk size + WEBP)
    if data[:4] == RIFF_SIGNATURE and data[8:12] == WEBP_SIGNATURE:
        return "image/webp", ".webp"

    # 4. SVG (strict XML + security check)
    if _is_valid_safe_svg(data):
        return "image/svg+xml", ".svg"

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "Formato de imagen no permitido o archivo corrupto. "
            "Solo se aceptan PNG, JPG, WEBP o SVG válido."
        ),
    )


def _is_valid_safe_svg(data: bytes) -> bool:
    """Validate that payload is well-formed SVG XML free from scripts/XXE/event handlers."""
    try:
        text = data.decode("utf-8").strip()
    except UnicodeDecodeError:
        return False

    # Fast check for SVG tag presence
    lower_head = text[:512].lower()
    if "<svg" not in lower_head and not lower_head.startswith("<?xml"):
        return False

    # Reject dangerous XSS / XXE constructs BEFORE XML parsing
    for pattern in SVG_FORBIDDEN_PATTERNS:
        if pattern.search(text):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El archivo SVG contiene elementos no seguros (scripts, eventos o entidades XML).",
            )

    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return False

    # Root tag may include XML namespace e.g. {http://www.w3.org/2000/svg}svg
    local_tag = root.tag.split("}")[-1].lower()
    if local_tag != "svg":
        return False

    # Inspect every element attribute as defense-in-depth
    for elem in root.iter():
        tag_name = elem.tag.split("}")[-1].lower()
        if tag_name in {"script", "foreignobject", "iframe", "object", "embed"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El archivo SVG contiene etiquetas prohibidas por seguridad.",
            )
        for attr_key, attr_val in elem.attrib.items():
            attr_name = attr_key.split("}")[-1].lower()
            val_lower = (attr_val or "").strip().lower()
            if attr_name.startswith("on") or val_lower.startswith("javascript:"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El archivo SVG contiene atributos potencialmente peligrosos.",
                )

    return True


async def validate_and_prepare_image(upload: UploadFile) -> ValidatedImageFile:
    """
    Read uploaded file in bounded chunks, enforce max byte limit,
    verify magic bytes / SVG safety, and generate a UUID storage path.
    """
    settings = get_settings()
    max_bytes = settings.max_upload_size_bytes

    chunks: list[bytes] = []
    total_read = 0
    chunk_size = 64 * 1024  # 64 KB chunks

    while True:
        chunk = await upload.read(chunk_size)
        if not chunk:
            break
        total_read += len(chunk)
        if total_read > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"La imagen supera el límite máximo permitido de {settings.MAX_UPLOAD_SIZE_MB} MB.",
            )
        chunks.append(chunk)

    raw_bytes = b"".join(chunks)
    if not raw_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes adjuntar una imagen válida para el sticker.",
        )

    content_type, extension = detect_real_image_type(raw_bytes)

    now = datetime.now(timezone.utc)
    safe_filename = f"{uuid.uuid4().hex}{extension}"
    storage_path = f"orders/{now.year:04d}/{now.month:02d}/{safe_filename}"

    return ValidatedImageFile(
        content=raw_bytes,
        content_type=content_type,
        extension=extension,
        size_bytes=len(raw_bytes),
        safe_filename=safe_filename,
        storage_path=storage_path,
        original_sanitized_name=sanitize_original_filename(upload.filename),
    )
