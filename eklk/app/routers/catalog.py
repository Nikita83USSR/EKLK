"""
Каталог товаров: прокси к mobile catalog + catalog service.
Данные не храним — только API EcomKassa.
"""

from __future__ import annotations

import io
import xml.etree.ElementTree as ET
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from app.clients.ecomkassa import EcomKassaClient, EcomKassaError
from app.core.deps import CurrentUser
from app.schemas.catalog import (
    CatalogBulkDeleteRequest,
    CatalogImportResult,
    CatalogItemIn,
    CatalogItemOut,
    CatalogListResponse,
)
from app.utils.logger import log_action

router = APIRouter(prefix="/catalog", tags=["Catalog"])

# Map CommerceML / free-form VAT → catalog API enum
_VAT_MAP = {
    "none": "VAT_NONE",
    "vat_none": "VAT_NONE",
    "без ндс": "VAT_NONE",
    "0": "VAT_0PCT",
    "vat0": "VAT_0PCT",
    "vat_0pct": "VAT_0PCT",
    "10": "VAT_10PCT",
    "vat10": "VAT_10PCT",
    "vat_10pct": "VAT_10PCT",
    "10/110": "VAT_110PCT",
    "vat110": "VAT_110PCT",
    "vat_110pct": "VAT_110PCT",
    "20": "VAT_20PCT",
    "vat20": "VAT_20PCT",
    "vat_20pct": "VAT_20PCT",
    "20/120": "VAT_120PCT",
    "vat120": "VAT_120PCT",
    "vat_120pct": "VAT_120PCT",
    "22": "VAT_20PCT",  # closest supported
    "vat22": "VAT_20PCT",
    "5": "VAT_NONE",
    "7": "VAT_NONE",
}

_PO_MAP = {
    "товар": "COMMODITY",
    "commodity": "COMMODITY",
    "услуга": "SERVICE",
    "service": "SERVICE",
    "работа": "JOB",
    "job": "JOB",
}


def _client_for(user: dict) -> EcomKassaClient:
    return EcomKassaClient(
        login=user["username"],
        password=user["password"],
        group_code=user.get("group_code") or "990",
    )


def _tax_id(user: dict) -> str:
    firm = user.get("firm") or {}
    inn = firm.get("taxIdentity") or firm.get("tax_identity") or firm.get("inn")
    if not inn:
        raise HTTPException(status_code=400, detail="ИНН организации не найден в профиле. Обновите данные в Настройках.")
    return str(inn).strip()


def _map_item(raw: dict) -> CatalogItemOut:
    return CatalogItemOut(
        itemId=raw.get("itemId"),
        name=raw.get("name"),
        sku=raw.get("sku"),
        price=raw.get("price"),
        vatType=raw.get("vatType"),
        paymentObject=raw.get("paymentObject"),
        taxId=raw.get("taxId") or raw.get("taxIdentity"),
        raw=raw,
    )


def _norm_vat(v: str | None) -> str:
    """Normalize to catalog-service enum; mobile API often uses none/vat20."""
    if not v:
        return "VAT_NONE"
    key = str(v).strip().lower().replace(" ", "").replace("%", "")
    if key in _VAT_MAP:
        return _VAT_MAP[key]
    up = str(v).strip().upper()
    if up.startswith("VAT_"):
        return up
    return "VAT_NONE"


def _vat_for_mobile(v: str | None) -> str:
    """Mobile list uses none/vat10/vat20…"""
    n = _norm_vat(v)
    return {
        "VAT_NONE": "none",
        "VAT_0PCT": "vat0",
        "VAT_10PCT": "vat10",
        "VAT_110PCT": "vat110",
        "VAT_20PCT": "vat20",
        "VAT_120PCT": "vat120",
    }.get(n, "none")


def _po_for_mobile(v: str | None) -> str:
    n = _norm_po(v)
    return n.lower()


def _norm_po(v: str | None) -> str:
    if not v:
        return "COMMODITY"
    key = str(v).strip().lower()
    if key in _PO_MAP:
        return _PO_MAP[key]
    up = str(v).strip().upper()
    if up in ("COMMODITY", "SERVICE", "JOB", "EXCISE", "PAYMENT", "ANOTHER"):
        return up
    return "COMMODITY"


