# AGENTS.md — контекст для ИИ / продолжения разработки EKLK

Документ для ассистентов (Grok, Cursor, Claude, Codex и т.д.).  
Цель: продолжить работу **без устных подсказок пользователя**, опираясь только на репозиторий.

Ветки: **`exp`** / **`expbd`** (эксперименты), **`dev`** (разработка), **`main`** (стабильная).

Актуальный полный контекст: **`eklk/AGENTS.md`** (этот файл в корне может отставать).

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
| `app/static/js/app.js` | **ЯДРО (CORE)** — монолитный vanilla JS (~3500 строк, IIFE). Стабильное. Не трогать без нужды. |
| `app/static/css/app.css` | стили |
| `app/routers/catalog.py` | Каталог товаров (прокси + CommerceML) |
| `app/routers/reports.py` | Отчёты mobile API + агрегация для бухгалтера |
| `app/static/js/sections/catalog.js` | UI Каталог (модуль) |
| `app/static/js/sections/reports.js` | UI Отчёты (модуль) |

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

Вкладки: home (Главная), create, payment, templates, orders, catalog, reports, ai-cashier; settings — ⚙ у «Выйти». Подробности: `eklk/AGENTS.md` §5.


---

## 5.1. Политика фронтенд-ядра (для ИИ и разработчиков)

`app/static/js/app.js` — **ядро приложения**. Большой монолитный файл (~3493 строки / ~142 KB).  
Содержит: auth, сессии, темы, роутинг вкладок, формы чека/оплаты, список заказов, настройки, клон чека и т.д.  
Считается **относительно стабильным**.

### Жёсткие правила

1. **Не рефакторить и не переписывать ядро** без крайней необходимости (критичный баг в auth / create check / orders).  
   Риск сломать рабочее поведение высок. Минимум диффов в `app.js`.

2. **Новые разделы / фичи UI** — **только отдельными скриптами**:
   - путь: `app/static/js/sections/<name>.js` (предпочтительно) или `app/static/js/<feature>.js`
   - подключать в `index.html` **после** `app.js` (с cache-bust `?v=`)
   - HTML секции — в `index.html` (или динамически из модуля)
   - не дублировать логику token / firm / groupCode / api-вызовов

3. Связь с ядром:
   - по возможности через уже существующие глобалы / DOM / события;
   - при необходимости — **минимально** расширить ядро: вынести тонкий публичный API
     (`window.EKLK = { token, api, showTab, ... }`), а не переносить логику в новый файл;
   - не ломать IIFE-область видимости без явного экспорта.

4. При генерации нового раздела ассистентом:
   - сначала описать контракт (какие данные из ядра нужны);
   - написать отдельный скрипт;
   - подключить в HTML;
   - в `app.js` трогать только если без этого невозможно (и тогда — точечно, с комментарием `// CORE: ...`).

5. Прочие доработки (бэкенд, стили, мелочи) — отдельно от ядра; связывать только при необходимости.

Цель: сохранить стабильность текущего ЛК и наращивать функциональность модульно.

---

## 6. Типичные задачи «продолжить работу»

1. **Исправить маппинг payments.type / payment_method** — `ecomkassa.py` `create_sell` + селекты в `app.js`.
2. **Новый Mobile API метод** — добавить в `EcomKassaClient`, роут в `orders.py` или `ecom.py`, схему, UI.
3. **Persistent sessions** — заменить dict в `deps.py` на Redis/SQLite.
4. **Не трогать** без нужды: формат Token header, путь getToken, storeId как group_code.
5. **Новый раздел UI** — отдельный `app/static/js/sections/*.js`, ядро `app.js` не раздувать.
6. Правки в `app.js` — только критичные багфиксы; помечать комментарием `// CORE`.

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

- Эксперименты / текущая работа → `exp`
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


---

## 11. Клон чека («Редактировать»)

- В списке чеков и в деталке: кнопка **Редактировать**.
- **Не** меняет исходный документ. Заполняет форму «Создать чек» из Atol-5.
- `sourceDocumentId` / `sourceExternalId` в `app.js`; при submit — **новый** `external_id` (`EKLK-FROM-{orderId}-…`).
- Confirm: «Будет создан новый документ…».
- Валидация `payment_method` × `payment_object` через `OBJECT_BY_METHOD` (блок 1105 до API).
- Fiscal `payments.type`: 0–4 (Atol v5).


---

## 12. Каталог и Отчёты (модули, не ядро)

Реализованы **отдельными скриптами**. Ядро `app.js` — только регистрация вкладок `APP_TABS`, публичный `window.EKLK` (`api`, `showAlert`) и хуки `onShow`.  
**Не вносить CRUD/графики/импорт в `app.js`.**

| Слой | Каталог | Отчёты |
|------|---------|--------|
| UI | `app/static/js/sections/catalog.js` → `window.EKLK_CATALOG` | `app/static/js/sections/reports.js` → `window.EKLK_REPORTS` |
| Backend | `app/routers/catalog.py` | `app/routers/reports.py` |
| Client | `EcomKassaClient.list_catalog_items` / `catalog_*` | `EcomKassaClient.report_*` |
| Schemas | `app/schemas/catalog.py` | `app/schemas/reports.py` |
| Разметка | вкладка + секция в `app/templates/index.html` | то же + canvas графиков |
| Libs | — | Chart.js, SheetJS (CDN в `index.html`) |

---

