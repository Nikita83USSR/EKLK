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
    money_balance: Optional[float] = None  # CASH + CREDIT_CARD
    offset_balance: Optional[float] = None  # PRE_PAID
    by_payment_type: Optional[dict] = None
    raw: Optional[dict] = None


class ReportHistoryItem(BaseModel):
    id: str
    reportType: str
    params: dict
    fetchedAt: str
    summary: Optional[dict] = None


class InvoiceReportItem(BaseModel):
    """Строка отчёта по платежам INVC (без ФИО — обогащается на клиенте)."""
    uuid: str
    order_id: Optional[int] = None
    external_id: Optional[str] = None
    date: Optional[str] = None
    total: Optional[float] = None
    status: Optional[str] = None
    store_id: Optional[int] = None
    store_name: Optional[str] = None
    # заполняется на клиенте из atol-5 / atol-4
    client_name: Optional[str] = None


class InvoiceReportResponse(BaseModel):
    reportType: str = "INVOICE_PAYMENTS"
    since: Optional[str] = None
    until: Optional[str] = None
    store_id: Optional[int] = None
    items: List[InvoiceReportItem] = []
    total_count: int = 0
    total_sum: float = 0.0
    pages_scanned: int = 0
    raw_scanned: int = 0
