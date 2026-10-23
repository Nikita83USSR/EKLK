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
from app.core.deps import CurrentUser, get_session, update_session_fields
from app.schemas.reports import (
    ReportPoint,
    ReportResponse,
    ReportHistoryItem,
    ReportHistoryCreate,
    InvoiceReportItem,
    InvoiceReportResponse,
)
from app.utils.logger import log_action

router = APIRouter(prefix="/reports", tags=["Reports"])

# Статусы «завершён» для отчёта по платежам INVC (как в UI списка документов)
INVOICE_DONE_STATUSES = frozenset(
    {"done", "completed", "complete", "success", "ok", "ready", "printed"}
)
INVOICE_SEARCH_PAGE = 500
INVOICE_MAX_PAGES = 40  # safety: 40 * 500 = 20_000 сырых записей
INVOICE_MAX_PERIOD_DAYS = 366

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


def _period_label(data: dict) -> str:
    """Человекочитаемый период из ответа API."""
    start = data.get("startDate") or ""
    end = data.get("endDate") or ""
    rtype = (data.get("reportType") or "").upper()
    if start and end and start != end:
        return f"{start} — {end}"
    if start:
        return str(start)
    if end:
        return str(end)
    return rtype or "период"


def _aggregate(points: list[dict], *, period_label: str = "") -> dict:
    """
    amount в API — копейки → рубли.

    EcomKassa уже учла приходы/возвраты в amount.
    - total_checks (общая сумма чеков) = сумма всех amount.
    - income (доход за период) = сумма amount, где зачёт аванса (PRE_PAID) = 0
      (вычитаем/не учитываем зачёт предоплаты).
    - cash_balance = только CASH.
    """
    # типы, которые не дают «живого» дохода при зачёте
    ZERO_INCOME_TYPES = {"PRE_PAID"}

    by_type: dict[str, float] = {}
    by_store: dict[str, float] = {}
    by_cashier: dict[str, float] = {}
    by_time: dict[str, float] = {}
    by_time_pay: dict[str, dict[str, float]] = {}
    stores_map: dict[str, dict] = {}
    total_checks = 0.0
    income = 0.0
    cash_balance = 0.0
    prepaid_total = 0.0

    def store_key(p: dict):
        return (
            str(p.get("storeName") or ""),
            int(p.get("storeId") or 0),
            str(p.get("time") or ""),
        )

    ordered = sorted([p for p in points if isinstance(p, dict)], key=store_key)

    for p in ordered:
        amount = _kop_to_rub(p.get("amount"))
        pt = str(p.get("paymentType") or "UNKNOWN").upper()
        store_name = str(p.get("storeName") or p.get("storeId") or "—")
        store_id = p.get("storeId")
        cashier = str(p.get("cashier") or "—")
        tlabel = str(p.get("time") or "—")

        by_type[pt] = by_type.get(pt, 0.0) + amount
        by_store[store_name] = by_store.get(store_name, 0.0) + amount
        by_cashier[cashier] = by_cashier.get(cashier, 0.0) + amount
        by_time[tlabel] = by_time.get(tlabel, 0.0) + amount
        by_time_pay.setdefault(tlabel, {})
        by_time_pay[tlabel][pt] = by_time_pay[tlabel].get(pt, 0.0) + amount

        total_checks += amount
        if pt in ZERO_INCOME_TYPES:
            prepaid_total += amount
            # зачёт аванса в доход не входит (0)
        else:
            income += amount
        if pt == "CASH":
            cash_balance += amount

        sk = f"{store_id}:{store_name}"
        if sk not in stores_map:
            stores_map[sk] = {"storeId": store_id, "storeName": store_name}

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

    summary = {
        "period_label": period_label,
        "total_checks": round(total_checks, 2),  # общая сумма чеков
        "income": round(income, 2),  # доход за период (без PRE_PAID)
        "prepaid_total": round(prepaid_total, 2),  # зачёт аванса (справочно)
        "balance": round(income, 2),
        "total_signed": round(total_checks, 2),
        "cash_balance": round(cash_balance, 2),
        "by_payment_type": {k: round(v, 2) for k, v in sorted(by_type.items())},
        "by_store": {k: round(v, 2) for k, v in sorted(by_store.items())},
        "by_cashier": {k: round(v, 2) for k, v in sorted(by_cashier.items())},
        "stores": sorted(
            stores_map.values(),
            key=lambda s: (str(s.get("storeName") or ""), int(s.get("storeId") or 0)),
        ),
        "payment_labels": PAYMENT_LABELS,
        "charts": {
            "payment": chart_payment,
            "time": chart_time,
        },
        "notes": [
            "Суммы в API приходят в копейках; в отчёте пересчитаны в рубли (÷100).",
            "EcomKassa уже учитывает приходы и возвраты в amount.",
            "Общая сумма чеков = сумма всех amount из ответа.",
            "Доход за период = общая сумма чеков минус зачёт аванса (PRE_PAID считается 0).",
            "Баланс наличных = сумма amount с paymentType=CASH.",
            "Отчёт упорядочен по магазину (storeName / storeId).",
        ],
        "unit": "RUB",
        "source_unit": "kopecks",
    }
    return summary



