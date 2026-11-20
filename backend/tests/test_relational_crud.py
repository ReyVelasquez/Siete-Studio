"""Relational CRUD, integrity constraints (CHECK/FK/UNIQUE), and RBAC automated tests."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.security import AuthenticatedUser, get_current_user
from app.db.database import build_engine, get_db
from app.db.models import Customer, Material, Order, Shape
from app.db.seed import init_db_and_seed
from app.main import app


@pytest.fixture()
def test_db_session(tmp_path):
    db_file = tmp_path / "test_siete.db"
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
    yield TestingSession
    app.dependency_overrides.clear()
    test_engine.dispose()


def _request(method: str, path: str, **kwargs) -> httpx.Response:
    async def _run() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(_run())


def _future_exact_hour_iso(hour: int = 14) -> str:
    studio_tz = timezone(timedelta(minutes=-240))
    dt = (datetime.now(studio_tz) + timedelta(days=1)).replace(
        hour=hour, minute=0, second=0, microsecond=0
    )
    return dt.isoformat()


def test_materials_crud_and_unique_constraint(test_db_session):
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="admin-uid", email="admin@siete.studio", role="admin", email_verified=True
    )

    # Read seeded materials
    res_list = _request("GET", "/api/v1/admin/materials")
    assert res_list.status_code == 200
    assert res_list.json()["total"] == 5

    # Create
    res_create = _request(
        "POST",
        "/api/v1/admin/materials",
        json={
            "name": "Vinilo Holográfico",
            "description": "Efecto tornasol resistente al agua",
            "requires_gloss_mode": False,
            "base_unit_price": 3.25,
            "is_active": True,
        },
    )
    assert res_create.status_code == 201
    mat_id = res_create.json()["id"]

    # Duplicate name -> 409 Conflict
    res_dup = _request(
        "POST",
        "/api/v1/admin/materials",
        json={"name": "Vinilo Holográfico", "base_unit_price": 2.0},
    )
    assert res_dup.status_code == 409

    # Update
    res_upd = _request(
        "PATCH",
        f"/api/v1/admin/materials/{mat_id}",
        json={"base_unit_price": 3.75, "is_active": False},
    )
    assert res_upd.status_code == 200
    assert res_upd.json()["base_unit_price"] == 3.75
    assert res_upd.json()["is_active"] is False

    # Delete unused material -> 204
    res_del = _request("DELETE", f"/api/v1/admin/materials/{mat_id}")
    assert res_del.status_code == 204


def test_orders_full_crud_audit_and_material_fk_restrict(test_db_session, tmp_path, monkeypatch):
    from app.services import storage_service as storage_mod

    monkeypatch.setattr(storage_mod, "LOCAL_UPLOADS_DIR", tmp_path / "uploads")
    monkeypatch.setattr(storage_mod.storage_service, "_should_use_firebase_bucket", lambda: False)

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="admin-uid", email="admin@siete.studio", role="admin", email_verified=True
    )

    # Create order via admin quick order
    valid_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00"
    res_create = _request(
        "POST",
        "/api/v1/admin/orders",
        data={
            "referral_name": "Elena Rivas",
            "phone": "+59171239999",
            "material": "Vinilo Mate",
            "shape": "Circular",
            "diameter_cm": "6",
            "quantity": "100",
            "delivery_datetime": _future_exact_hour_iso(15),
            "total_price": "120",
            "advance_payment": "40",
            "payment_method": "QR",
            "status": "Pendiente",
        },
        files={"image": ("arte.png", valid_png, "image/png")},
    )
    assert res_create.status_code == 201
    order_id = res_create.json()["id"]
    assert res_create.json()["pending_balance"] == 80.0
    assert len(res_create.json()["status_history"]) == 1
    assert len(res_create.json()["payments"]) == 1

    # Trying to delete referenced 'Vinilo Mate' must fail with 409 ON DELETE RESTRICT
    mats = _request("GET", "/api/v1/admin/materials").json()["items"]
    mate = next(m for m in mats if m["name"] == "Vinilo Mate")
    assert mate["orders_count"] == 1
    res_restrict = _request("DELETE", f"/api/v1/admin/materials/{mate['id']}")
    assert res_restrict.status_code == 409

    # Update order status + additional payment -> adds audit history & payment
    res_patch = _request(
        "PATCH",
        f"/api/v1/admin/orders/{order_id}",
        json={
            "status": "En Impresión",
            "advance_payment": 100.0,
            "payment_method": "Transferencia",
        },
    )
    assert res_patch.status_code == 200
    patched = res_patch.json()
    assert patched["pending_balance"] == 20.0
    assert len(patched["status_history"]) == 2
    assert len(patched["payments"]) == 2

    # Delete order -> 204 and cascades related records
    res_del = _request("DELETE", f"/api/v1/admin/orders/{order_id}")
    assert res_del.status_code == 204

    res_missing = _request("GET", f"/api/v1/admin/orders/{order_id}")
    assert res_missing.status_code == 404


def test_db_check_constraint_rejects_invalid_size_xor(test_db_session):
    """Directly verify SQL CHECK constraint `chk_orders_size_xor` at DBMS level."""
    db = test_db_session()
    try:
        cust = Customer(referral_name="Test", phone="70001111")
        db.add(cust)
        db.flush()
        mat = db.query(Material).first()
        shape = db.query(Shape).first()

        # Both diameter_cm and dimensions set violates chk_orders_size_xor
        bad_order = Order(
            order_number="STK-BAD-0001",
            customer_id=cust.id,
            material_id=mat.id,
            shape_id=shape.id,
            diameter_cm=5.0,
            dimensions="5x5 cm",
            size_display="invalid",
            quantity=10,
            delivery_datetime=datetime.now(timezone.utc) + timedelta(days=1),
        )
        db.add(bad_order)
        with pytest.raises(IntegrityError):
            db.commit()
    finally:
        db.rollback()
        db.close()


def test_rbac_blocks_non_admin_from_users_module(test_db_session):
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="op-uid", email="operador@siete.studio", role="operador", email_verified=True
    )
    res = _request("GET", "/api/v1/admin/users")
    assert res.status_code == 403
