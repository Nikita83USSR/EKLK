"""
CRUD шаблонов чеков EcomKassa + многоразовые QR Pay ссылки.
Mobile API: /api/mobile/v1/templates
Публичная ссылка: https://app.ecomkassa.ru/public/qrpay/{templateId}
"""

from __future__ import annotations

import base64
import json
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.clients.ecomkassa import EcomKassaClient, EcomKassaError
from app.core.deps import CurrentUser
from app.schemas.templates import TemplateCreate, TemplateUpdate, TemplateOut
from app.utils.logger import log_action

router = APIRouter(prefix="/templates", tags=["Templates"])

QRPAY_PUBLIC_BASE = "https://app.ecomkassa.ru/public/qrpay"


def _client_for(user: dict) -> EcomKassaClient:
    return EcomKassaClient(
        login=user["username"],
        password=user["password"],
        group_code=user.get("group_code") or "990",
    )


def _firm_id(user: dict) -> str | None:
    firm = user.get("firm") or {}
    return firm.get("firmId") or firm.get("firm_id")


_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _is_uuid(value: str | None) -> bool:
    if not value or not isinstance(value, str):
        return False
    return bool(_UUID_RE.match(value.strip()))


def _user_id_from_jwt(token: str | None) -> str | None:
    """Достаём userId из JWT EcomKassa — только если значение похоже на UUID."""
    if not token or not isinstance(token, str):
        return None
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return None
        pad = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(pad.encode("utf-8")))
        if not isinstance(payload, dict):
            return None
        # Не берём sub/id — у EcomKassa sub часто не UUID (шифрованная строка)
        for key in ("userId", "user_id", "uid"):
            val = payload.get(key)
            if val is None:
                continue
            s = str(val).strip()
            if _is_uuid(s):
                return s
    except Exception:
        return None
    return None


def _is_firm_id(uid: str | None, firm_id: str | None) -> bool:
    if not uid or not firm_id:
        return False
    if not _is_uuid(str(uid)) or not _is_uuid(str(firm_id)):
        return False
    return str(uid).strip().lower() == str(firm_id).strip().lower()


def _user_id_from_templates(
    items: list,
    firm_id: str | None = None,
    prefer_store_id: int | str | None = None,
) -> str | None:
    """Берём qrPay.userId кассира; firmId в userId пропускаем — это не кассир."""

    def is_cashier(uid) -> bool:
        if not _is_uuid(str(uid) if uid is not None else None):
            return False
        if _is_firm_id(str(uid), firm_id):
            return False
        return True

    prefer = None
    if prefer_store_id is not None and str(prefer_store_id).strip() != "":
        try:
            prefer = int(prefer_store_id)
        except (TypeError, ValueError):
            prefer = str(prefer_store_id)

    if prefer is not None:
        for t in items or []:
            if not isinstance(t, dict):
                continue
            qp = t.get("qrPay") or {}
            if not isinstance(qp, dict):
                continue
            sid = qp.get("storeId")
            try:
                sid_match = int(sid) == prefer if isinstance(prefer, int) else str(sid) == str(prefer)
            except (TypeError, ValueError):
                sid_match = str(sid) == str(prefer)
            if sid_match and is_cashier(qp.get("userId")):
                return str(qp.get("userId")).strip()

    for t in items or []:
        if not isinstance(t, dict):
            continue
        qp = t.get("qrPay") or {}
        if not isinstance(qp, dict):
            continue
        if is_cashier(qp.get("userId")):
            return str(qp.get("userId")).strip()
    return None


