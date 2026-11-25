"""Shared pytest configuration ensuring hermetic test execution without hitting live Firestore."""

from __future__ import annotations

import pytest

from app.core.firebase import FirebaseNotConfiguredError
from app.services import order_service as order_service_mod


@pytest.fixture(autouse=True)
def _isolate_firestore_by_default(monkeypatch):
    """
    Prevent unit/integration tests from writing test records into real Firebase Firestore.
    Tests that specifically verify Firestore persistence override `get_firestore_client`
    with an in-memory fake client.
    """

    def _disabled_firestore():
        raise FirebaseNotConfiguredError("Firestore deshabilitado en pruebas automatizadas.")

    monkeypatch.setattr(order_service_mod, "get_firestore_client", _disabled_firestore)
