"""
Auth Schemas
"""

from typing import Optional
from pydantic import BaseModel, EmailStr, Field, ConfigDict


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class TokenPayload(BaseModel):
    sub: str
    exp: int
    iat: Optional[int] = None
    type: str = "access"
    role: Optional[str] = None


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=100, description="Username or email")
    password: str = Field(..., min_length=6, max_length=128)


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=100, pattern=r"^[a-zA-Z0-9_]+$")
    password: str = Field(..., min_length=8, max_length=128)
    full_name: Optional[str] = Field(None, max_length=255)
    role: Optional[str] = Field(default="cashier", description="admin | cashier | manager")


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    username: str
    full_name: Optional[str] = None
    role: str
    is_active: bool
    is_verified: bool
    created_at: str
    last_login_at: Optional[str] = None