async def _resolve_cashier_user_id(
    client: EcomKassaClient,
    explicit: str | None = None,
    firm_id: str | None = None,
    prefer_store_id: int | str | None = None,
) -> str | None:
    """
    userId в qrPay — UUID кассира (не firmId).
    Источники (по приоритету):
      1) явный UUID, если это не firmId
      2) qrPay.userId из существующих шаблонов (лучше с тем же storeId)
      3) JWT userId (если UUID и не firmId)
    firmId как кассир не подставляем — EcomKassa: need to define store and cashier.
    """
    if _is_uuid(explicit) and not _is_firm_id(explicit, firm_id):
        return str(explicit).strip()

    try:
        items = await client.list_templates(firm_id=firm_id)
        from_tpl = _user_id_from_templates(
            items, firm_id=firm_id, prefer_store_id=prefer_store_id
        )
        if from_tpl:
            return from_tpl
    except EcomKassaError:
        pass

    token = getattr(client, "_token", None) or await client.get_token()
    from_jwt = _user_id_from_jwt(token)
    if from_jwt and not _is_firm_id(from_jwt, firm_id):
        return from_jwt

    return None


def _enrich(tpl: dict) -> dict:
    """Добавить qrpay_url к объекту шаблона."""
    if not isinstance(tpl, dict):
        return tpl
    tid = tpl.get("templateId") or tpl.get("template_id")
    out = dict(tpl)
    if tid:
        out["qrpay_url"] = f"{QRPAY_PUBLIC_BASE}/{tid}"
    return out


def _to_out(tpl: dict) -> TemplateOut:
    e = _enrich(tpl)
    return TemplateOut(
        templateId=e.get("templateId"),
        name=e.get("name"),
        product=e.get("product"),
        price=e.get("price"),
        count=e.get("count"),
        vat=e.get("vat"),
        paymentMethod=e.get("paymentMethod"),
        paymentObject=e.get("paymentObject"),
        operationType=e.get("operationType"),
        agentType=e.get("agentType"),
        isDefault=e.get("isDefault"),
        requireClientEmail=e.get("requireClientEmail"),
        requireClientPhone=e.get("requireClientPhone"),
        requireClientData=e.get("requireClientData"),
        preferredPaymentType=e.get("preferredPaymentType"),
        supplierPhone=e.get("supplierPhone"),
        supplierName=e.get("supplierName"),
        supplierInn=e.get("supplierInn"),
        harvestEmail=e.get("harvestEmail"),
        userProperty=e.get("userProperty"),
        qrPay=e.get("qrPay"),
        qrpay_url=e.get("qrpay_url"),
        raw=e,
    )


def _body_for_api(data: TemplateCreate | TemplateUpdate) -> dict:
    """Pydantic → dict без None (API принимает частичные поля, name обязателен)."""
    raw = data.model_dump(exclude_none=True)
    if "qrPay" in raw and isinstance(raw["qrPay"], dict):
        qp = {k: v for k, v in raw["qrPay"].items() if v is not None and v != ""}
        if not qp.get("allowedProviders"):
            qp.pop("allowedProviders", None)
        raw["qrPay"] = qp
    return raw


async def _ensure_qrpay_user_id(
    client: EcomKassaClient,
    payload: dict,
    firm_id: str | None,
) -> dict:
    """Гарантируем qrPay.userId = UUID кассира (не firmId)."""
    qp = payload.get("qrPay")
    if not isinstance(qp, dict):
        return payload
    current = qp.get("userId")
    cur_s = str(current).strip() if current is not None else ""
    # firmId в userId считаем пустым — иначе need to define store and cashier
    if _is_uuid(cur_s) and not _is_firm_id(cur_s, firm_id):
        qp = dict(qp)
        qp["userId"] = cur_s
        payload = dict(payload)
        payload["qrPay"] = qp
        return payload
    uid = await _resolve_cashier_user_id(
        client,
        explicit=None,
        firm_id=firm_id,
        prefer_store_id=qp.get("storeId"),
    )
    if not uid or not _is_uuid(uid):
        raise HTTPException(
            status_code=400,
            detail={
                "message": (
                    "Не удалось определить UUID кассира (qrPay.userId). "
                    "Откройте любой рабочий шаблон с QR Pay в ЛК EcomKassa "
                    "или сохраните шаблон, созданный там — userId подтянется автоматически."
                ),
                "code": "userId_missing",
            },
        )
    qp = dict(qp)
    qp["userId"] = uid
    payload = dict(payload)
    payload["qrPay"] = qp
    return payload


