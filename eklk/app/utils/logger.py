import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import settings


class ColoredFormatter(logging.Formatter):
    COLORS = {
        "DEBUG": "\033[36m",
        "INFO": "\033[32m",
        "WARNING": "\033[33m",
        "ERROR": "\033[31m",
        "CRITICAL": "\033[41m",
    }
    RESET = "\033[0m"
    BOLD = "\033[1m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, self.RESET)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        level = f"{color}{self.BOLD}{record.levelname:8}{self.RESET}"
        name = f"\033[35m{record.name}\033[0m"
        extra = []
        for k in ("action", "user_id", "entity", "entity_id", "uuid", "worker"):
            if hasattr(record, k) and getattr(record, k) is not None:
                extra.append(f"{k}={getattr(record, k)}")
        extra_str = f" | {' '.join(extra)}" if extra else ""
        return f"{ts} | {level} | {name} | {record.getMessage()}{extra_str}"


class PlainFormatter(logging.Formatter):
    """File log without ANSI colors (run.log)."""

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        extra = []
        for k in ("action", "user_id", "entity", "entity_id", "uuid", "worker"):
            if hasattr(record, k) and getattr(record, k) is not None:
                extra.append(f"{k}={getattr(record, k)}")
        extra_str = f" | {' '.join(extra)}" if extra else ""
        pid = os.getpid()
        return f"{ts} | {record.levelname:8} | pid={pid} | {record.name} | {record.getMessage()}{extra_str}"


def setup_logging() -> logging.Logger:
    root = logging.getLogger()
    root.handlers.clear()
    level = getattr(logging, settings.log_level.upper(), logging.DEBUG)
    root.setLevel(level)

    h = logging.StreamHandler(sys.stdout)
    h.setLevel(level)
    h.setFormatter(ColoredFormatter())
    root.addHandler(h)

    # Single shared run.log (all workers append)
    log_path = Path(settings.log_file)
    if not log_path.is_absolute():
        # relative to process CWD (eklk/ when started via start-eklk.sh)
        log_path = Path.cwd() / log_path
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_path, encoding="utf-8")
        fh.setLevel(level)
        fh.setFormatter(PlainFormatter())
        root.addHandler(fh)
    except Exception as e:
        # stdout still works
        logging.getLogger("eklk").warning("Cannot open log file %s: %s", log_path, e)

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    log = logging.getLogger("eklk")
    log.info("Logging initialized file=%s", log_path, extra={"action": "startup"})
    return log


logger = setup_logging()


def log_action(action: str, message: str, level: str = "info", **kwargs: Any) -> None:
    # Never accept obvious secrets in kwargs
    for ban in ("password", "token", "access_token", "secret", "authorization"):
        kwargs.pop(ban, None)
    fn = getattr(logger, level.lower(), logger.info)
    fn(message, extra={"action": action, **kwargs})
