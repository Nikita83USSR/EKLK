"""
Payment Schemas
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator


class PaymentCreate(BaseModel):
    check_id: int = Field(..., gt=0)
    amount: Decimal = Field(..., gt=0, max_digits=14, decimal_places=2)
    method: str = Field(default="cash", description="cash | card | sbp | electronic | other")
    description: Optional[str] = None
    external_id: Optional[str] = Field(None, max_length=128)

    @field_validator("amount", mode="before")
    @classmethod
    def coerce_decimal(cls, v):
        if isinstance(v, (int, float, str)):
            return Decimal(str(v))
        return v


class PaymentUpdateStatus(BaseModel):
    status: str = Field(..., description="pending | processing | completed | failed | cancelled | refunded")
    external_id: Optional[str] = None
    external_status: Optional[str] = None
    error_message: Optional[str] = None


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    payment_number: str
    check_id: int
    amount: Decimal
    method: str
    status: str
    external_id: Optional[str] = None
    external_status: Optional[str] = None
    description: Optional[str] = None
    error_message: Optional[str] = None
    is_refund: bool
    created_by: int
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None


class PaymentListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    payment_number: str
    check_id: int
    amount: Decimal
    method: str
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None
