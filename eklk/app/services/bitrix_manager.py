"""
Расширение: менеджер Bitrix24 по ИНН организации (batch REST).
Не связано с ядром фискализации / EcomKassa.
"""
from __future__ import annotations

from typing import Any, Optional
from urllib.parse import urlencode

import httpx

from app.core.config import settings
from app.utils.logger import logger


class BitrixManagerError(Exception):
    """Бизнес-ошибка поиска менеджера (для ответа фронту)."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def _normalize_webhook(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    if not u.endswith("/"):
        u += "/"
    return u


def _batch_cmd_query(method: str, params: dict[str, Any]) -> str:
    """Собирает строку cmd для batch: method?a=1&b=2."""
    # Bitrix batch accepts method?query or nested dict; query string is reliable.
    flat: list[tuple[str, str]] = []

    def walk(prefix: str, obj: Any) -> None:
        if isinstance(obj, dict):
            for k, v in obj.items():
                key = f"{prefix}[{k}]" if prefix else str(k)
                walk(key, v)
        elif isinstance(obj, (list, tuple)):
            for i, v in enumerate(obj):
                key = f"{prefix}[{i}]"
                walk(key, v)
        else:
            flat.append((prefix, "" if obj is None else str(obj)))

    walk("", params)
    qs = urlencode(flat, doseq=True)
    return f"{method}?{qs}" if qs else method


async def fetch_manager_by_inn(inn: str) -> dict[str, Any]:
    """
    Batch: requisite (ИНН) → активная сделка → ответственный менеджер.

    Returns:
        {"success": True, "manager": {"name", "email", "inner_phone"}}

    Raises:
        BitrixManagerError — бизнес-ошибки (ИНН / сделки / менеджер)
        RuntimeError — вебхук не настроен или сетевой сбой
    """
    inn_clean = "".join(ch for ch in str(inn or "") if ch.isdigit())
    if len(inn_clean) < 10:
        raise BitrixManagerError("ИНН организации не указан или некорректен")

    webhook = _normalize_webhook(settings.bitrix24_webhook_url)
    if not webhook:
        raise RuntimeError("BITRIX24_WEBHOOK_URL не задан в окружении")

    # Цепочка batch (halt=1): при ошибке на шаге дальше не идём
    cmd = {
        "find_company": _batch_cmd_query(
            "crm.requisite.list",
            {
                "filter": {"RQ_INN": inn_clean},
                "select": ["ENTITY_ID", "ENTITY_TYPE_ID", "RQ_INN"],
            },
        ),
        "find_deal": _batch_cmd_query(
            "crm.deal.list",
            {
                "filter": {
                    "COMPANY_ID": "$result[find_company][0][ENTITY_ID]",
                    "CLOSED": "N",
                },
                "order": {"ID": "DESC"},
                "select": ["ID", "ASSIGNED_BY_ID", "TITLE", "CLOSED"],
            },
        ),
        # user.get принимает ID напрямую
        "get_manager": "user.get?ID=$result[find_deal][0][ASSIGNED_BY_ID]",
    }

    payload = {"halt": 0, "cmd": cmd}  # halt=0: получаем все result_error по шагам сами

    url = webhook + "batch"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(url, json=payload)
            data = resp.json() if resp.content else {}
    except Exception as e:
        logger.warning(f"bitrix batch network error: {e}")
        raise RuntimeError("Не удалось связаться с Bitrix24") from e

    if resp.status_code >= 400:
        logger.warning(f"bitrix batch HTTP {resp.status_code}: {data}")
        raise RuntimeError("Ошибка ответа Bitrix24")

    result = (data.get("result") or {}).get("result") or data.get("result") or {}
    result_error = (data.get("result") or {}).get("result_error") or data.get("result_error") or {}

    # --- find_company ---
    companies = result.get("find_company")
    if result_error.get("find_company"):
        raise BitrixManagerError("Компания с таким ИНН не найдена в CRM")
    if not companies or not isinstance(companies, list) or len(companies) == 0:
        raise BitrixManagerError("Компания с таким ИНН не найдена в CRM")

    # --- find_deal ---
    deals = result.get("find_deal")
    if result_error.get("find_deal"):
        raise BitrixManagerError("Связанные активные сделки не найдены")
    if not deals or not isinstance(deals, list) or len(deals) == 0:
        raise BitrixManagerError("Связанные активные сделки не найдены")

    # --- get_manager ---
    managers = result.get("get_manager")
    if result_error.get("get_manager") or not managers:
        raise BitrixManagerError("Менеджер сделки не найден")

    if isinstance(managers, list):
        if not managers:
            raise BitrixManagerError("Менеджер сделки не найден")
        user = managers[0]
    elif isinstance(managers, dict):
        user = managers
    else:
        raise BitrixManagerError("Менеджер сделки не найден")

    name_parts = [user.get("NAME") or "", user.get("LAST_NAME") or ""]
    full_name = " ".join(p for p in name_parts if p).strip() or "Менеджер"

    email = ""
    em = user.get("EMAIL")
    if isinstance(em, list) and em:
        # user.get may return EMAIL as list of {VALUE, ...}
        first = em[0]
        email = first.get("VALUE") if isinstance(first, dict) else str(first)
    elif isinstance(em, str):
        email = em

    inner = user.get("UF_PHONE_INNER")
    if inner is None or str(inner).strip() == "":
        inner_phone = "Не указан"
    else:
        inner_phone = str(inner).strip()

    return {
        "success": True,
        "manager": {
            "name": full_name,
            "email": email or "—",
            "inner_phone": inner_phone,
        },
    }
