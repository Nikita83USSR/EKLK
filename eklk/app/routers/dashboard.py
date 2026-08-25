"""
Дашборд «На главную».
Данные из mobile reports. Суммы в копейках → рубли.
Периоды: daily | weekly | monthly | quarterly | annual (как в разделе Отчёты).
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
VALID_PERIODS = ("daily", "weekly", "monthly", "quarterly", "annual")


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
    count = 0
    stores: dict[str, dict] = {}

    for p in points:
        amount = _kop_to_rub(p.get("amount"))
        pt = str(p.get("paymentType") or "UNKNOWN").upper()
        by_type[pt] = by_type.get(pt, 0.0) + amount
        total_checks += amount
        count += 1
        if pt not in ZERO_INCOME:
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
        "by_payment_type": {k: round(v, 2) for k, v in by_type.items()},
        "stores": list(stores.values()),
        "payment_labels": PAYMENT_LABELS,
    }


def _pct_change(current: float, previous: float) -> float | None:
    if previous == 0:
        return 100.0 if current > 0 else (0.0 if current == 0 else None)
    return round((current - previous) / abs(previous) * 100.0, 2)


def _prev_period_params(period: str, day: date, year: int, month: int, quarter: int) -> dict:
    """Параметры предыдущего периода для % сравнения."""
    if period == "daily":
        d = day - timedelta(days=1)
        return {"period": "daily", "date": d, "year": d.year, "month": d.month, "quarter": (d.month - 1) // 3 + 1}
    if period == "weekly":
        d = day - timedelta(days=7)
        return {"period": "weekly", "date": d, "year": d.year, "month": d.month, "quarter": (d.month - 1) // 3 + 1}
    if period == "monthly":
        if month <= 1:
            return {"period": "monthly", "date": date(year - 1, 12, 1), "year": year - 1, "month": 12, "quarter": 4}
        return {
            "period": "monthly",
            "date": date(year, month - 1, 1),
            "year": year,
            "month": month - 1,
            "quarter": (month - 2) // 3 + 1,
        }
    if period == "quarterly":
        if quarter <= 1:
            return {"period": "quarterly", "date": date(year - 1, 10, 1), "year": year - 1, "month": 10, "quarter": 4}
        m = (quarter - 2) * 3 + 1
        return {"period": "quarterly", "date": date(year, m, 1), "year": year, "month": m, "quarter": quarter - 1}
    return {
        "period": "annual",
        "date": date(year - 1, 1, 1),
        "year": year - 1,
        "month": 1,
        "quarter": 1,
    }


def _period_label(period: str, day: date, year: int, month: int, quarter: int) -> str:
    if period == "daily":
        return day.isoformat()
    if period == "weekly":
        return f"неделя от {day.isoformat()}"
    if period == "monthly":
        return f"{year}-{month:02d}"
    if period == "quarterly":
        return f"{year} Q{quarter}"
    return str(year)


async def _fetch_report(
    client: EcomKassaClient,
    period: str,
    day: date,
    year: int,
    month: int,
    quarter: int,
    order_types: list[str] | None = None,
) -> dict:
    if period == "daily":
        return await client.report_daily(day.isoformat(), order_types)
    if period == "weekly":
        return await client.report_weekly(day.isoformat(), order_types)
    if period == "monthly":
        return await client.report_monthly(year, month, order_types)
    if period == "quarterly":
        return await client.report_quarterly(year, quarter, order_types)
    if period == "annual":
        return await client.report_annual(year, order_types)
    raise HTTPException(status_code=400, detail=f"period: ожидается {', '.join(VALID_PERIODS)}")


@router.get("/summary")
async def dashboard_summary(
    user: CurrentUser,
    date_str: Optional[str] = Query(None, alias="date", description="YYYY-MM-DD (daily/weekly)"),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    quarter: Optional[int] = Query(None, ge=1, le=4),
    store_id: Optional[int] = Query(None),
    period: str = Query("daily", description="daily|weekly|monthly|quarterly|annual"),
):
    """
    Сводка дашборда за выбранный период + % к предыдущему аналогичному периоду.
    По счетам / по чекам — отдельные запросы orderTypes=INVC / VCHR.
    """
    period = (period or "daily").lower().strip()
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"period: ожидается {', '.join(VALID_PERIODS)}")

    today = date.today()
    if date_str:
        try:
            day = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="date: ожидается YYYY-MM-DD")
    else:
        day = today

    y = year if year is not None else day.year
    m = month if month is not None else day.month
    q = quarter if quarter is not None else ((day.month - 1) // 3 + 1)

    if period == "monthly":
        day = date(y, m, 1)
    elif period == "quarterly":
        day = date(y, (q - 1) * 3 + 1, 1)
    elif period == "annual":
        day = date(y, 1, 1)

    client = _client_for(user)
    try:
        raw_all = await _fetch_report(client, period, day, y, m, q, None)
        raw_vchr = await _fetch_report(client, period, day, y, m, q, ["VCHR"])
        raw_invc = await _fetch_report(client, period, day, y, m, q, ["INVC"])

        pts_all = _parse_points(raw_all, store_id)
        pts_vchr = _parse_points(raw_vchr, store_id)
        pts_invc = _parse_points(raw_invc, store_id)

        cur = _metrics(pts_all)
        by_checks = _metrics(pts_vchr)
        by_invoices = _metrics(pts_invc)

        prev_p = _prev_period_params(period, day, y, m, q)
        try:
            raw_prev = await _fetch_report(
                client,
                prev_p["period"],
                prev_p["date"],
                prev_p["year"],
                prev_p["month"],
                prev_p["quarter"],
                None,
            )
            prev = _metrics(_parse_points(raw_prev, store_id))
        except EcomKassaError:
            prev = {
                "total_checks": 0.0,
                "income": 0.0,
                "sales_count": 0,
                "avg_check": 0.0,
            }

        profit = cur["income"]
        profit_prev = prev.get("income") or 0.0

        gauge_pct = 0.0
        if cur["total_checks"]:
            gauge_pct = round(min(100.0, max(0.0, profit / cur["total_checks"] * 100.0)), 1)

        stores = cur.get("stores") or []
        label = _period_label(period, day, y, m, q)

        result = {
            "period": period,
            "date": day.isoformat(),
            "year": y,
            "month": m,
            "quarter": q,
            "period_label": label,
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
                "sales_count_pct": _pct_change(
                    float(cur["sales_count"]), float(prev.get("sales_count") or 0)
                ),
                "avg_check_pct": _pct_change(cur["avg_check"], prev.get("avg_check") or 0.0),
                "total_checks_pct": _pct_change(
                    cur["total_checks"], prev.get("total_checks") or 0.0
                ),
            },
            "gauge_pct": gauge_pct,
            "stores": stores,
            "notes": [
                "Периоды как в разделе Отчёты.",
                "Суммы API в копейках, в дашборде в рублях.",
                "Прибыль (доход) = сумма amount без зачёта аванса (PRE_PAID).",
                "По счетам = orderTypes=INVC, по чекам = VCHR.",
                "Сравнение % — с предыдущим аналогичным периодом.",
            ],
        }
        log_action(
            "dashboard_summary",
            f"period={period} label={label} sales={cur['sales_count']}",
            user_id=user["username"],
        )
        return result
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()