def _to_response(
    data: dict,
    *,
    store_id: int | None = None,
) -> ReportResponse:
    points_raw = data.get("points") or []
    if not isinstance(points_raw, list):
        points_raw = []

    # фильтр по магазину (если выбран)
    if store_id is not None:
        filtered = []
        for p in points_raw:
            if not isinstance(p, dict):
                continue
            try:
                sid = int(p.get("storeId")) if p.get("storeId") is not None else None
            except (TypeError, ValueError):
                sid = None
            if sid == int(store_id):
                filtered.append(p)
        points_raw = filtered

    period_label = _period_label(data)
    summary = _aggregate(points_raw, period_label=period_label)

    # точки в рублях, сортировка по магазину
    def sort_key(p: dict):
        return (
            str(p.get("storeName") or ""),
            int(p.get("storeId") or 0),
            str(p.get("time") or ""),
        )

    ordered = sorted([p for p in points_raw if isinstance(p, dict)], key=sort_key)
    points = [
        ReportPoint(
            time=p.get("time"),
            cashier=p.get("cashier"),
            storeId=p.get("storeId"),
            storeName=p.get("storeName"),
            paymentType=p.get("paymentType"),
            amount=round(_kop_to_rub(p.get("amount")), 2),
        )
        for p in ordered
    ]

    return ReportResponse(
        reportType=data.get("reportType"),
        startDate=data.get("startDate"),
        endDate=data.get("endDate"),
        orderTypes=data.get("orderTypes"),
        firmId=data.get("firmId"),
        firmName=data.get("firmName"),
        points=points,
        summary=summary,
        cash_drawer=summary.get("cash_balance"),
        money_balance=summary.get("income"),
        offset_balance=summary.get("prepaid_total"),
        by_payment_type=summary.get("by_payment_type"),
        raw=data,
    )


def _push_history(login: str, report_type: str, params: dict, resp: ReportResponse) -> None:
    session = get_session(login)
    if not session:
        return
    hist = list(session.get("report_history") or [])
    item = {
        "id": str(uuid.uuid4())[:8],
        "reportType": report_type,
        "params": params,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total_checks": (resp.summary or {}).get("total_checks"),
            "income": (resp.summary or {}).get("income"),
            "cash_balance": (resp.summary or {}).get("cash_balance"),
            "prepaid_total": (resp.summary or {}).get("prepaid_total"),
            "period_label": (resp.summary or {}).get("period_label"),
            "points": len(resp.points),
            "startDate": resp.startDate,
            "endDate": resp.endDate,
        },
    }
    hist.insert(0, item)
    # keep last 30
    update_session_fields(login, report_history=hist[:30])


@router.get("/daily", response_model=ReportResponse)
async def report_daily(
    user: CurrentUser,
    date: str = Query(..., description="YYYY-MM-DD"),
    order_types: Optional[str] = Query(None, description="VCHR,INVC,CORD"),
    store_id: Optional[int] = Query(None, description="Фильтр по storeId из ответа"),
):
    client = _client_for(user)
    try:
        data = await client.report_daily(date, _parse_order_types(order_types))
        resp = _to_response(data, store_id=store_id)
        _push_history(
            user["username"],
            "DAILY",
            {"date": date, "order_types": order_types, "store_id": store_id},
            resp,
        )
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
    store_id: Optional[int] = Query(None),
):
    client = _client_for(user)
    try:
        data = await client.report_weekly(date, _parse_order_types(order_types))
        resp = _to_response(data, store_id=store_id)
        _push_history(
            user["username"],
            "WEEKLY",
            {"date": date, "order_types": order_types, "store_id": store_id},
            resp,
        )
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
    store_id: Optional[int] = Query(None),
):
    client = _client_for(user)
    try:
        data = await client.report_monthly(year, month, _parse_order_types(order_types))
        resp = _to_response(data, store_id=store_id)
        _push_history(
            user["username"],
            "MONTHLY",
            {"year": year, "month": month, "order_types": order_types, "store_id": store_id},
            resp,
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
    store_id: Optional[int] = Query(None),
):
    client = _client_for(user)
    try:
        data = await client.report_quarterly(year, quarter, _parse_order_types(order_types))
        resp = _to_response(data, store_id=store_id)
        _push_history(
            user["username"],
            "QUARTERLY",
            {"year": year, "quarter": quarter, "order_types": order_types, "store_id": store_id},
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
    store_id: Optional[int] = Query(None),
):
    client = _client_for(user)
    try:
        data = await client.report_annual(year, _parse_order_types(order_types))
        resp = _to_response(data, store_id=store_id)
        _push_history(
            user["username"],
            "ANNUAL",
            {"year": year, "order_types": order_types, "store_id": store_id},
            resp,
        )
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


