from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class PresenceIn(BaseModel):
    agent_id: str = Field(..., min_length=3, max_length=64)
    platform: str = Field(default="", max_length=32)
    status: str = Field(default="online", max_length=32)


class AgentOut(BaseModel):
    agent_id: str
    login: str
    firm_id: str
    inn: str
    firm_name: str
    platform: str
    status: str
    last_seen: str


class ConnectIn(BaseModel):
    agent_id: str = Field(..., min_length=3, max_length=64)


class ConnectOut(BaseModel):
    session_id: str
    agent_id: str
    inn: str
    firm_name: str
    status: str
    # для админ-клиента: открыть rustdesk:// или --connect
    connect_hint: str = ""


class RespondIn(BaseModel):
    allow: bool


class PublicConfigOut(BaseModel):
    rd_host: str
    rd_key: str
    helper_windows_url: str = "/api/v1/support/download/helper-windows?arch=x64"
    helper_windows_x86_url: str = "/api/v1/support/download/helper-windows?arch=x86"
    admin_windows_url: str = "/api/v1/support/download/admin-windows?arch=x64"
    admin_windows_x86_url: str = "/api/v1/support/download/admin-windows?arch=x86"
    helper_macos_url: str = "/static/remote/EKLK-Helper-macOS.zip"
    remote_env_example_url: str = "/static/remote/eklk-remote.env.example"
    helper_windows_legacy_url: str = "/static/remote/EKLK-Helper-Setup.exe"
    admin_windows_legacy_url: str = "/static/remote/EKLK-Admin-Setup.exe"
    enabled: bool = True
