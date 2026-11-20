"""Schemas for dashboard KPI summary and priority queue."""

from __future__ import annotations

from typing import Dict, List

from pydantic import BaseModel

from app.schemas.order import OrderResponse


class DashboardSummaryResponse(BaseModel):
    pending_orders_count: int
    in_production_count: int
    today_deliveries_count: int
    overdue_deliveries_count: int
    today_sales_total: float
    today_collected_total: float
    month_sales_total: float
    month_collected_total: float
    month_pending_balance: float
    status_breakdown: Dict[str, int]
    upcoming_deliveries: List[OrderResponse]
