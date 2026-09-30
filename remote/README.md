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


## Рекомендуемый способ (Windows) — официальный клиент

Кастомные `EKLK-*-Setup.exe` **без цифровой подписи** часто блокируются SmartScreen/антивирусом.

Вместо них ЛК отдаёт **официальный подписанный** standalone RustDesk с host/key в **имени файла**:

```
rustdesk-host=YOUR_HOST,key=YOUR_KEY#.exe
```

API (только для авторизованных пользователей):

| Endpoint | Кто |
|----------|-----|
| `GET /api/v1/support/download/helper-windows?arch=x64\|x86` | любой залогиненный |
| `GET /api/v1/support/download/admin-windows?arch=x64\|x86` | только `SUPPORT_ADMIN_LOGINS` |

Кэш бинарников (в git):

```
eklk/app/static/remote/cache/rustdesk-1.3.9-x86_64.exe
eklk/app/static/remote/cache/rustdesk-1.3.9-x86-sciter.exe
```

Обновить кэш:

```bash
VER=1.3.9
mkdir -p eklk/app/static/remote/cache
curl -L -o eklk/app/static/remote/cache/rustdesk-$VER-x86_64.exe \
  https://github.com/rustdesk/rustdesk/releases/download/$VER/rustdesk-$VER-x86_64.exe
curl -L -o eklk/app/static/remote/cache/rustdesk-$VER-x86-sciter.exe \
  https://github.com/rustdesk/rustdesk/releases/download/$VER/rustdesk-$VER-x86-sciter.exe
```

Сценарий для пользователя: Скачать → Запустить → скопировать ID в ЛК → «Я в сети».

Legacy Setup.exe остаются в `static/remote/` как запасной вариант.


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

## Авторизация админа (EXE)

Файл EKLK-Admin-Setup.exe перед установкой RustDesk:

1. Читает EKLK_API_BASE из eklk-remote.env (URL вашего ЛК)
2. Запрашивает логин и пароль EcomKassa
3. POST /api/v1/auth/login и GET /api/v1/support/me
4. Продолжает только если is_admin=true (логин в SUPPORT_ADMIN_LOGINS на сервере)

Помощник (EKLK-Helper-Setup.exe) авторизацию на EKLK не требует.
