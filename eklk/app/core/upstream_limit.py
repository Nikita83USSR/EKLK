"""Per-process limit on concurrent outbound calls to EcomKassa (stage F)."""

from __future__ import annotations

import asyncio
import logging

from app.core.config import settings

logger = logging.getLogger("eklk.upstream")

_sem: asyncio.Semaphore | None = None


def get_upstream_semaphore() -> asyncio.Semaphore:
    global _sem
    if _sem is None:
        n = max(1, int(settings.upstream_max_concurrent))
        _sem = asyncio.Semaphore(n)
        logger.info("Upstream concurrency limit: %s per worker", n)
    return _sem
