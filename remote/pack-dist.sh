#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/eklk/app/static/remote"
mkdir -p "$OUT"
cd "$ROOT/remote"
zip -r "$OUT/EKLK-Helper-Windows.zip" helper-windows -x '*.DS_Store'
zip -r "$OUT/EKLK-Helper-macOS.zip" helper-macos -x '*.DS_Store'
zip -r "$OUT/EKLK-Admin-Windows.zip" admin-windows -x '*.DS_Store'
echo "Packed into $OUT"
ls -la "$OUT"
