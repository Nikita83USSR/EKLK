from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class UserSettingsData(BaseModel):
    theme: Optional[str] = Field(None, description="light | dark | glass")
    last_pay_type: Optional[str] = Field(None, description="Last selected payment provider id")


class FirmSettingsData(BaseModel):
    selected_store_id: Optional[str | int] = Field(None, description="Default storeId / group_code")


class SettingsOut(BaseModel):
    user: dict[str, Any] = Field(default_factory=dict)
    firm: dict[str, Any] = Field(default_factory=dict)
    schema_version: int = 1
    # True when response is defaults/optimistic because DB was unavailable or corrupt
    degraded: bool = False
    degraded_reason: Optional[str] = None


class SettingsUpdate(BaseModel):
    """Partial update. Only provided keys are merged. Client must NOT send login/firm_id."""

    user: Optional[dict[str, Any]] = None
    firm: Optional[dict[str, Any]] = None
