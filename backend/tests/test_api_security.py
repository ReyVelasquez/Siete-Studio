"""FastAPI ASGI integration tests for authentication, RBAC enforcement, validation, and Phase 2 stubs."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy.orm import sessionmaker

from app.core.rate_limit import public_orders_limiter
from app.core.security import AuthenticatedUser, get_current_user
from app.db.database import build_engine, get_db
from app.db.seed import init_db_and_seed
from app.main import app
from app.services.user_service import user_service


@pytest.fixture()
def isolated_db(tmp_path):
    """Provide an isolated SQLite relational DB for hermetic RBAC & API tests."""
    db_file = tmp_path / "test_security.db"
    test_engine = build_engine(f"sqlite:///{db_file.as_posix()}")
    init_db_and_seed(bind_engine=test_engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine, future=True)

    def _override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestingSession
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()


def _request(method: str, path: str, **kwargs) -> httpx.Response:
    async def _run() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(_run())


def _future_iso(hour: int = 15, minute: int = 0) -> str:
    studio_tz = timezone(timedelta(minutes=-240))
    dt = (datetime.now(studio_tz) + timedelta(days=1)).replace(
        hour=hour, minute=minute, second=0, microsecond=0
    )
    return dt.isoformat()


def test_health_and_security_headers():
    res = _request("GET", "/api/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"


def test_admin_endpoints_reject_unauthenticated_requests():
    for method, path in (
        ("GET", "/api/v1/dashboard/summary"),
        ("GET", "/api/v1/admin/orders"),
        ("GET", "/api/v1/admin/materials"),
        ("GET", "/api/v1/admin/users"),
        ("GET", "/api/v1/image-processing/capabilities"),
        ("POST", "/api/v1/image-processing/enhance"),
    ):
        res = _request(method, path)
        assert res.status_code == 401, f"{method} {path} should require Firebase JWT"


def test_sync_firebase_user_assigns_admin_first_and_cliente_by_default(isolated_db):
    """First user becomes `admin`; subsequent public signups receive least-privilege `cliente` role."""
    db = isolated_db()
    try:
        first = user_service.sync_firebase_user(
            db,
            {
                "uid": "first-admin-uid",
                "email": "founder@siete.studio",
                "name": "Fundador Siete",
                "email_verified": True,
                "firebase": {"sign_in_provider": "password"},
            },
        )
        assert first.role.code == "admin"

        second = user_service.sync_firebase_user(
            db,
            {
                "uid": "public-signup-uid",
                "email": "nuevo.cliente@example.com",
                "name": "Nuevo Cliente",
                "email_verified": True,
                "firebase": {"sign_in_provider": "google.com"},
            },
        )
        assert second.role.code == "cliente"
    finally:
        db.close()


def test_cliente_role_receives_403_on_internal_routes(isolated_db):
    """Authenticated `cliente` users must receive 403 on all staff/admin endpoints while public GET stays open."""
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="cliente-uid",
        db_user_id=99,
        email="cliente@example.com",
        role="cliente",
        email_verified=True,
    )

    # Public materials endpoint must remain accessible
    pub_res = _request("GET", "/api/v1/public/materials")
    assert pub_res.status_code == 200

    # All internal workshop (require_staff) and admin (require_admin) routes must return 403
    for method, path, extra in (
        ("GET", "/api/v1/dashboard/summary", {}),
        ("GET", "/api/v1/admin/orders", {}),
        ("DELETE", "/api/v1/admin/orders/1", {}),
        ("GET", "/api/v1/admin/materials", {}),
        (
            "POST",
            "/api/v1/admin/materials",
            {"json": {"name": "Vinilo Intruso", "base_unit_price": 1.0}},
        ),
        ("GET", "/api/v1/image-processing/capabilities", {}),
        ("POST", "/api/v1/image-processing/enhance", {"json": {"order_id": "1"}}),
        (
            "POST",
            "/api/v1/image-processing/pack-layout",
            {
                "json": {
                    "sheet_width_cm": 32.0,
                    "sheet_height_cm": 45.0,
                    "margin_cm": 2.0,
                    "gap_cm": 0.3,
                    "items": [{"item_id": "1", "width_cm": 5.0, "height_cm": 5.0, "quantity": 10}],
                }
            },
        ),
        ("GET", "/api/v1/admin/users", {}),
    ):
        res = _request(method, path, **extra)
        assert res.status_code == 403, f"Role 'cliente' must receive 403 on {method} {path}, got {res.status_code}"


def test_operador_role_can_access_staff_routes_but_not_admin_users(isolated_db):
    """Authenticated `operador` users can access staff routes and are still blocked from `/admin/users`."""
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="operador-uid",
        db_user_id=2,
        email="operador@siete.studio",
        role="operador",
        email_verified=True,
    )

    for path in (
        "/api/v1/dashboard/summary",
        "/api/v1/admin/orders",
        "/api/v1/admin/materials",
        "/api/v1/image-processing/capabilities",
    ):
        res = _request("GET", path)
        assert res.status_code == 200, f"Role 'operador' should access GET {path}, got {res.status_code}"

    # `/admin/users` must remain restricted strictly to `admin`
    users_res = _request("GET", "/api/v1/admin/users")
    assert users_res.status_code == 403


def test_admin_role_can_access_staff_and_admin_users_routes(isolated_db):
    """Authenticated `admin` users can access both staff endpoints and `/admin/users`."""
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="admin-uid",
        db_user_id=1,
        email="admin@siete.studio",
        role="admin",
        email_verified=True,
    )

    for path in (
        "/api/v1/dashboard/summary",
        "/api/v1/admin/orders",
        "/api/v1/admin/materials",
        "/api/v1/admin/users",
        "/api/v1/image-processing/capabilities",
    ):
        res = _request("GET", path)
        assert res.status_code == 200, f"Role 'admin' should access GET {path}, got {res.status_code}"


def test_public_order_rejects_non_exact_delivery_minute():
    public_orders_limiter.reset()
    valid_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00"
    res = _request(
        "POST",
        "/api/v1/public/orders",
        data={
            "referral_name": "Cliente Prueba",
            "phone": "+59171234567",
            "material": "Vinilo Mate",
            "shape": "Circular",
            "diameter_cm": "5",
            "quantity": "50",
            "delivery_datetime": _future_iso(hour=15, minute=15),
        },
        files={"image": ("logo.png", valid_png, "image/png")},
    )
    assert res.status_code == 422
    assert "hora en punto" in res.json()["detail"].lower()


def test_public_order_rejects_malicious_svg():
    public_orders_limiter.reset()
    xss_svg = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
    res = _request(
        "POST",
        "/api/v1/public/orders",
        data={
            "referral_name": "Cliente Prueba",
            "phone": "+59171234567",
            "material": "Transparente",
            "shape": "Cuadrado",
            "dimensions": "5x5 cm",
            "quantity": "10",
            "delivery_datetime": _future_iso(hour=15, minute=0),
        },
        files={"image": ("attack.svg", xss_svg, "image/svg+xml")},
    )
    assert res.status_code == 400


def test_phase2_pack_layout_returns_200_when_authenticated():
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="test-uid",
        email="operador@siete.studio",
        role="operador",
        email_verified=True,
    )
    try:
        cap_res = _request("GET", "/api/v1/image-processing/capabilities")
        assert cap_res.status_code == 200
        assert len(cap_res.json()["modules"]) == 3

        pack_res = _request(
            "POST",
            "/api/v1/image-processing/pack-layout",
            json={
                "sheet_width_cm": 32.0,
                "sheet_height_cm": 45.0,
                "margin_cm": 2.0,
                "gap_cm": 0.3,
                "items": [{"item_id": "1", "width_cm": 5.0, "height_cm": 5.0, "quantity": 10}],
            },
        )
        assert pack_res.status_code == 200
        body = pack_res.json()
        assert body["total_sheets"] == 1
        assert body["total_stickers"] == 10
        assert body["utilization_percent"] > 0
    finally:
        app.dependency_overrides.clear()
