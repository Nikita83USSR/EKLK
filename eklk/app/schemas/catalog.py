from typing import Optional, List, Any
from pydantic import BaseModel, Field


class CatalogItemIn(BaseModel):
    name: str
    sku: Optional[str] = Field(default="", description="Пустой → сгенерируем уникальный")
    price: float = 0
    vatType: str = Field(default="VAT_NONE", description="VAT_NONE | VAT_10PCT | ...")
    paymentObject: str = Field(default="COMMODITY", description="COMMODITY | SERVICE | ...")


class CatalogItemOut(BaseModel):
    itemId: Optional[int] = None
    name: Optional[str] = None
    sku: Optional[str] = None
    price: Optional[float] = None
    vatType: Optional[str] = None
    paymentObject: Optional[str] = None
    taxId: Optional[str] = None
    raw: Optional[dict] = None


class CatalogListResponse(BaseModel):
    items: List[CatalogItemOut] = []
    currentPage: int = 1
    totalPages: int = 1
    size: int = 50


class CatalogBulkDeleteRequest(BaseModel):
    item_ids: List[int] = Field(default_factory=list)


class CatalogImportResult(BaseModel):
    total: int = 0
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors_count: int = 0
    generated_sku: int = 0
    errors: List[str] = []
    items: List[CatalogItemOut] = []
    report: Optional[dict] = None
