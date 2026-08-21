"""Schemas for EcomKassa receipt templates (reusable QR Pay links)."""

from typing import Optional, List, Any
from pydantic import BaseModel, Field


class QrPayIn(BaseModel):
    """Настройки многоразовой ссылки QR Pay для шаблона."""

    allowedProviders: List[str] = Field(
        default_factory=list,
        description="Коды платёжных провайдеров (SBERBANK, YOOKASSA, …)",
    )
    storeId: int = Field(..., description="ID точки продаж (магазина)")
    userId: Optional[str] = Field(
        default=None,
        description="UUID пользователя-кассира (подставляется на бэке, если пусто)",
    )


class TemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128, description="Наименование шаблона")
    product: Optional[str] = Field(default=None, description="Наименование товара/услуги")
    price: Optional[float] = Field(default=None, ge=0)
    count: Optional[float] = Field(default=1, gt=0)
    vat: Optional[str] = Field(default="none")
    paymentMethod: Optional[str] = Field(default="full_prepayment")
    paymentObject: Optional[str] = Field(default="service")
    operationType: Optional[str] = Field(default="sell")
    agentType: Optional[str] = Field(default="non_agent")
    requireClientEmail: Optional[bool] = Field(default=True)
    requireClientPhone: Optional[bool] = Field(default=False)
    requireClientData: Optional[bool] = Field(default=False)
    isDefault: Optional[bool] = Field(default=False)
    preferredPaymentType: Optional[str] = Field(default=None)
    supplierPhone: Optional[str] = None
    supplierName: Optional[str] = None
    supplierInn: Optional[str] = None
    harvestEmail: Optional[str] = None
    userProperty: Optional[str] = None
    qrPay: Optional[QrPayIn] = None


class TemplateUpdate(TemplateCreate):
    """Тело PUT — те же поля, name обязателен по API."""

    pass


class TemplateOut(BaseModel):
    templateId: Optional[str] = None
    name: Optional[str] = None
    product: Optional[str] = None
    price: Optional[float] = None
    count: Optional[float] = None
    vat: Optional[str] = None
    paymentMethod: Optional[str] = None
    paymentObject: Optional[str] = None
    operationType: Optional[str] = None
    agentType: Optional[str] = None
    isDefault: Optional[bool] = None
    requireClientEmail: Optional[bool] = None
    requireClientPhone: Optional[bool] = None
    requireClientData: Optional[bool] = None
    preferredPaymentType: Optional[str] = None
    supplierPhone: Optional[str] = None
    supplierName: Optional[str] = None
    supplierInn: Optional[str] = None
    harvestEmail: Optional[str] = None
    userProperty: Optional[str] = None
    qrPay: Optional[dict] = None
    # Удобная ссылка на многоразовый QR Pay (собираем на бэке)
    qrpay_url: Optional[str] = None
    raw: Optional[Any] = None
