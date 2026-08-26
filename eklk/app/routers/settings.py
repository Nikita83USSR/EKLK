"""
GET/PUT user+firm preferences.

Keys (login, firm_id) come only from session.
DB failures → 200 + defaults/optimistic merge + degraded=true (app keeps working).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db import get_db
from app.schemas.settings import SettingsOut, SettingsUpdate
from app.services import settings_service as svc
from app.utils.logger import log_action

logger = logging.getLogger("eklk.settings.router")

router = APIRouter(prefix="/auth/settings", tags=["Settings"])


def _firm_id(user: dict) -> str | None:
    return svc.firm_id_from_user(user)


@router.get("", response_model=SettingsOut)
async def get_settings(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    login = str(user["username"])
    try:
        data = await svc.get_settings(db, login, _firm_id(user))
    except Exception as e:
        logger.error("GET /auth/settings failed: %s", e, exc_info=True)
        data = svc.empty_settings_payload(degraded=True, reason="db_unavailable")
    return SettingsOut(**{k: v for k, v in data.items() if k in SettingsOut.model_fields})


@router.put("", response_model=SettingsOut)
async def put_settings(
    body: SettingsUpdate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    login = str(user["username"])
    firm_id = _firm_id(user)

    if body.firm and not firm_id:
        # Business validation — not a DB error
        raise HTTPException(
            status_code=400,
            detail="Профиль фирмы не загружен — org-настройки пока недоступны",
        )

    # selected_store_id is per-user
    store_candidate = None
    if body.user and body.user.get("selected_store_id") is not None:
        store_candidate = body.user.get("selected_store_id")
    if store_candidate is not None and store_candidate != "":
        firm = user.get("firm") or {}
        stores = firm.get("stores") or []
        if stores:
            ok = any(str(s.get("storeId")) == str(store_candidate) for s in stores)
            if not ok:
                raise HTTPException(
                    status_code=400,
                    detail=f"Магазин storeId={store_candidate} не найден в профиле фирмы",
                )

    try:
        data = await svc.update_settings(
            db,
            login=login,
            firm_id=firm_id,
            user_patch=body.user,
            firm_patch=body.firm,
        )
    except Exception as e:
        logger.error("PUT /auth/settings failed: %s", e, exc_info=True)
        data = svc.empty_settings_payload(degraded=True, reason="db_unavailable")
        if body.user:
            data["user"] = svc.merge_with_defaults(
                svc.sanitize_user_patch(body.user),
                svc.USER_DEFAULTS,
            )
        if body.firm:
            data["firm"] = svc.merge_with_defaults(
                svc.sanitize_firm_patch(body.firm),
                svc.FIRM_DEFAULTS,
            )

    if data.get("degraded"):
        log_action(
            "settings_degraded",
            f"reason={data.get('degraded_reason')}",
            level="warning",
            user_id=login,
        )
    else:
        log_action(
            "settings_updated",
            f"user_keys={list((body.user or {}).keys())} firm_keys={list((body.firm or {}).keys())}",
            user_id=login,
        )

    return SettingsOut(**{k: v for k, v in data.items() if k in SettingsOut.model_fields})
