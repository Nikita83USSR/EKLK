#Requires -Version 5.1
# Админ-клиент Windows — тот же RustDesk, сервер EKLK, подключение по ID из ЛК.
param()
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RdHost = ""; $RdKey = ""
$CfgLocal = Join-Path $Root "eklk-remote.env"
if (Test-Path $CfgLocal) {
  Get-Content $CfgLocal | ForEach-Object {
    if ($_ -match '^\s*EKLK_RD_HOST=(.*)$') { $RdHost = $Matches[1].Trim() }
    if ($_ -match '^\s*EKLK_RD_KEY=(.*)$') { $RdKey = $Matches[1].Trim() }
  }
}
if (-not $RdHost) { Write-Host "Заполните eklk-remote.env"; exit 1 }

$Dest = Join-Path $env:LOCALAPPDATA "EKLK-Admin"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$Exe = Join-Path $Dest "rustdesk.exe"
$Uri = "https://github.com/rustdesk/rustdesk/releases/download/1.3.9/rustdesk-1.3.9-x86_64.exe"
Write-Host "Скачивание RustDesk (админ)..."
try { Invoke-WebRequest -Uri $Uri -OutFile $Exe -UseBasicParsing } catch {
  Write-Host "Скачайте rustdesk.exe вручную в $Dest"
}
$ConfDir = Join-Path $env:APPDATA "RustDesk\config"
New-Item -ItemType Directory -Force -Path $ConfDir | Out-Null
@"
rendezvous_server = '$RdHost'
nat_type = 1
serial = 0

[options]
custom-rendezvous-server = '$RdHost'
key = '$RdKey'
direct-server = 'Y'
"@ | Set-Content -Path (Join-Path $ConfDir "RustDesk2.toml") -Encoding UTF8

Write-Host "Админ-клиент готов. В ЛК: Поддержка → Подключиться → в RustDesk введите ID клиента." -ForegroundColor Green
if (Test-Path $Exe) { Start-Process $Exe }
