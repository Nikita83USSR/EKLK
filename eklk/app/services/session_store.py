"""
Shared session store for multi-worker deploy.

Backends:
  - memory — process-local dict (dev / single worker)
  - redis  — shared across workers (production)

Keys:
  - eklk:session:{login}  — sealed session payload (password, ecom_token, firm, ...)
  - eklk:sid:{session_id} — maps cookie id → login (for /auth/refresh)

Stage D: password and ecom_token are encrypted at rest (Fernet via SECRET_KEY).
Long-lived "remember me" is implemented via session_id cookie + sliding TTL on both keys.
"""

from __future__ import annotations

import json
import logging
import secrets
import time
from typing import Any, Optional, Protocol

from app.core.config import settings
from app.services.session_crypto import open_session_for_use, seal_session_for_storage

logger = logging.getLogger("eklk.session")


def default_session_ttl_seconds(remember: bool = False) -> int:
    if remember:
        return max(3600, int(settings.session_remember_days) * 86400)
    return max(300, int(settings.session_ttl_hours) * 3600)


def new_session_id() -> str:
    return secrets.token_urlsafe(32)


class SessionStore(Protocol):
    def save(
        self,
        login: str,
        password: str,
        group_code: str = "990",
        firm: Optional[dict] = None,
        ecom_token: Optional[str] = None,
        *,
        ttl_seconds: Optional[int] = None,
        session_id: Optional[str] = None,
        remember: bool = False,
    ) -> str: ...

    def get(self, login: str) -> Optional[dict[str, Any]]: ...

    def get_login_by_sid(self, session_id: str) -> Optional[str]: ...

    def touch(self, login: str, session_id: Optional[str] = None, ttl_seconds: Optional[int] = None) -> None: ...

    def update_store(self, login: str, store_id: str | int) -> None: ...

    def update_fields(self, login: str, **fields: Any) -> None: ...

    def clear(self, login: str) -> None: ...

    def clear_sid(self, session_id: str) -> None: ...


def _merge_session(
    prev: dict[str, Any],
    login: str,
    password: str,
    group_code: str,
    firm: Optional[dict],
    ecom_token: Optional[str],
) -> dict[str, Any]:
    """
    Build session payload in *plaintext* form (for in-process use).
    Callers must seal_session_for_storage before persisting.
    prev is expected to be already opened (plaintext) or empty.
    """
    selected = prev.get("selected_store_id")
    stores = (firm or {}).get("stores") or prev.get("firm", {}).get("stores") or []
    if selected is not None and stores:
        ids = {str(s.get("storeId")) for s in stores}
        if str(selected) not in ids:
            selected = None
    if selected is None and stores:
        selected = stores[0].get("storeId")
    if selected is not None:
        group_code = str(selected)
    data: dict[str, Any] = {
        "login": login,
        "password": password,
        "group_code": str(group_code),
        "firm": firm if firm is not None else prev.get("firm"),
        "selected_store_id": selected if selected is not None else group_code,
    }
    if "report_history" in prev:
        data["report_history"] = prev["report_history"]
    if "remember" in prev:
        data["remember"] = prev["remember"]
    if "session_id" in prev:
        data["session_id"] = prev["session_id"]
    tok = ecom_token if ecom_token is not None else prev.get("ecom_token")
    if tok:
        data["ecom_token"] = tok
    return data


