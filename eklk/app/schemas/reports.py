from typing import Optional, List, Any
from pydantic import BaseModel, Field


class ReportPoint(BaseModel):
    time: Optional[str] = None
    cashier: Optional[str] = None
    storeId: Optional[int] = None
    storeName: Optional[str] = None
    paymentType: Optional[str] = None
    amount: Optional[float] = None


class ReportResponse(BaseModel):
    reportType: Optional[str] = None
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    orderTypes: Optional[List[str]] = None
    firmId: Optional[str] = None
    firmName: Optional[str] = None
    points: List[ReportPoint] = []
    # Aggregates for accountant (computed)
    summary: Optional[dict] = None
    cash_drawer: Optional[float] = None  # physical cash (CASH only)
    by_payment_type: Optional[dict] = None
    raw: Optional[dict] = None


class ReportHistoryItem(BaseModel):
    id: str
    reportType: str
    params: dict
    fetchedAt: str
    summary: Optional[dict] = None
