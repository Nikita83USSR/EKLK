"""
User + firm preferences in SQLite.

Design for future fields without breaking old rows:
  - Stored payload is a JSON object in column `data`.
  - CURRENT_SCHEMA_VERSION documents the app's expected shape.
  - USER_DEFAULTS / FIRM_DEFAULTS supply missing keys on read.
  - PUT merges shallowly: existing keys kept, patch overwrites, unknown
    keys in DB are preserved (forward + backward compatible).

Resilience (DB down / row deleted / corrupt JSON / bad schema):
  - Reads never raise to the caller — return defaults + degraded=True.
  - Writes try to persist; on failure return optimistic merge + degraded=True.
  - Auth / checks / payments must not depend on settings DB health.

Security: login and firm_id are NEVER taken from the client body —
only from CurrentUser / session (EcomKassa-backed).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import FirmSettings, UserSettings

logger = logging.getLogger("eklk.settings")

CURRENT_SCHEMA_VERSION = 1

USER_DEFAULTS: dict[str, Any] = {
    "theme": "light",
    "last_pay_type": None,
    "selected_store_id": None,  # per-login default store (was firm-level)
}

# Org-level prefs (reserved for future shared org settings)
FIRM_DEFAULTS: dict[str, Any] = {}

USER_WRITABLE = frozenset({"theme", "last_pay_type", "selected_store_id"})
FIRM_WRITABLE = frozenset()  # no firm keys for now

ALLOWED_THEMES = frozenset({"light", "dark", "glass"})


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse(raw: str | None) -> dict[str, Any]:
    """Corrupt / non-object JSON → empty dict (defaults fill the rest)."""
    if not raw:
        return {}
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {}
    except (json.JSONDecodeError, TypeError, ValueError):
        logger.warning("settings: corrupt JSON payload, using empty object")
        return {}


def _dump(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def merge_with_defaults(stored: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    out = dict(defaults)
    if isinstance(stored, dict):
        out.update(stored)
    return out


def empty_settings_payload(*, degraded: bool = False, reason: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "user": dict(USER_DEFAULTS),
        "firm": dict(FIRM_DEFAULTS),
        "schema_version": CURRENT_SCHEMA_VERSION,
        "degraded": degraded,
    }
    if degraded and reason:
        payload["degraded_reason"] = reason
    return payload


def _sanitize_user_patch(patch: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(patch, dict):
        return {}
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
        elif k == "selected_store_id":
            if v is None or v == "":
                clean[k] = None
            else:
                clean[k] = str(v).strip()
    return clean


def _sanitize_firm_patch(patch: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(patch, dict):
        return {}
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


def firm_id_from_user(user: dict) -> str | None:
    firm = user.get("firm") or {}
    fid = firm.get("firmId") or firm.get("firm_id")
    if fid is None or fid == "":
        return None
    return str(fid)


# ── core (may raise) ─────────────────────────────────────────────────


async def _get_user_data_raw(db: AsyncSession, login: str) -> dict[str, Any]:
    row = await db.get(UserSettings, login)
    stored = _parse(row.data if row else None)
    return merge_with_defaults(stored, USER_DEFAULTS)


async def _get_firm_data_raw(db: AsyncSession, firm_id: str | None) -> dict[str, Any]:
    if not firm_id:
        return dict(FIRM_DEFAULTS)
    row = await db.get(FirmSettings, str(firm_id))
    stored = _parse(row.data if row else None)
    return merge_with_defaults(stored, FIRM_DEFAULTS)


async def _patch_user_raw(db: AsyncSession, login: str, patch: dict[str, Any]) -> dict[str, Any]:
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
        try:
            row.schema_version = max(int(row.schema_version or 1), CURRENT_SCHEMA_VERSION)
        except (TypeError, ValueError):
            row.schema_version = CURRENT_SCHEMA_VERSION
        row.updated_at = _utcnow()
    await db.commit()
    return merge_with_defaults(_parse(row.data), USER_DEFAULTS)


async def _patch_firm_raw(db: AsyncSession, firm_id: str, patch: dict[str, Any]) -> dict[str, Any]:
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
        try:
            row.schema_version = max(int(row.schema_version or 1), CURRENT_SCHEMA_VERSION)
        except (TypeError, ValueError):
            row.schema_version = CURRENT_SCHEMA_VERSION
        row.updated_at = _utcnow()
    await db.commit()
    return merge_with_defaults(_parse(row.data), FIRM_DEFAULTS)


# ── safe public API (never raises for operational DB errors) ──────────


async def get_user_data(db: AsyncSession, login: str) -> dict[str, Any]:
    try:
        return await _get_user_data_raw(db, login)
    except Exception as e:
        logger.warning("settings get_user failed login=%s: %s", login, e, exc_info=True)
        try:
            await db.rollback()
        except Exception:
            pass
        return dict(USER_DEFAULTS)


async def get_firm_data(db: AsyncSession, firm_id: str | None) -> dict[str, Any]:
    try:
        return await _get_firm_data_raw(db, firm_id)
    except Exception as e:
        logger.warning("settings get_firm failed firm_id=%s: %s", firm_id, e, exc_info=True)
        try:
            await db.rollback()
        except Exception:
            pass
        return dict(FIRM_DEFAULTS)


async def get_settings(db: AsyncSession, login: str, firm_id: str | None) -> dict[str, Any]:
    """Always returns a usable payload. degraded=True if DB/schema issues."""
    try:
        user = await _get_user_data_raw(db, login)
        firm = await _get_firm_data_raw(db, firm_id)
        # One-time compatibility: store was firm-level; copy into user if missing
        if not user.get("selected_store_id") and isinstance(firm, dict):
            legacy = firm.get("selected_store_id")
            if legacy is not None and legacy != "":
                try:
                    user = await _patch_user_raw(
                        db, login, {"selected_store_id": legacy}
                    )
                except Exception as e:
                    logger.warning("settings legacy store migrate failed: %s", e)
                    user = merge_with_defaults(
                        {**user, "selected_store_id": str(legacy)}, USER_DEFAULTS
                    )
        return {
            "user": user,
            "firm": firm,
            "schema_version": CURRENT_SCHEMA_VERSION,
            "degraded": False,
        }
    except Exception as e:
        logger.warning(
            "settings get_settings failed login=%s firm_id=%s: %s",
            login,
            firm_id,
            e,
            exc_info=True,
        )
        try:
            await db.rollback()
        except Exception:
            pass
        return empty_settings_payload(degraded=True, reason="db_read_failed")


async def patch_user(db: AsyncSession, login: str, patch: dict[str, Any]) -> dict[str, Any]:
    try:
        return await _patch_user_raw(db, login, patch)
    except Exception as e:
        logger.warning("settings patch_user failed login=%s: %s", login, e, exc_info=True)
        try:
            await db.rollback()
        except Exception:
            pass
        # Optimistic: what the client asked for, merged with defaults (not persisted)
        return merge_with_defaults(_sanitize_user_patch(patch), USER_DEFAULTS)


async def patch_firm(db: AsyncSession, firm_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    try:
        return await _patch_firm_raw(db, firm_id, patch)
    except Exception as e:
        logger.warning("settings patch_firm failed firm_id=%s: %s", firm_id, e, exc_info=True)
        try:
            await db.rollback()
        except Exception:
            pass
        return merge_with_defaults(_sanitize_firm_patch(patch), FIRM_DEFAULTS)


async def update_settings(
    db: AsyncSession,
    login: str,
    firm_id: str | None,
    user_patch: Optional[dict[str, Any]] = None,
    firm_patch: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Persist what we can. On any failure return merged view + degraded.
    Session / auth path must not break if this fails.
    """
    degraded = False
    reason: str | None = None
    user_out = dict(USER_DEFAULTS)
    firm_out = dict(FIRM_DEFAULTS)

    try:
        if user_patch:
            try:
                user_out = await _patch_user_raw(db, login, user_patch)
            except Exception as e:
                degraded = True
                reason = "db_write_user_failed"
                logger.warning("settings update user failed: %s", e, exc_info=True)
                try:
                    await db.rollback()
                except Exception:
                    pass
                user_out = merge_with_defaults(_sanitize_user_patch(user_patch), USER_DEFAULTS)
        else:
            try:
                user_out = await _get_user_data_raw(db, login)
            except Exception as e:
                degraded = True
                reason = reason or "db_read_user_failed"
                logger.warning("settings read user failed: %s", e, exc_info=True)
                try:
                    await db.rollback()
                except Exception:
                    pass

        if firm_patch and firm_id:
            try:
                firm_out = await _patch_firm_raw(db, firm_id, firm_patch)
            except Exception as e:
                degraded = True
                reason = reason or "db_write_firm_failed"
                logger.warning("settings update firm failed: %s", e, exc_info=True)
                try:
                    await db.rollback()
                except Exception:
                    pass
                firm_out = merge_with_defaults(_sanitize_firm_patch(firm_patch), FIRM_DEFAULTS)
        else:
            try:
                firm_out = await _get_firm_data_raw(db, firm_id)
            except Exception as e:
                degraded = True
                reason = reason or "db_read_firm_failed"
                logger.warning("settings read firm failed: %s", e, exc_info=True)
                try:
                    await db.rollback()
                except Exception:
                    pass
    except Exception as e:
        # Catastrophic (e.g. session object broken)
        logger.error("settings update_settings catastrophic: %s", e, exc_info=True)
        degraded = True
        reason = "db_unavailable"
        if user_patch:
            user_out = merge_with_defaults(_sanitize_user_patch(user_patch), USER_DEFAULTS)
        if firm_patch:
            firm_out = merge_with_defaults(_sanitize_firm_patch(firm_patch), FIRM_DEFAULTS)

    payload: dict[str, Any] = {
        "user": user_out,
        "firm": firm_out,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "degraded": degraded,
    }
    if degraded and reason:
        payload["degraded_reason"] = reason
    return payload


def sanitize_user_patch(patch: dict[str, Any]) -> dict[str, Any]:
    return _sanitize_user_patch(patch)


def sanitize_firm_patch(patch: dict[str, Any]) -> dict[str, Any]:
    return _sanitize_firm_patch(patch)