class MemorySessionStore:
    def __init__(self) -> None:
        # login -> sealed session + meta
        self._data: dict[str, dict[str, Any]] = {}
        # sid -> login
        self._sid: dict[str, str] = {}
        # login -> expires_at unix
        self._exp: dict[str, float] = {}
        # sid -> expires_at
        self._sid_exp: dict[str, float] = {}

    def _expired(self, login: str) -> bool:
        exp = self._exp.get(login)
        return exp is not None and time.time() > exp

    def save(
        self,
        login: str,
        password: str,
        group_code: str = "990",
        firm: Optional[dict] = None,
        ecom_token: Optional[str] = None,
        *,
        ttl_seconds: Optional[int] = None,
        session_id: Optional[str] = None,
        remember: bool = False,
    ) -> str:
        prev = open_session_for_use(self._data[login]) if login in self._data and not self._expired(login) else {}
        if prev is None:
            prev = {}
        merged = _merge_session(prev, login, password, group_code, firm, ecom_token)
        merged["remember"] = bool(remember or prev.get("remember"))
        sid = session_id or prev.get("session_id") or new_session_id()
        merged["session_id"] = sid
        self._data[login] = seal_session_for_storage(merged)
        ttl = int(ttl_seconds if ttl_seconds is not None else default_session_ttl_seconds(merged["remember"]))
        exp_at = time.time() + max(60, ttl)
        self._exp[login] = exp_at
        # drop old sid mapping for this login if rotated
        old_sid = prev.get("session_id")
        if old_sid and old_sid != sid:
            self._sid.pop(old_sid, None)
            self._sid_exp.pop(old_sid, None)
        self._sid[sid] = login
        self._sid_exp[sid] = exp_at
        return sid

    def get(self, login: str) -> Optional[dict[str, Any]]:
        if login not in self._data:
            return None
        if self._expired(login):
            self.clear(login)
            return None
        raw = self._data.get(login)
        if not raw:
            return None
        return open_session_for_use(raw)

    def get_login_by_sid(self, session_id: str) -> Optional[str]:
        if not session_id:
            return None
        exp = self._sid_exp.get(session_id)
        if exp is not None and time.time() > exp:
            self.clear_sid(session_id)
            return None
        return self._sid.get(session_id)

    def touch(self, login: str, session_id: Optional[str] = None, ttl_seconds: Optional[int] = None) -> None:
        session = self.get(login)
        if not session:
            return
        remember = bool(session.get("remember"))
        ttl = int(ttl_seconds if ttl_seconds is not None else default_session_ttl_seconds(remember))
        exp_at = time.time() + max(60, ttl)
        self._exp[login] = exp_at
        sid = session_id or session.get("session_id")
        if sid:
            self._sid[sid] = login
            self._sid_exp[sid] = exp_at

    def update_store(self, login: str, store_id: str | int) -> None:
        session = self.get(login)
        if not session:
            return
        session["selected_store_id"] = store_id
        session["group_code"] = str(store_id)
        self._data[login] = seal_session_for_storage(session)

    def update_fields(self, login: str, **fields: Any) -> None:
        session = self.get(login)
        if not session:
            return
        session.update(fields)
        self._data[login] = seal_session_for_storage(session)

    def clear(self, login: str) -> None:
        session = None
        raw = self._data.pop(login, None)
        self._exp.pop(login, None)
        if raw:
            session = open_session_for_use(raw)
        sid = (session or {}).get("session_id")
        if sid:
            self._sid.pop(sid, None)
            self._sid_exp.pop(sid, None)

    def clear_sid(self, session_id: str) -> None:
        login = self._sid.pop(session_id, None)
        self._sid_exp.pop(session_id, None)
        if login and self._sid.get(login) is None:
            # if this sid was the active one, clear login session too
            raw = self._data.get(login)
            if raw:
                opened = open_session_for_use(raw)
                if opened and opened.get("session_id") == session_id:
                    self._data.pop(login, None)
                    self._exp.pop(login, None)