### 12.1 Каталог

**Назначение:** просмотр и управление номенклатурой организации (по ИНН). Данные **не храним** у себя — только API EcomKassa.

#### Внешние API
| Операция | Endpoint | Auth | Примечание |
|----------|----------|------|------------|
| Список / поиск | `GET https://app.ecomkassa.ru/api/mobile/v1/catalog/items` | `Token` (как ядро) | **Рабочий** путь чтения |
| CRUD | `https://catalog.ecomkassa.ru/api/v1/items/{taxId}` | **пока без auth** (как в успешном серверном логе) | С внешней среды часто **401 Basic**; разбор auth — отдельно |
| Создание body | `POST .../items/{taxId}` | | См. формат ниже |

**Формат тела создания (из рабочего лога EcomKassa):**
```json
{
  "itemId": -1,
  "name": "...",
  "sku": "...",
  "price": 1.0,
  "vatType": "vat20",
  "paymentObject": "commodity",
  "taxIdentity": "7724923302"
}
```
- `itemId: -1` — создать новый (ID выдаёт EcomKassa).
- `vatType` / `paymentObject` — **lowercase** (`none`, `vat20`, `commodity`, …), не `VAT_NONE` / `COMMODITY`.
- `taxIdentity` — ИНН в теле; в path — тот же `taxId`.
- Обновление: тот же shape, но `itemId` = реальный id; `PUT .../items/{taxId}/{itemId}`.
- Удаление: `DELETE .../items/{taxId}/{itemId}`.

Сборка body: `EcomKassaClient._catalog_body()` / `catalog_create_item` / `catalog_update_item`.

#### Правила SKU
1. Пользователь **не ввёл** артикул → генерируем (`EKLK-XXXXXXXX`).
2. Импорт **без** артикула → генерируем (`IMP-XXXXXXXX`).
3. Артикул **уже есть** в каталоге (pre-check по mobile list) или API ответил «SKU уже существует» → **ошибка**, не молчаливый skip.
4. Дубль SKU **внутри файла** импорта → строка в `errors`.

#### UI (catalog.js)
- Список, поиск (name/sku), пагинация.
- Создание / редактирование / удаление.
- Массовое удаление (checkbox).
- «Удалить все» — подтверждение вводом слова **`удалить`**.
- Импорт CommerceML 2 (XML): неподдерживаемые поля игнорируются; модификации → клоны товара с суффиксом в name/sku.
- Отчёт импорта: `total`, `created`, `updated`, `skipped`, `errors_count`, `generated_sku`, список `errors`.

#### Backend routes (`/api/v1/catalog/...`)
- `GET /items`, `POST /items`, `PUT /items/{id}`, `DELETE /items/{id}`
- `POST /items/bulk-delete`, `DELETE /items/all?confirm=удалить`
- `POST /import/commerceml` (multipart file)

#### Ограничения / TODO
- Запись на `catalog.ecomkassa.ru` снаружи часто **401** (`WWW-Authenticate: Basic`). Auth каталога — отдельная задача; формат body и `itemId=-1` уже совпадают с рабочим логом.
- Чтение списка через **mobile** стабильно.

---

### 12.2 Отчёты

**Назначение:** сводки для бухгалтера за период; сверка баланса кассы с учётом типов оплаты и знака операции.

#### Внешние API
```
GET /api/mobile/v1/reports/daily/{date}
GET /api/mobile/v1/reports/weekly/{date}
GET /api/mobile/v1/reports/monthly/{year}/{month}
GET /api/mobile/v1/reports/quarterly/{year}/{quarter}
GET /api/mobile/v1/reports/annual/{year}
```
Опционально: `?orderTypes=VCHR,INVC,CORD`.  
Auth: **`Token`** (как ядро). Ответ: `points[]` с полями `time`, `cashier`, `storeId`, `storeName`, `paymentType`, `amount`.

**Знак `amount` уже в API:**
- `+` — приход / возврат расхода  
- `−` — возврат прихода / расход  

Тип операции (sell / sell_refund) в points **не приходит** — направление выводим по знаку.

#### Агрегация (`app/routers/reports.py` → `_aggregate`)
- API отдаёт `amount` в **копейках** → в отчёте делим на **100** (рубли).
- **Баланс кассы за период** = сумма всех `amount` из ответа (как есть), без отдельной логики возвратов/ящика.
- Справочно: разбивка по типам оплаты / точкам / кассирам (уже в рублях).

#### UI (reports.js)
- Фильтры: тип периода, дата / год / месяц / квартал, orderTypes.
- Сводка + таблица «направление × тип оплаты».
- Детализация points (колонка «Направление»).
- Графики Chart.js: типы оплаты; приход vs возврат; матрица; динамика по периодам; **балансы** (ящик / общий / зачёт).
- Выгрузка **XLS** (SheetJS): листы «Сводка» и «Детализация».
- История: до 30 отчётов в `SESSIONS[login].report_history` (память процесса, до рестарта).

#### Backend routes (`/api/v1/reports/...`)
- `GET /daily`, `/weekly`, `/monthly`, `/quarterly`, `/annual`
- `GET /history`, `DELETE /history`

#### Важно для доработок
- Не путать **ящик (только нал)** и **общий баланс (нал+безнал)**.
- Не класть `PRE_PAID` в `money_balance`.
- Не трогать `app.js` для графиков/XLS — только `sections/reports.js` + router/client.
