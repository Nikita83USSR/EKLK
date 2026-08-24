# EKLK — Личный кабинет EcomKassa

Веб-ЛК и API-обёртка над **EcomKassa / Atol Online protocol v5** (ФФД 1.1 / 1.2).

Свои пользователи **не хранятся**: вход = логин/пароль EcomKassa (`getToken`).  
После входа подтягивается профиль фирмы и магазины; `storeId` = `group_code` кассы.

---

## Возможности ЛК

| Раздел | Что делает |
|--------|------------|
| **Создать чек** | Фискальный чек (sell / sell_refund / buy / buy_refund), агенты, доп. реквизиты |
| **Ссылка на оплату** | Invoice через платёжки (Сбер, Тинькофф и т.д.) |
| **Статус** | Отчёт по UUID чека/счёта |
| **Список чеков** | Поиск последних транзакций (Mobile API), просмотр состава в формате Atol 5 |
| **Настройки** | Организация + магазины; выбор магазина запоминается |

Возврат — через «Признак расчёта» = `sell_refund` в форме чека (отдельной вкладки «Возврат» нет).

---

## Быстрый старт

```bash
cd eklk
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # при необходимости
./start-eklk.sh                    # или: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Открыть: **http://127.0.0.1:8000**  
Swagger: **http://127.0.0.1:8000/docs**

### XFCE-ярлык

```bash
cd ~/EKLK/eklk
chmod +x start-eklk.sh EKLK-install-shortcut.sh
./EKLK-install-shortcut.sh
```

### Вход

Логин/пароль — учётка EcomKassa (как в https://app.ecomkassa.ru).

Тестовые (sandbox):

- login: `sales@ecomkassa.ru`
- password: `ecomkassa1`

---

## Архитектура

```
eklk/
├── app/
│   ├── main.py                 # FastAPI app, static, templates
│   ├── clients/ecomkassa.py    # HTTP-клиент к EcomKassa (fiscal + mobile)
│   ├── routers/
│   │   ├── auth.py             # login, me, firm, select-store
│   │   ├── ecom.py             # checks, payment-types, refunds, report
│   │   └── orders.py           # search + detail чеков
│   ├── schemas/                # Pydantic: auth, checks, orders
│   ├── core/                   # config, JWT, sessions (in-memory)
│   ├── templates/index.html    # SPA-подобная вёрстка ЛК
│   └── static/js/app.js        # ЯДРО фронта (монолит, стабильное; новые разделы — отдельные scripts)
├── start-eklk.sh
├── EKLK.desktop / EKLK-install-shortcut.sh
├── .env.example
└── requirements.txt
```

**Сессии:** in-memory `SESSIONS` (логин → password, group_code, firm). JWT (`SECRET_KEY`) не переживает рестарт сервера без повторного login.

**localStorage (браузер):**

| Ключ | Назначение |
|------|------------|
| `eklk_token` | JWT (очищается при «Выйти») |
| `eklk_group` | Последний `storeId` / group_code (**сохраняется** после выхода) |

---

## Backend API (наш `/api/v1`)

Все пути кроме login требуют `Authorization: Bearer <jwt>`.

### Auth

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/v1/auth/login` | Логин EcomKassa → JWT + firm + selected_store_id |
| POST | `/api/v1/auth/login/form` | OAuth2 form (Swagger) |
| GET | `/api/v1/auth/me` | Текущий пользователь + firm |
| GET | `/api/v1/auth/firm` | Обновить профиль фирмы с API |
| POST | `/api/v1/auth/select-store` | `{ "store_id": 97 }` → session group_code |

**Login body:** `{ "username": "email", "password": "..." }`  
**Login response:** `{ access_token, token_type, expires_in, firm, selected_store_id }`

### Ecom (чеки / платежи)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/v1/ecom/payment-types` | Список типов оплаты (v4 paymentTypes) |
| POST | `/api/v1/ecom/checks` | Создать чек **или** ссылку на оплату |
| GET | `/api/v1/ecom/checks/{uuid}` | Статус / report |
| POST | `/api/v1/ecom/refunds` | sell_refund (API; в UI — через operation) |

**CreateCheckRequest (сжато):**

- `operation`: `sell` \| `sell_refund` \| `buy` \| `buy_refund`
- `sno`: `osn` \| `usn_income` \| `usn_income_outcome` \| `esn` \| `patent`
- `client`: email и/или phone (нужен хотя бы один)
- `items[]`: name, price, quantity, vat_type, payment_object, payment_method, agent?
- `payments[]`: type + sum  
  - Фискальные: **0** нал, **1** безнал, **2** предоплата, **3** кредит, **4** встречное (Atol v5)  
  - Invoice (ссылка): type ≥ 100 (напр. 103 = Сбер)
