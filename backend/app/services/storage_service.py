"""Firebase Storage service with optional secure local fallback for Spark-plan dev setups."""

from __future__ import annotations

import logging
import mimetypes
from pathlib import Path
from typing import Tuple

from fastapi import HTTPException, status

from app.core.config import BACKEND_DIR, get_settings
from app.core.file_security import ValidatedImageFile
from app.core.firebase import FirebaseNotConfiguredError, get_storage_bucket

logger = logging.getLogger(__name__)

LOCAL_UPLOADS_DIR = (BACKEND_DIR / "uploads").resolve()


class StorageService:
    """Encapsulates sticker artwork persistence (Firebase Storage primary, secure local fallback)."""

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
        if settings.STORAGE_BACKEND == "local":
            return False
        if settings.STORAGE_BACKEND == "firebase":
            return True

        # mode == "auto": prefer Firebase Storage whenever the bucket is provisioned
        try:
            bucket = get_storage_bucket()
            return bool(bucket.exists())
        except Exception:
            return False

    def upload_order_image(
        self,
        image: ValidatedImageFile,
        *,
        order_number: str,
    ) -> str:
        """Upload a pre-validated image with UUID filename to Firebase Storage (or local fallback)."""
        settings = get_settings()

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
        """Download image bytes and content-type from Firebase Storage or local fallback."""
        settings = get_settings()

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
