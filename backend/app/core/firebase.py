"""Firebase Admin SDK initialization for Auth, Firestore, and Storage."""

from __future__ import annotations

import base64
import binascii
import json
import logging
from pathlib import Path
from typing import Any, Optional

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials, firestore, storage

from app.core.config import BACKEND_DIR, get_settings

logger = logging.getLogger(__name__)

_firebase_app: Optional[firebase_admin.App] = None
_firestore_client: Optional[Any] = None


class FirebaseNotConfiguredError(RuntimeError):
    """Raised when Firebase Admin credentials are missing or invalid."""


def _parse_firebase_credentials_json(raw_value: str) -> dict[str, Any]:
    """Parse Firebase service account JSON from plain single-line JSON or Base64-encoded JSON."""
    cleaned = raw_value.strip()
    cert_dict: Any = None

    try:
        cert_dict = json.loads(cleaned)
    except json.JSONDecodeError:
        try:
            decoded = base64.b64decode(cleaned).decode("utf-8")
            cert_dict = json.loads(decoded)
        except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            raise FirebaseNotConfiguredError(
                "FIREBASE_CREDENTIALS_JSON no contiene un JSON válido (plano ni codificado en Base64)."
            ) from exc

    if not isinstance(cert_dict, dict):
        raise FirebaseNotConfiguredError(
            "FIREBASE_CREDENTIALS_JSON debe decodificarse a un objeto JSON de cuenta de servicio."
        )

    private_key = cert_dict.get("private_key")
    if isinstance(private_key, str):
        cert_dict["private_key"] = private_key.replace("\\n", "\n")

    return cert_dict


def initialize_firebase() -> firebase_admin.App:
    """Initialize Firebase Admin SDK once using env-provided credentials."""
    global _firebase_app

    if _firebase_app is not None:
        return _firebase_app

    if firebase_admin._apps:
        _firebase_app = firebase_admin.get_app()
        return _firebase_app

    settings = get_settings()
    cred: Optional[credentials.Base] = None

    if settings.FIREBASE_CREDENTIALS_JSON and settings.FIREBASE_CREDENTIALS_JSON.strip():
        try:
            cert_dict = _parse_firebase_credentials_json(settings.FIREBASE_CREDENTIALS_JSON)
            cred = credentials.Certificate(cert_dict)
        except FirebaseNotConfiguredError:
            raise
        except (ValueError, TypeError) as exc:
            raise FirebaseNotConfiguredError(
                "FIREBASE_CREDENTIALS_JSON no contiene una cuenta de servicio de Firebase válida."
            ) from exc
    elif settings.FIREBASE_CREDENTIALS_PATH and settings.FIREBASE_CREDENTIALS_PATH.strip():
        raw_path = Path(settings.FIREBASE_CREDENTIALS_PATH)
        cred_path = raw_path if raw_path.is_absolute() else (BACKEND_DIR / raw_path)
        if not cred_path.is_file():
            cred_path = raw_path.resolve()
        if not cred_path.is_file():
            raise FirebaseNotConfiguredError(
                f"No se encontró el archivo de credenciales de Firebase en: {BACKEND_DIR / raw_path}. "
                "Configura FIREBASE_CREDENTIALS_PATH o FIREBASE_CREDENTIALS_JSON en backend/.env."
            )
        cred = credentials.Certificate(str(cred_path))
    else:
        raise FirebaseNotConfiguredError(
            "Credenciales de Firebase Admin no configuradas. Define "
            "FIREBASE_CREDENTIALS_PATH o FIREBASE_CREDENTIALS_JSON en backend/.env."
        )

    options: dict[str, Any] = {}
    if settings.FIREBASE_STORAGE_BUCKET:
        options["storageBucket"] = settings.FIREBASE_STORAGE_BUCKET

    _firebase_app = firebase_admin.initialize_app(cred, options or None)
    logger.info("Firebase Admin SDK inicializado correctamente.")
    return _firebase_app


def get_firestore_client():
    """Return initialized Firestore client."""
    global _firestore_client
    initialize_firebase()
    if _firestore_client is None:
        _firestore_client = firestore.client()
    return _firestore_client


def get_storage_bucket():
    """Return configured Firebase Storage bucket."""
    settings = get_settings()
    if not settings.FIREBASE_STORAGE_BUCKET:
        raise FirebaseNotConfiguredError(
            "FIREBASE_STORAGE_BUCKET no está configurado en backend/.env."
        )
    initialize_firebase()
    return storage.bucket(settings.FIREBASE_STORAGE_BUCKET)


def verify_firebase_id_token(id_token: str) -> dict[str, Any]:
    """Verify a Firebase JWT ID token using Firebase Admin Auth."""
    initialize_firebase()
    return firebase_auth.verify_id_token(id_token, check_revoked=True)


def is_firebase_ready() -> bool:
    """Non-throwing readiness check used by /health."""
    try:
        initialize_firebase()
        return True
    except Exception:
        return False
