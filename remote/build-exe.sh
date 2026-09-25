#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/bootstrap"
go mod tidy 2>/dev/null || true
mkdir -p "$ROOT/dist" "$ROOT/../eklk/app/static/remote"
GOOS=windows GOARCH=386 CGO_ENABLED=0 go build -ldflags="-s -w -X main.buildMode=helper" -o "$ROOT/dist/EKLK-Helper-Setup.exe" .
GOOS=windows GOARCH=386 CGO_ENABLED=0 go build -ldflags="-s -w -X main.buildMode=admin" -o "$ROOT/dist/EKLK-Admin-Setup.exe" .
cp "$ROOT/dist/"*.exe "$ROOT/../eklk/app/static/remote/"
cp "$ROOT/helper-windows/eklk-remote.env" "$ROOT/../eklk/app/static/remote/eklk-remote.env.example"
echo "EXEs in eklk/app/static/remote/"
ls -la "$ROOT/../eklk/app/static/remote/"*.exe
