"""Full CRUD service for relational `materials` catalog enforcing FK & UNIQUE integrity."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import Material, Order
from app.schemas.material import (
    MaterialCreateInput,
    MaterialListResponse,
    MaterialResponse,
    MaterialUpdateInput,
)


def _to_material_response(mat: Material, orders_count: int) -> MaterialResponse:
    return MaterialResponse(
        id=mat.id,
        name=mat.name,
        description=mat.description,
        requires_gloss_mode=bool(mat.requires_gloss_mode),
        base_unit_price=round(float(mat.base_unit_price), 2),
        is_active=bool(mat.is_active),
        orders_count=orders_count,
        created_at=mat.created_at,
        updated_at=mat.updated_at,
    )


class MaterialService:
    """Manages CRUD operations on the `materials` table with relational integrity protection."""

    def list_materials(self, db: Session, *, only_active: bool = False) -> MaterialListResponse:
        stmt = (
            select(Material, func.count(Order.id).label("orders_count"))
            .outerjoin(Order, Order.material_id == Material.id)
            .group_by(Material.id)
            .order_by(Material.id.asc())
        )
        if only_active:
            stmt = stmt.where(Material.is_active.is_(True))

        rows = db.execute(stmt).all()
        items = [_to_material_response(mat, int(count)) for mat, count in rows]
        return MaterialListResponse(items=items, total=len(items))

    def create_material(self, db: Session, payload: MaterialCreateInput) -> MaterialResponse:
        existing = db.scalar(
            select(Material).where(func.lower(Material.name) == payload.name.lower())
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ya existe un material llamado '{payload.name}'.",
            )

        mat = Material(
            name=payload.name,
            description=payload.description,
            requires_gloss_mode=payload.requires_gloss_mode,
            base_unit_price=round(payload.base_unit_price, 2),
            is_active=payload.is_active,
        )
        try:
            db.add(mat)
            db.commit()
            db.refresh(mat)
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Violación de restricción de integridad al crear el material.",
            ) from exc

        return _to_material_response(mat, 0)

    def update_material(
        self, db: Session, material_id: int, payload: MaterialUpdateInput
    ) -> MaterialResponse:
        mat = db.scalar(select(Material).where(Material.id == material_id))
        if not mat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Material no encontrado.",
            )

        if payload.name is not None:
            conflict = db.scalar(
                select(Material).where(
                    func.lower(Material.name) == payload.name.lower(),
                    Material.id != material_id,
                )
            )
            if conflict:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Ya existe otro material con el nombre '{payload.name}'.",
                )
            mat.name = payload.name
        if payload.description is not None:
            mat.description = payload.description
        if payload.requires_gloss_mode is not None:
            mat.requires_gloss_mode = payload.requires_gloss_mode
        if payload.base_unit_price is not None:
            mat.base_unit_price = round(payload.base_unit_price, 2)
        if payload.is_active is not None:
            mat.is_active = payload.is_active

        try:
            db.commit()
            db.refresh(mat)
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Violación de restricción de integridad al actualizar el material.",
            ) from exc

        count = db.scalar(select(func.count(Order.id)).where(Order.material_id == mat.id)) or 0
        return _to_material_response(mat, int(count))

    def delete_material(self, db: Session, material_id: int) -> None:
        mat = db.scalar(select(Material).where(Material.id == material_id))
        if not mat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Material no encontrado.",
            )

        orders_count = (
            db.scalar(select(func.count(Order.id)).where(Order.material_id == material_id)) or 0
        )
        if orders_count > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"No se puede eliminar '{mat.name}' porque tiene {orders_count} pedido(s) "
                    "asociado(s) (restricción de integridad referencial ON DELETE RESTRICT). "
                    "Puedes desactivarlo en su lugar."
                ),
            )

        try:
            db.delete(mat)
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No se puede eliminar este material porque está referenciado por pedidos existentes.",
            ) from exc


material_service = MaterialService()