- `group_code` (optional) — иначе из сессии
- `success_url` — для invoice

### Orders (список чеков)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/v1/orders/search` | Поиск (default limit=30) |
| GET | `/api/v1/orders/search` | То же query-параметрами |
| GET | `/api/v1/orders/{order_id}` | Деталь + atol5 receipt |

**Search body:**

```json
{
  "offset": 0,
  "limit": 30,
  "external_id": "optional",
  "since": "2026-01-01T00:00:00Z",
  "until": "2026-12-31T23:59:59Z",
  "order_types": ["VCHR"]
}
```

Типы: `VCHR` (чек), `INVC` (счёт), `CORD` (курьер).

### Служебные

| Метод | Путь |
|-------|------|
| GET | `/` | HTML ЛК |
| GET | `/health` | `{ status: ok }` |
| GET | `/docs` | OpenAPI |

---

## Внешние методы EcomKassa (которые вызываем)

Base URL по умолчанию: `https://app.ecomkassa.ru`  
(это **фискальный API**, не «другой ЛК»).

### Fiscalorder (Atol Online protocol)

| Метод | URL | Заголовки / тело |
|-------|-----|------------------|
| POST | `/fiscalorder/v5/getToken` | `{ "login", "pass" }` → `token` |
| POST | `/fiscalorder/v5/{group}/sell` | `Token` header; чек |
| POST | `/fiscalorder/v5/{group}/sell_refund` | возврат |
| GET | `/fiscalorder/v5/{group}/report/{uuid}` | статус |
| GET | `/fiscalorder/v4/{group}/paymentTypes` | типы оплат |

`group` = `storeId` из профиля фирмы (или fallback `ECOMKASSA_GROUP_CODE`).

### Mobile API

Заголовок: `Token: <token из getToken>`.

| Метод | URL | Назначение |
|-------|-----|------------|
| GET | `/api/mobile/v1/profile/firm` | firmId, firmName, taxIdentity, taxVariant, stores[] |
| POST | `/api/mobile/v1/orders/search` | offset, limit, externalId, since, until, orderTypes |
| GET | `/api/mobile/v1/orders/{orderId}` | карточка заказа |
| GET | `/api/mobile/v1/orders/{orderId}/atol-5` | чек в формате Atol Online 5 |

**Ответ profile/firm (payload):**

```json
{
  "firmId": "uuid",
  "firmName": "...",
  "taxIdentity": "ИНН",
  "taxVariant": "usn_income_outcome",
  "stores": [
    { "storeId": 97, "storeName": "...", "storeAddress": "..." }
  ]
}
```

---

## Фронтенд

- Один `index.html` + **ядро** `app/static/js/app.js` (vanilla JS, без фреймворка, ~3500 строк).
- `app.js` — **стабильное ядро**. Не рефакторить и не раздувать без крайней нужды.
- Новые разделы UI — **отдельными скриптами** (`app/static/js/sections/<name>.js`), подключать после ядра.
- Вкладки / URL: create, payment, orders, settings (клиентский роутинг).
- Виджет Bitrix24: loader  
  `https://cdn-ru.bitrix24.ru/b24444000/crm/site_button/loader_4_q8v7f4.js`  
  (как на app.ecomkassa.ru).
- Статусы чеков в UI переведены (wait→Ожидание, done→Готов, fail→Ошибка…).

После правок static — менять `?v=` у css/js в `index.html` (cache-bust).

Подробные правила для ИИ и модульного расширения: см. `AGENTS.md` §5.1 «Политика фронтенд-ядра».

---

## Конфиг (`.env`)

См. `.env.example`. Важное:

| Переменная | Смысл |
|------------|--------|
| `ECOMKASSA_BASE_URL` | API шлюз (`https://app.ecomkassa.ru`) |
| `ECOMKASSA_GROUP_CODE` | Fallback group, если профиль без stores |
| `SECRET_KEY` | JWT |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Время жизни JWT |

Логин/пароль из `.env` — только fallback для фоновых задач; пользователь вводит свои в UI.

---

## Production

```bash
DEBUG=false
SECRET_KEY=<длинный случайный>
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Для нескольких воркеров нужна общая session-store (сейчас память процесса).
