"""Presence and support sessions for remote helper (RustDesk-backed)."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

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


def public_config() -> dict[str, Any]:
    host = (settings.support_rd_host or "").strip()
    key = (settings.support_rd_key or "").strip()
    return {
        "rd_host": host,
        "rd_key": key,
        "helper_windows_url": "/static/remote/EKLK-Helper-Windows.zip",
        "helper_macos_url": "/static/remote/EKLK-Helper-macOS.zip",
        "admin_windows_url": "/static/remote/EKLK-Admin-Windows.zip",
        "enabled": bool(host),
    }