@router.get("", response_model=list[TemplateOut])
async def list_templates(
    user: CurrentUser,
    firm_id: str | None = Query(default=None, description="firmId для админа"),
):
    client = _client_for(user)
    try:
        fid = firm_id or _firm_id(user)
        items = await client.list_templates(firm_id=fid)
        return [_to_out(t) for t in items]
    except EcomKassaError as e:
        log_action("templates_list_error", str(e), level="error", user_id=user["username"])
        raise HTTPException(
            status_code=400, detail={"message": str(e), "code": e.code, "raw": e.raw}
        )
    finally:
        await client.close()


@router.get("/{template_id}", response_model=TemplateOut)
async def get_template(template_id: str, user: CurrentUser):
    client = _client_for(user)
    try:
        tpl = await client.get_template(template_id)
        return _to_out(tpl)
    except EcomKassaError as e:
        raise HTTPException(
            status_code=400, detail={"message": str(e), "code": e.code, "raw": e.raw}
        )
    finally:
        await client.close()


@router.post("", response_model=TemplateOut)
async def create_template(body: TemplateCreate, user: CurrentUser):
    client = _client_for(user)
    try:
        payload = _body_for_api(body)
        fid = _firm_id(user)
        if payload.get("qrPay"):
            payload = await _ensure_qrpay_user_id(client, payload, fid)
        result = await client.create_template(payload, firm_id=fid)
        log_action(
            "template_created",
            f"name={body.name} id={result.get('templateId')}",
            user_id=user["username"],
        )
        return _to_out(result)
    except HTTPException:
        raise
    except EcomKassaError as e:
        log_action("template_create_error", str(e), level="error", user_id=user["username"])
        raise HTTPException(
            status_code=400, detail={"message": str(e), "code": e.code, "raw": e.raw}
        )
    finally:
        await client.close()


@router.put("/{template_id}", response_model=TemplateOut)
async def update_template(template_id: str, body: TemplateUpdate, user: CurrentUser):
    client = _client_for(user)
    try:
        payload = _body_for_api(body)
        fid = _firm_id(user)
        if payload.get("qrPay"):
            # При редактировании сначала пробуем userId из текущего шаблона
            try:
                current = await client.get_template(template_id)
                cur_uid = (current.get("qrPay") or {}).get("userId")
                if _is_uuid(str(cur_uid) if cur_uid is not None else None):
                    if not _is_uuid(str((payload.get("qrPay") or {}).get("userId") or "")):
                        payload["qrPay"] = dict(payload["qrPay"])
                        payload["qrPay"]["userId"] = str(cur_uid).strip()
            except EcomKassaError:
                pass
            payload = await _ensure_qrpay_user_id(client, payload, fid)
        result = await client.update_template(template_id, payload)
        log_action(
            "template_updated",
            f"id={template_id} name={body.name}",
            user_id=user["username"],
        )
        return _to_out(result)
    except HTTPException:
        raise
    except EcomKassaError as e:
        log_action("template_update_error", str(e), level="error", user_id=user["username"])
        raise HTTPException(
            status_code=400, detail={"message": str(e), "code": e.code, "raw": e.raw}
        )
    finally:
        await client.close()


@router.delete("/{template_id}")
async def delete_template(template_id: str, user: CurrentUser):
    client = _client_for(user)
    try:
        await client.delete_template(template_id)
        log_action("template_deleted", f"id={template_id}", user_id=user["username"])
        return {"ok": True, "templateId": template_id}
    except EcomKassaError as e:
        log_action("template_delete_error", str(e), level="error", user_id=user["username"])
        raise HTTPException(
            status_code=400, detail={"message": str(e), "code": e.code, "raw": e.raw}
        )
    finally:
        await client.close()
