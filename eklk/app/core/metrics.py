"""In-process metrics for stage G (per worker)."""

from __future__ import annotations

import os
import time
from threading import Lock
from typing import Any

_lock = Lock()
_worker_id = f"pid-{os.getpid()}"

_counters: dict[str, int] = {
    "http_requests": 0,
    "http_5xx": 0,
    "http_429": 0,
    "http_401": 0,
    "upstream_requests": 0,
    "upstream_errors": 0,
    "upstream_401_refresh": 0,
    "sqlite_errors": 0,
}
_latency_sum_ms: float = 0.0
_upstream_latency_sum_ms: float = 0.0
_in_flight_upstream: int = 0


def worker_id() -> str:
    return _worker_id


def inc(name: str, n: int = 1) -> None:
    with _lock:
        _counters[name] = _counters.get(name, 0) + n


def add_request_latency(ms: float) -> None:
    global _latency_sum_ms
    with _lock:
        _counters["http_requests"] = _counters.get("http_requests", 0) + 1
        _latency_sum_ms += ms


def upstream_begin() -> float:
    global _in_flight_upstream
    with _lock:
        _in_flight_upstream += 1
        _counters["upstream_requests"] = _counters.get("upstream_requests", 0) + 1
    return time.perf_counter()


def upstream_end(t0: float, *, error: bool = False, refresh: bool = False) -> None:
    global _in_flight_upstream, _upstream_latency_sum_ms
    ms = (time.perf_counter() - t0) * 1000.0
    with _lock:
        _in_flight_upstream = max(0, _in_flight_upstream - 1)
        _upstream_latency_sum_ms += ms
        if error:
            _counters["upstream_errors"] = _counters.get("upstream_errors", 0) + 1
        if refresh:
            _counters["upstream_401_refresh"] = _counters.get("upstream_401_refresh", 0) + 1


def snapshot() -> dict[str, Any]:
    with _lock:
        req = _counters.get("http_requests", 0) or 1
        ureq = _counters.get("upstream_requests", 0) or 1
        return {
            "worker": _worker_id,
            "counters": dict(_counters),
            "in_flight_upstream": _in_flight_upstream,
            "avg_request_latency_ms": round(_latency_sum_ms / max(1, _counters.get("http_requests", 0) or 1), 2)
            if _counters.get("http_requests")
            else 0,
            "avg_upstream_latency_ms": round(
                _upstream_latency_sum_ms / max(1, _counters.get("upstream_requests", 0) or 1), 2
            )
            if _counters.get("upstream_requests")
            else 0,
        }
