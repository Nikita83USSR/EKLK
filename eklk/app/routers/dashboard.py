"""
Дашборд «На главную».
Данные из mobile reports (день по умолчанию). Суммы в копейках → рубли.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.clients.ecomkassa import EcomKassaClient, EcomKassaError
from app.core.deps import CurrentUser
from app.routers.reports import _kop_to_rub, PAYMENT_LABELS
from app.utils.logger import log_action

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

ZERO_INCOME = {"PRE_PAID"}


def _client_for(user: dict) -> EcomKassaClient:
    return EcomKassaClient(
        login=user["username"],
        password=user["password"],
        group_code=user.get("group_code") or "990",
    )


def _parse_points(data: dict, store_id: int | None = None) -> list[dict]:
    points = data.get("points") or []
    if not isinstance(points, list):
        return []
    out = []
    for p in points:
        if not isinstance(p, dict):
            continue
        if store_id is not None:
            try:
                sid = int(p.get("storeId")) if p.get("storeId") is not None else None
            except (TypeError, ValueError):
                sid = None
            if sid != int(store_id):
                continue
        out.append(p)
    return out


def _metrics(points: list[dict]) -> dict:
    total_checks = 0.0
    income = 0.0
    cash = 0.0
    by_type: dict[str, float] = {}
    invoices = 0.0  # will use payment split as proxy if no doc type in points
    # points don't have order type — split by payment is available;
    # "по счетам / по чекам" from API orderTypes filter when fetching separately
    count = 0
    stores: dict[str, dict] = {}

    for p in points:
        amount = _kop_to_rub(p.get("amount"))
        pt = str(p.get("paymentType") or "UNKNOWN").upper()
        by_type[pt] = by_type.get(pt, 0.0) + amount
        total_checks += amount
        count += 1
        if pt in ZERO_INCOME:
            pass
        else:
            income += amount
        if pt == "CASH":
            cash += amount
        sid = p.get("storeId")
        sname = str(p.get("storeName") or sid or "—")
        key = f"{sid}:{sname}"
        if key not in stores:
            stores[key] = {"storeId": sid, "storeName": sname}

    avg = (total_checks / count) if count else 0.0
    return {
        "total_checks": round(total_checks, 2),
        "income": round(income, 2),
        "cash_balance": round(cash, 2),
        "sales_count": count,
        "avg_check": round(avg, 2),
        "by_payment_type": {k: round(v, 2) for k, v in sorted(by_type.items())},
        "stores": list(stores.values()),
        "payment_labels": PAYMENT_LABELS,
    }


def _pct_change(current: float, previous: float) -> float | None:
    if previous == 0:
        return 100.0 if current > 0 else (0.0 if current == 0 else None)
    return round((current - previous) / abs(previous) * 100.0, 2)


def _prev_date(d: date) -> date:
    return d - timedelta(days=1)


@router.get("/summary")
async def dashboard_summary(
    user: CurrentUser,
    date_str: Optional[str] = Query(None, alias="date", description="YYYY-MM-DD, по умолчанию сегодня"),
    store_id: Optional[int] = Query(None),
    period: str = Query("daily", description="daily|weekly|monthly"),
):
    """
    Сводка дашборда.
    period=daily (по умолчанию): отчёт за день + сравнение с предыдущим днём.
    По счетам / по чекам — отдельные запросы orderTypes=INVC / VCHR.
    """
    if date_str:
        try:
            day = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="date: ожидается YYYY-MM-DD")
    else:
        day = date.today()

    client = _client_for(user)
    try:
        ds = day.isoformat()

        async def fetch_daily(d: str, order_types: list[str] | None = None):
            return await client.report_daily(d, order_types)

        # текущий день: все / чеки / счета
        raw_all = await fetch_daily(ds, None)
        raw_vchr = await fetch_daily(ds, ["VCHR"])
        raw_invc = await fetch_daily(ds, ["INVC"])

        pts_all = _parse_points(raw_all, store_id)
        pts_vchr = _parse_points(raw_vchr, store_id)
        pts_invc = _parse_points(raw_invc, store_id)

        cur = _metrics(pts_all)
        by_checks = _metrics(pts_vchr)
        by_invoices = _metrics(pts_invc)

        # предыдущий день для %
        prev_ds = _prev_date(day).isoformat()
        try:
            raw_prev = await fetch_daily(prev_ds, None)
            pts_prev = _parse_points(raw_prev, store_id)
            prev = _metrics(pts_prev)
        except EcomKassaError:
            prev = {
                "total_checks": 0.0,
                "income": 0.0,
                "sales_count": 0,
                "avg_check": 0.0,
            }

        profit = cur["income"]  # доход без PRE_PAID
        profit_prev = prev.get("income") or 0.0

        # gauge: доля дохода в общей сумме чеков (0–100)
        gauge_pct = 0.0
        if cur["total_checks"]:
            gauge_pct = round(min(100.0, max(0.0, profit / cur["total_checks"] * 100.0)), 1)

        # stores list from current
        stores = cur.get("stores") or []

        result = {
            "period": "daily",
            "date": ds,
            "prev_date": prev_ds,
            "period_label": ds,
            "firmName": raw_all.get("firmName"),
            "store_id": store_id,
            "by_invoices": by_invoices["total_checks"],
            "by_checks": by_checks["total_checks"],
            "profit": profit,
            "total_checks": cur["total_checks"],
            "cash_balance": cur["cash_balance"],
            "sales_count": cur["sales_count"],
            "avg_check": cur["avg_check"],
            "by_payment_type": cur["by_payment_type"],
            "payment_labels": PAYMENT_LABELS,
            "changes": {
                "profit_pct": _pct_change(profit, profit_prev),
                "sales_count_pct": _pct_change(float(cur["sales_count"]), float(prev.get("sales_count") or 0)),
                "avg_check_pct": _pct_change(cur["avg_check"], prev.get("avg_check") or 0.0),
                "total_checks_pct": _pct_change(cur["total_checks"], prev.get("total_checks") or 0.0),
            },
            "gauge_pct": gauge_pct,
            "stores": stores,
            "notes": [
                "Период по умолчанию — день.",
                "Суммы API в копейках, в дашборде в рублях.",
                "Прибыль (доход) = сумма amount без зачёта аванса (PRE_PAID).",
                "По счетам = orderTypes=INVC, по чекам = VCHR.",
                "Сравнение % — с предыдущим календарным днём.",
            ],
        }
        log_action("dashboard_summary", f"date={ds} sales={cur['sales_count']}", user_id=user["username"])
        return result
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()
