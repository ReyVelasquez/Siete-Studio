"""Secure uploaded file verification: extension + MIME cross-check, magic bytes & allowlist SVG hardening."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from xml.etree import ElementTree as ET

from fastapi import HTTPException, UploadFile, status

from app.core.config import get_settings

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"
RIFF_SIGNATURE = b"RIFF"
WEBP_SIGNATURE = b"WEBP"

ALLOWED_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".svg"})
MIME_TO_ALLOWED_EXTENSIONS: dict[str, frozenset[str]] = {
    "image/png": frozenset({".png"}),
    "image/jpeg": frozenset({".jpg", ".jpeg"}),
    "image/webp": frozenset({".webp"}),
    "image/svg+xml": frozenset({".svg"}),
}
MIME_ALIASES: dict[str, str] = {
    "image/jpg": "image/jpeg",
    "image/pjpeg": "image/jpeg",
}

# Strict allowlist of safe static vector SVG elements (blocks script, animate, set, foreignObject, iframe, a, etc.)
SVG_ALLOWED_TAGS = frozenset(
    {
        "svg",
        "g",
        "defs",
        "title",
        "desc",
        "metadata",
        "symbol",
        "use",
        "path",
        "circle",
        "ellipse",
        "rect",
        "line",
        "polyline",
        "polygon",
        "text",
        "tspan",
        "textpath",
        "lineargradient",
        "radialgradient",
        "stop",
        "clippath",
        "mask",
        "pattern",
        "filter",
        "fegaussianblur",
        "feoffset",
        "feblend",
        "fecolormatrix",
        "fecomposite",
        "feflood",
        "femerge",
        "femergenode",
        "fedropshadow",
        "style",
        "image",
    }
)

# Strict allowlist of safe SVG presentation / geometry attributes (lowercase local names)
SVG_ALLOWED_ATTRS = frozenset(
    {
        "id",
        "class",
        "style",
        "version",
        "baseprofile",
        "viewbox",
        "preserveaspectratio",
        "width",
        "height",
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "cx",
        "cy",
        "r",
        "rx",
        "ry",
        "fx",
        "fy",
        "fr",
        "d",
        "points",
        "transform",
        "fill",
        "fill-opacity",
        "fill-rule",
        "stroke",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-miterlimit",
        "stroke-dasharray",
        "stroke-dashoffset",
        "stroke-opacity",
        "opacity",
        "color",
        "display",
        "visibility",
        "overflow",
        "paint-order",
        "vector-effect",
        "shape-rendering",
        "image-rendering",
        "text-rendering",
        "color-interpolation",
        "color-interpolation-filters",
        "enable-background",
        "mix-blend-mode",
        "isolation",
        "stop-color",
        "stop-opacity",
        "offset",
        "gradientunits",
        "gradienttransform",
        "spreadmethod",
        "patternunits",
        "patterntransform",
        "patterncontentunits",
        "clip-path",
        "clip-rule",
        "clippathunits",
        "mask",
        "maskunits",
        "maskcontentunits",
        "filter",
        "filterunits",
        "primitiveunits",
        "stddeviation",
        "in",
        "in2",
        "result",
        "mode",
        "type",
        "values",
        "operator",
        "k1",
        "k2",
        "k3",
        "k4",
        "flood-color",
        "flood-opacity",
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "font-variant",
        "text-anchor",
        "dominant-baseline",
        "alignment-baseline",
        "letter-spacing",
        "word-spacing",
        "text-decoration",
        "dx",
        "dy",
        "rotate",
        "textlength",
        "lengthadjust",
        "href",
        "data-name",
        "space",
        "lang",
    }
)

# Pre-parse XML/XSS/XXE/PI rejections (fast defense-in-depth before XML tree construction)
SVG_PREPARSE_FORBIDDEN_PATTERNS = [
    re.compile(r"<!\s*ENTITY\b", re.IGNORECASE),
    re.compile(r"<!\s*DOCTYPE\b", re.IGNORECASE),
    re.compile(r"<\?\s*xml-stylesheet\b", re.IGNORECASE),
    re.compile(r"<\?(?!\s*xml(?:\s|\?>))", re.IGNORECASE),
    re.compile(r"<\s*(?:script|foreignObject|iframe|object|embed|animate\w*|set)\b", re.IGNORECASE),
]

# Dangerous schemes / external references / CSS execution patterns inside attributes or <style>
SVG_DANGEROUS_VALUE_PATTERNS = [
    re.compile(r"javascript\s*:", re.IGNORECASE),
    re.compile(r"vbscript\s*:", re.IGNORECASE),
    re.compile(r"data\s*:\s*text/html", re.IGNORECASE),
    re.compile(r"data\s*:\s*image/svg\+xml", re.IGNORECASE),
    re.compile(r"data\s*:\s*(?:application|text)/", re.IGNORECASE),
    re.compile(r"https?\s*://", re.IGNORECASE),
    re.compile(r"(?:^|[\s(\"'=])//[^\s\"')]+", re.IGNORECASE),
    re.compile(r"@import\b", re.IGNORECASE),
    re.compile(r"expression\s*\(", re.IGNORECASE),
    re.compile(r"behavior\s*:", re.IGNORECASE),
]

SVG_CSS_URL_RE = re.compile(r"url\s*\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE)
SAFE_FRAGMENT_REF_RE = re.compile(r"^#[A-Za-z_][A-Za-z0-9_.:-]*$")
SAFE_RASTER_DATA_URI_RE = re.compile(
    r"^data:image/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$", re.IGNORECASE
)


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


def _extract_declared_extension(filename: str | None) -> str:
    """Return lowercase final file extension (e.g. '.png') or empty string if absent."""
    if not filename:
        return ""
    base = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip()
    return Path(base).suffix.lower()


def _normalize_declared_mime(content_type: str | None) -> str:
    if not content_type:
        return ""
    cleaned = content_type.split(";", 1)[0].strip().lower()
    return MIME_ALIASES.get(cleaned, cleaned)


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

    # 4. SVG (strict XML + allowlist security check)
    if _is_valid_safe_svg(data):
        return "image/svg+xml", ".svg"

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "Formato de imagen no permitido o archivo corrupto. "
            "Solo se aceptan PNG, JPG, WEBP o SVG válido."
        ),
    )


def _normalize_for_scheme_scan(value: str) -> str:
    """Strip ASCII control chars/nulls/comments so obfuscated schemes cannot bypass regexes."""
    no_ctrl = re.sub(r"[\x00-\x1f\x7f]+", "", value)
    return re.sub(r"/\*.*?\*/", "", no_ctrl, flags=re.DOTALL)


def _assert_safe_svg_text_value(value: str, *, context: str) -> None:
    cleaned = _normalize_for_scheme_scan(value)
    for pattern in SVG_DANGEROUS_VALUE_PATTERNS:
        if pattern.search(cleaned):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El archivo SVG contiene referencias o código no seguro en {context}.",
            )

    for match in SVG_CSS_URL_RE.finditer(cleaned):
        target = match.group(2).strip()
        if not SAFE_FRAGMENT_REF_RE.match(target):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El archivo SVG contiene una referencia url(...) externa o no permitida en {context}.",
            )


def _is_valid_safe_svg(data: bytes) -> bool:
    """
    Validate SVG using a strict allowlist approach (OWASP defense-in-depth):
    - Rejects DOCTYPE/ENTITY (XXE), <?xml-stylesheet?>, unknown processing instructions.
    - Allows only safe static SVG elements & attributes (blocks script, animate*, set, foreignObject, etc.).
    - Blocks event handlers (on*), javascript:/vbscript:, data:image/svg+xml, data:text/html,
      and external http(s):// URLs in attributes or <style> blocks.
    """
    try:
        text = data.decode("utf-8").strip()
    except UnicodeDecodeError:
        return False

    lower_head = text[:512].lower()
    if "<svg" not in lower_head and not lower_head.startswith("<?xml"):
        return False

    # Reject dangerous XML constructs / processing instructions BEFORE parsing
    for pattern in SVG_PREPARSE_FORBIDDEN_PATTERNS:
        if pattern.search(text):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El archivo SVG contiene elementos no seguros (scripts, animaciones, hojas XML o entidades).",
            )

    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return False

    local_root = root.tag.split("}")[-1].lower()
    if local_root != "svg":
        return False

    for elem in root.iter():
        tag_name = elem.tag.split("}")[-1].lower()
        if tag_name not in SVG_ALLOWED_TAGS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El archivo SVG contiene la etiqueta no permitida '<{tag_name}>'.",
            )

        # Inspect <style> blocks against external URLs, @import, scripts, data:image/svg+xml
        if tag_name == "style":
            style_content = "".join(elem.itertext())
            if style_content.strip():
                _assert_safe_svg_text_value(style_content, context="<style>")

        for attr_key, raw_val in elem.attrib.items():
            attr_name = attr_key.split("}")[-1].lower()
            val = (raw_val or "").strip()

            if attr_name.startswith("on"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El archivo SVG contiene manejadores de eventos no permitidos.",
                )

            if attr_name not in SVG_ALLOWED_ATTRS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El archivo SVG contiene el atributo no permitido '{attr_name}'.",
                )

            if attr_name == "href":
                if tag_name == "image":
                    if not SAFE_RASTER_DATA_URI_RE.match(val):
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=(
                                "Los elementos <image> dentro de SVG solo permiten imágenes raster "
                                "embebidas en Base64 (PNG/JPEG/WEBP), sin URLs externas ni SVG anidado."
                            ),
                        )
                else:
                    if not SAFE_FRAGMENT_REF_RE.match(val):
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="El atributo 'href' en SVG solo puede referenciar IDs internos (#id).",
                        )
                continue

            _assert_safe_svg_text_value(val, context=f"el atributo '{attr_name}'")

    return True


async def validate_and_prepare_image(
    upload: UploadFile,
    *,
    remaining_budget_bytes: Optional[int] = None,
) -> ValidatedImageFile:
    """
    Validate extension, read uploaded file in bounded chunks enforcing per-file & optional
    cumulative order byte limits, verify real magic bytes / allowlist SVG safety, cross-check
    declared Content-Type & extension against real magic bytes, and generate a UUID storage path.
    """
    settings = get_settings()
    max_file_bytes = settings.max_upload_size_bytes

    declared_ext = _extract_declared_extension(upload.filename)
    if declared_ext and declared_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Extensión de archivo no permitida ('{declared_ext}'). "
                "Solo se aceptan PNG, JPG, WEBP o SVG."
            ),
        )
    if upload.filename and not declared_ext:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo debe tener una extensión permitida (.png, .jpg, .jpeg, .webp o .svg).",
        )

    chunks: list[bytes] = []
    total_read = 0
    chunk_size = 64 * 1024  # 64 KB chunks

    while True:
        chunk = await upload.read(chunk_size)
        if not chunk:
            break
        total_read += len(chunk)
        if total_read > max_file_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"La imagen supera el límite máximo permitido de {settings.MAX_UPLOAD_SIZE_MB} MB.",
            )
        if remaining_budget_bytes is not None and total_read > remaining_budget_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=(
                    "El peso acumulado de todas las imágenes del pedido supera el límite máximo "
                    f"permitido de {settings.MAX_TOTAL_ORDER_UPLOAD_MB} MB."
                ),
            )
        chunks.append(chunk)

    raw_bytes = b"".join(chunks)
    if not raw_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes adjuntar una imagen válida para el sticker.",
        )

    real_content_type, extension = detect_real_image_type(raw_bytes)

    # Cross-check declared extension against detected real file signature
    if declared_ext:
        allowed_for_real = MIME_TO_ALLOWED_EXTENSIONS.get(real_content_type, frozenset())
        if declared_ext not in allowed_for_real:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"La extensión del archivo ('{declared_ext}') no coincide con el contenido real "
                    f"detectado ('{real_content_type}')."
                ),
            )

    # Cross-check declared Content-Type header against detected real magic bytes
    declared_mime = _normalize_declared_mime(upload.content_type)
    if declared_mime and declared_mime != real_content_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El Content-Type declarado ('{declared_mime}') no coincide con el tipo real "
                f"detectado ('{real_content_type}')."
            ),
        )

    now = datetime.now(timezone.utc)
    safe_filename = f"{uuid.uuid4().hex}{extension}"
    storage_path = f"orders/{now.year:04d}/{now.month:02d}/{safe_filename}"

    return ValidatedImageFile(
        content=raw_bytes,
        content_type=real_content_type,
        extension=extension,
        size_bytes=len(raw_bytes),
        safe_filename=safe_filename,
        storage_path=storage_path,
        original_sanitized_name=sanitize_original_filename(upload.filename),
    )
