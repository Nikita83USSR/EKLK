from typing import Optional, List, Any
from pydantic import BaseModel, Field, field_validator
import re


class CheckItemIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    price: float = Field(..., ge=0)
    quantity: float = Field(default=1, gt=0)
    sum: Optional[float] = None
    vat_type: str = Field(default="vat20", description="none|vat0|vat10|vat20|vat110|vat120")
    payment_method: str = Field(default="full_payment")
    payment_object: int | str = Field(default=1, description="1=commodity, 3=service, ...")
    measure: int = Field(default=0)
    is_agent: bool = Field(default=False, description="Применить agent_info к этой позиции")


class ClientIn(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    inn: Optional[str] = None

    @field_validator("phone")
    @classmethod
    def phone_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        digits = re.sub(r"\D", "", v)
        # 10 digits (mobile without country) or 11 (7/8 + 10 digits)
        if len(digits) not in (10, 11):
            raise ValueError(
                "Телефон должен содержать 10 или 11 цифр. Пример: +79001234567"
            )
        return v

    @field_validator("email")
    @classmethod
    def email_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Некорректный email")
        return v

    @field_validator("inn")
    @classmethod
    def client_inn_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        digits = re.sub(r"\D", "", v)
        if len(digits) not in (10, 12):
            raise ValueError(
                f"ИНН покупателя: 10 или 12 цифр, сейчас {len(digits)}"
            )
        return digits


class CompanyIn(BaseModel):
    email: Optional[str] = None
    inn: Optional[str] = None
    sno: str = Field(default="osn", description="osn|usn_income|usn_income_outcome|esn|patent")
    payment_address: Optional[str] = None


class PaymentIn(BaseModel):
    type: int = Field(..., description="1=cash/electronic fiscal, 103=Sber, 121=Sber SBP, ...")
    sum: float = Field(..., gt=0)


class AgentInfoIn(BaseModel):
    """Атол v5 / ФФД 1.2 agent_info + supplier_info."""
    type: str = Field(
        ...,
        description="bank_paying_agent|bank_paying_subagent|paying_agent|paying_subagent|attorney|commission_agent|another",
    )
    # paying_agent
    paying_operation: Optional[str] = None
    paying_phones: Optional[str] = None  # comma-separated, normalized later
    # receive_payments_operator
    receive_phones: Optional[str] = None
    # money_transfer_operator
    transfer_phones: Optional[str] = None
    transfer_name: Optional[str] = None
    transfer_address: Optional[str] = None
    transfer_inn: Optional[str] = None
    # supplier_info (обязателен при agent_info)
    supplier_name: Optional[str] = None
    supplier_phones: Optional[str] = None
    supplier_inn: Optional[str] = None

    @field_validator("supplier_inn", "transfer_inn")
    @classmethod
    def inn_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        digits = re.sub(r"\D", "", v)
        if len(digits) not in (10, 12):
            raise ValueError(
                f"ИНН должен содержать 10 (юрлицо) или 12 (ИП) цифр, сейчас {len(digits)}: «{v}»"
            )
        return digits

    @field_validator("supplier_phones", "paying_phones", "receive_phones", "transfer_phones")
    @classmethod
    def phones_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        # at least one number with 10-11 digits
        parts = re.split(r"[,;]+", v)
        ok = False
        for part in parts:
            d = re.sub(r"\D", "", part)
            if len(d) == 11 and d[0] in "78":
                ok = True
            elif len(d) == 10 and d[0] == "9":
                ok = True
        if not ok:
            raise ValueError(
                f"Телефон агента/поставщика: формат +79001234567, сейчас «{v}»"
            )
        return v


class AdditionalUserPropsIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    value: str = Field(..., min_length=1, max_length=256)


class CreateCheckRequest(BaseModel):
    external_id: Optional[str] = None
    items: List[CheckItemIn] = Field(..., min_length=1)
    payments: List[PaymentIn] = Field(..., min_length=1)
    client: Optional[ClientIn] = None
    company: Optional[CompanyIn] = None
    sno: str = "osn"
    success_url: Optional[str] = None
    callback_url: Optional[str] = None
    agent: Optional[AgentInfoIn] = None
    additional_user_props: Optional[AdditionalUserPropsIn] = None


class CreateRefundRequest(BaseModel):
    external_id: Optional[str] = None
    items: List[CheckItemIn] = Field(..., min_length=1)
    payments: List[PaymentIn] = Field(..., min_length=1)
    client: Optional[ClientIn] = None
    company: Optional[CompanyIn] = None
    sno: str = "osn"
    original_uuid: Optional[str] = None


class CheckResponse(BaseModel):
    uuid: Optional[str] = None
    external_id: Optional[str] = None
    status: Optional[str] = None
    kind: Optional[str] = None
    permalink: Optional[str] = None
    error: Optional[Any] = None
    invoice_payload: Optional[dict] = None
    payload: Optional[dict] = None
    timestamp: Optional[str] = None
    raw: Optional[dict] = None
