"""Online support agents (RustDesk helper presence)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SupportAgent(Base):
    """Клиент с запущенным помощником: agent_id = RustDesk ID."""

    __tablename__ = "support_agents"

    agent_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    login: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    firm_id: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    inn: Mapped[str] = mapped_column(String(32), nullable=False, default="", index=True)
    firm_name: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    platform: Mapped[str] = mapped_column(String(32), nullable=False, default="")  # windows|macos
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="online")
    # online | ringing | busy | offline
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
    meta_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")


class SupportSession(Base):
    """Запрос/сессия подключения админа к агенту."""

    __tablename__ = "support_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    admin_login: Mapped[str] = mapped_column(String(255), nullable=False)
    client_login: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    inn: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ringing")
    # ringing | allowed | denied | ended
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
