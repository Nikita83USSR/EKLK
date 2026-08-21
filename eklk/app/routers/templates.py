"""
CRUD шаблонов чеков EcomKassa + многоразовые QR Pay ссылки.
Mobile API: /api/mobile/v1/templates
Публичная ссылка: https://app.ecomkassa.ru/public/qrpay/{templateId}
"""

from fastapi import APIRouter, HTTPException, Query

from app.clients.ecomkassa import EcomKassaClient, EcomKassaError
from app.core.config import settings
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
        qp = {k: v for k, v in raw["qrPay"].items() if v is not None}
        if not qp.get("allowedProviders"):
            qp.pop("allowedProviders", None)
        raw["qrPay"] = qp
    return raw


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
        result = await client.create_template(payload, firm_id=fid)
        log_action(
            "template_created",
            f"name={body.name} id={result.get('templateId')}",
            user_id=user["username"],
        )
        return _to_out(result)
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
        result = await client.update_template(template_id, payload)
        log_action(
            "template_updated",
            f"id={template_id} name={body.name}",
            user_id=user["username"],
        )
        return _to_out(result)
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
