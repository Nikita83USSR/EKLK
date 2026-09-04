from typing import Optional, List, Any
from pydantic import BaseModel, Field


class OrderSearchRequest(BaseModel):
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=30, ge=1, le=500)
    external_id: Optional[str] = None
    since: Optional[str] = Field(default=None, description="ISO local datetime without Z, e.g. 2026-01-01T00:00:00")
    until: Optional[str] = Field(default=None, description="ISO local datetime without Z")
    order_types: Optional[List[str]] = Field(
        default=None,
        description="VCHR | INVC | CORD",
    )


class OrderListItem(BaseModel):
    order_id: Optional[int] = None
    external_id: Optional[str] = None
    updated: Optional[str] = None
    order_type: Optional[str] = None
    status: Optional[str] = None
    total: Optional[float] = None
    firm_id: Optional[str] = None
    store_id: Optional[int] = None
    store_name: Optional[str] = None
    cashier_name: Optional[str] = None
    is_sale: Optional[bool] = None
    is_correction: Optional[bool] = None
    raw: Optional[dict] = None


class OrderSearchResponse(BaseModel):
    query: Optional[dict] = None
    result: List[OrderListItem] = []
    total_returned: int = 0


class OrderDetailResponse(BaseModel):
    summary: Optional[OrderListItem] = None
    atol5: Optional[dict] = None
    fiscal: Optional[dict] = None  # fiscalorder report (payload ФД, ОФД и т.д.)
    raw_summary: Optional[dict] = None
