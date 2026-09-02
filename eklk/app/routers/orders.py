"""
Список и детализация чеков через mobile API EcomKassa.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List

from app.clients.ecomkassa import EcomKassaClient, EcomKassaError
from app.core.deps import CurrentUser
from app.schemas.orders import (
    OrderSearchRequest,
    OrderSearchResponse,
    OrderListItem,
    OrderDetailResponse,
)
from app.utils.logger import log_action

router = APIRouter(prefix="/orders", tags=["Orders"])


def _client_for(user: dict) -> EcomKassaClient:
    return EcomKassaClient(
        login=user["username"],
        password=user["password"],
        group_code=user.get("group_code") or "990",
    )


def _map_item(raw: dict) -> OrderListItem:
    return OrderListItem(
        order_id=raw.get("orderId"),
        external_id=raw.get("externalId"),
        updated=raw.get("updated"),
        order_type=raw.get("orderType"),
        status=raw.get("status"),
        total=raw.get("total"),
        firm_id=raw.get("firmId"),
        store_id=raw.get("storeId"),
        store_name=raw.get("storeName"),
        cashier_name=raw.get("cashierName"),
        is_sale=raw.get("isSale"),
        is_correction=raw.get("isCorrection"),
        raw=raw,
    )


@router.post("/search", response_model=OrderSearchResponse)
async def search_orders(body: OrderSearchRequest, user: CurrentUser):
    """
    Поиск чеков. По умолчанию limit=30.
    Сортировка по дате обновления — на стороне EcomKassa.
    """
    client = _client_for(user)
    try:
        data = await client.search_orders(
            offset=body.offset,
            limit=body.limit,
            external_id=body.external_id,
            since=body.since,
            until=body.until,
            order_types=body.order_types,
        )
        rows = data.get("result") or []
        if not isinstance(rows, list):
            rows = []
        items = [_map_item(r) for r in rows if isinstance(r, dict)]
        log_action(
            "orders_search",
            f"returned={len(items)} offset={body.offset}",
            user_id=user["username"],
        )
        return OrderSearchResponse(
            query=data.get("query") or body.model_dump(exclude_none=True),
            result=items,
            total_returned=len(items),
        )
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail={"message": str(e), "code": e.code, "raw": e.raw})
    finally:
        await client.close()


@router.get("/search", response_model=OrderSearchResponse)
async def search_orders_get(
    user: CurrentUser,
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=500),
    external_id: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    order_types: Optional[str] = Query(None, description="Comma-separated: VCHR,INVC,CORD"),
):
    types = [t.strip() for t in order_types.split(",") if t.strip()] if order_types else None
    body = OrderSearchRequest(
        offset=offset,
        limit=limit,
        external_id=external_id,
        since=since,
        until=until,
        order_types=types,
    )
    return await search_orders(body, user)


@router.get("/{order_id}", response_model=OrderDetailResponse)
async def get_order_detail(order_id: int, user: CurrentUser):
    """
    Краткая карточка + состав чека (Atol Online v5, fallback v4 при пустых позициях).
    """
    client = _client_for(user)
    try:
        summary_raw = None
        try:
            summary_raw = await client.get_order(order_id)
        except EcomKassaError as e:
            log_action("order_summary_warn", str(e), level="warning", user_id=user["username"])

        # atol-5 first; if no product lines — seamless fallback to atol-4
        atol5, atol_src = await client.get_order_atol_document(order_id)
        if atol5 is None and summary_raw is None:
            raise HTTPException(
                status_code=400,
                detail={"message": "Не удалось загрузить чек (summary и atol недоступны)"},
            )
        if atol_src == "atol-4":
            log_action(
                "order_atol_source",
                f"order={order_id} source=atol-4",
                user_id=user["username"],
            )

        summary = _map_item(summary_raw) if summary_raw else OrderListItem(order_id=order_id)

        # Фискальный report (ФД, ФП, ссылка ОФД) — uuid обычно = orderId
        fiscal = None
        store_gc = None
        if summary.store_id is not None:
            store_gc = str(summary.store_id)
        elif user.get("group_code"):
            store_gc = str(user.get("group_code"))
        try:
            # временно group_code магазина чека
            if store_gc:
                client.group_code = store_gc
            fiscal = await client.get_report(str(order_id))
        except EcomKassaError as e:
            log_action(
                "order_fiscal_warn",
                str(e),
                level="warning",
                user_id=user["username"],
            )
            fiscal = None

        # Rare: items only inside fiscal report payload
        if atol5 is not None and not EcomKassaClient.atol_document_has_items(atol5) and isinstance(fiscal, dict):
            fp = fiscal.get("payload") if isinstance(fiscal.get("payload"), dict) else None
            if isinstance(fp, dict) and EcomKassaClient.atol_document_has_items(fp):
                atol5 = fp
                log_action(
                    "order_atol_source",
                    f"order={order_id} source=fiscal_payload",
                    user_id=user["username"],
                )

        return OrderDetailResponse(
            summary=summary,
            atol5=atol5,
            fiscal=fiscal,
            raw_summary=summary_raw,
        )
    finally:
        await client.close()