class RedisSessionStore:
    def __init__(self, url: str, default_ttl_seconds: int) -> None:
        import redis

        self._r = redis.from_url(url, decode_responses=True)
        self._default_ttl = max(60, int(default_ttl_seconds))
        self._r.ping()

    def _key(self, login: str) -> str:
        return f"eklk:session:{login}"

    def _sid_key(self, session_id: str) -> str:
        return f"eklk:sid:{session_id}"

    def _write(self, login: str, plain_session: dict[str, Any], ttl: int) -> None:
        sealed = seal_session_for_storage(plain_session)
        self._r.set(
            self._key(login),
            json.dumps(sealed, ensure_ascii=False, default=str),
            ex=max(60, int(ttl)),
        )

    def save(
        self,
        login: str,
        password: str,
        group_code: str = "990",
        firm: Optional[dict] = None,
        ecom_token: Optional[str] = None,
        *,
        ttl_seconds: Optional[int] = None,
        session_id: Optional[str] = None,
        remember: bool = False,
    ) -> str:
        prev = self.get(login) or {}
        merged = _merge_session(prev, login, password, group_code, firm, ecom_token)
        merged["remember"] = bool(remember or prev.get("remember"))
        sid = session_id or prev.get("session_id") or new_session_id()
        merged["session_id"] = sid
        ttl = int(ttl_seconds if ttl_seconds is not None else default_session_ttl_seconds(merged["remember"]))
        old_sid = prev.get("session_id")
        if old_sid and old_sid != sid:
            self._r.delete(self._sid_key(old_sid))
        self._write(login, merged, ttl)
        self._r.set(self._sid_key(sid), login, ex=max(60, ttl))
        return sid

    def get(self, login: str) -> Optional[dict[str, Any]]:
        raw = self._r.get(self._key(login))
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Corrupt session JSON for login=%s", login)
            return None
        opened = open_session_for_use(data)
        if opened is None:
            self.clear(login)
            return None
        return opened

    def get_login_by_sid(self, session_id: str) -> Optional[str]:
        if not session_id:
            return None
        return self._r.get(self._sid_key(session_id))

    def touch(self, login: str, session_id: Optional[str] = None, ttl_seconds: Optional[int] = None) -> None:
        session = self.get(login)
        if not session:
            return
        remember = bool(session.get("remember"))
        ttl = int(ttl_seconds if ttl_seconds is not None else default_session_ttl_seconds(remember))
        self._r.expire(self._key(login), max(60, ttl))
        sid = session_id or session.get("session_id")
        if sid:
            self._r.set(self._sid_key(sid), login, ex=max(60, ttl))

    def update_store(self, login: str, store_id: str | int) -> None:
        session = self.get(login)
        if not session:
            return
        session["selected_store_id"] = store_id
        session["group_code"] = str(store_id)
        ttl = default_session_ttl_seconds(bool(session.get("remember")))
        # preserve remaining TTL if possible
        try:
            rem = self._r.ttl(self._key(login))
            if isinstance(rem, int) and rem > 60:
                ttl = rem
        except Exception:
            pass
        self._write(login, session, ttl)

    def update_fields(self, login: str, **fields: Any) -> None:
        session = self.get(login)
        if not session:
            return
        session.update(fields)
        ttl = default_session_ttl_seconds(bool(session.get("remember")))
        try:
            rem = self._r.ttl(self._key(login))
            if isinstance(rem, int) and rem > 60:
                ttl = rem
        except Exception:
            pass
        self._write(login, session, ttl)

    def clear(self, login: str) -> None:
        session = self.get(login)
        self._r.delete(self._key(login))
        if session and session.get("session_id"):
            self._r.delete(self._sid_key(str(session["session_id"])))

    def clear_sid(self, session_id: str) -> None:
        login = self._r.get(self._sid_key(session_id))
        self._r.delete(self._sid_key(session_id))
        if login:
            raw = self._r.get(self._key(login))
            if raw:
                try:
                    data = json.loads(raw)
                    opened = open_session_for_use(data)
                    if opened and opened.get("session_id") == session_id:
                        self._r.delete(self._key(login))
                except Exception:
                    self._r.delete(self._key(login))


_store: SessionStore | None = None


def get_session_store() -> SessionStore:
    global _store
    if _store is not None:
        return _store

    backend = (settings.session_backend or "memory").strip().lower()
    ttl = default_session_ttl_seconds(remember=True)

    if backend == "redis":
        try:
            _store = RedisSessionStore(settings.redis_url, default_ttl_seconds=ttl)
            logger.info(
                "Session store: redis (%s), default_ttl=%ss (secrets encrypted at rest)",
                settings.redis_url,
                ttl,
            )
            return _store
        except Exception as e:
            logger.error("Redis session store failed (%s) — falling back to memory", e)

    _store = MemorySessionStore()
    logger.info("Session store: memory (dev / fallback)")
    return _store
