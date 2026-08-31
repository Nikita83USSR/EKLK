# EKLK — деплой на VPS (production)

Целевая ветка: **`exp`**  
Стек: FastAPI + 2 worker uvicorn + Redis (сессии) + SQLite (настройки)  
Путь на тестовом сервере (пример): `/var/www/WEBROOT/EKLK`

Документ описывает **первичный** деплой и **обновление** уже установленного инстанса.

---

## 0. Требования к серверу

- Debian 12 / Ubuntu 22.04+ (или аналог)
- Python **3.11+** (`python3`, `python3-venv`, `python3-pip`)
- Git
- Redis (для multi-worker сессий)
- Открытый порт приложения (по умолчанию **8000**; снаружи обычно через nginx)

Проверка:

```bash
python3 --version
git --version
```

---

## 1. Первичный деплой

### 1.1. Клонирование репозитория

```bash
sudo mkdir -p /var/www/WEBROOT
cd /var/www/WEBROOT

# HTTPS (подставьте токен/доступ при необходимости) или SSH:
git clone -b exp https://github.com/Nikita83USSR/EKLK.git EKLK
cd EKLK
git checkout exp
git pull origin exp
```

Рабочий каталог приложения: **`/var/www/WEBROOT/EKLK/eklk`**.

### 1.2. Системные пакеты

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git redis-server

sudo systemctl enable redis-server
sudo systemctl start redis-server
redis-cli ping   # → PONG
ss -tlnp | grep 6379   # → 127.0.0.1:6379
```

Redis должен слушать **только localhost** (`127.0.0.1`). Не открывайте 6379 наружу без пароля и firewall.

### 1.3. Виртуальное окружение и зависимости

```bash
cd /var/www/WEBROOT/EKLK/eklk
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 1.4. Файл `.env`

```bash
cd /var/www/WEBROOT/EKLK/eklk
cp -n .env.example .env
nano .env   # или vi
```

Минимально обязательные параметры production:

```env
DEBUG=false
LOG_LEVEL=INFO
SECRET_KEY=<длинная_случайная_строка_не_меньше_32_символов>
ACCESS_TOKEN_EXPIRE_MINUTES=480

SESSION_BACKEND=redis
REDIS_URL=redis://127.0.0.1:6379/0

DATABASE_URL=sqlite+aiosqlite:///./eklk.db

# EcomKassa — URL шлюза (логин пользователя = учётка EcomKassa при входе в ЛК)
ECOMKASSA_BASE_URL=https://app.ecomkassa.ru
ECOMKASSA_API_VERSION=v5
```

Сгенерировать `SECRET_KEY`:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Вставьте результат в `.env` как `SECRET_KEY=...`.

Опционально (каталог, ИИ-кассир) — см. `.env.example`.

Права:

```bash
chmod 600 .env
```

### 1.5. Первый запуск

```bash
cd /var/www/WEBROOT/EKLK/eklk
chmod +x start-eklk.sh
./start-eklk.sh
```

Скрипт поднимает:

```text
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
```

без `--reload`.

Фоновый запуск с логом:

```bash
cd /var/www/WEBROOT/EKLK/eklk
pkill -f "uvicorn app.main" 2>/dev/null || true
sleep 1
./start-eklk.sh > /tmp/eklk.log 2>&1 &
sleep 4
grep -E "Session store|Shared HTTP|Application started|ERROR|Traceback" /tmp/eklk.log
```

В логе должно быть:

- `Session store: redis (redis://127.0.0.1:6379/0), ttl=...`
- `Shared HTTP client ready ...`
- `Application started` (по разу на worker)

### 1.6. Проверка здоровья

```bash
curl -sS http://127.0.0.1:8000/health
# {"status":"ok","service":"EKLK","version":"..."}

pgrep -af "uvicorn app.main"
# master + 2 worker
```

Логин (smoke):

```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"USER@example.com","password":"SECRET"}'
```

Сессия в Redis:

```bash
redis-cli keys 'eklk:session:*'
```

---

## 2. Обновление уже установленного инстанса

```bash
cd /var/www/WEBROOT/EKLK
git fetch origin
git checkout exp
git pull origin exp

cd eklk
source .venv/bin/activate
pip install -r requirements.txt

# сверить .env с новыми ключами из .env.example (не перезаписывать .env целиком)
diff -u <(grep -E '^[A-Z]' .env.example | sort) <(grep -E '^[A-Z]' .env | sort) || true

# перезапуск
pkill -f "uvicorn app.main" || true
sleep 1
./start-eklk.sh > /tmp/eklk.log 2>&1 &
sleep 4
curl -sS http://127.0.0.1:8000/health; echo
grep -E "Session store|Shared HTTP|ERROR|Traceback" /tmp/eklk.log
```

