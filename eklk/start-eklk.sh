#!/usr/bin/env bash
# Запуск EKLK (личный кабинет EcomKassa)
set -e
cd "$(dirname "$(readlink -f "$0")")"

if [ ! -d .venv ]; then
  echo "Создаю виртуальное окружение .venv ..."
  python3 -m venv .venv
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install -r requirements.txt
else
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

echo "=============================================="
echo "  EKLK — http://127.0.0.1:8000"
echo "  Остановка: Ctrl+C"
echo "=============================================="

# Открыть браузер через пару секунд после старта (если есть)
( sleep 2; xdg-open "http://127.0.0.1:8000" >/dev/null 2>&1 || true ) &

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
