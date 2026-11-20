"""Protected dashboard KPI and summary router."""

from fastapi import APIRouter, Depends

from app.core.security import get_current_user
from app.schemas.dashboard import DashboardSummaryResponse
from app.services.order_service import order_service

router = APIRouter(
    prefix="/dashboard",
    tags=["Dashboard"],
    dependencies=[Depends(get_current_user)],
)


@router.get(
    "/summary",
    response_model=DashboardSummaryResponse,
    summary="Resumen KPI de trabajos pendientes, entregas del día y ventas",
)
async def get_dashboard_summary() -> DashboardSummaryResponse:
    return order_service.get_dashboard_summary()
