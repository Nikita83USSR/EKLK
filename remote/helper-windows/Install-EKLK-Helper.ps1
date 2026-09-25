#Requires -Version 5.1
<#
  EKLK Helper (Windows) — ставит RustDesk под разрядность ОС и прописывает ваш сервер.
  Запуск: правый клик → Run with PowerShell.
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

# --- Архитектура ОС ---
$Is64 = [Environment]::Is64BitOperatingSystem
# PROCESSOR_ARCHITECTURE: AMD64 | x86 | ARM64
$ArchEnv = [string]$env:PROCESSOR_ARCHITECTURE
$IsArm64 = $ArchEnv -eq "ARM64"

$RdVersion = "1.3.9"
$BaseUrl = "https://github.com/rustdesk/rustdesk/releases/download/$RdVersion"

if ($IsArm64) {
  # Официального Windows ARM64 exe в 1.3.9 нет — пробуем x64 (эмуляция на Windows on ARM)
  Write-Host "Обнаружен Windows ARM64: скачиваем x86_64 (эмуляция)." -ForegroundColor Yellow
  $Uri = "$BaseUrl/rustdesk-$RdVersion-x86_64.exe"
  $ArchLabel = "x86_64 (WoA)"
} elseif ($Is64) {
  $Uri = "$BaseUrl/rustdesk-$RdVersion-x86_64.exe"
  $ArchLabel = "x86_64"
} else {
  # 32-bit: Flutter-сборки нет, используется Sciter-сборка
  $Uri = "$BaseUrl/rustdesk-$RdVersion-x86-sciter.exe"
  $ArchLabel = "x86 (32-bit Sciter)"
}

Write-Host "ОС: $(if ($Is64) { '64-bit' } else { '32-bit' }) · сборка RustDesk: $ArchLabel"
Write-Host "URL: $Uri"

$Dest = Join-Path $env:LOCALAPPDATA "EKLK-Helper"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$RustDeskExe = Join-Path $Dest "rustdesk.exe"

Write-Host "Скачивание RustDesk..."
try {
  Invoke-WebRequest -Uri $Uri -OutFile $RustDeskExe -UseBasicParsing
} catch {
  Write-Host "Автозагрузка не удалась: $_" -ForegroundColor Yellow
  Write-Host "Скачайте вручную:" -ForegroundColor Yellow
  Write-Host "  64-bit: $BaseUrl/rustdesk-$RdVersion-x86_64.exe"
  Write-Host "  32-bit: $BaseUrl/rustdesk-$RdVersion-x86-sciter.exe"
  Write-Host "Положите файл как: $RustDeskExe"
  if (-not (Test-Path $RustDeskExe)) { exit 1 }
}

$ConfDir = Join-Path $env:APPDATA "RustDesk\config"
New-Item -ItemType Directory -Force -Path $ConfDir | Out-Null
$Toml = Join-Path $ConfDir "RustDesk2.toml"
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
Set-Content -Path $Toml -Value $Content -Encoding UTF8

$Reg = @"
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
Set-Content -Path (Join-Path '$Dest' 'agent_id.txt') -Value `$id
"@
Set-Content -Path (Join-Path $Dest "Register-Presence.ps1") -Value $Reg -Encoding UTF8

if (Test-Path $CfgLocal) {
  Copy-Item -Force $CfgLocal -Destination (Join-Path $Dest "eklk-remote.env") -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Готово ($ArchLabel). Запуск: $RustDeskExe" -ForegroundColor Green
Write-Host "1) Дождитесь ID в окне RustDesk"
Write-Host "2) ЛК EKLK → Помощник → вставьте ID → «Я в сети»"
Write-Host "3) Оставьте RustDesk включённым на время поддержки"
if (Test-Path $RustDeskExe) { Start-Process $RustDeskExe }
