"""
Simple fixed-window rate limits (stage F).

Uses Redis when SESSION_BACKEND=redis (shared across workers),
otherwise process-local memory (limit applies per worker).

Returns True if allowed, False if over limit → caller should HTTP 429.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from threading import Lock

from app.core.config import settings

logger = logging.getLogger("eklk.ratelimit")

_mem: dict[str, list[float]] = defaultdict(list)
_lock = Lock()
_redis = None
_redis_failed = False


def _get_redis():
    global _redis, _redis_failed
    if _redis_failed:
        return None
    if _redis is not None:
        return _redis
    if (settings.session_backend or "").lower() != "redis":
        return None
    try:
        import redis

        _redis = redis.from_url(settings.redis_url, decode_responses=True)
        _redis.ping()
        return _redis
    except Exception as e:
        logger.warning("Rate limit Redis unavailable, using memory: %s", e)
        _redis_failed = True
        return None


def allow(key: str, limit: int, window_seconds: int) -> bool:
    """
    Allow at most `limit` events for `key` inside the current window.
    """
    if limit <= 0:
        return True
    window = max(1, int(window_seconds))
    r = _get_redis()
    if r is not None:
        try:
            rk = f"eklk:rl:{key}"
            # fixed window via INCR + EXPIRE
            n = r.incr(rk)
            if n == 1:
                r.expire(rk, window)
            return n <= limit
        except Exception as e:
            logger.warning("Rate limit Redis error, fallback memory: %s", e)

    now = time.monotonic()
    with _lock:
        bucket = _mem[key]
        cutoff = now - window
        bucket[:] = [t for t in bucket if t >= cutoff]
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True


def client_ip(request) -> str:
    """Best-effort client IP (X-Forwarded-For first hop if present)."""
    xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip() or "unknown"
    if request.client:
        return request.client.host or "unknown"
    return "unknown"
