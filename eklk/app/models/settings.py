"""Persisted preferences.

Keys are server-side only:
  - UserSettings.login  = EcomKassa login (from JWT/session)
  - FirmSettings.firm_id = firmId from EcomKassa profile in session

Payload lives in JSON column `data` so new preference keys can be added
without altering the table schema. Missing keys are filled from defaults
in the service layer (forward-compatible with older rows).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserSettings(Base):
    __tablename__ = "user_settings"

    login: Mapped[str] = mapped_column(String(255), primary_key=True)
    # JSON object as text for broad SQLite/SQLAlchemy compatibility
    data: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class FirmSettings(Base):
    __tablename__ = "firm_settings"

    firm_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
