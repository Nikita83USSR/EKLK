from pydantic import BaseModel, Field
from typing import Optional, List, Any


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, description="Логин EcomKassa (регистр букв сохраняется, не lower)")
    password: str = Field(..., min_length=1)


class StoreOut(BaseModel):
    store_id: int | str
    store_name: str
    store_address: Optional[str] = None


class FirmOut(BaseModel):
    firm_id: Optional[str] = None
    firm_name: Optional[str] = None
    tax_identity: Optional[str] = None
    tax_variant: Optional[str] = None
    stores: List[StoreOut] = []


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    firm: Optional[FirmOut] = None
    selected_store_id: Optional[int | str] = None


class UserOut(BaseModel):
    id: int = 0
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: str = "operator"
    firm: Optional[FirmOut] = None
    selected_store_id: Optional[int | str] = None


class SelectStoreRequest(BaseModel):
    store_id: int | str = Field(..., description="storeId из профиля фирмы (group_code кассы)")


def firm_from_payload(payload: dict | None) -> Optional[FirmOut]:
    if not payload:
        return None
    stores = []
    for s in payload.get("stores") or []:
        stores.append(
            StoreOut(
                store_id=s.get("storeId"),
                store_name=s.get("storeName") or str(s.get("storeId")),
                store_address=s.get("storeAddress"),
            )
        )
    return FirmOut(
        firm_id=payload.get("firmId"),
        firm_name=payload.get("firmName"),
        tax_identity=payload.get("taxIdentity"),
        tax_variant=payload.get("taxVariant"),
        stores=stores,
    )
