"""
User + firm preferences in SQLite.

Design for future fields without breaking old rows:
  - Stored payload is a JSON object in column `data`.
  - CURRENT_SCHEMA_VERSION documents the app's expected shape.
  - USER_DEFAULTS / FIRM_DEFAULTS supply missing keys on read.
  - PUT merges shallowly: existing keys kept, patch overwrites, unknown
    keys in DB are preserved (forward + backward compatible).
  - If schema_version in row < CURRENT, we can run migrations later;
    for now only fill defaults.

Security: login and firm_id are NEVER taken from the client body —
only from CurrentUser / session (EcomKassa-backed).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import FirmSettings, UserSettings

CURRENT_SCHEMA_VERSION = 1

# Defaults applied on read when key absent in stored JSON (old rows).
USER_DEFAULTS: dict[str, Any] = {
    "theme": "light",
    "last_pay_type": None,
}

FIRM_DEFAULTS: dict[str, Any] = {
    "selected_store_id": None,
}

# Keys the client is allowed to write (whitelist). Extra client keys ignored.
USER_WRITABLE = frozenset({"theme", "last_pay_type"})
FIRM_WRITABLE = frozenset({"selected_store_id"})

ALLOWED_THEMES = frozenset({"light", "dark", "glass"})


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _dump(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def merge_with_defaults(stored: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    """defaults ← stored (stored wins). Preserves unknown keys from stored for future readers."""
    out = dict(defaults)
    out.update(stored)
    return out


def _sanitize_user_patch(patch: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for k, v in patch.items():
        if k not in USER_WRITABLE:
            continue
        if k == "theme":
            if v is None:
                continue
            s = str(v).strip().lower()
            if s not in ALLOWED_THEMES:
                continue
            clean[k] = s
        elif k == "last_pay_type":
            if v is None or v == "":
                clean[k] = None
            else:
                clean[k] = str(v).strip()
    return clean


def _sanitize_firm_patch(patch: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for k, v in patch.items():
        if k not in FIRM_WRITABLE:
            continue
        if k == "selected_store_id":
            if v is None or v == "":
                clean[k] = None
            else:
                clean[k] = str(v).strip()
    return clean


async def get_user_data(db: AsyncSession, login: str) -> dict[str, Any]:
    row = await db.get(UserSettings, login)
    stored = _parse(row.data if row else None)
    return merge_with_defaults(stored, USER_DEFAULTS)


async def get_firm_data(db: AsyncSession, firm_id: str | None) -> dict[str, Any]:
    if not firm_id:
        return dict(FIRM_DEFAULTS)
    row = await db.get(FirmSettings, str(firm_id))
    stored = _parse(row.data if row else None)
    return merge_with_defaults(stored, FIRM_DEFAULTS)


async def get_settings(db: AsyncSession, login: str, firm_id: str | None) -> dict[str, Any]:
    user = await get_user_data(db, login)
    firm = await get_firm_data(db, firm_id)
    return {
        "user": user,
        "firm": firm,
        "schema_version": CURRENT_SCHEMA_VERSION,
    }


async def patch_user(db: AsyncSession, login: str, patch: dict[str, Any]) -> dict[str, Any]:
    clean = _sanitize_user_patch(patch)
    row = await db.get(UserSettings, login)
    if row is None:
        data = dict(USER_DEFAULTS)
        data.update(clean)
        row = UserSettings(
            login=login,
            data=_dump(data),
            schema_version=CURRENT_SCHEMA_VERSION,
            updated_at=_utcnow(),
        )
        db.add(row)
    else:
        data = _parse(row.data)
        data.update(clean)
        row.data = _dump(data)
        row.schema_version = max(row.schema_version or 1, CURRENT_SCHEMA_VERSION)
        row.updated_at = _utcnow()
    await db.commit()
    return merge_with_defaults(_parse(row.data), USER_DEFAULTS)


async def patch_firm(db: AsyncSession, firm_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    clean = _sanitize_firm_patch(patch)
    fid = str(firm_id)
    row = await db.get(FirmSettings, fid)
    if row is None:
        data = dict(FIRM_DEFAULTS)
        data.update(clean)
        row = FirmSettings(
            firm_id=fid,
            data=_dump(data),
            schema_version=CURRENT_SCHEMA_VERSION,
            updated_at=_utcnow(),
        )
        db.add(row)
    else:
        data = _parse(row.data)
        data.update(clean)
        row.data = _dump(data)
        row.schema_version = max(row.schema_version or 1, CURRENT_SCHEMA_VERSION)
        row.updated_at = _utcnow()
    await db.commit()
    return merge_with_defaults(_parse(row.data), FIRM_DEFAULTS)


async def update_settings(
    db: AsyncSession,
    login: str,
    firm_id: str | None,
    user_patch: Optional[dict[str, Any]] = None,
    firm_patch: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    if user_patch:
        await patch_user(db, login, user_patch)
    if firm_patch and firm_id:
        await patch_firm(db, firm_id, firm_patch)
    return await get_settings(db, login, firm_id)


def firm_id_from_user(user: dict) -> str | None:
    firm = user.get("firm") or {}
    fid = firm.get("firmId") or firm.get("firm_id")
    if fid is None or fid == "":
        return None
    return str(fid)
