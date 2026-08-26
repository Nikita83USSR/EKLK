"""
ИИ-кассир (iikassa.ru) — partner-embed по официальной api-docs.

Два режима (см. https://iikassa.ru/api-docs):
  1) action=issue_from_token — ecomkassa_token (JWT getToken), без секрета, можно из браузера.
  2) action=issue — ecomkassa_login/password + заголовок X-Partner-Secret (только бэкенд).

Мы всегда ходим с бэкенда, чтобы логировать request/response и при наличии
IIKASSA_PARTNER_SECRET использовать надёжный issue.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.clients.ecomkassa import EcomKassaClient, EcomKassaError
from app.core.config import settings
from app.core.deps import CurrentUser
from app.utils.logger import log_action

logger = logging.getLogger("eklk.ai_cashier")

router = APIRouter(prefix="/ai-cashier", tags=["AI Cashier"])

EMBED_URL = settings.iikassa_embed_url
PARTNER_ID = settings.iikassa_partner_id or "eklk"


@router.post("/embed")
async def create_embed(
    user: CurrentUser,
    debug: bool = Query(True, description="Включить request/response в ответ (временно для отладки)"),
):
    """
    Получить embed_path для iframe чата ИИ-кассира.
    """
    login = str(user["username"])
    password = user.get("password") or ""
    if not password:
        raise HTTPException(status_code=401, detail="Сессия без пароля — войдите снова")

    # 1) Свежий токен EcomKassa (fiscalorder getToken) — тот же JWT, что mobile API
    ecom_token: str | None = None
    token_meta: dict[str, Any] = {}
    client = EcomKassaClient(
        login=login,
        password=password,
        group_code=user.get("group_code") or "990",
    )
    try:
        ecom_token = await client.get_token(force=True)
        token_meta = {
            "token_len": len(ecom_token),
            "token_prefix": ecom_token[:20] + "…",
            "token_is_jwt": ecom_token.count(".") == 2,
        }
        # Быстрая проверка, что токен живой у EcomKassa
        try:
            firm = await client.get_firm_profile()
            token_meta["ecom_firm_ok"] = True
            token_meta["firm_id"] = (firm or {}).get("firmId")
        except Exception as e:
            token_meta["ecom_firm_ok"] = False
            token_meta["ecom_firm_error"] = str(e)
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=f"EcomKassa getToken: {e}")
    finally:
        await client.close()

    use_secret = bool((settings.iikassa_partner_secret or "").strip())
    headers = {"Content-Type": "application/json"}
    if use_secret:
        headers["X-Partner-Secret"] = settings.iikassa_partner_secret.strip()
        body: dict[str, Any] = {
            "action": "issue",
            "ecomkassa_login": login,
            "ecomkassa_password": password,
            "partner_id": PARTNER_ID,
        }
        mode = "issue"
    else:
        body = {
            "action": "issue_from_token",
            "ecomkassa_token": ecom_token,
            "partner_id": PARTNER_ID,
        }
        mode = "issue_from_token"

    # Для логов — без полного пароля/токена
    body_log = dict(body)
    if "ecomkassa_password" in body_log:
        body_log["ecomkassa_password"] = "***"
    if "ecomkassa_token" in body_log and body_log["ecomkassa_token"]:
        tok = body_log["ecomkassa_token"]
        body_log["ecomkassa_token"] = tok[:16] + f"…(len={len(tok)})"

    status_code = 0
    resp_data: Any = None
    resp_text = ""
    try:
        async with httpx.AsyncClient(timeout=30.0) as http:
            r = await http.post(EMBED_URL, headers=headers, json=body)
            status_code = r.status_code
            resp_text = r.text
            try:
                resp_data = r.json()
            except Exception:
                resp_data = {"raw": resp_text[:2000]}
    except Exception as e:
        logger.exception("iikassa embed request failed")
        raise HTTPException(status_code=502, detail=f"Сеть iikassa: {e}")

    log_action(
        "ai_cashier_embed",
        f"mode={mode} http={status_code} partner_id={PARTNER_ID}",
        user_id=login,
        level="info" if status_code == 200 else "warning",
    )

    ok = status_code == 200 and isinstance(resp_data, dict) and bool(resp_data.get("embed_path"))
    out: dict[str, Any] = {
        "ok": ok,
        "mode": mode,
        "embed_path": (resp_data or {}).get("embed_path") if isinstance(resp_data, dict) else None,
        "embed_token": (resp_data or {}).get("embed_token") if isinstance(resp_data, dict) else None,
        "expires_in": (resp_data or {}).get("expires_in") if isinstance(resp_data, dict) else None,
        "user_id": (resp_data or {}).get("user_id") if isinstance(resp_data, dict) else None,
        "error": None if ok else (
            (resp_data or {}).get("error") if isinstance(resp_data, dict) else resp_text[:500]
        ),
        "embed_url": None,
    }
    if out["embed_path"]:
        path = out["embed_path"]
        if path.startswith("http"):
            out["embed_url"] = path
        else:
            out["embed_url"] = "https://iikassa.ru" + path

    if debug:
        out["debug"] = {
            "embed_endpoint": EMBED_URL,
            "request_headers": {
                "Content-Type": "application/json",
                "X-Partner-Secret": ("set" if use_secret else "not set"),
            },
            "request_body": body_log,
            "ecom_token_meta": token_meta,
            "response_http_status": status_code,
            "response_body": resp_data,
        }

    if not ok:
        # 200 с debug, чтобы фронт показал лог; бизнес-ошибка в ok=false
        return out
    return out
