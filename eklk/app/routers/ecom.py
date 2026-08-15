"""
EcomKassa integration endpoints.
"""

import time
import uuid as uuid_lib
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.clients.ecomkassa import EcomKassaClient, EcomKassaError, to_rubles
from app.core.deps import CurrentUser
from app.schemas.checks import CreateCheckRequest, CreateRefundRequest, CheckResponse
from app.utils.logger import log_action

router = APIRouter(prefix="/ecom", tags=["EcomKassa"])


def _client() -> EcomKassaClient:
    return EcomKassaClient()


@router.get("/payment-types")
async def payment_types(user: CurrentUser):
    client = _client()
    try:
        types = await client.get_payment_types()
        return {"items": types}
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@router.post("/checks", response_model=CheckResponse)
async def create_check(body: CreateCheckRequest, user: CurrentUser):
    """
    Create SALE check or payment invoice (if payments.type is provider id like 103).
    """
    client = _client()
    try:
        external_id = body.external_id or f"EKLK-{int(time.time())}-{uuid_lib.uuid4().hex[:8]}"
        items = [it.model_dump() for it in body.items]
        for it in items:
            if it.get("sum") is None:
                it["sum"] = to_rubles(it["price"] * it["quantity"])
        payments = [p.model_dump() for p in body.payments]
        total = sum(p["sum"] for p in payments)

        company = body.company.model_dump(exclude_none=True) if body.company else None
        client_data = body.client.model_dump(exclude_none=True) if body.client else None

        result = await client.create_sell(
            external_id=external_id,
            items=items,
            payments=payments,
            total=total,
            client=client_data,
            company=company,
            sno=body.sno or (company or {}).get("sno", "osn"),
            success_url=body.success_url,
            callback_url=body.callback_url,
        )
        log_action("check_created", f"uuid={result.get('uuid')}", user_id=user["id"], uuid=result.get("uuid"))
        return CheckResponse(
            uuid=result.get("uuid"),
            external_id=external_id,
            status=result.get("status"),
            kind=result.get("kind"),
            permalink=result.get("permalink"),
            error=result.get("error"),
            invoice_payload=result.get("invoice_payload"),
            timestamp=result.get("timestamp"),
            raw=result,
        )
    except EcomKassaError as e:
        log_action("check_error", str(e), level="error", user_id=user["id"])
        raise HTTPException(status_code=400, detail={"message": str(e), "code": e.code, "raw": e.raw})
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        await client.close()


@router.get("/checks/{uuid}", response_model=CheckResponse)
async def get_check(uuid: str, user: CurrentUser):
    client = _client()
    try:
        result = await client.get_report(uuid)
        return CheckResponse(
            uuid=result.get("uuid"),
            external_id=result.get("external_id"),
            status=result.get("status"),
            kind=result.get("kind"),
            permalink=result.get("permalink"),
            error=result.get("error"),
            invoice_payload=result.get("invoice_payload"),
            payload=result.get("payload"),
            timestamp=result.get("timestamp"),
            raw=result,
        )
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail={"message": str(e), "code": e.code, "raw": e.raw})
    finally:
        await client.close()


@router.post("/refunds", response_model=CheckResponse)
async def create_refund(body: CreateRefundRequest, user: CurrentUser):
    client = _client()
    try:
        external_id = body.external_id or f"REF-{int(time.time())}-{uuid_lib.uuid4().hex[:8]}"
        items = [it.model_dump() for it in body.items]
        for it in items:
            if it.get("sum") is None:
                it["sum"] = to_rubles(it["price"] * it["quantity"])
        payments = [p.model_dump() for p in body.payments]
        total = sum(p["sum"] for p in payments)
        company = body.company.model_dump(exclude_none=True) if body.company else None
        client_data = body.client.model_dump(exclude_none=True) if body.client else None

        result = await client.create_refund(
            external_id=external_id,
            items=items,
            payments=payments,
            total=total,
            client=client_data,
            company=company,
            sno=body.sno,
            original_uuid=body.original_uuid,
        )
        return CheckResponse(
            uuid=result.get("uuid"),
            external_id=external_id,
            status=result.get("status"),
            kind=result.get("kind"),
            permalink=result.get("permalink"),
            error=result.get("error"),
            timestamp=result.get("timestamp"),
            raw=result,
        )
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail={"message": str(e), "code": e.code, "raw": e.raw})
    finally:
        await client.close()
