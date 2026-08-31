"""
Shared session store for multi-worker deploy.

Backends:
  - memory — process-local dict (dev / single worker)
  - redis  — shared across workers (production)

Key: eklk:session:{login}
TTL: ACCESS_TOKEN_EXPIRE_MINUTES + 30 min (slightly longer than JWT).

Stage C: password may still be stored (removed/encrypted in stage D).
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional, Protocol

from app.core.config import settings

logger = logging.getLogger("eklk.session")


class SessionStore(Protocol):
    def save(
        self,
        login: str,
        password: str,
        group_code: str = "990",
        firm: Optional[dict] = None,
        ecom_token: Optional[str] = None,
    ) -> None: ...

    def get(self, login: str) -> Optional[dict[str, Any]]: ...

    def update_store(self, login: str, store_id: str | int) -> None: ...

    def update_fields(self, login: str, **fields: Any) -> None: ...

    def clear(self, login: str) -> None: ...


def _merge_session(
    prev: dict[str, Any],
    login: str,
    password: str,
    group_code: str,
    firm: Optional[dict],
    ecom_token: Optional[str],
) -> dict[str, Any]:
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
    # preserve report_history and ecom_token unless explicitly replaced
    if "report_history" in prev:
        data["report_history"] = prev["report_history"]
    tok = ecom_token if ecom_token is not None else prev.get("ecom_token")
    if tok:
        data["ecom_token"] = tok
    return data


class MemorySessionStore:
    def __init__(self) -> None:
        self._data: dict[str, dict[str, Any]] = {}

    def save(
        self,
        login: str,
        password: str,
        group_code: str = "990",
        firm: Optional[dict] = None,
        ecom_token: Optional[str] = None,
    ) -> None:
        prev = self._data.get(login) or {}
        self._data[login] = _merge_session(prev, login, password, group_code, firm, ecom_token)

    def get(self, login: str) -> Optional[dict[str, Any]]:
        return self._data.get(login)

    def update_store(self, login: str, store_id: str | int) -> None:
        session = self._data.get(login)
        if not session:
            return
        session["selected_store_id"] = store_id
        session["group_code"] = str(store_id)

    def update_fields(self, login: str, **fields: Any) -> None:
        session = self._data.get(login)
        if not session:
            return
        session.update(fields)

    def clear(self, login: str) -> None:
        self._data.pop(login, None)


class RedisSessionStore:
    def __init__(self, url: str, ttl_seconds: int) -> None:
        import redis

        self._r = redis.from_url(url, decode_responses=True)
        self._ttl = max(60, int(ttl_seconds))
        # fail fast if Redis is down
        self._r.ping()

    def _key(self, login: str) -> str:
        return f"eklk:session:{login}"

    def save(
        self,
        login: str,
        password: str,
        group_code: str = "990",
        firm: Optional[dict] = None,
        ecom_token: Optional[str] = None,
    ) -> None:
        prev = self.get(login) or {}
        data = _merge_session(prev, login, password, group_code, firm, ecom_token)
        self._r.set(self._key(login), json.dumps(data, ensure_ascii=False, default=str), ex=self._ttl)

    def get(self, login: str) -> Optional[dict[str, Any]]:
        raw = self._r.get(self._key(login))
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Corrupt session JSON for login=%s", login)
            return None
        # sliding TTL: touch on read so active users stay logged in
        self._r.expire(self._key(login), self._ttl)
        return data

    def update_store(self, login: str, store_id: str | int) -> None:
        session = self.get(login)
        if not session:
            return
        session["selected_store_id"] = store_id
        session["group_code"] = str(store_id)
        self._r.set(self._key(login), json.dumps(session, ensure_ascii=False, default=str), ex=self._ttl)

    def update_fields(self, login: str, **fields: Any) -> None:
        session = self.get(login)
        if not session:
            return
        session.update(fields)
        self._r.set(self._key(login), json.dumps(session, ensure_ascii=False, default=str), ex=self._ttl)

    def clear(self, login: str) -> None:
        self._r.delete(self._key(login))


_store: SessionStore | None = None


def get_session_store() -> SessionStore:
    global _store
    if _store is not None:
        return _store

    backend = (settings.session_backend or "memory").strip().lower()
    ttl = (settings.access_token_expire_minutes + 30) * 60

    if backend == "redis":
        try:
            _store = RedisSessionStore(settings.redis_url, ttl_seconds=ttl)
            logger.info("Session store: redis (%s), ttl=%ss", settings.redis_url, ttl)
            return _store
        except Exception as e:
            logger.error(
                "Redis session store failed (%s) — falling back to memory. "
                "Multi-worker sessions will NOT be shared until Redis is available.",
                e,
            )
            _store = MemorySessionStore()
            return _store

    _store = MemorySessionStore()
    logger.info("Session store: memory (single-process only)")
    return _store


def reset_session_store_for_tests() -> None:
    """Reset singleton (unit tests only)."""
    global _store
    _store = None