**Важно:** `.env` и `eklk.db` в git не коммитятся — после `pull` они остаются на сервере.

---

## 3. Переменные окружения (справочник)

| Переменная | Production | Описание |
|------------|------------|----------|
| `DEBUG` | `false` | Режим отладки |
| `LOG_LEVEL` | `INFO` | Уровень логов |
| `SECRET_KEY` | **свой** | Подпись JWT; не дефолт из example |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | Срок JWT (мин) |
| `SESSION_BACKEND` | `redis` | `memory` только для 1 process / dev |
| `REDIS_URL` | `redis://127.0.0.1:6379/0` | Redis для сессий |
| `DATABASE_URL` | `sqlite+aiosqlite:///./eklk.db` | Настройки (тема, org) |
| `HTTP_MAX_CONNECTIONS` | `100` | Лимит пула httpx (на worker) |
| `HTTP_MAX_KEEPALIVE_CONNECTIONS` | `20` | Keepalive |
| `HTTP_TIMEOUT_SECONDS` | `30` | Таймаут upstream |
| `ECOMKASSA_BASE_URL` | `https://app.ecomkassa.ru` | Шлюз EcomKassa |
| `CATALOG_*` | по необходимости | Basic для catalog.ecomkassa.ru |
| `IIKASSA_*` | по необходимости | Embed ИИ-кассира |

При `SESSION_BACKEND=redis` и недоступном Redis приложение **стартует с fallback на memory** и пишет ERROR в лог. При 2 workers сессии снова разъедутся — Redis обязателен для production.

Поля `password` и `ecom_token` в Redis хранятся **зашифрованными** (Fernet от `SECRET_KEY`). Смена `SECRET_KEY` требует повторного входа всех пользователей.

---

## 4. Процессы и порты

| Что | Где |
|-----|-----|
| EKLK HTTP | `0.0.0.0:8000` (uvicorn, 2 worker) |
| Redis | `127.0.0.1:6379` |
| SQLite | `eklk/eklk.db` (рядом с приложением) |

Остановка:

```bash
pkill -f "uvicorn app.main"
```

Проверка worker’ов:

```bash
pgrep -af "uvicorn app.main"
# или
MASTER=$(pgrep -f "uvicorn app.main:app" | head -1)
pstree -p "$MASTER"
```

---

## 5. Nginx (рекомендуется)

Пример upstream на локальный uvicorn:

```nginx
server {
    listen 80;
    server_name eklk.example.com;

    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

HTTPS — через certbot / ваш обычный процесс.

Не проксируйте Redis наружу.

---

## 6. systemd (опционально)

Файл `/etc/systemd/system/eklk.service`:

```ini
[Unit]
Description=EKLK personal cabinet
After=network.target redis-server.service
Requires=redis-server.service

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/WEBROOT/EKLK/eklk
Environment=PATH=/var/www/WEBROOT/EKLK/eklk/.venv/bin
ExecStart=/var/www/WEBROOT/EKLK/eklk/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable eklk
sudo systemctl start eklk
sudo systemctl status eklk --no-pager
journalctl -u eklk -n 50 --no-pager
```

При использовании systemd **не** держите параллельно `./start-eklk.sh`.

---

## 7. Типовые проблемы

| Симптом | Что проверить |
|---------|----------------|
| `Unit redis-server.service could not be found` | `apt install redis-server` |
| `Session store: memory` при желаемом redis | `.env`: `SESSION_BACKEND=redis`, `REDIS_URL`, `redis-cli ping` |
| `Сессия истекла` / разный `selected_store_id` на F5 | Redis выключен или backend=memory при `--workers 2` |
| Порт 8000 занят | `ss -tlnp \| grep 8000`, `pkill -f uvicorn` |
| Import / ModuleNotFoundError | `source .venv/bin/activate && pip install -r requirements.txt` |
| Старый код после pull | Убедиться `git branch` = `exp`, `git log -1`, перезапуск uvicorn |

---

## 8. Что не коммитить и не светить

- `.env`, пароли, `SECRET_KEY`, токены GitHub
- Дампы Redis с сессиями (на этапе C password ещё может быть в session JSON)
- `eklk.db` с данными организаций

---

## 9. Связанные документы

- Пользовательский README: [`../README.md`](../README.md)
- План масштабирования backend: [`BACKEND_SCALE_PLAN.txt`](BACKEND_SCALE_PLAN.txt)
- Контекст для ИИ: [`../AGENTS.md`](../AGENTS.md)

---

*Обновляйте этот файл при смене способа запуска, новых обязательных env или смене числа workers.*
