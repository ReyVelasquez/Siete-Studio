"""FastAPI ASGI integration tests for authentication enforcement, validation, and Phase 2 stubs."""

import asyncio
from datetime import datetime, timedelta, timezone

import httpx

from app.core.rate_limit import public_orders_limiter
from app.core.security import AuthenticatedUser, get_current_user
from app.main import app


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
        ("GET", "/api/v1/image-processing/capabilities"),
        ("POST", "/api/v1/image-processing/enhance"),
    ):
        res = _request(method, path)
        assert res.status_code == 401, f"{method} {path} should require Firebase JWT"


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


def test_phase2_stub_returns_501_when_authenticated():
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="test-uid", email="admin@siete.studio", email_verified=True
    )
    try:
        cap_res = _request("GET", "/api/v1/image-processing/capabilities")
        assert cap_res.status_code == 200
        assert len(cap_res.json()["modules"]) == 3

        stub_res = _request(
            "POST",
            "/api/v1/image-processing/enhance",
            json={"order_id": "ord_123", "target_dpi": 300, "upscale_factor": 2.0},
        )
        assert stub_res.status_code == 501
        assert stub_res.json()["status"] == "not_implemented"
    finally:
        app.dependency_overrides.clear()
