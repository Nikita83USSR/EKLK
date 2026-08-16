#!/usr/bin/env bash
# Установка ярлыка на рабочий стол XFCE и в меню приложений
set -e
APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ICON="$APP_DIR/eklk-icon.png"
DESKTOP_FILE="$HOME/Desktop/EKLK.desktop"
APPS_FILE="$HOME/.local/share/applications/EKLK.desktop"

mkdir -p "$HOME/Desktop" "$HOME/.local/share/applications"

for TARGET in "$DESKTOP_FILE" "$APPS_FILE"; do
  cat > "$TARGET" << EOL
[Desktop Entry]
Version=1.0
Type=Application
Name=EKLK
GenericName=EcomKassa ЛК
Comment=Личный кабинет EKLK (чеки и платежи EcomKassa)
Exec=xfce4-terminal --working-directory=${APP_DIR} --title=EKLK --hold -e "bash -lc './start-eklk.sh'"
Path=${APP_DIR}
Icon=${ICON}
Terminal=false
Categories=Network;Office;Finance;
StartupNotify=true
Keywords=ecomkassa;kassa;чек;касс;
EOL
  chmod +x "$TARGET"
done

# XFCE: разрешить запуск (убрать "Untrusted")
if command -v gio >/dev/null 2>&1; then
  gio set "$DESKTOP_FILE" metadata::trusted true 2>/dev/null || true
fi
# fallback
chmod +x "$DESKTOP_FILE"

echo "Ярлык установлен:"
echo "  • Рабочий стол: $DESKTOP_FILE"
echo "  • Меню приложений: $APPS_FILE"
echo ""
echo "Если на рабочем столе «Untrusted» — ПКМ по ярлыку → Allow Launching"
