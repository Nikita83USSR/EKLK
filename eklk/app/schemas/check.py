"""
Check (Чек) Schemas
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict, field_validator


class CheckItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    quantity: Decimal = Field(default=Decimal("1.000"), gt=0, max_digits=12, decimal_places=3)
    price: Decimal = Field(..., ge=0, max_digits=14, decimal_places=2)
    vat_rate: Decimal = Field(default=Decimal("20.00"), ge=0, le=100, max_digits=5, decimal_places=2)
    product_code: Optional[str] = Field(None, max_length=64)
    unit: Optional[str] = Field(default="шт", max_length=32)

    @field_validator("quantity", "price", "vat_rate", mode="before")
    @classmethod
    def coerce_decimal(cls, v):
        if isinstance(v, (int, float, str)):
            return Decimal(str(v))
        return v


class CheckItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    quantity: Decimal
    price: Decimal
    amount: Decimal
    vat_rate: Decimal
    vat_amount: Decimal
    product_code: Optional[str] = None
    unit: Optional[str] = None


class CheckCreate(BaseModel):
    check_type: str = Field(default="sale", description="sale | refund | expense | refund_expense")
    items: List[CheckItemCreate] = Field(..., min_length=1)
    customer_email: Optional[str] = None
    customer_phone: Optional[str] = Field(None, max_length=32)
    customer_name: Optional[str] = Field(None, max_length=255)
    comment: Optional[str] = None
    discount_amount: Decimal = Field(default=Decimal("0.00"), ge=0)

    @field_validator("discount_amount", mode="before")
    @classmethod
    def coerce_decimal(cls, v):
        if isinstance(v, (int, float, str)):
            return Decimal(str(v))
        return v


class CheckUpdateStatus(BaseModel):
    status: str = Field(..., description="created | paid | cancelled | refunded")
    comment: Optional[str] = None


class CheckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    check_number: str
    check_type: str
    status: str
    total_amount: Decimal
    vat_amount: Decimal
    discount_amount: Decimal
    customer_email: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_name: Optional[str] = None
    comment: Optional[str] = None
    fiscal_sign: Optional[str] = None
    fiscal_document_number: Optional[int] = None
    is_archived: bool
    created_by: int
    created_at: datetime
    updated_at: datetime
    paid_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    items: List[CheckItemOut] = []


class CheckListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    check_number: str
    check_type: str
    status: str
    total_amount: Decimal
    created_at: datetime
    paid_at: Optional[datetime] = None
