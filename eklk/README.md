# EKLK — Личный кабинет + API для EcomKassa

Бэкенд и веб-ЛК для работы с **EcomKassa API v5** (ФФД 1.1 / 1.2):

- Авторизация в ЛК
- Создание фискальных чеков (SALE)
- Создание ссылок на оплату (Сбер, Тинькофф, Точка и др.)
- Проверка статуса чека / счёта
- Возврат (sell_refund)
- Нормализация телефона, расчёт сумм, auto-refresh токена EcomKassa
- Логи в консоль для отладки

Маркировка — позже.

---

## Быстрый старт

```bash
cd eklk
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Открыть: **http://localhost:8000**

### Вход в ЛК
Логин и пароль — **учётная запись EcomKassa** (те же, что в app.ecomkassa.ru).

Тестовые:
- login: `sales@ecomkassa.ru`
- password: `ecomkassa1`
- group_code / ID магазина: `990`

Своих пользователей у ЛК нет — авторизация идёт через `getToken` EcomKassa.

---

## API

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/v1/auth/login` | Логин в ЛК |
| GET  | `/api/v1/auth/me` | Профиль |
| GET  | `/api/v1/ecom/payment-types` | Список платёжек |
| POST | `/api/v1/ecom/checks` | Создать чек или ссылку на оплату |
| GET  | `/api/v1/ecom/checks/{uuid}` | Статус |
| POST | `/api/v1/ecom/refunds` | Возврат |

Swagger: `/docs`

### Пример: ссылка на оплату Сбером

```bash
TOKEN=<jwt из /auth/login>

curl -X POST http://localhost:8000/api/v1/ecom/checks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{"name": "Товар", "price": 10, "quantity": 1, "vat_type": "vat20"}],
    "payments": [{"type": 103, "sum": 10}],
    "client": {"email": "buyer@example.com", "phone": "89001234567"},
    "success_url": "https://example.com/ok"
  }'
```

В ответе `invoice_payload.link` — URL страницы оплаты.

---

## Структура

```
eklk/
├── app/
│   ├── clients/ecomkassa.py   # клиент EcomKassa v5
│   ├── routers/               # auth, ecom
│   ├── schemas/
│   ├── templates/index.html   # веб-ЛК
│   ├── static/
│   └── main.py
├── requirements.txt
├── .env.example
└── README.md
```

---

## Деплой

Любой хост с Python 3.11+:

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Для production: `DEBUG=false`, сменить `SECRET_KEY`, вынести креды EcomKassa в секреты.
