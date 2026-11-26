"""Storage service supporting Firebase Storage, Cloudinary, and secure local fallback."""

from __future__ import annotations

import io
import logging
import mimetypes
import re
from pathlib import Path
from typing import Any, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fastapi import HTTPException, status

from app.core.config import BACKEND_DIR, get_settings
from app.core.file_security import ValidatedImageFile
from app.core.firebase import FirebaseNotConfiguredError, get_storage_bucket

logger = logging.getLogger(__name__)

LOCAL_UPLOADS_DIR = (BACKEND_DIR / "uploads").resolve()
CLOUDINARY_ORDERS_FOLDER = "siete-studio/orders"
CLOUDINARY_ALLOWED_HOST = "res.cloudinary.com"


class StorageService:
    """Encapsulates sticker artwork persistence (Firebase Storage, Cloudinary, or secure local fallback)."""

    def _safe_local_path(self, storage_path: str) -> Path:
        """Resolve a local path strictly confined inside backend/uploads/ (blocks path traversal)."""
        candidate = (LOCAL_UPLOADS_DIR / storage_path).resolve()
        if not candidate.is_relative_to(LOCAL_UPLOADS_DIR):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ruta de archivo inválida.",
            )
        return candidate

    def _should_use_firebase_bucket(self) -> bool:
        settings = get_settings()
        if settings.STORAGE_BACKEND in ("local", "cloudinary"):
            return False
        if settings.STORAGE_BACKEND == "firebase":
            return True

        # mode == "auto": prefer Firebase Storage whenever the bucket is provisioned
        try:
            bucket = get_storage_bucket()
            return bool(bucket.exists())
        except Exception:
            return False

    def _is_cloudinary_url(self, storage_path: str) -> bool:
        parsed = urlparse(storage_path)
        return parsed.scheme == "https" and parsed.hostname == CLOUDINARY_ALLOWED_HOST

    def _extract_cloudinary_public_id(self, url: str) -> Optional[str]:
        """Extract Cloudinary public_id from a standard res.cloudinary.com delivery URL."""
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != CLOUDINARY_ALLOWED_HOST:
            return None
        marker = "/upload/"
        if marker not in parsed.path:
            return None
        tail = parsed.path.split(marker, 1)[1].lstrip("/")
        tail = re.sub(r"^v\d+/", "", tail)
        if not tail:
            return None
        return str(Path(tail).with_suffix("")).replace("\\", "/")

    def _get_cloudinary_uploader(self) -> Any:
        """Configure and return cloudinary.uploader when Cloudinary credentials are present."""
        settings = get_settings()
        cloud_name = (settings.CLOUDINARY_CLOUD_NAME or "").strip()
        api_key = (settings.CLOUDINARY_API_KEY or "").strip()
        api_secret = (settings.CLOUDINARY_API_SECRET or "").strip()

        if not (cloud_name and api_key and api_secret):
            logger.error(
                "Storage upload blocked - Cloudinary credentials incomplete "
                "(CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)."
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Almacenamiento de imágenes (Cloudinary) no configurado en el servidor.",
            )

        try:
            import cloudinary
            import cloudinary.uploader
        except ImportError as exc:
            logger.error("Cloudinary SDK is not installed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Dependencia de almacenamiento Cloudinary no instalada en el servidor.",
            ) from exc

        cloudinary.config(
            cloud_name=cloud_name,
            api_key=api_key,
            api_secret=api_secret,
            secure=True,
        )
        return cloudinary.uploader

    def upload_order_image(
        self,
        image: ValidatedImageFile,
        *,
        order_number: str,
    ) -> str:
        """Upload a pre-validated image to Cloudinary, Firebase Storage, or secure local fallback."""
        settings = get_settings()

        if settings.STORAGE_BACKEND == "cloudinary":
            uploader = self._get_cloudinary_uploader()
            try:
                result = uploader.upload(
                    io.BytesIO(image.content),
                    folder=CLOUDINARY_ORDERS_FOLDER,
                    public_id=Path(image.safe_filename).stem,
                    resource_type="image",
                )
            except HTTPException:
                raise
            except Exception as exc:
                logger.exception("Error uploading image to Cloudinary for %s.", order_number)
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="No se pudo guardar la imagen del sticker. Intenta nuevamente.",
                ) from exc

            secure_url = result.get("secure_url") if isinstance(result, dict) else None
            if not isinstance(secure_url, str) or not secure_url.strip():
                logger.error("Cloudinary upload response missing secure_url for %s.", order_number)
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="No se pudo obtener la URL pública de la imagen en Cloudinary.",
                )
            return secure_url

        if self._should_use_firebase_bucket():
            try:
                bucket = get_storage_bucket()
                blob = bucket.blob(image.storage_path)
                blob.metadata = {
                    "order_number": order_number,
                    "original_filename": image.original_sanitized_name,
                }
                blob.upload_from_string(
                    image.content,
                    content_type=image.content_type,
                )
                return image.storage_path
            except FirebaseNotConfiguredError as exc:
                if settings.STORAGE_BACKEND == "firebase":
                    logger.error("Storage upload blocked - Firebase not configured: %s", exc)
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Almacenamiento de imágenes no configurado en el servidor.",
                    ) from exc
            except Exception as exc:
                if settings.STORAGE_BACKEND == "firebase":
                    logger.exception("Error uploading image to Firebase Storage.")
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="No se pudo guardar la imagen del sticker. Intenta nuevamente.",
                    ) from exc
                logger.warning(
                    "Firebase Storage no disponible; usando almacenamiento local seguro para %s.",
                    order_number,
                )

        # Secure local fallback (backend/uploads/orders/YYYY/MM/{uuid}.{ext})
        local_target = self._safe_local_path(image.storage_path)
        local_target.parent.mkdir(parents=True, exist_ok=True)
        local_target.write_bytes(image.content)
        logger.info("Imagen guardada en almacenamiento local seguro: %s", image.storage_path)
        return image.storage_path

    def upload_binary_artifact(
        self,
        storage_path: str,
        content: bytes,
        content_type: str,
        *,
        metadata: dict[str, str] | None = None,
    ) -> str:
        """Upload a derived prepress artifact (enhanced PNG, 2-layer EPS, etc.) safely."""
        settings = get_settings()

        if self._should_use_firebase_bucket():
            try:
                bucket = get_storage_bucket()
                blob = bucket.blob(storage_path)
                if metadata:
                    blob.metadata = metadata
                blob.upload_from_string(content, content_type=content_type)
                return storage_path
            except FirebaseNotConfiguredError as exc:
                if settings.STORAGE_BACKEND == "firebase":
                    logger.error("Artifact upload blocked - Firebase not configured: %s", exc)
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Almacenamiento de archivos no configurado en el servidor.",
                    ) from exc
            except Exception as exc:
                if settings.STORAGE_BACKEND == "firebase":
                    logger.exception("Error uploading prepress artifact to Firebase Storage.")
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="No se pudo guardar el archivo de preprensa. Intenta nuevamente.",
                    ) from exc
                logger.warning(
                    "Firebase Storage no disponible; usando almacenamiento local para %s.",
                    storage_path,
                )

        local_target = self._safe_local_path(storage_path)
        local_target.parent.mkdir(parents=True, exist_ok=True)
        local_target.write_bytes(content)
        logger.info("Artefacto de preprensa guardado en almacenamiento local seguro: %s", storage_path)
        return storage_path

    def download_order_image(self, storage_path: str) -> Tuple[bytes, str]:
        """Download image bytes and content-type from Cloudinary, Firebase Storage, or local fallback."""
        settings = get_settings()

        if self._is_cloudinary_url(storage_path):
            try:
                req = Request(storage_path, headers={"User-Agent": "SieteStickerStudio/1.0"})
                with urlopen(req, timeout=30) as resp:
                    if not self._is_cloudinary_url(resp.geturl()):
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="URL de imagen de Cloudinary inválida.",
                        )
                    data = resp.read()
                    content_type = (
                        resp.headers.get_content_type()
                        if resp.headers
                        else "application/octet-stream"
                    )
                    return data, content_type or "application/octet-stream"
            except HTTPException:
                raise
            except HTTPError as exc:
                if exc.code == 404:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="La imagen asociada al pedido no existe en Storage.",
                    ) from exc
                logger.exception("HTTP error downloading image from Cloudinary.")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="No se pudo descargar la imagen del pedido.",
                ) from exc
            except URLError as exc:
                logger.exception("Network error downloading image from Cloudinary.")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="No se pudo descargar la imagen del pedido.",
                ) from exc

        if self._should_use_firebase_bucket():
            try:
                bucket = get_storage_bucket()
                if bucket.exists():
                    blob = bucket.blob(storage_path)
                    if blob.exists():
                        blob.reload()
                        data = blob.download_as_bytes()
                        content_type = blob.content_type or "application/octet-stream"
                        return data, content_type
            except FirebaseNotConfiguredError as exc:
                if settings.STORAGE_BACKEND == "firebase":
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Almacenamiento de imágenes no configurado en el servidor.",
                    ) from exc
            except Exception as exc:
                if settings.STORAGE_BACKEND == "firebase":
                    logger.exception("Error downloading image from Firebase Storage.")
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="No se pudo descargar la imagen del pedido.",
                    ) from exc

        local_file = self._safe_local_path(storage_path)
        if local_file.is_file():
            guessed_type, _ = mimetypes.guess_type(str(local_file))
            return local_file.read_bytes(), guessed_type or "application/octet-stream"

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="La imagen asociada al pedido no existe en Storage.",
        )

    def delete_order_image(self, storage_path: str) -> None:
        """Best-effort cleanup if a DB write fails after upload or an order/artifact is removed."""
        if self._is_cloudinary_url(storage_path):
            public_id = self._extract_cloudinary_public_id(storage_path)
            if public_id:
                try:
                    uploader = self._get_cloudinary_uploader()
                    uploader.destroy(public_id, resource_type="image")
                except Exception:
                    logger.warning("Cleanup failed for Cloudinary object: %s", storage_path)
            return

        if self._should_use_firebase_bucket():
            try:
                bucket = get_storage_bucket()
                if bucket.exists():
                    blob = bucket.blob(storage_path)
                    if blob.exists():
                        blob.delete()
            except Exception:
                pass

        try:
            local_file = self._safe_local_path(storage_path)
            if local_file.is_file():
                local_file.unlink()
        except Exception:
            logger.warning("Cleanup failed for storage object: %s", storage_path)


storage_service = StorageService()
