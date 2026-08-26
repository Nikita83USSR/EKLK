"""
GET/PUT user+firm preferences. Keys (login, firm_id) come only from session.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db import get_db
from app.schemas.settings import SettingsOut, SettingsUpdate
from app.services import settings_service as svc
from app.utils.logger import log_action

router = APIRouter(prefix="/auth/settings", tags=["Settings"])


def _firm_id(user: dict) -> str | None:
    return svc.firm_id_from_user(user)


@router.get("", response_model=SettingsOut)
async def get_settings(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    login = str(user["username"])
    data = await svc.get_settings(db, login, _firm_id(user))
    return SettingsOut(**data)


@router.put("", response_model=SettingsOut)
async def put_settings(
    body: SettingsUpdate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    login = str(user["username"])
    firm_id = _firm_id(user)

    if body.firm and not firm_id:
        raise HTTPException(
            status_code=400,
            detail="Профиль фирмы не загружен — org-настройки пока недоступны",
        )

    # Optional: validate store against firm profile
    if body.firm and body.firm.get("selected_store_id") is not None:
        store_id = body.firm.get("selected_store_id")
        firm = user.get("firm") or {}
        stores = firm.get("stores") or []
        if stores:
            ok = any(str(s.get("storeId")) == str(store_id) for s in stores)
            if not ok:
                raise HTTPException(
                    status_code=400,
                    detail=f"Магазин storeId={store_id} не найден в профиле фирмы",
                )

    data = await svc.update_settings(
        db,
        login=login,
        firm_id=firm_id,
        user_patch=body.user,
        firm_patch=body.firm,
    )
    log_action(
        "settings_updated",
        f"user_keys={list((body.user or {}).keys())} firm_keys={list((body.firm or {}).keys())}",
        user_id=login,
    )
    return SettingsOut(**data)
