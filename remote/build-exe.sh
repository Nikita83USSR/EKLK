#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/bootstrap"
go mod tidy 2>/dev/null || true
mkdir -p "$ROOT/dist" "$ROOT/../eklk/app/static/remote"

# URL ЛК для автозагрузки host/key (можно переопределить):
API_BASE="${EKLK_API_BASE:-https://kassa.ecomkassa.ru}"
LDFLAGS_COMMON="-s -w -X main.defaultAPIBase=${API_BASE}"

GOOS=windows GOARCH=386 CGO_ENABLED=0 go build -ldflags="${LDFLAGS_COMMON} -X main.buildMode=helper" -o "$ROOT/dist/EKLK-Helper-Setup.exe" .
GOOS=windows GOARCH=386 CGO_ENABLED=0 go build -ldflags="${LDFLAGS_COMMON} -X main.buildMode=admin" -o "$ROOT/dist/EKLK-Admin-Setup.exe" .
cp "$ROOT/dist/"*.exe "$ROOT/../eklk/app/static/remote/"
cp "$ROOT/helper-windows/eklk-remote.env" "$ROOT/../eklk/app/static/remote/eklk-remote.env.example" 2>/dev/null || true
echo "Built with defaultAPIBase=${API_BASE}"
ls -la "$ROOT/../eklk/app/static/remote/"*.exe