@router.post("/history", response_model=ReportHistoryItem)
async def add_report_history(body: ReportHistoryCreate, user: CurrentUser):
    """Добавить запись в историю (для клиентских отчётов: ссылки на оплату)."""
    session = get_session(user["username"])
    if not session:
        raise HTTPException(status_code=401, detail="Сессия истекла")
    hist = list(session.get("report_history") or [])
    item = {
        "id": str(uuid.uuid4())[:8],
        "reportType": body.reportType,
        "params": body.params or {},
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "summary": body.summary or {},
    }
    hist.insert(0, item)
    update_session_fields(user["username"], report_history=hist[:30])
    return ReportHistoryItem(
        id=item["id"],
        reportType=item["reportType"],
        params=item["params"],
        fetchedAt=item["fetchedAt"],
        summary=item["summary"],
    )


@router.delete("/history")
async def clear_report_history(user: CurrentUser):
    if get_session(user["username"]):
        update_session_fields(user["username"], report_history=[])
    return {"ok": True}


def _parse_iso_dt(value: str) -> datetime:
    """Parse ISO / datetime-local into aware UTC datetime."""
    s = (value or "").strip()
    if not s:
        raise ValueError("empty")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        # date only YYYY-MM-DD
        dt = datetime.fromisoformat(s + "T00:00:00")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _is_invoice_done(status: object) -> bool:
    key = str(status or "").lower().strip()
    return key in INVOICE_DONE_STATUSES


@router.get("/invoices", response_model=InvoiceReportResponse)
async def report_invoices(
    user: CurrentUser,
    since: str = Query(..., description="ISO / datetime-local start"),
    until: str = Query(..., description="ISO / datetime-local end"),
    store_id: Optional[int] = Query(None, description="Filter by store; omit = all"),
):
    """
    Список завершённых платежей INVC за период.

    Mobile search отдаёт страницы до 500 записей смешанных статусов.
    Листаем offset, пока API не исчерпается, оставляя только done-статусы
    (и опционально store_id). ФИО покупателя — на клиенте через /orders/{id}.
    """
    try:
        dt_since = _parse_iso_dt(since)
        dt_until = _parse_iso_dt(until)
    except ValueError:
        raise HTTPException(status_code=400, detail="Некорректный формат since/until")

    if dt_until < dt_since:
        raise HTTPException(status_code=400, detail="«По» не может быть раньше «С»")

    if (dt_until - dt_since).days > INVOICE_MAX_PERIOD_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Период не более {INVOICE_MAX_PERIOD_DAYS} дней (1 год)",
        )

    # Нормализуем в ISO UTC с миллисекундами — как ждёт mobile API
    since_iso = dt_since.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    until_iso = dt_until.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    client = _client_for(user)
    items: list[InvoiceReportItem] = []
    pages = 0
    raw_scanned = 0
    offset = 0

    try:
        while pages < INVOICE_MAX_PAGES:
            data = await client.search_orders(
                offset=offset,
                limit=INVOICE_SEARCH_PAGE,
                since=since_iso,
                until=until_iso,
                order_types=["INVC"],
            )
            rows = data.get("result") or []
            if not isinstance(rows, list):
                rows = []
            pages += 1
            raw_scanned += len(rows)

            for raw in rows:
                if not isinstance(raw, dict):
                    continue
                if not _is_invoice_done(raw.get("status")):
                    continue
                sid = raw.get("storeId")
                try:
                    sid_int = int(sid) if sid is not None else None
                except (TypeError, ValueError):
                    sid_int = None
                if store_id is not None and sid_int != int(store_id):
                    continue

                oid = raw.get("orderId")
                try:
                    total_val = float(raw.get("total") or 0)
                except (TypeError, ValueError):
                    total_val = 0.0

                items.append(
                    InvoiceReportItem(
                        uuid=str(oid if oid is not None else raw.get("externalId") or ""),
                        order_id=int(oid) if oid is not None else None,
                        external_id=raw.get("externalId"),
                        date=raw.get("updated"),
                        total=round(total_val, 2),
                        status=str(raw.get("status") or ""),
                        store_id=sid_int,
                        store_name=raw.get("storeName"),
                    )
                )

            if len(rows) < INVOICE_SEARCH_PAGE:
                break
            offset += INVOICE_SEARCH_PAGE

        # Сортировка по дате убыв. (как в документах)
        def _date_key(it: InvoiceReportItem):
            return it.date or ""

        items.sort(key=_date_key, reverse=True)
        total_sum = round(sum((it.total or 0.0) for it in items), 2)

        log_action(
            "reports_invoices",
            f"items={len(items)} raw={raw_scanned} pages={pages} store={store_id}",
            user_id=user["username"],
        )

        return InvoiceReportResponse(
            reportType="INVOICE_PAYMENTS",
            since=since_iso,
            until=until_iso,
            store_id=store_id,
            items=items,
            total_count=len(items),
            total_sum=total_sum,
            pages_scanned=pages,
            raw_scanned=raw_scanned,
        )
    except EcomKassaError as e:
        raise HTTPException(
            status_code=400,
            detail={"message": str(e), "code": e.code, "raw": e.raw},
        )
    finally:
        await client.close()
