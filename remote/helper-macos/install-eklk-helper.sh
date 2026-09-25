#!/usr/bin/env bash
# EKLK Helper (macOS) — ставит/настраивает RustDesk на ваш hbbs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
[ -f "$ROOT/eklk-remote.env" ] && set -a && source "$ROOT/eklk-remote.env" && set +a

RD_HOST="${EKLK_RD_HOST:-}"
RD_KEY="${EKLK_RD_KEY:-}"
if [[ -z "$RD_HOST" ]]; then
  echo "Заполните EKLK_RD_HOST в eklk-remote.env"
  exit 1
fi

DEST="$HOME/Applications/EKLK-Helper"
mkdir -p "$DEST"
CONF_DIR="$HOME/Library/Preferences/com.carriez.rustdesk"
# Actual path varies; also write generic toml used by RustDesk on mac
RD_CONF="$HOME/.config/rustdesk"
mkdir -p "$RD_CONF" 2>/dev/null || true

TOML="$RD_CONF/RustDesk2.toml"
cat > "$TOML" <<TOML
rendezvous_server = '$RD_HOST'
nat_type = 1
serial = 0

[options]
custom-rendezvous-server = '$RD_HOST'
key = '$RD_KEY'
direct-server = 'Y'
approve-mode = 'password'
TOML

echo "Конфиг записан: $TOML"
echo "Установите RustDesk: https://github.com/rustdesk/rustdesk/releases (dmg)"
echo "После первого запуска скопируйте ID в ЛК EKLK → «Помощник» → «Я в сети»."
echo "Оставляйте приложение запущенным на время поддержки."
