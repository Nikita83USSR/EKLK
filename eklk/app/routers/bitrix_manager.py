"""
API расширения: менеджер Bitrix24 по ИНН из профиля организации.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.core.deps import CurrentUser
from app.services.bitrix_manager import BitrixManagerError, fetch_manager_by_inn
from app.utils.logger import log_action

router = APIRouter(prefix="/bitrix", tags=["bitrix-manager"])


def _inn_from_user(user: dict) -> str:
    firm = user.get("firm") or {}
    # session stores raw Ecom payload (taxIdentity) or already-normalized
    inn = firm.get("taxIdentity") or firm.get("tax_identity") or ""
    return str(inn).strip()


@router.get("/manager")
async def get_my_manager(user: CurrentUser) -> dict[str, Any]:
    """
    Возвращает куратора (менеджера) по ИНН организации текущего пользователя.
    ИНН берётся из профиля сессии, не из query (защита от подмены).
    """
    inn = _inn_from_user(user)
    login = user.get("username") or ""
    try:
        out = await fetch_manager_by_inn(inn)
        log_action("bitrix_manager_ok", f"inn={inn}", user_id=login)
        return out
    except BitrixManagerError as e:
        log_action("bitrix_manager_miss", e.message, level="info", user_id=login)
        return {"success": False, "error": e.message}
    except RuntimeError as e:
        log_action("bitrix_manager_cfg", str(e), level="warning", user_id=login)
        return {"success": False, "error": str(e)}
    except Exception as e:
        log_action("bitrix_manager_err", str(e), level="error", user_id=login)
        return {"success": False, "error": "Внутренняя ошибка поиска менеджера"}
