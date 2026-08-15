from pydantic import BaseModel, Field
from typing import Optional


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, description="Логин EcomKassa (email)")
    password: str = Field(..., min_length=1)
    group_code: Optional[str] = Field(
        default=None,
        description="ID магазина / group_code (по умолчанию из .env, обычно 990)",
    )


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    id: int = 0
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: str = "operator"
