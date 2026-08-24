"""
Отчёты по расчётам (mobile API).
История отчётов — только в in-memory сессии пользователя.

Важно: amount в points API приходит в **копейках**. Перед отображением делим на 100.
Сумма amount за период = баланс кассы за период (как отдаёт EcomKassa), без
самостоятельного пересчёта возвратов / ящика.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query

from app.clients.ecomkassa import EcomKassaClient, EcomKassaError
from app.core.deps import CurrentUser, get_session, SESSIONS
from app.schemas.reports import ReportPoint, ReportResponse, ReportHistoryItem
from app.utils.logger import log_action

router = APIRouter(prefix="/reports", tags=["Reports"])

# Типы оплаты EcomKassa reports API
PAYMENT_LABELS = {
    "CASH": "Наличные",
    "CREDIT_CARD": "Безналичные",
    "PRE_PAID": "Предоплата (аванс / зачёт)",
    "POST_PAID": "Постоплата (кредит)",
    "COUNTER_OFFER": "Встречное предоставление",
}

# API отдаёт amount в копейках
KOPECKS_IN_RUBLE = 100.0


def _client_for(user: dict) -> EcomKassaClient:
    return EcomKassaClient(
        login=user["username"],
        password=user["password"],
        group_code=user.get("group_code") or "990",
    )


def _parse_order_types(raw: Optional[str]) -> list[str] | None:
    if not raw:
        return None
    parts = [p.strip().upper() for p in raw.split(",") if p.strip()]
    allowed = {"VCHR", "INVC", "CORD", "CASH_VOUCHER", "INVOICE", "COURIER_ORDER"}
    out = [p for p in parts if p in allowed]
    return out or None


def _kop_to_rub(value) -> float:
    try:
        return float(value or 0) / KOPECKS_IN_RUBLE
    except (TypeError, ValueError):
        return 0.0


def _aggregate(points: list[dict]) -> tuple[dict, float, dict]:
    """
    Сводка для бухгалтера.

    amount в API — **копейки**. Конвертируем в рубли (/100).
    Итоговая сумма amount за период = баланс кассы за период (как есть из API).
    Разбивка по типам оплаты / точкам / кассирам — только для удобства, без
    отдельной логики «возвратов» и «денежного ящика».
    """
    by_type: dict[str, float] = {}
    by_store: dict[str, float] = {}
    by_cashier: dict[str, float] = {}
    by_time: dict[str, float] = {}
    by_time_pay: dict[str, dict[str, float]] = {}
    total_all = 0.0

    for p in points:
        if not isinstance(p, dict):
            continue
        amount = _kop_to_rub(p.get("amount"))
        pt = str(p.get("paymentType") or "UNKNOWN").upper()
        store = str(p.get("storeName") or p.get("storeId") or "—")
        cashier = str(p.get("cashier") or "—")
        tlabel = str(p.get("time") or "—")

        by_type[pt] = by_type.get(pt, 0.0) + amount
        by_store[store] = by_store.get(store, 0.0) + amount
        by_cashier[cashier] = by_cashier.get(cashier, 0.0) + amount
        by_time[tlabel] = by_time.get(tlabel, 0.0) + amount
        by_time_pay.setdefault(tlabel, {})
        by_time_pay[tlabel][pt] = by_time_pay[tlabel].get(pt, 0.0) + amount
        total_all += amount

    pay_keys = sorted(by_type.keys())
    chart_payment = {
        "labels": [PAYMENT_LABELS.get(k, k) for k in pay_keys],
        "keys": pay_keys,
        "values": [round(by_type[k], 2) for k in pay_keys],
    }
    time_keys = sorted(by_time.keys())
    chart_time = {
        "labels": time_keys,
        "total": [round(by_time[k], 2) for k in time_keys],
        "by_payment": {
            pt: [round(by_time_pay.get(tk, {}).get(pt, 0), 2) for tk in time_keys]
            for pt in pay_keys
        },
    }

    balance = round(total_all, 2)
    summary = {
        "balance": balance,  # истинный баланс кассы за период (сумма amount из API, ₽)
        "total_signed": balance,  # alias для совместимости UI
        "by_payment_type": {k: round(v, 2) for k, v in sorted(by_type.items())},
        "by_store": {k: round(v, 2) for k, v in sorted(by_store.items())},
        "by_cashier": {k: round(v, 2) for k, v in sorted(by_cashier.items())},
        "payment_labels": PAYMENT_LABELS,
        "charts": {
            "payment": chart_payment,
            "time": chart_time,
        },
        "notes": [
            "Суммы в API приходят в копейках; в отчёте пересчитаны в рубли (÷100).",
            "Баланс кассы за период = сумма всех amount из ответа API (без дополнительной фильтрации возвратов).",
            "Разбивка по типам оплаты / точкам / кассирам — справочная.",
        ],
        "unit": "RUB",
        "source_unit": "kopecks",
    }
    return summary, balance, {k: round(v, 2) for k, v in by_type.items()}


def _to_response(data: dict) -> ReportResponse:
    points_raw = data.get("points") or []
    if not isinstance(points_raw, list):
        points_raw = []

    # Конвертируем amount копейки → рубли в каждой точке
    points = []
    points_for_agg: list[dict] = []
    for p in points_raw:
        if not isinstance(p, dict):
            continue
        rub = _kop_to_rub(p.get("amount"))
        points_for_agg.append(p)  # aggregate сам делит на 100
        points.append(
            ReportPoint(
                time=p.get("time"),
                cashier=p.get("cashier"),
                storeId=p.get("storeId"),
                storeName=p.get("storeName"),
                paymentType=p.get("paymentType"),
                amount=round(rub, 2),
            )
        )

    summary, balance, by_pt = _aggregate(points_for_agg)
    return ReportResponse(
        reportType=data.get("reportType"),
        startDate=data.get("startDate"),
        endDate=data.get("endDate"),
        orderTypes=data.get("orderTypes"),
        firmId=data.get("firmId"),
        firmName=data.get("firmName"),
        points=points,
        summary=summary,
        cash_drawer=balance,  # для совместимости: баланс периода
        money_balance=balance,
        offset_balance=None,
        by_payment_type=by_pt,
        raw=data,
    )



def _push_history(login: str, report_type: str, params: dict, resp: ReportResponse) -> None:
    session = SESSIONS.get(login)
    if not session:
        return
    hist = session.setdefault("report_history", [])
    item = {
        "id": str(uuid.uuid4())[:8],
        "reportType": report_type,
        "params": params,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "balance": (resp.summary or {}).get("balance"),
            "total_signed": (resp.summary or {}).get("total_signed"),
            "cash_drawer": resp.cash_drawer,
            "points": len(resp.points),
            "startDate": resp.startDate,
            "endDate": resp.endDate,
        },
    }
    hist.insert(0, item)
    # keep last 30
    session["report_history"] = hist[:30]


@router.get("/daily", response_model=ReportResponse)
async def report_daily(
    user: CurrentUser,
    date: str = Query(..., description="YYYY-MM-DD"),
    order_types: Optional[str] = Query(None, description="VCHR,INVC,CORD"),
):
    client = _client_for(user)
    try:
        data = await client.report_daily(date, _parse_order_types(order_types))
        resp = _to_response(data)
        _push_history(user["username"], "DAILY", {"date": date, "order_types": order_types}, resp)
        log_action("report_daily", f"date={date} points={len(resp.points)}", user_id=user["username"])
        return resp
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@router.get("/weekly", response_model=ReportResponse)
async def report_weekly(
    user: CurrentUser,
    date: str = Query(..., description="YYYY-MM-DD (день внутри недели)"),
    order_types: Optional[str] = Query(None),
):
    client = _client_for(user)
    try:
        data = await client.report_weekly(date, _parse_order_types(order_types))
        resp = _to_response(data)
        _push_history(user["username"], "WEEKLY", {"date": date, "order_types": order_types}, resp)
        return resp
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@router.get("/monthly", response_model=ReportResponse)
async def report_monthly(
    user: CurrentUser,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    order_types: Optional[str] = Query(None),
):
    client = _client_for(user)
    try:
        data = await client.report_monthly(year, month, _parse_order_types(order_types))
        resp = _to_response(data)
        _push_history(
            user["username"], "MONTHLY", {"year": year, "month": month, "order_types": order_types}, resp
        )
        return resp
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@router.get("/quarterly", response_model=ReportResponse)
async def report_quarterly(
    user: CurrentUser,
    year: int = Query(..., ge=2000, le=2100),
    quarter: int = Query(..., ge=1, le=4),
    order_types: Optional[str] = Query(None),
):
    client = _client_for(user)
    try:
        data = await client.report_quarterly(year, quarter, _parse_order_types(order_types))
        resp = _to_response(data)
        _push_history(
            user["username"],
            "QUARTERLY",
            {"year": year, "quarter": quarter, "order_types": order_types},
            resp,
        )
        return resp
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@router.get("/annual", response_model=ReportResponse)
async def report_annual(
    user: CurrentUser,
    year: int = Query(..., ge=2000, le=2100),
    order_types: Optional[str] = Query(None),
):
    client = _client_for(user)
    try:
        data = await client.report_annual(year, _parse_order_types(order_types))
        resp = _to_response(data)
        _push_history(user["username"], "ANNUAL", {"year": year, "order_types": order_types}, resp)
        return resp
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@router.get("/history", response_model=List[ReportHistoryItem])
async def report_history(user: CurrentUser):
    session = get_session(user["username"]) or {}
    hist = session.get("report_history") or []
    return [
        ReportHistoryItem(
            id=h.get("id", ""),
            reportType=h.get("reportType", ""),
            params=h.get("params") or {},
            fetchedAt=h.get("fetchedAt", ""),
            summary=h.get("summary"),
        )
        for h in hist
        if isinstance(h, dict)
    ]


@router.delete("/history")
async def clear_report_history(user: CurrentUser):
    session = SESSIONS.get(user["username"])
    if session:
        session["report_history"] = []
    return {"ok": True}
