# EKLK Remote Support (ветка expremote)

Стабильный контур на **self-host RustDesk** (экран, управление, файлы) + **EKLK** (список по ИНН).

## Компоненты

| Часть | Назначение |
|-------|------------|
| `server/` | hbbs + hbbr (Docker) |
| `helper-windows/` | PS1-скрипт (опционально) |
| `dist/*.exe` / `static/remote/*-Setup.exe` | **Автоустановщики Windows** |
| `helper-macos/` | Установщик помощника Mac |
| `admin-windows/` | Клиент админа Win |
| API `/api/v1/support/*` | Presence, список online, connect |

Полный форк UI RustDesk не используется — берётся официальный клиент, только ваш сервер и сценарий EKLK. Так выше совместимость Win/macOS.

## Быстрый старт

1. Поднять `remote/server` , взять `id_ed25519.pub`.
2. В `.env` EKLK: `SUPPORT_RD_HOST`, `SUPPORT_RD_KEY`, `SUPPORT_ADMIN_LOGINS`.
3. Прописать host/key в `eklk-remote.env` дистрибутивов, отдать клиентам ZIP.
4. Клиент: установить помощник → ID в ЛК «Помощник» → «Я в сети».
5. Админ: ЛК «Поддержка» → список → «Подключиться» → RustDesk по ID.

## Сборка ZIP для static

```bash
./remote/pack-dist.sh
```

Кладёт архивы в `eklk/app/static/remote/`.


## Windows EXE

```bash
bash remote/build-exe.sh
```

Рядом с `EKLK-Helper-Setup.exe` / `EKLK-Admin-Setup.exe` положите `eklk-remote.env` с `EKLK_RD_HOST` и `EKLK_RD_KEY`.
Один exe (386) работает на Windows 32-bit и 64-bit; сам качает x86_64 или x86-sciter RustDesk.
