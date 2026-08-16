# AGENTS.md — контекст для ИИ / продолжения разработки EKLK

Документ для ассистентов (Grok, Cursor, Claude, Codex и т.д.).  
Цель: продолжить работу **без устных подсказок пользователя**, опираясь только на репозиторий.

Ветка разработки: **`dev`**. Стабильные merge — в **`main`**.

---

## 1. Что это за проект

**EKLK** — FastAPI + vanilla JS личный кабинет поверх API **EcomKassa** (протокол Atol Online v5).

- Репозиторий: `https://github.com/Nikita83USSR/EKLK`
- Рабочая папка приложения: `eklk/` (внутри неё `app/`, `.venv`, `start-eklk.sh`)
- UI язык: русский
- Авторизация пользователя = credentials EcomKassa, не локальная БД пользователей

Не путать:

- `https://app.ecomkassa.ru` — **API backend** (fiscalorder + mobile), не «чужой ЛК»
- `https://ecomkassa.ru` — маркетинговый сайт
- Наш ЛК — `http://localhost:8000` (этот проект)

---

## 2. Карта кода

| Путь | Роль |
|------|------|
| `app/main.py` | FastAPI, CORS, static `/static`, template `/`, health |
| `app/clients/ecomkassa.py` | Единственный HTTP-клиент к EcomKassa |
| `app/routers/auth.py` | login / me / firm / select-store |
| `app/routers/ecom.py` | checks, refunds, payment-types, report |
| `app/routers/orders.py` | search + order detail + atol5 |
| `app/schemas/*` | Pydantic request/response |
| `app/core/config.py` | Settings из `.env` |
| `app/core/deps.py` | JWT user + **in-memory SESSIONS** |
| `app/core/security.py` | create/decode JWT |
| `app/templates/index.html` | UI |
| `app/static/js/app.js` | вся клиентская логика (IIFE) |
| `app/static/css/app.css` | стили |

Сессия сервера: `SESSIONS[login] = { password, group_code, selected_store_id, firm }`.  
После рестарта uvicorn JWT ещё жив, а session нет → 401 «Сессия истекла».

---

## 3. Все методы, которые реально используются

### 3.1 Наш REST (`/api/v1`)

```
POST /api/v1/auth/login
POST /api/v1/auth/login/form
GET  /api/v1/auth/me
GET  /api/v1/auth/firm
POST /api/v1/auth/select-store          body: { store_id }

GET  /api/v1/ecom/payment-types
POST /api/v1/ecom/checks                CreateCheckRequest
GET  /api/v1/ecom/checks/{uuid}
POST /api/v1/ecom/refunds               CreateRefundRequest

POST /api/v1/orders/search              OrderSearchRequest
GET  /api/v1/orders/search              query: offset,limit,external_id,since,until,order_types
GET  /api/v1/orders/{order_id}          summary + atol5

GET  /
GET  /health
GET  /docs
```

### 3.2 EcomKassa Fiscalorder

Base: `{ECOMKASSA_BASE_URL}/fiscalorder/{v4|v5}/...`

| Client method | HTTP |
|---------------|------|
| `get_token` | `POST .../v5/getToken` body `{login, pass}` |
| `create_sell` | `POST .../v5/{group}/sell` header `Token` |
| `create_refund` | `POST .../v5/{group}/sell_refund` |
| `get_report` | `GET .../v5/{group}/report/{uuid}` |
| `get_payment_types` | `GET .../v4/{group}/paymentTypes` |

`group` = session `group_code` = выбранный `storeId`.

### 3.3 EcomKassa Mobile API

Base: `{ECOMKASSA_BASE_URL}/api/mobile/v1/...`  
Header: `Token: <fiscal token>`

| Client method | HTTP |
|---------------|------|
| `get_firm_profile` | `GET profile/firm` → payload firm + stores |
| `search_orders` | `POST orders/search` body offset, limit, externalId, since, until, orderTypes |
| `get_order` | `GET orders/{id}` |
| `get_order_atol5` | `GET orders/{id}/atol-5` |

