# EKLK — прогресс масштабирования backend

**Ветка:** `exp`  
**План:** [`BACKEND_SCALE_PLAN.txt`](BACKEND_SCALE_PLAN.txt)  
**Деплой:** [`DEPLOY.md`](DEPLOY.md)  
**Обновлено:** 2026-08-31  

Цель: 2 worker production + shared sessions + устойчивость к нагрузке ~500–1000 одновременных пользователей (профиль ~50/50 read/write).  
PostgreSQL **не** внедрять. Frontend `app.js` **не** переписывать.

---

## Статус этапов

| Этап | Название | Статус | Коммит(ы) | Примечание |
|------|----------|--------|-----------|------------|
| **A** | Production config, 2 workers | ✅ **DONE** | `6a79bda` | `start-eklk.sh` → `--workers 2`, без `--reload` |
| **B** | Shared httpx.AsyncClient | ✅ **DONE** | `6a79bda` | Один client на worker через lifespan |
| **C** | Redis session store | ✅ **DONE** | `7c39b46` | `SESSION_BACKEND=redis`, dual memory\|redis |
| **D** | Убрать plaintext password из session | ✅ **DONE** | `d2a8684` | Fernet от SECRET_KEY; password+ecom_token at rest |
| **E** | SQLite WAL / busy_timeout | ✅ **DONE** | `b8e3b87` | WAL, busy_timeout=30s, NullPool |
| **F** | Rate limit + upstream Semaphore | ✅ **DONE** | `8ba45cd` | login 10/min IP; write 60/min user; sem 80/worker |
| **G** | Logging / metrics / health ready | ✅ **DONE** | (this commit) | run.log, /health/ready, /metrics |
| **H** | Load + regression tests | ⬜ **NEXT** | — | Mock EcomKassa; RSS двух worker |

Документация деплоя: `86b0025` (`docs/DEPLOY.md`).

---

## Зафиксированные решения (не пересматривать без причины)

1. **Workers:** ровно **2** (не 3–4 без измерений).
2. **Redis:** на VPS, `127.0.0.1:6379`, не Docker.
3. **Fallback:** при падении Redis → memory + ERROR в лог (app стартует).
4. **Password в session (этап D):** вариант **A** — хранить **зашифрованным**, не plaintext; семантика getToken/401 refresh сохраняется.
5. **ecom_token:** хранить в session (Redis), оба worker видят один token.
6. **Нагрузка:** ориентир 500–1000 одновременных пользователей, ~50% read / 50% write.
7. **start-eklk.sh:** сразу production-режим (2 workers).

---

## Проверено на VPS (`vm-instance-eklk-test`)

Путь: `/var/www/WEBROOT/EKLK`

- [x] `git pull origin exp`, `pip install redis`
- [x] `.env`: `SESSION_BACKEND=redis`, `REDIS_URL=redis://127.0.0.1:6379/0`
- [x] `redis-cli ping` → PONG; слушает `127.0.0.1:6379`
- [x] 2 worker (pstree: master + 2× python3)
- [x] Лог: `Shared HTTP client ready` ×2, `Session store: redis ...` ×2
- [x] `GET /health` → `{"status":"ok",...}`
- [x] Login → ключ `eklk:session:sergey@ecomkassa.ru`
- [x] `GET /me` ×5 → стабильный `selected_store_id=1172` (раньше прыгал 1172↔990)

**Риск дублей чеков/платежей из‑за 2 workers:** нет (один HTTP-запрос → один worker → один upstream).

**После D:** password и ecom_token в Redis только как `eklk1:` + Fernet ciphertext.
Смена `SECRET_KEY` инвалидирует сессии (нужен re-login).

---

## С чего начать новую сессию агента

1. Ветка **`exp`**, прочитать этот файл и `BACKEND_SCALE_PLAN.txt`.
2. Следующая работа: **этап H** (load + regression tests).
3. Не менять API-контракты, ФФД, бизнес-логику чеков.
4. После F: commit + push `exp`, проверка 429 на burst login.
5. Дальше G → H по плану.

### Ключевые файлы этапа D

- `eklk/app/services/session_store.py` — encrypt/decrypt password field
- `eklk/app/core/deps.py` — get_current_user отдаёт расшифрованный password в runtime
- `eklk/app/core/config.py` / `.env` — при необходимости отдельный `SESSION_FERNET_KEY` или derive from `SECRET_KEY`
- Не логировать password/token

### Ключевые файлы уже сделанного

- A/B: `start-eklk.sh`, `app/main.py` lifespan, `app/clients/ecomkassa.py`, `app/core/config.py`
- C: `app/services/session_store.py`, `app/core/deps.py`, `requirements.txt` (`redis`)
- D: `app/services/session_crypto.py`, sealed password/ecom_token in store
- E: `app/db.py` — WAL, busy_timeout, NullPool
- F: `app/core/rate_limit.py`, `upstream_limit.py`; auth/ecom limits
- G: `run.log`, `app/core/metrics.py`, `/health/live|ready`, `/metrics`
- Deploy: `docs/DEPLOY.md`

---

## Команды обновления на VPS (кратко)

```bash
cd /var/www/WEBROOT/EKLK
git pull origin exp
cd eklk && source .venv/bin/activate
pip install -r requirements.txt
# сверить .env с .env.example при новых ключах
pkill -f "uvicorn app.main" || true
sleep 1
./start-eklk.sh > /tmp/eklk.log 2>&1 &
sleep 4
grep -E "Session store|Shared HTTP|ERROR" /tmp/eklk.log
curl -sS http://127.0.0.1:8000/health; echo
```

Полная инструкция: [`DEPLOY.md`](DEPLOY.md).