@router.get("/items", response_model=CatalogListResponse)
async def list_items(
    user: CurrentUser,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    sku: Optional[str] = None,
    name: Optional[str] = None,
    source: str = Query("auto", description="auto | mobile | catalog"),
):
    """Список товаров. auto: catalog service, fallback mobile."""
    client = _client_for(user)
    tax_id = _tax_id(user)
    try:
        payload = None
        # mobile list — рабочий путь; catalog.ecomkassa.ru CRUD часто 401 без отдельного доступа
        if source in ("auto", "mobile"):
            try:
                payload = await client.list_catalog_items(sku=sku, name=name, page=page, size=size)
            except EcomKassaError:
                if source == "mobile":
                    raise
                payload = None
        if payload is None and source in ("auto", "catalog"):
            payload = await client.catalog_list_items(
                tax_id, page=page, size=size, sku=sku, name=name
            )
        items_raw = payload.get("items") or []
        if not isinstance(items_raw, list):
            items_raw = []
        items = [_map_item(r) for r in items_raw if isinstance(r, dict)]
        return CatalogListResponse(
            items=items,
            currentPage=int(payload.get("currentPage") or page),
            totalPages=int(payload.get("totalPages") or 1),
            size=int(payload.get("size") or size),
        )
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@router.post("/items", response_model=CatalogItemOut)
async def create_item(body: CatalogItemIn, user: CurrentUser):
    client = _client_for(user)
    tax_id = _tax_id(user)
    try:
        data = await client.catalog_create_item(
            tax_id,
            {
                "name": body.name,
                "sku": body.sku,
                "price": body.price,
                "vatType": _norm_vat(body.vatType),
                "paymentObject": _norm_po(body.paymentObject),
            },
        )
        log_action("catalog_create", f"sku={body.sku}", user_id=user["username"])
        return _map_item(data if isinstance(data, dict) else {})
    except EcomKassaError as e:
        msg = str(e)
        if "401" in msg or "Unauthorized" in msg or "hostname" in msg.lower():
            msg = (
                "Каталог: запись недоступна (catalog.ecomkassa.ru вернул отказ авторизации). "
                "Просмотр списка работает через mobile API. "
                f"Детали: {e}"
            )
        raise HTTPException(status_code=400, detail=msg)
    finally:
        await client.close()


@router.put("/items/{item_id}", response_model=CatalogItemOut)
async def update_item(item_id: int, body: CatalogItemIn, user: CurrentUser):
    client = _client_for(user)
    tax_id = _tax_id(user)
    try:
        data = await client.catalog_update_item(
            tax_id,
            item_id,
            {
                "name": body.name,
                "sku": body.sku,
                "price": body.price,
                "vatType": _norm_vat(body.vatType),
                "paymentObject": _norm_po(body.paymentObject),
            },
        )
        log_action("catalog_update", f"id={item_id}", user_id=user["username"])
        return _map_item(data if isinstance(data, dict) else {})
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@router.delete("/items/{item_id}")
async def delete_item(item_id: int, user: CurrentUser):
    client = _client_for(user)
    tax_id = _tax_id(user)
    try:
        await client.catalog_delete_item(tax_id, item_id)
        log_action("catalog_delete", f"id={item_id}", user_id=user["username"])
        return {"ok": True}
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@router.post("/items/bulk-delete")
async def bulk_delete(body: CatalogBulkDeleteRequest, user: CurrentUser):
    client = _client_for(user)
    tax_id = _tax_id(user)
    deleted = 0
    errors = []
    try:
        for iid in body.item_ids:
            try:
                await client.catalog_delete_item(tax_id, iid)
                deleted += 1
            except EcomKassaError as e:
                errors.append(f"{iid}: {e}")
        log_action("catalog_bulk_delete", f"deleted={deleted}", user_id=user["username"])
        return {"deleted": deleted, "errors": errors}
    finally:
        await client.close()


@router.post("/items/delete-all")
async def delete_all(user: CurrentUser, confirm: str = Query(...)):
    """Удалить все товары. confirm должен быть «удалить»."""
    if confirm.strip().lower() != "удалить":
        raise HTTPException(status_code=400, detail="Для подтверждения введите слово «удалить»")
    client = _client_for(user)
    tax_id = _tax_id(user)
    deleted = 0
    errors = []
    try:
        page = 1
        while True:
            payload = await client.list_catalog_items(page=page, size=100)
            items = payload.get("items") or []
            if not items:
                break
            for it in items:
                iid = it.get("itemId")
                if iid is None:
                    continue
                try:
                    await client.catalog_delete_item(tax_id, iid)
                    deleted += 1
                except EcomKassaError as e:
                    errors.append(f"{iid}: {e}")
            total_pages = int(payload.get("totalPages") or 1)
            if page >= total_pages:
                break
            page += 1
        log_action("catalog_delete_all", f"deleted={deleted}", user_id=user["username"])
        return {"deleted": deleted, "errors": errors}
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


