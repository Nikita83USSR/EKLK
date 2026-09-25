#Requires -Version 5.1
# Админ-клиент Windows — RustDesk под разрядность ОС, сервер EKLK.
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

$Is64 = [Environment]::Is64BitOperatingSystem
$IsArm64 = [string]$env:PROCESSOR_ARCHITECTURE -eq "ARM64"
$RdVersion = "1.3.9"
$BaseUrl = "https://github.com/rustdesk/rustdesk/releases/download/$RdVersion"

if ($IsArm64 -or $Is64) {
  $Uri = "$BaseUrl/rustdesk-$RdVersion-x86_64.exe"
  $ArchLabel = if ($IsArm64) { "x86_64 (WoA)" } else { "x86_64" }
} else {
  $Uri = "$BaseUrl/rustdesk-$RdVersion-x86-sciter.exe"
  $ArchLabel = "x86 (32-bit Sciter)"
}

Write-Host "Сборка: $ArchLabel"
Write-Host "URL: $Uri"

$Dest = Join-Path $env:LOCALAPPDATA "EKLK-Admin"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$Exe = Join-Path $Dest "rustdesk.exe"
Write-Host "Скачивание RustDesk (админ)..."
try {
  Invoke-WebRequest -Uri $Uri -OutFile $Exe -UseBasicParsing
} catch {
  Write-Host "Скачайте вручную в $Exe : $Uri" -ForegroundColor Yellow
  if (-not (Test-Path $Exe)) { exit 1 }
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

Write-Host "Админ-клиент готов ($ArchLabel). ЛК → Поддержка → Подключиться → ID в RustDesk." -ForegroundColor Green
if (Test-Path $Exe) { Start-Process $Exe }
