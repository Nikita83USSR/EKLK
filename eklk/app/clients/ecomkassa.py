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


def split_phones(phones: str | None) -> list[str]:
    """Split comma/semicolon phones and normalize each."""
    if not phones:
        return []
    result = []
    for part in re.split(r"[,;]+", phones):
        part = part.strip()
        if not part:
            continue
        try:
            result.append(normalize_phone(part))
        except EcomKassaError:
            # keep raw digits-only attempt
            d = re.sub(r"\D", "", part)
            if len(d) == 11 and d.startswith("8"):
                d = "7" + d[1:]
            if len(d) == 10:
                d = "7" + d
            if len(d) == 11 and d.startswith("7"):
                result.append(f"+{d}")
    return [p for p in result if p]


def build_agent_payload(agent: dict) -> tuple[dict, dict | None]:
    """
    Build agent_info + supplier_info for Atol v5.
    agent dict from AgentInfoIn.model_dump()
    """
    agent_info: dict = {"type": agent["type"]}
    # paying_agent block — relevant for paying_* and bank_paying_*
    pa_phones = split_phones(agent.get("paying_phones"))
    if agent.get("paying_operation") or pa_phones:
        pa: dict = {}
        if agent.get("paying_operation"):
            pa["operation"] = str(agent["paying_operation"])[:24]
        if pa_phones:
            pa["phones"] = pa_phones
        if pa:
            agent_info["paying_agent"] = pa

    r_phones = split_phones(agent.get("receive_phones"))
    if r_phones:
        agent_info["receive_payments_operator"] = {"phones": r_phones}

    t_phones = split_phones(agent.get("transfer_phones"))
    if t_phones or agent.get("transfer_name") or agent.get("transfer_address") or agent.get("transfer_inn"):
        mt: dict = {}
        if t_phones:
            mt["phones"] = t_phones
        if agent.get("transfer_name"):
            mt["name"] = agent["transfer_name"]
        if agent.get("transfer_address"):
            mt["address"] = agent["transfer_address"]
        if agent.get("transfer_inn"):
            mt["inn"] = agent["transfer_inn"]
        if mt:
            agent_info["money_transfer_operator"] = mt

    supplier = None
    s_phones = split_phones(agent.get("supplier_phones"))
    if agent.get("supplier_name") or s_phones or agent.get("supplier_inn"):
        supplier = {}
        if s_phones:
            supplier["phones"] = s_phones
        if agent.get("supplier_name"):
            supplier["name"] = agent["supplier_name"]
        if agent.get("supplier_inn"):
            supplier["inn"] = agent["supplier_inn"]

    return agent_info, supplier


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

    def _mobile_url(self, path: str) -> str:
        return f"{self.base_url}/api/mobile/v1/{path.lstrip('/')}"

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

    async def get_firm_profile(self) -> dict:
        """
        GET /api/mobile/v1/profile/firm
        Returns firm + stores (storeId is used as group_code for fiscal API).
        """
        token = await self.get_token()
        url = self._mobile_url("profile/firm")
        log_action("ecom_firm", f"GET {url}")
        resp = await self._client.get(
            url,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Token": token,
            },
        )
        try:
            data = resp.json()
        except Exception:
            raise EcomKassaError(
                f"Invalid firm profile response: {resp.text[:300]}",
                code=resp.status_code,
            )
        if resp.status_code >= 400:
            err = data.get("error") or data
            text = err.get("text") if isinstance(err, dict) else str(err)
            raise EcomKassaError(text or f"HTTP {resp.status_code}", code=resp.status_code, raw=data)
        # Mobile API uses errorCode
        if isinstance(data, dict) and data.get("errorCode") not in (0, None, "0"):
            raise EcomKassaError(
                data.get("errorMessage") or data.get("error") or "Firm profile error",
                code=data.get("errorCode"),
                raw=data,
            )
        payload = data.get("payload") if isinstance(data, dict) else None
        if not payload:
            raise EcomKassaError("Empty firm profile payload", raw=data)
        log_action(
            "ecom_firm",
            f"Firm {payload.get('firmName')} stores={len(payload.get('stores') or [])}",
        )
        return payload

    async def _mobile_request(
        self,
        method: str,
        path: str,
        json_body: dict | None = None,
        retry_auth: bool = True,
    ) -> dict:
        """Request to /api/mobile/v1/... with Token header."""
        token = await self.get_token()
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "Token": token,
        }
        url = self._mobile_url(path)
        log_action("ecom_mobile", f"{method} {url}", level="debug")
        resp = await self._client.request(method, url, json=json_body, headers=headers)

        if resp.status_code == 401 and retry_auth:
            log_action("ecom_auth", "Token expired (mobile), refreshing", level="warning")
            await self.get_token(force=True)
            return await self._mobile_request(method, path, json_body, retry_auth=False)

        try:
            data = resp.json()
        except Exception:
            raise EcomKassaError(f"Invalid response: {resp.text[:300]}", code=resp.status_code)

        if resp.status_code >= 400:
            err = data.get("error") or data
            text = err if isinstance(err, str) else (err.get("text") or err.get("error") if isinstance(err, dict) else str(err))
            raise EcomKassaError(text or f"HTTP {resp.status_code}", code=resp.status_code, raw=data)

        if isinstance(data, dict) and data.get("errorCode") not in (0, None, "0"):
            raise EcomKassaError(
                data.get("error") or data.get("errorMessage") or "Mobile API error",
                code=data.get("errorCode"),
                raw=data,
            )
        return data

    async def search_orders(
        self,
        *,
        offset: int = 0,
        limit: int = 30,
        external_id: str | None = None,
        since: str | None = None,
        until: str | None = None,
        order_types: list[str] | None = None,
    ) -> dict:
        """
        POST /api/mobile/v1/orders/search
        Default: last 30, sorted by update date (API side).
        """
        body: dict = {
            "offset": max(0, offset),
            "limit": min(max(1, limit), 500),
        }
        if external_id:
            body["externalId"] = external_id
        if since:
            body["since"] = since
        if until:
            body["until"] = until
        if order_types:
            body["orderTypes"] = order_types
        log_action("ecom_orders_search", f"offset={offset} limit={limit}")
        data = await self._mobile_request("POST", "orders/search", json_body=body)
        # Response may be {query, result} without errorCode wrapper
        if "result" in data:
            return data
        if "payload" in data:
            return data["payload"] if isinstance(data["payload"], dict) else {"result": data["payload"]}
        return data

    async def get_order(self, order_id: int | str) -> dict:
        """GET /api/mobile/v1/orders/:orderId"""
        data = await self._mobile_request("GET", f"orders/{order_id}")
        if "payload" in data and isinstance(data["payload"], dict):
            return data["payload"]
        return data

    async def get_order_atol5(self, order_id: int | str) -> dict:
        """GET /api/mobile/v1/orders/:orderId/atol-5 — receipt in Atol Online v5 format."""
        data = await self._mobile_request("GET", f"orders/{order_id}/atol-5")
        if "payload" in data and isinstance(data["payload"], dict):
            return data["payload"]
        return data

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
        agent: dict | None = None,
        additional_user_props: dict | None = None,
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

        # Agent / supplier only on items marked is_agent (ФФД: per subject of settlement)
        if agent:
            agent_info, supplier_info = build_agent_payload(agent)
            for src, prepared in zip(items, prepared_items):
                if src.get("is_agent"):
                    prepared["agent_info"] = agent_info
                    if supplier_info:
                        prepared["supplier_info"] = supplier_info

        prepared_payments = [
            {"type": int(p["type"]), "sum": to_rubles(p["sum"])} for p in payments
        ]

        receipt: dict[str, Any] = {
            "client": client,
            "company": company,
            "items": prepared_items,
            "payments": prepared_payments,
            "total": to_rubles(total),
        }
        if additional_user_props and additional_user_props.get("name") and additional_user_props.get("value"):
            receipt["additional_user_props"] = {
                "name": str(additional_user_props["name"])[:64],
                "value": str(additional_user_props["value"])[:256],
            }

        body: dict[str, Any] = {
            "external_id": external_id,
            "timestamp": ts,
            "receipt": receipt,
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
