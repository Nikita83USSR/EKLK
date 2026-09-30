"""Presence and support sessions for remote helper (RustDesk-backed)."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
import urllib.request

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.support import SupportAgent, SupportSession

logger = logging.getLogger("eklk.support")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def is_support_admin(login: str) -> bool:
    raw = (settings.support_admin_logins or "").strip()
    if not raw:
        return False
    allowed = {x.strip().lower() for x in raw.split(",") if x.strip()}
    return login.strip().lower() in allowed


def firm_inn_name(user: dict) -> tuple[str, str, str]:
    firm = user.get("firm") or {}
    inn = str(
        firm.get("taxIdentity")
        or firm.get("tax_identity")
        or firm.get("inn")
        or firm.get("INN")
        or ""
    ).strip()
    name = str(
        firm.get("shortName")
        or firm.get("fullName")
        or firm.get("name")
        or firm.get("organizationName")
        or ""
    ).strip()
    firm_id = str(firm.get("firmId") or firm.get("id") or "").strip()
    return inn, name, firm_id


async def upsert_presence(
    db: AsyncSession,
    *,
    user: dict,
    agent_id: str,
    platform: str = "",
    status: str = "online",
) -> SupportAgent:
    login = str(user["username"])
    inn, firm_name, firm_id = firm_inn_name(user)
    agent_id = agent_id.strip()
    st = status if status in ("online", "busy", "ringing") else "online"

    row = await db.get(SupportAgent, agent_id)
    if row is None:
        row = SupportAgent(
            agent_id=agent_id,
            login=login,
            firm_id=firm_id,
            inn=inn,
            firm_name=firm_name,
            platform=(platform or "")[:32],
            status=st,
            last_seen=_utcnow(),
        )
        db.add(row)
    else:
        row.login = login
        row.firm_id = firm_id
        row.inn = inn
        row.firm_name = firm_name
        if platform:
            row.platform = platform[:32]
        # не затираем busy/ringing heartbeat'ом "online", если сессия активна
        if st == "online" and row.status in ("busy", "ringing"):
            pass
        else:
            row.status = st
        row.last_seen = _utcnow()
    await db.commit()
    await db.refresh(row)
    return row


async def mark_offline(db: AsyncSession, agent_id: str, login: str) -> None:
    row = await db.get(SupportAgent, agent_id.strip())
    if row and row.login == login:
        row.status = "offline"
        row.last_seen = _utcnow()
        await db.commit()


async def list_online(db: AsyncSession) -> list[dict[str, Any]]:
    ttl = int(settings.support_presence_ttl_seconds or 90)
    cutoff = _utcnow() - timedelta(seconds=ttl)
    q = await db.execute(select(SupportAgent))
    rows = q.scalars().all()
    out: list[dict[str, Any]] = []
    for r in rows:
        ls = r.last_seen
        if ls is not None and ls.tzinfo is None:
            ls = ls.replace(tzinfo=timezone.utc)
        if r.status == "offline":
            continue
        if ls is None or ls < cutoff:
            continue
        out.append(
            {
                "agent_id": r.agent_id,
                "login": r.login,
                "firm_id": r.firm_id or "",
                "inn": r.inn or "",
                "firm_name": r.firm_name or "",
                "platform": r.platform or "",
                "status": r.status,
                "last_seen": (ls or _utcnow()).isoformat(),
            }
        )
    out.sort(key=lambda x: (x.get("firm_name") or x.get("inn") or x["agent_id"]))
    return out


async def create_connect(
    db: AsyncSession, *, admin_login: str, agent_id: str
) -> dict[str, Any]:
    agent = await db.get(SupportAgent, agent_id.strip())
    if not agent:
        raise ValueError("Агент не найден — помощник не в сети")
    ttl = int(settings.support_presence_ttl_seconds or 90)
    ls = agent.last_seen
    if ls is not None and ls.tzinfo is None:
        ls = ls.replace(tzinfo=timezone.utc)
    if agent.status == "offline" or ls is None or ls < _utcnow() - timedelta(seconds=ttl):
        raise ValueError("Помощник не в сети")

    sid = uuid.uuid4().hex
    sess = SupportSession(
        id=sid,
        agent_id=agent.agent_id,
        admin_login=admin_login,
        client_login=agent.login,
        inn=agent.inn or "",
        status="ringing",
    )
    db.add(sess)
    agent.status = "ringing"
    await db.commit()

    host = (settings.support_rd_host or "").strip()
    hint = f"rustdesk://{agent.agent_id}"
    if host:
        hint = f"Подключитесь к ID {agent.agent_id} (сервер {host})"

    return {
        "session_id": sid,
        "agent_id": agent.agent_id,
        "inn": agent.inn or "",
        "firm_name": agent.firm_name or "",
        "status": "ringing",
        "connect_hint": hint,
    }


async def respond_session(
    db: AsyncSession, *, session_id: str, login: str, allow: bool
) -> SupportSession:
    sess = await db.get(SupportSession, session_id)
    if not sess:
        raise ValueError("Сессия не найдена")
    if sess.client_login and sess.client_login != login:
        # также разрешаем по agent владельцу
        agent = await db.get(SupportAgent, sess.agent_id)
        if not agent or agent.login != login:
            raise PermissionError("Нет доступа к этой сессии")
    sess.status = "allowed" if allow else "denied"
    sess.updated_at = _utcnow()
    agent = await db.get(SupportAgent, sess.agent_id)
    if agent:
        agent.status = "busy" if allow else "online"
        agent.last_seen = _utcnow()
    await db.commit()
    await db.refresh(sess)
    return sess


async def pending_for_client(db: AsyncSession, login: str) -> Optional[dict[str, Any]]:
    q = await db.execute(
        select(SupportSession)
        .where(SupportSession.client_login == login, SupportSession.status == "ringing")
        .order_by(SupportSession.created_at.desc())
    )
    sess = q.scalars().first()
    if not sess:
        return None
    return {
        "session_id": sess.id,
        "agent_id": sess.agent_id,
        "admin_login": sess.admin_login,
        "status": sess.status,
        "inn": sess.inn,
    }


async def end_session(db: AsyncSession, session_id: str, login: str, as_admin: bool) -> None:
    sess = await db.get(SupportSession, session_id)
    if not sess:
        return
    if as_admin and sess.admin_login != login:
        raise PermissionError("Только создатель сессии")
    if not as_admin and sess.client_login != login:
        raise PermissionError("Нет доступа")
    sess.status = "ended"
    sess.updated_at = _utcnow()
    agent = await db.get(SupportAgent, sess.agent_id)
    if agent:
        agent.status = "online"
    await db.commit()


# Official RustDesk standalone (signed). Cached under static/remote/cache/.
RUSTDESK_CLIENT_VERSION = "1.3.9"
_CACHE_DIR = Path(__file__).resolve().parent.parent / "static" / "remote" / "cache"


def _sanitize_filename_part(value: str) -> str:
    """Windows filename-safe fragment (no invalid path chars)."""
    bad = set('<>:"/\\|?*')
    return "".join("_" if ch in bad else ch for ch in (value or "").strip())


def rustdesk_download_filename(host: str, key: str) -> str:
    """Filename that pre-configures official RustDesk (Windows only).

    Format: rustdesk-host=HOST,key=KEY#.exe
    Trailing # protects key if browser appends (1) on re-download.
    """
    h = _sanitize_filename_part(host)
    k = _sanitize_filename_part(key)
    if not h or not k:
        raise ValueError("SUPPORT_RD_HOST и SUPPORT_RD_KEY должны быть заданы")
    return f"rustdesk-host={h},key={k}#.exe"


def _rustdesk_release_url(name: str) -> str:
    return (
        f"https://github.com/rustdesk/rustdesk/releases/download/"
        f"{RUSTDESK_CLIENT_VERSION}/{name}"
    )


def _ensure_cache_dir() -> Path:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return _CACHE_DIR


def cached_rustdesk_path(arch: str) -> Path:
    """arch: 'x64' | 'x86'. Uses local cache; downloads from GitHub if missing."""
    arch = (arch or "x64").lower().strip()
    if arch in ("x86", "32", "i386", "i686", "sciter"):
        name = f"rustdesk-{RUSTDESK_CLIENT_VERSION}-x86-sciter.exe"
    else:
        name = f"rustdesk-{RUSTDESK_CLIENT_VERSION}-x86_64.exe"
    path = _CACHE_DIR / name
    if path.is_file() and path.stat().st_size > 1_000_000:
        return path

    # Self-heal: pull official signed binary once
    _ensure_cache_dir()
    url = _rustdesk_release_url(name)
    tmp = path.with_suffix(path.suffix + ".part")
    logger.info("rustdesk cache miss — downloading %s → %s", url, path)
    try:
        urllib.request.urlretrieve(url, str(tmp))
        if not tmp.is_file() or tmp.stat().st_size < 1_000_000:
            raise FileNotFoundError(f"Скачанный файл слишком мал: {tmp}")
        tmp.replace(path)
    except Exception as e:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass
        raise FileNotFoundError(
            f"Нет кэша {name} ({path}). Автозагрузка с GitHub не удалась: {e}. "
            f"Положите файл вручную в eklk/app/static/remote/cache/"
        ) from e
    logger.info("rustdesk cache ready: %s (%s bytes)", path, path.stat().st_size)
    return path


def cache_status() -> dict[str, Any]:
    """Paths and presence of cached official binaries."""
    out: dict[str, Any] = {
        "cache_dir": str(_CACHE_DIR),
        "cache_dir_exists": _CACHE_DIR.is_dir(),
        "version": RUSTDESK_CLIENT_VERSION,
        "files": {},
    }
    for arch, name in (
        ("x64", f"rustdesk-{RUSTDESK_CLIENT_VERSION}-x86_64.exe"),
        ("x86", f"rustdesk-{RUSTDESK_CLIENT_VERSION}-x86-sciter.exe"),
    ):
        path = _CACHE_DIR / name
        out["files"][arch] = {
            "name": name,
            "path": str(path),
            "exists": path.is_file(),
            "size": path.stat().st_size if path.is_file() else 0,
        }
    return out


def public_config() -> dict[str, Any]:

    host = (settings.support_rd_host or "").strip()
    key = (settings.support_rd_key or "").strip()
    return {
        "rd_host": host,
        "rd_key": key,
        # Official signed RustDesk with host/key in filename (auth required)
        "helper_windows_url": "/api/v1/support/download/helper-windows?arch=x64",
        "helper_windows_x86_url": "/api/v1/support/download/helper-windows?arch=x86",
        "admin_windows_url": "/api/v1/support/download/admin-windows?arch=x64",
        "admin_windows_x86_url": "/api/v1/support/download/admin-windows?arch=x86",
        "helper_macos_url": "/static/remote/EKLK-Helper-macOS.zip",
        "remote_env_example_url": "/static/remote/eklk-remote.env.example",
        # legacy unsigned installers (fallback)
        "helper_windows_legacy_url": "/static/remote/EKLK-Helper-Setup.exe",
        "admin_windows_legacy_url": "/static/remote/EKLK-Admin-Setup.exe",
        "enabled": bool(host and key),
    }