Ответы mobile часто: `{ errorCode: 0, payload: {...} }` или `{ query, result }`.  
Клиент нормализует оба варианта.

---

## 4. Критичные бизнес-правила

### Платежи Atol v5 (`payments[].type`)

| type | Смысл |
|------|--------|
| 0 | наличные |
| 1 | безналичные |
| 2 | предварительная оплата (зачёт аванса) |
| 3 | постоплата (кредит) |
| 4 | встречное предоставление |
| ≥100 | не фискальный тип, а **invoice** (ссылка на оплату провайдера) |

UI раньше слал 1/2/14 — это **ошибка** относительно Atol; при правках сверять с документацией Atol Online v5 и поведением sandbox.

### Магазин

1. После login вызывается `get_firm_profile`.
2. `storeId` → `group_code` в session.
3. Браузер: `localStorage.eklk_group` — **не удалять при logout**.
4. При login фронт предпочитает `eklk_group` серверному `selected_store_id` (первый магазин).

### Чек

- Нужен email **или** phone покупателя.
- `payment_method` позиции: full_payment, full_prepayment, prepayment, advance, …
- Агенты: supplier_info обязателен для агентских схем; тег 1223 только для платёжных/банковских агентов (см. комментарии в `app.js` / `ecomkassa.py`).

### Список чеков

- `bindOrdersUI()` **обязан** вызываться при старте `app.js` (иначе кнопки «Найти» молчат).
- Default: limit 30, без фильтров.
- Статусы мапить через `STATUS_LABELS` в `app.js`.

### Возврат

Вкладки «Возврат» **нет**. Возврат = operation `sell_refund` в «Создать чек».  
`POST /ecom/refunds` остаётся для API.

---

## 5. UI / static

- Логотип: `app/static/img/logo.png` (header + login). Без бейджа «ЛК».
- Bitrix24 виджет (чат):  
  `https://cdn-ru.bitrix24.ru/b24444000/crm/site_button/loader_4_q8v7f4.js`  
  Подключать в конце `body`, высокий z-index (см. `app.css`).
- Footer: ИП Носов А.С., support@ecomkassa.ru, ссылки на оферты/docs.
- Cache-bust: query `?v=YYYYMMDD` на css/js/logo в `index.html`.

Вкладки `data-tab`: `create` | `payment` | `status` | `orders` | `settings`.

---

## 6. Типичные задачи «продолжить работу»

1. **Исправить маппинг payments.type / payment_method** — `ecomkassa.py` `create_sell` + селекты в `app.js`.
2. **Новый Mobile API метод** — добавить в `EcomKassaClient`, роут в `orders.py` или `ecom.py`, схему, UI.
3. **Persistent sessions** — заменить dict в `deps.py` на Redis/SQLite.
4. **Не трогать** без нужды: формат Token header, путь getToken, storeId как group_code.

---

## 7. Запуск (Debian / XFCE)

```bash
cd ~/EKLK && git pull origin dev
cd eklk
chmod +x start-eklk.sh   # если git не выставил +x
source .venv/bin/activate
./start-eklk.sh
```

Тесты API вручную: Swagger `/docs` или curl с Bearer после login.

---

## 8. Git

- Разработка → `dev`
- Релизы / стабильное → `main` (merge из dev)
- Не коммитить `.venv/`, `.env` с секретами, `__pycache__`

---

## 9. Известные ограничения

- In-memory sessions: multi-worker / restart ломает сессии.
- Нет полноценной БД заказов — только прокси к EcomKassa.
- Маркировка (chestny znak) — не реализована.
- Корректность всех комбинаций ФФД 1.2 agent tags нужно валидировать на sandbox кассе.

---

## 10. Контакты продукта (в UI)

- ИП Носов А.С., ИНН 643890985437  
- support@ecomkassa.ru, Пн–Пт 9:00–18:00 Мск  
- https://ecomkassa.ru/helpcenter , https://ecomkassa.ru/docs  