def _local(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def _text(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return (el.text or "").strip()


def _parse_commerceml(content: bytes) -> list[dict]:
    """
    CommerceML 2 → list of {name, sku, price, vatType, paymentObject}.
    Неподдерживаемые поля игнорируем.
    Модификации (Характеристики) → отдельные клоны товара с суффиксом в sku/name.
    """
    try:
        root = ET.parse(io.BytesIO(content)).getroot()
    except ET.ParseError as e:
        raise HTTPException(status_code=400, detail=f"Некорректный XML CommerceML: {e}")

    products: list[dict] = []

    # Index prices by product Id if present in ПакетПредложений
    price_by_id: dict[str, float] = {}
    for el in root.iter():
        if _local(el.tag) != "Предложение":
            continue
        pid = ""
        price = None
        for ch in el:
            ln = _local(ch.tag)
            if ln == "Ид":
                pid = _text(ch)
            elif ln == "Цены":
                for price_el in ch:
                    if _local(price_el.tag) != "Цена":
                        continue
                    for pch in price_el:
                        if _local(pch.tag) == "ЦенаЗаЕдиницу":
                            try:
                                price = float(_text(pch).replace(",", "."))
                            except ValueError:
                                pass
        if pid and price is not None:
            price_by_id[pid] = price

    def walk_products(parent: ET.Element):
        for el in parent:
            if _local(el.tag) == "Товар":
                _extract_product(el)
            else:
                walk_products(el)

    def _extract_product(el: ET.Element):
        pid = ""
        name = ""
        sku = ""
        price = 0.0
        vat = "VAT_NONE"
        po = "COMMODITY"
        mods: list[tuple[str, str]] = []  # (char_name, value)

        for ch in el:
            ln = _local(ch.tag)
            if ln == "Ид":
                pid = _text(ch)
            elif ln == "Наименование":
                name = _text(ch)
            elif ln in ("Артикул", "Штрихкод", "Код"):
                if not sku:
                    sku = _text(ch)
            elif ln == "СтавкиНалогов":
                for tax in ch:
                    if _local(tax.tag) != "СтавкаНалога":
                        continue
                    rate = ""
                    for tch in tax:
                        if _local(tch.tag) == "Ставка":
                            rate = _text(tch)
                    vat = _norm_vat(rate)
            elif ln == "ЗначенияРеквизитов":
                for req in ch:
                    if _local(req.tag) != "ЗначениеРеквизита":
                        continue
                    rname, rval = "", ""
                    for rch in req:
                        if _local(rch.tag) == "Наименование":
                            rname = _text(rch).lower()
                        elif _local(rch.tag) == "Значение":
                            rval = _text(rch)
                    if "вид номенклатуры" in rname or "тип" in rname:
                        po = _norm_po(rval)
            elif ln == "Цены":
                for price_el in ch:
                    if _local(price_el.tag) != "Цена":
                        continue
                    for pch in price_el:
                        if _local(pch.tag) == "ЦенаЗаЕдиницу":
                            try:
                                price = float(_text(pch).replace(",", "."))
                            except ValueError:
                                pass
            elif ln == "ХарактеристикиТовара":
                for char in ch:
                    if _local(char.tag) != "ХарактеристикаТовара":
                        continue
                    cn, cv = "", ""
                    for cch in char:
                        if _local(cch.tag) == "Наименование":
                            cn = _text(cch)
                        elif _local(cch.tag) == "Значение":
                            cv = _text(cch)
                    if cn or cv:
                        mods.append((cn, cv))

        if not name and not sku:
            return
        if not sku:
            sku = pid or name[:32]
        if price <= 0 and pid in price_by_id:
            price = price_by_id[pid]

        base = {
            "name": name or sku,
            "sku": sku,
            "price": price,
            "vatType": vat,
            "paymentObject": po,
        }
        if not mods:
            products.append(base)
        else:
            # Клонируем товар на каждую модификацию
            for i, (cn, cv) in enumerate(mods):
                suffix = cv or cn or str(i + 1)
                products.append(
                    {
                        "name": f"{base['name']} ({suffix})"[:256],
                        "sku": f"{base['sku']}-{suffix}"[:64],
                        "price": base["price"],
                        "vatType": base["vatType"],
                        "paymentObject": base["paymentObject"],
                    }
                )

    walk_products(root)
    return products


@router.post("/import/commerceml", response_model=CatalogImportResult)
async def import_commerceml(user: CurrentUser, file: UploadFile = File(...)):
    """
    Импорт CommerceML 2 (XML). Неподдерживаемые поля игнорируются.
    Модификации → клоны товара.
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Пустой файл")
    rows = _parse_commerceml(content)
    if not rows:
        raise HTTPException(status_code=400, detail="В файле не найдено товаров CommerceML")

    client = _client_for(user)
    tax_id = _tax_id(user)
    created = 0
    skipped = 0
    errors: list[str] = []
    out_items: list[CatalogItemOut] = []
    try:
        for row in rows:
            try:
                data = await client.catalog_create_item(
                    tax_id,
                    {
                        "name": row["name"][:256],
                        "sku": str(row["sku"])[:64],
                        "price": float(row.get("price") or 0),
                        "vatType": _norm_vat(row.get("vatType")),
                        "paymentObject": _norm_po(row.get("paymentObject")),
                    },
                )
                created += 1
                out_items.append(_map_item(data if isinstance(data, dict) else row))
            except EcomKassaError as e:
                msg = str(e).lower()
                if "уже существует" in msg or "already" in msg or "sku" in msg:
                    skipped += 1
                else:
                    errors.append(f"{row.get('sku')}: {e}")
        log_action(
            "catalog_import",
            f"created={created} skipped={skipped} errors={len(errors)}",
            user_id=user["username"],
        )
        return CatalogImportResult(
            created=created, skipped=skipped, errors=errors[:50], items=out_items[:100]
        )
    finally:
        await client.close()
