import logging
import sys
from datetime import datetime, timezone
from typing import Any, Optional

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
        for k in ("action", "user_id", "entity", "entity_id", "uuid"):
            if hasattr(record, k) and getattr(record, k) is not None:
                extra.append(f"{k}={getattr(record, k)}")
        extra_str = f" | {' '.join(extra)}" if extra else ""
        return f"{ts} | {level} | {name} | {record.getMessage()}{extra_str}"


def setup_logging() -> logging.Logger:
    root = logging.getLogger()
    root.handlers.clear()
    level = getattr(logging, settings.log_level.upper(), logging.DEBUG)
    root.setLevel(level)
    h = logging.StreamHandler(sys.stdout)
    h.setLevel(level)
    h.setFormatter(ColoredFormatter())
    root.addHandler(h)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    log = logging.getLogger("eklk")
    log.info("Logging initialized", extra={"action": "startup"})
    return log


logger = setup_logging()


def log_action(action: str, message: str, level: str = "info", **kwargs: Any) -> None:
    fn = getattr(logger, level.lower(), logger.info)
    fn(message, extra={"action": action, **kwargs})
