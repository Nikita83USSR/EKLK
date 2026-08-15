"""
EcomKassa API Client (Atol Online protocol v5)
FFD 1.1 / 1.2 compatible.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.utils.logger import log_action, logger


class EcomKassaError(Exception):
    def __init__(self, message: str, code: int | str | None = None, raw: Any = None):
        super().__init__(message)
        self.code = code
        self.raw = raw


def normalize_phone(phone: str | None) -> str | None:
    """
    Any messy input → strict +7XXXXXXXXXX (12 chars total).
    Accepts: +7(964)537-62-92, 8 964 537 6292, 79645376292, etc.
    """
    if not phone:
        return None
    raw = str(phone).strip()
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    # 8XXXXXXXXXX (Russia local) → 7XXXXXXXXXX
    if len(digits) == 11 and digits.startswith("8"):
        digits = "7" + digits[1:]
    # 10 digits without country → assume Russia
    if len(digits) == 10 and digits[0] in "9":
        digits = "7" + digits
    if len(digits) == 11 and digits.startswith("7"):
        return f"+{digits}"
    raise EcomKassaError(
        f"Некорректный телефон: «{phone}». Нужен формат +79001234567 "
        f"(после очистки получилось «{digits}», длина {len(digits)})"
    )


def to_rubles(amount: Decimal | float | int | str) -> float:
    """Normalize to 2 decimal places as float (API expects rubles)."""
    d = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return float(d)


class EcomKassaClient:
    def __init__(
        self,
        login: str | None = None,
        password: str | None = None,
        group_code: str | None = None,
        base_url: str | None = None,
        api_version: str = "v5",
    ):
        self.login = login or settings.ecomkassa_login
        self.password = password or settings.ecomkassa_password
        self.group_code = group_code or settings.ecomkassa_group_code
        self.base_url = (base_url or settings.ecomkassa_base_url).rstrip("/")
        self.api_version = api_version or settings.ecomkassa_api_version
        self._token: str | None = None
        self._client = httpx.AsyncClient(timeout=30.0)

    def _url(self, path: str, version: str | None = None) -> str:
        ver = version or self.api_version
        return f"{self.base_url}/fiscalorder/{ver}/{path.lstrip('/')}"

    async def close(self) -> None:
        await self._client.aclose()

    async def get_token(self, force: bool = False) -> str:
        if self._token and not force:
            return self._token
        url = self._url("getToken")
        log_action("ecom_auth", f"Requesting token from {url}")
        resp = await self._client.post(
            url,
            json={"login": self.login, "pass": self.password},
            headers={"Content-Type": "application/json; charset=utf-8"},
        )
        data = resp.json()
        if resp.status_code != 200 or data.get("code") not in (0, None) and not data.get("token"):
            raise EcomKassaError(
                data.get("text") or data.get("error", {}).get("text") or "Auth failed",
                code=data.get("code") or resp.status_code,
                raw=data,
            )
        self._token = data["token"]
        log_action("ecom_auth", "Token obtained successfully")
        return self._token

    async def _request(
        self,
        method: str,
        path: str,
        json_body: dict | None = None,
        version: str | None = None,
        retry_auth: bool = True,
    ) -> dict:
        token = await self.get_token()
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "Token": token,
        }
        url = self._url(path, version=version)
        log_action("ecom_request", f"{method} {url}", level="debug")

        resp = await self._client.request(method, url, json=json_body, headers=headers)

        if resp.status_code == 401 and retry_auth:
            log_action("ecom_auth", "Token expired, refreshing", level="warning")
            await self.get_token(force=True)
            return await self._request(method, path, json_body, version, retry_auth=False)

        try:
            data = resp.json()
        except Exception:
            raise EcomKassaError(f"Invalid response: {resp.text[:300]}", code=resp.status_code)

        if resp.status_code >= 400:
            err = data.get("error") or data
            text = err.get("text") if isinstance(err, dict) else str(err)
            raise EcomKassaError(text or f"HTTP {resp.status_code}", code=resp.status_code, raw=data)

        if isinstance(data, dict) and isinstance(data.get("error"), dict) and data["error"].get("code"):
            raise EcomKassaError(
                data["error"].get("text") or "API error",
                code=data["error"].get("code"),
                raw=data,
            )

        return data

    async def get_payment_types(self) -> list[dict]:
        """List available payment providers. Endpoint lives on v4."""
        try:
            data = await self._request("GET", f"{self.group_code}/paymentTypes", version="v4")
            if isinstance(data, list):
                return data
            return data.get("paymentTypes") or data.get("items") or []
        except EcomKassaError as e:
            log_action("ecom_payment_types", f"Fallback static list: {e}", level="warning")
            # Known types from sandbox
            return [
                {"id": 103, "code": 1, "description": 'Платёж через счёт "Сбербанк"'},
                {"id": 121, "code": 1, "description": 'Платёж через СБП "Сбербанк"'},
                {"id": 102, "code": 1, "description": 'Платёж через счёт "Тинькофф Эквайринг"'},
                {"id": 111, "code": 1, "description": 'Платёж через счёт "Тинькофф СБП"'},
                {"id": 108, "code": 1, "description": 'Платёж через СБП банка "Точка"'},
                {"id": 113, "code": 1, "description": 'Платёж через эквайринг банка "Точка"'},
                {"id": 109, "code": 1, "description": 'Платёж через счёт "Robokassa"'},
                {"id": 1, "code": 1, "description": "Наличные / электронные (фискальный type=1)"},
            ]

    async def create_sell(
        self,
        *,
        external_id: str,
        items: list[dict],
        payments: list[dict],
        total: float,
        client: dict | None = None,
        company: dict | None = None,
        sno: str = "osn",
        success_url: str | None = None,
        callback_url: str | None = None,
        timestamp: str | None = None,
    ) -> dict:
        """
        Create SALE check or INVOICE (payment link).
        If payments[].type is a provider id (101+), kind becomes INVOICE.
        """
        ts = timestamp or datetime.now().strftime("%d.%m.%Y %H:%M:%S")

        # Normalize client phone
        client = dict(client or {})
        if client.get("phone"):
            client["phone"] = normalize_phone(client["phone"])

        # Default company from sandbox
        company = company or {
            "email": self.login,
            "sno": sno,
            "inn": "7708317992",
            "payment_address": "https://app.ecomkassa.ru",
        }
        if "sno" not in company:
            company["sno"] = sno

        # Build items for v5
        prepared_items = []
        for it in items:
            price = to_rubles(it["price"])
            qty = float(it.get("quantity", 1))
            sum_val = to_rubles(it.get("sum", price * qty))
            vat_type = it.get("vat_type") or it.get("vat", {}).get("type") or "vat20"
            prepared = {
                "name": it["name"],
                "price": price,
                "quantity": qty,
                "sum": sum_val,
                "measure": it.get("measure", 0),
                "payment_method": it.get("payment_method", "full_payment"),
                "payment_object": it.get("payment_object", 1),
                "vat": {"type": vat_type},
            }
            if "vat_sum" in it or (isinstance(it.get("vat"), dict) and "sum" in it["vat"]):
                prepared["vat"]["sum"] = to_rubles(
                    it.get("vat_sum") or it["vat"].get("sum", 0)
                )
            prepared_items.append(prepared)

        prepared_payments = [
            {"type": int(p["type"]), "sum": to_rubles(p["sum"])} for p in payments
        ]

        body: dict[str, Any] = {
            "external_id": external_id,
            "timestamp": ts,
            "receipt": {
                "client": client,
                "company": company,
                "items": prepared_items,
                "payments": prepared_payments,
                "total": to_rubles(total),
            },
        }

        service: dict[str, Any] = {}
        if callback_url:
            service["callback_url"] = callback_url
        if success_url:
            service["success_url"] = success_url
        if service:
            body["service"] = service

        log_action(
            "ecom_sell",
            f"Creating sell external_id={external_id} total={total} payments={prepared_payments}",
        )
        result = await self._request("POST", f"{self.group_code}/sell", json_body=body)
        log_action(
            "ecom_sell",
            f"Created uuid={result.get('uuid')} kind={result.get('kind')} status={result.get('status')}",
            uuid=result.get("uuid"),
        )
        return result

    async def get_report(self, uuid: str) -> dict:
        """Get check / invoice status by uuid."""
        log_action("ecom_report", f"Fetching report uuid={uuid}", uuid=uuid)
        return await self._request("GET", f"{self.group_code}/report/{uuid}")

    async def create_refund(
        self,
        *,
        external_id: str,
        items: list[dict],
        payments: list[dict],
        total: float,
        client: dict | None = None,
        company: dict | None = None,
        sno: str = "osn",
        original_uuid: str | None = None,
    ) -> dict:
        """Create sell_refund (return of receipt)."""
        ts = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
        client = dict(client or {})
        if client.get("phone"):
            client["phone"] = normalize_phone(client["phone"])
        company = company or {
            "email": self.login,
            "sno": sno,
            "inn": "7708317992",
            "payment_address": "https://app.ecomkassa.ru",
        }

        prepared_items = []
        for it in items:
            price = to_rubles(it["price"])
            qty = float(it.get("quantity", 1))
            prepared_items.append({
                "name": it["name"],
                "price": price,
                "quantity": qty,
                "sum": to_rubles(it.get("sum", price * qty)),
                "measure": it.get("measure", 0),
                "payment_method": it.get("payment_method", "full_payment"),
                "payment_object": it.get("payment_object", 1),
                "vat": {"type": it.get("vat_type") or "vat20"},
            })

        body = {
            "external_id": external_id,
            "timestamp": ts,
            "receipt": {
                "client": client,
                "company": company,
                "items": prepared_items,
                "payments": [{"type": int(p["type"]), "sum": to_rubles(p["sum"])} for p in payments],
                "total": to_rubles(total),
            },
        }
        if original_uuid:
            body["receipt"]["additional_check_props"] = original_uuid

        log_action("ecom_refund", f"Creating refund external_id={external_id}")
        result = await self._request("POST", f"{self.group_code}/sell_refund", json_body=body)
        log_action("ecom_refund", f"Refund uuid={result.get('uuid')}", uuid=result.get("uuid"))
        return result
