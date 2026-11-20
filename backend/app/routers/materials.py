"""CRUD endpoints for the relational `materials` catalog (enforces UNIQUE & FK ON DELETE RESTRICT)."""

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.database import get_db
from app.schemas.material import (
    MaterialCreateInput,
    MaterialListResponse,
    MaterialResponse,
    MaterialUpdateInput,
)
from app.services.material_service import material_service

router = APIRouter(tags=["Materials Catalog CRUD"])


@router.get(
    "/public/materials",
    response_model=MaterialListResponse,
    summary="Listar materiales activos para el portal público",
)
async def list_public_materials(db: Session = Depends(get_db)) -> MaterialListResponse:
    return material_service.list_materials(db, only_active=True)


@router.get(
    "/admin/materials",
    response_model=MaterialListResponse,
    dependencies=[Depends(get_current_user)],
    summary="Listar catálogo completo de materiales con conteo de pedidos",
)
async def list_admin_materials(db: Session = Depends(get_db)) -> MaterialListResponse:
    return material_service.list_materials(db, only_active=False)


@router.post(
    "/admin/materials",
    response_model=MaterialResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_user)],
    summary="Crear nuevo material en el catálogo",
)
async def create_material(
    payload: MaterialCreateInput,
    db: Session = Depends(get_db),
) -> MaterialResponse:
    return material_service.create_material(db, payload)


@router.patch(
    "/admin/materials/{material_id}",
    response_model=MaterialResponse,
    dependencies=[Depends(get_current_user)],
    summary="Actualizar material existente",
)
async def update_material(
    material_id: int,
    payload: MaterialUpdateInput,
    db: Session = Depends(get_db),
) -> MaterialResponse:
    return material_service.update_material(db, material_id, payload)


@router.delete(
    "/admin/materials/{material_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(get_current_user)],
    summary="Eliminar material (protegido por FK ON DELETE RESTRICT si tiene pedidos)",
)
async def delete_material(
    material_id: int,
    db: Session = Depends(get_db),
) -> Response:
    material_service.delete_material(db, material_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
