"""Relational CRUD, integrity constraints (CHECK/FK/UNIQUE), and RBAC automated tests."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.rate_limit import public_orders_limiter
from app.core.security import AuthenticatedUser, get_current_user
from app.db.database import build_engine, get_db
from app.db.models import Customer, Material, Order, OrderItem, Shape
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


class _FakeFirestoreDocument:
    def __init__(self, store: dict, doc_id: str):
        self._store = store
        self._doc_id = doc_id

    def set(self, data: dict) -> None:
        self._store[self._doc_id] = data

    def delete(self) -> None:
        self._store.pop(self._doc_id, None)


class _FakeFirestoreCollection:
    def __init__(self, store: dict):
        self._store = store

    def document(self, doc_id: str) -> _FakeFirestoreDocument:
        return _FakeFirestoreDocument(self._store, doc_id)


class _FakeFirestoreClient:
    def __init__(self):
        self.collections: dict[str, dict[str, dict]] = {}

    def collection(self, name: str) -> _FakeFirestoreCollection:
        store = self.collections.setdefault(name, {})
        return _FakeFirestoreCollection(store)


def test_public_master_detail_order_multi_images_and_firestore_sync(
    test_db_session, tmp_path, monkeypatch
):
    import json

    from app.services import order_service as order_service_mod
    from app.services import storage_service as storage_mod

    public_orders_limiter.reset()
    uploads_dir = tmp_path / "uploads"
    monkeypatch.setattr(storage_mod, "LOCAL_UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(storage_mod.storage_service, "_should_use_firebase_bucket", lambda: False)

    fake_fs = _FakeFirestoreClient()
    monkeypatch.setattr(order_service_mod, "get_firestore_client", lambda: fake_fs)

    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00ITEM1"
    jpg_bytes = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00ITEM2"

    items_payload = [
        {
            "material": "Vinilo Brillo",
            "vinyl_gloss_mode": "Corte uno a uno",
            "shape": "Circular",
            "diameter_cm": 5,
            "quantity": 100,
        },
        {
            "material": "DTF UV",
            "shape": "Rectangular",
            "dimensions": "6x9 cm",
            "quantity": 50,
        },
    ]

    res = _request(
        "POST",
        "/api/v1/public/orders",
        data={
            "referral_name": "Andrea Soliz",
            "phone": "+591 7788-9900",
            "delivery_datetime": _future_exact_hour_iso(16),
            "items": json.dumps(items_payload),
        },
        files=[
            ("images", ("logo-circular.png", png_bytes, "image/png")),
            ("images", ("etiqueta-dtf.jpg", jpg_bytes, "image/jpeg")),
        ],
    )
    assert res.status_code == 201, res.text
    body = res.json()
    order_id = body["id"]
    order_number = body["order_number"]

    # Master-Detail HTTP response assertions
    assert body["referral_name"] == "Andrea Soliz"
    assert body["phone"] == "+59177889900"
    assert body["items_count"] == 2
    assert body["total_quantity"] == 150
    assert len(body["items"]) == 2
    assert body["items"][0]["position"] == 1
    assert body["items"][0]["material"] == "Vinilo Brillo"
    assert body["items"][0]["vinyl_gloss_mode"] == "Corte uno a uno"
    assert body["items"][0]["shape"] == "Circular"
    assert body["items"][0]["diameter_cm"] == 5.0
    assert body["items"][0]["dimensions"] is None
    assert body["items"][0]["image"]["content_type"] == "image/png"
    assert body["items"][1]["position"] == 2
    assert body["items"][1]["material"] == "DTF UV"
    assert body["items"][1]["vinyl_gloss_mode"] is None
    assert body["items"][1]["shape"] == "Rectangular"
    assert body["items"][1]["dimensions"] == "6x9 cm"
    assert body["items"][1]["diameter_cm"] is None
    assert body["items"][1]["image"]["content_type"] == "image/jpeg"
    assert body["items"][0]["image"]["storage_path"] != body["items"][1]["image"]["storage_path"]

    # Firestore Master-Detail structure verification
    assert "orders" in fake_fs.collections
    assert order_number in fake_fs.collections["orders"]
    fs_doc = fake_fs.collections["orders"][order_number]
    assert fs_doc["referral_name"] == "Andrea Soliz"
    assert fs_doc["phone"] == "+59177889900"
    assert fs_doc["received_at"] is not None
    assert fs_doc["delivery_datetime"] is not None
    assert fs_doc["items_count"] == 2
    assert fs_doc["total_quantity"] == 150
    assert len(fs_doc["items"]) == 2
    assert fs_doc["items"][0]["material"] == "Vinilo Brillo"
    assert fs_doc["items"][0]["vinyl_gloss_mode"] == "Corte uno a uno"
    assert fs_doc["items"][0]["image"]["content_type"] == "image/png"
    assert fs_doc["items"][1]["material"] == "DTF UV"
    assert fs_doc["items"][1]["dimensions"] == "6x9 cm"
    assert fs_doc["items"][1]["image"]["content_type"] == "image/jpeg"

    # Admin retrieval, multi-item material filter, nested per-item image download & ON DELETE RESTRICT
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="admin-uid", email="admin@siete.studio", role="admin", email_verified=True
    )

    # Filter by secondary item's material ('DTF UV') must find the order
    res_filter = _request("GET", "/api/v1/admin/orders", params={"material": "DTF UV"})
    assert res_filter.status_code == 200
    assert res_filter.json()["total"] == 1
    assert res_filter.json()["items"][0]["id"] == order_id

    # Download item #2's own image via REST nested route
    item2_id = body["items"][1]["id"]
    res_img2 = _request("GET", f"/api/v1/admin/orders/{order_id}/items/{item2_id}/image")
    assert res_img2.status_code == 200
    assert res_img2.headers["content-type"] == "image/jpeg"
    assert res_img2.content == jpg_bytes

    # Deleting material used ONLY by item #2 ('DTF UV') MUST fail with 409 Conflict
    mats = _request("GET", "/api/v1/admin/materials").json()["items"]
    dtf_mat = next(m for m in mats if m["name"] == "DTF UV")
    assert dtf_mat["orders_count"] == 1
    assert _request("DELETE", f"/api/v1/admin/materials/{dtf_mat['id']}").status_code == 409

    # Deleting the order removes BOTH stored files and removes the Firestore document
    img1_path = uploads_dir / body["items"][0]["image"]["storage_path"]
    img2_path = uploads_dir / body["items"][1]["image"]["storage_path"]
    assert img1_path.is_file() and img2_path.is_file()

    assert _request("DELETE", f"/api/v1/admin/orders/{order_id}").status_code == 204
    assert not img1_path.exists()
    assert not img2_path.exists()
    assert order_number not in fake_fs.collections["orders"]


def test_public_order_multi_image_count_mismatch_and_invalid_item_image(
    test_db_session, tmp_path, monkeypatch
):
    import json

    from app.services import storage_service as storage_mod

    public_orders_limiter.reset()
    uploads_dir = tmp_path / "uploads"
    monkeypatch.setattr(storage_mod, "LOCAL_UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(storage_mod.storage_service, "_should_use_firebase_bucket", lambda: False)

    valid_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00VALID"
    xss_svg = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
    two_items = json.dumps(
        [
            {"material": "Vinilo Mate", "shape": "Circular", "diameter_cm": 4, "quantity": 10},
            {"material": "Transparente", "shape": "Cuadrado", "dimensions": "5x5 cm", "quantity": 20},
        ]
    )

    # 1. Empty items array -> 422
    res_empty = _request(
        "POST",
        "/api/v1/public/orders",
        data={
            "referral_name": "Cliente Vacio",
            "phone": "+59171234567",
            "delivery_datetime": _future_exact_hour_iso(14),
            "items": "[]",
        },
        files=[("images", ("a.png", valid_png, "image/png"))],
    )
    assert res_empty.status_code == 422

    # 2. 2 items but only 1 image -> 422
    res_mismatch = _request(
        "POST",
        "/api/v1/public/orders",
        data={
            "referral_name": "Cliente Incompleto",
            "phone": "+59171234567",
            "delivery_datetime": _future_exact_hour_iso(14),
            "items": two_items,
        },
        files=[("images", ("only-one.png", valid_png, "image/png"))],
    )
    assert res_mismatch.status_code == 422
    assert "exactamente una imagen" in res_mismatch.json()["detail"].lower()

    # 3. 2 items + 2 images where image #2 is malicious SVG -> 400 and ZERO files persisted
    res_xss = _request(
        "POST",
        "/api/v1/public/orders",
        data={
            "referral_name": "Cliente XSS",
            "phone": "+59171234567",
            "delivery_datetime": _future_exact_hour_iso(14),
            "items": two_items,
        },
        files=[
            ("images", ("ok.png", valid_png, "image/png")),
            ("images", ("bad.svg", xss_svg, "image/svg+xml")),
        ],
    )
    assert res_xss.status_code == 400
    assert "Diseño #2:" in res_xss.json()["detail"]
    assert not uploads_dir.exists()


def test_admin_order_master_detail_requires_auth_and_persists_items(
    test_db_session, tmp_path, monkeypatch
):
    import json

    from app.services import storage_service as storage_mod

    monkeypatch.setattr(storage_mod, "LOCAL_UPLOADS_DIR", tmp_path / "uploads")
    monkeypatch.setattr(storage_mod.storage_service, "_should_use_firebase_bucket", lambda: False)

    valid_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00ADMIN"
    items_json = json.dumps(
        [
            {
                "material": "Vinilo Brillo",
                "vinyl_gloss_mode": "En rollo",
                "shape": "Circular",
                "diameter_cm": 6,
                "quantity": 80,
            },
            {
                "material": "Hojas Adhesivas",
                "shape": "Cuadrado",
                "dimensions": "5x5 cm",
                "quantity": 40,
            },
        ]
    )

    # Without auth -> MUST remain 401 Unauthorized
    res_unauth = _request(
        "POST",
        "/api/v1/admin/orders",
        data={
            "referral_name": "Sin Auth",
            "phone": "71234567",
            "delivery_datetime": _future_exact_hour_iso(12),
            "items": items_json,
        },
        files=[
            ("images", ("a.png", valid_png, "image/png")),
            ("images", ("b.png", valid_png, "image/png")),
        ],
    )
    assert res_unauth.status_code == 401

    # Authenticated admin -> 201 Created with 2 items + financials
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="admin-uid", email="admin@siete.studio", role="admin", email_verified=True
    )
    res_ok = _request(
        "POST",
        "/api/v1/admin/orders",
        data={
            "referral_name": "Marcos Quiroga",
            "phone": "+59170002222",
            "delivery_datetime": _future_exact_hour_iso(12),
            "items": items_json,
            "total_price": "250",
            "advance_payment": "100",
            "payment_method": "QR",
            "status": "En Diseño",
            "notes": "Dos diseños en mismo pedido",
        },
        files=[
            ("images", ("a.png", valid_png, "image/png")),
            ("images", ("b.png", valid_png, "image/png")),
        ],
    )
    assert res_ok.status_code == 201, res_ok.text
    created = res_ok.json()
    assert created["items_count"] == 2
    assert created["total_quantity"] == 120
    assert created["pending_balance"] == 150.0
    assert len(created["items"]) == 2
    assert len(created["payments"]) == 1


def test_db_check_constraint_rejects_invalid_order_item_size_xor(test_db_session):
    """Directly verify SQL CHECK constraint `chk_order_items_size_xor` at DBMS level."""
    db = test_db_session()
    try:
        cust = Customer(referral_name="Test Item", phone="70009999")
        db.add(cust)
        db.flush()
        mat = db.query(Material).first()
        shape = db.query(Shape).first()

        order = Order(
            order_number="STK-ITEM-XOR1",
            customer_id=cust.id,
            material_id=mat.id,
            shape_id=shape.id,
            diameter_cm=5.0,
            dimensions=None,
            size_display="Ø 5 cm",
            quantity=10,
            delivery_datetime=datetime.now(timezone.utc) + timedelta(days=1),
        )
        db.add(order)
        db.flush()

        bad_item = OrderItem(
            order_id=order.id,
            position=1,
            material_id=mat.id,
            shape_id=shape.id,
            diameter_cm=5.0,
            dimensions="5x5 cm",
            size_display="invalid",
            quantity=10,
            image_storage_path="orders/2026/11/bad.png",
            image_safe_filename="bad.png",
            image_original_filename="bad.png",
            image_content_type="image/png",
            image_size_bytes=1024,
        )
        db.add(bad_item)
        with pytest.raises(IntegrityError):
            db.commit()
    finally:
        db.rollback()
        db.close()


def test_public_order_ignores_client_received_at_and_enforces_security_limits(
    test_db_session, tmp_path, monkeypatch
):
    import io
    import json

    from fastapi import UploadFile
    from starlette.datastructures import Headers

    from app.routers.public_orders import validate_order_item_uploads
    from app.services import storage_service as storage_mod

    public_orders_limiter.reset()
    uploads_dir = tmp_path / "uploads"
    monkeypatch.setattr(storage_mod, "LOCAL_UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(storage_mod.storage_service, "_should_use_firebase_bucket", lambda: False)

    valid_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00SAFE"
    one_item = json.dumps(
        [{"material": "Vinilo Mate", "shape": "Circular", "diameter_cm": 5, "quantity": 10}]
    )

    # 1. Client spoofed `received_at` from 2020 MUST be ignored on public endpoint (server assigns UTC now)
    now_before = datetime.now(timezone.utc) - timedelta(seconds=5)
    res_ok = _request(
        "POST",
        "/api/v1/public/orders",
        data={
            "referral_name": "Cliente Hora Segura",
            "phone": "+59171230001",
            "received_at": "2020-01-01T10:00:00+00:00",
            "delivery_datetime": _future_exact_hour_iso(14),
            "items": one_item,
        },
        files=[("images", ("logo.png", valid_png, "image/png"))],
    )
    assert res_ok.status_code == 201, res_ok.text
    received_dt = datetime.fromisoformat(res_ok.json()["received_at"].replace("Z", "+00:00"))
    assert received_dt >= now_before
    assert received_dt.year >= datetime.now(timezone.utc).year

    # 2. Oversized items JSON (> 32 KB) -> 413 before parsing
    public_orders_limiter.reset()
    oversized_json = "[" + (" " * (33 * 1024)) + "]"
    res_json_big = _request(
        "POST",
        "/api/v1/public/orders",
        data={
            "referral_name": "JSON Gigante",
            "phone": "+59171230002",
            "delivery_datetime": _future_exact_hour_iso(14),
            "items": oversized_json,
        },
        files=[("images", ("logo.png", valid_png, "image/png"))],
    )
    assert res_json_big.status_code == 413

    # 3. Total quantity > 1,000,000 -> 422 before uploading any files
    public_orders_limiter.reset()
    over_qty_items = json.dumps(
        [
            {"material": "Vinilo Mate", "shape": "Circular", "diameter_cm": 5, "quantity": 600_000},
            {"material": "DTF UV", "shape": "Cuadrado", "dimensions": "5x5 cm", "quantity": 500_000},
        ]
    )
    res_qty = _request(
        "POST",
        "/api/v1/public/orders",
        data={
            "referral_name": "Exceso Cantidad",
            "phone": "+59171230003",
            "delivery_datetime": _future_exact_hour_iso(14),
            "items": over_qty_items,
        },
        files=[
            ("images", ("a.png", valid_png, "image/png")),
            ("images", ("b.png", valid_png, "image/png")),
        ],
    )
    assert res_qty.status_code == 422
    assert "1,000,000" in res_qty.json()["detail"]

    # 4. UploadFile handles MUST be closed in `finally` even when validation fails
    closed_flags = []

    class _TrackedUpload(UploadFile):
        async def close(self) -> None:
            closed_flags.append(self.filename)
            await super().close()

    u1 = _TrackedUpload(
        file=io.BytesIO(valid_png),
        filename="good.png",
        headers=Headers({"content-type": "image/png"}),
    )
    u2 = _TrackedUpload(
        file=io.BytesIO(b"MZ_FAKE_BINARY_PAYLOAD_123456"),
        filename="bad.png",
        headers=Headers({"content-type": "image/png"}),
    )
    with pytest.raises(Exception):
        asyncio.run(validate_order_item_uploads(expected_count=2, images=[u1, u2], legacy_image=None))
    assert closed_flags == ["good.png", "bad.png"]


def test_svg_response_has_sandbox_csp_and_sql_filters_and_local_storage_skip(
    test_db_session, tmp_path, monkeypatch
):
    import json

    from app.core import config as config_mod
    from app.services import storage_service as storage_mod

    public_orders_limiter.reset()
    uploads_dir = tmp_path / "uploads"
    monkeypatch.setattr(storage_mod, "LOCAL_UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(storage_mod.storage_service, "_should_use_firebase_bucket", lambda: False)

    safe_svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/></svg>'
    valid_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00SQLF"

    studio_tz = timezone(timedelta(minutes=-240))
    dt_day1 = (datetime.now(studio_tz) + timedelta(days=1)).replace(
        hour=10, minute=0, second=0, microsecond=0
    )
    dt_day2 = (datetime.now(studio_tz) + timedelta(days=2)).replace(
        hour=19, minute=0, second=0, microsecond=0
    )

    # Order 1: SVG design on day 1 (Vinilo Mate + Circular)
    r1 = _request(
        "POST",
        "/api/v1/public/orders",
        data={
            "referral_name": "Sofia Vector",
            "phone": "+59171112222",
            "delivery_datetime": dt_day1.isoformat(),
            "items": json.dumps(
                [{"material": "Vinilo Mate", "shape": "Circular", "diameter_cm": 5, "quantity": 20}]
            ),
        },
        files=[("images", ("vector.svg", safe_svg, "image/svg+xml"))],
    )
    assert r1.status_code == 201, r1.text
    order1_id = r1.json()["id"]

    # Order 2: Multi-item on day 2 (item #1 Transparente/Cuadrado, item #2 DTF UV/Rectangular)
    r2 = _request(
        "POST",
        "/api/v1/public/orders",
        data={
            "referral_name": "Bruno_100% Real",
            "phone": "+59173334444",
            "delivery_datetime": dt_day2.isoformat(),
            "items": json.dumps(
                [
                    {"material": "Transparente", "shape": "Cuadrado", "dimensions": "5x5 cm", "quantity": 30},
                    {"material": "DTF UV", "shape": "Rectangular", "dimensions": "4x9 cm", "quantity": 15},
                ]
            ),
        },
        files=[
            ("images", ("a.png", valid_png, "image/png")),
            ("images", ("b.png", valid_png, "image/png")),
        ],
    )
    assert r2.status_code == 201, r2.text
    order2_id = r2.json()["id"]

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="admin-uid", email="admin@siete.studio", role="admin", email_verified=True
    )

    # 1. Serving SVG must include strict sandbox CSP header
    svg_res = _request("GET", f"/api/v1/admin/orders/{order1_id}/image")
    assert svg_res.status_code == 200
    assert svg_res.headers["content-security-policy"] == "default-src 'none'; sandbox"

    # 2. Mark order 1 as Entregado -> SQL `only_pending=true` excludes it
    assert (
        _request(
            "PATCH", f"/api/v1/admin/orders/{order1_id}", json={"status": "Entregado"}
        ).status_code
        == 200
    )

    res_pending = _request("GET", "/api/v1/admin/orders", params={"only_pending": "true"})
    assert res_pending.status_code == 200
    assert [o["id"] for o in res_pending.json()["items"]] == [order2_id]

    # 3. SQL filter by secondary item material & shape
    res_mat = _request("GET", "/api/v1/admin/orders", params={"material": "DTF UV", "shape": "Rectangular"})
    assert res_mat.status_code == 200
    assert [o["id"] for o in res_mat.json()["items"]] == [order2_id]

    # 4. SQL filter by local studio delivery_date (including 19:00 UTC-4 = 23:00 UTC)
    res_day2 = _request(
        "GET", "/api/v1/admin/orders", params={"delivery_date": dt_day2.date().isoformat()}
    )
    assert res_day2.status_code == 200
    assert [o["id"] for o in res_day2.json()["items"]] == [order2_id]

    # 5. SQL search with escaped LIKE wildcard `%` matches literal `100%` only
    res_search = _request("GET", "/api/v1/admin/orders", params={"search": "100%"})
    assert res_search.status_code == 200
    assert [o["id"] for o in res_search.json()["items"]] == [order2_id]

    # 6. StorageService.delete_order_image MUST NOT touch Firebase when STORAGE_BACKEND="local"
    def _fail_if_called():
        raise AssertionError("get_storage_bucket() no debe llamarse cuando STORAGE_BACKEND='local'")

    monkeypatch.setattr(storage_mod, "get_storage_bucket", _fail_if_called)
    monkeypatch.setattr(storage_mod, "get_settings", lambda: config_mod.Settings(STORAGE_BACKEND="local"))
    assert _request("DELETE", f"/api/v1/admin/orders/{order1_id}").status_code == 204
