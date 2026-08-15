# EKLK — Электронные Чеки и Платежи

**Надёжная бизнес-система** для создания чеков и платежей с акцентом на безопасность авторизации и целостность финансовых операций.

> Главный фокус текущей версии: **авторизация**, **создание чеков**, **создание платежей**.  
> Эти три блока реализованы качественно и готовы к использованию. Остальной функционал будет дорабатываться позже.

---

## Возможности MVP

### Авторизация
- Регистрация пользователей (роли: `admin`, `cashier`, `manager`)
- Вход по username / email + пароль
- JWT Bearer-токены
- Защита всех бизнес-эндпоинтов
- Просмотр профиля `/api/v1/auth/me`

### Чеки (Чеки)
- Создание чека с позициями (товары/услуги)
- Автоматический расчёт сумм и НДС
- Типы: `sale`, `refund`, `expense`, `refund_expense`
- Статусы с бизнес-правилами переходов: `draft` → `created` → `paid` / `cancelled` → `refunded`
- Фискальные атрибуты (номер, fiscal_sign — заготовка под ОФД)
- Список и детальный просмотр

### Платежи
- Создание платежа с привязкой к чеку
- Методы: `cash`, `card`, `sbp`, `electronic`, `other`
- Статусы: `pending` → `processing` → `completed` / `failed` / `cancelled` / `refunded`
- При завершении платежа — автоматическое обновление статуса чека на `paid` (если сумма покрыта)
- Список и детальный просмотр

### Логирование
- Подробные цветные логи в консоль
- Структурированные записи всех критических действий (регистрация, логин, создание чека/платежа, смена статусов)
- Удобно для отладки

---

## Быстрый старт

### Требования
- Python 3.11+
- pip

### Установка

```bash
cd eklk
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Отредактируйте .env при необходимости (особенно SECRET_KEY)
```

### Запуск

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Откройте:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- Health: http://localhost:8000/health

База данных SQLite создаётся автоматически (`eklk.db`).

---

## Примеры использования (через Swagger или curl)

### 1. Регистрация

```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "cashier@eklk.local",
    "username": "cashier1",
    "password": "SecurePass123",
    "full_name": "Иван Кассир",
    "role": "cashier"
  }'
```

### 2. Логин

```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "cashier1",
    "password": "SecurePass123"
  }'
```

Скопируйте `access_token` и используйте в заголовке:

```
Authorization: Bearer <token>
```

### 3. Создание чека

```bash
curl -X POST http://localhost:8000/api/v1/checks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "check_type": "sale",
    "items": [
      {
        "name": "Товар А",
        "quantity": 2,
        "price": 1500.00,
        "vat_rate": 20.00,
        "unit": "шт"
      },
      {
        "name": "Услуга Б",
        "quantity": 1,
        "price": 500.00,
        "vat_rate": 20.00
      }
    ],
    "customer_name": "Покупатель",
    "comment": "Тестовый чек"
  }'
```

### 4. Создание платежа

```bash
curl -X POST http://localhost:8000/api/v1/payments \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "check_id": 1,
    "amount": 3500.00,
    "method": "card",
    "description": "Оплата картой"
  }'
```

### 5. Завершение платежа

```bash
curl -X POST http://localhost:8000/api/v1/payments/1/complete \
  -H "Authorization: Bearer <token>"
```

После этого статус чека автоматически станет `paid`.

---

## Структура проекта

```
eklk/
├── app/
│   ├── core/           # config, security, deps
│   ├── models/         # SQLAlchemy models (User, Check, Payment)
│   ├── schemas/        # Pydantic DTOs
│   ├── routers/        # API endpoints
│   ├── services/       # Business logic
│   ├── utils/          # logger
│   ├── database.py
│   └── main.py
├── requirements.txt
├── .env.example
└── README.md
```

---

## Безопасность и надёжность

- Пароли хешируются bcrypt
- JWT с ограниченным временем жизни
- Валидация всех входных данных (Pydantic)
- Транзакционность создания чеков и платежей
- Бизнес-правила переходов статусов
- Подробное логирование всех критических операций
- Foreign keys и каскады в БД

---

## Дальнейшее развитие (после MVP)

- Интеграция с ОФД / фискальным накопителем
- Реальные эквайринги и СБП
- Отчёты и аналитика
- Печать / отправка электронных чеков
- Мультитенантность (организации)
- Аудит-лог в БД
- Rate limiting, 2FA
- Frontend

---

**EKLK** — серьёзный бизнес-продукт.  
Сделано с упором на надёжность, прозрачность и удобство отладки.
