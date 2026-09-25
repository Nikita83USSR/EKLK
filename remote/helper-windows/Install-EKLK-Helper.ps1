#Requires -Version 5.1
<#
  EKLK Helper (Windows) — ставит RustDesk и прописывает ваш сервер.
  Запуск: правый клик → Run with PowerShell (от имени пользователя).
#>
param(
  [string]$RdHost = $env:EKLK_RD_HOST,
  [string]$RdKey = $env:EKLK_RD_KEY,
  [string]$ApiBase = $env:EKLK_API_BASE
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$CfgLocal = Join-Path $Root "eklk-remote.env"
if (Test-Path $CfgLocal) {
  Get-Content $CfgLocal | ForEach-Object {
    if ($_ -match '^\s*EKLK_RD_HOST=(.*)$') { $RdHost = $Matches[1].Trim() }
    if ($_ -match '^\s*EKLK_RD_KEY=(.*)$') { $RdKey = $Matches[1].Trim() }
    if ($_ -match '^\s*EKLK_API_BASE=(.*)$') { $ApiBase = $Matches[1].Trim() }
  }
}

if (-not $RdHost) {
  Write-Host "Укажите EKLK_RD_HOST в eklk-remote.env (хост hbbs)." -ForegroundColor Red
  exit 1
}

$Dest = Join-Path $env:LOCALAPPDATA "EKLK-Helper"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$RustDeskExe = Join-Path $Dest "rustdesk.exe"

# Official portable-ish download (latest windows x86_64)
$Uri = "https://github.com/rustdesk/rustdesk/releases/download/1.3.9/rustdesk-1.3.9-x86_64.exe"
Write-Host "Скачивание RustDesk..."
try {
  Invoke-WebRequest -Uri $Uri -OutFile $RustDeskExe -UseBasicParsing
} catch {
  Write-Host "Не удалось скачать автоматически. Скачайте RustDesk вручную с github.com/rustdesk/rustdesk/releases и положите rustdesk.exe в $Dest" -ForegroundColor Yellow
}

$ConfDir = Join-Path $env:APPDATA "RustDesk\config"
New-Item -ItemType Directory -Force -Path $ConfDir | Out-Null
$Toml = Join-Path $ConfDir "RustDesk2.toml"
# Минимальный конфиг: только ваш сервер (ID появится после первого запуска)
$Content = @"
rendezvous_server = '$RdHost'
nat_type = 1
serial = 0

[options]
custom-rendezvous-server = '$RdHost'
key = '$RdKey'
allow-remote-config-modification = 'N'
direct-server = 'Y'
verification-method = 'use-permanent-password'
approve-mode = 'password'
"@
# permanent password optional — admin is trusted; user still confirms connection in UI
Set-Content -Path $Toml -Value $Content -Encoding UTF8

# Register helper script
$Reg = @"
# Register presence in EKLK after RustDesk has an ID
`$conf = Join-Path `$env:APPDATA 'RustDesk\config\RustDesk.toml'
if (-not (Test-Path `$conf)) { `$conf = Join-Path `$env:APPDATA 'RustDesk\config\RustDesk2.toml' }
`$id = `$null
if (Test-Path `$conf) {
  `$raw = Get-Content `$conf -Raw
  if (`$raw -match "id\s*=\s*'([^']+)'") { `$id = `$Matches[1] }
  elseif (`$raw -match 'id\s*=\s*"([^"]+)"') { `$id = `$Matches[1] }
}
if (-not `$id) {
  Write-Host 'Запустите RustDesk один раз, затем снова Register-Presence.ps1'
  exit 0
}
Write-Host "RustDesk ID: `$id"
Write-Host "Вставьте ID в ЛК EKLK → Помощник (или сохраните; heartbeat из ЛК отправит ID)."
Set-Content -Path (Join-Path '$Dest' 'agent_id.txt') -Value `$id
"@
Set-Content -Path (Join-Path $Dest "Register-Presence.ps1") -Value $Reg -Encoding UTF8

Copy-Item -Force (Join-Path $Root "eklk-remote.env") -Destination (Join-Path $Dest "eklk-remote.env") -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Готово. Запустите: $RustDeskExe" -ForegroundColor Green
Write-Host "1) Откройте RustDesk, дождитесь своего ID"
Write-Host "2) В ЛК EKLK → раздел «Помощник» вставьте ID и нажмите «Я в сети»"
Write-Host "3) Оставьте RustDesk запущенным пока нужна поддержка"
if ($RustDeskExe -and (Test-Path $RustDeskExe)) {
  Start-Process $RustDeskExe
}
