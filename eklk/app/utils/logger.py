"""
EKLK Logging Module
Structured console logging for convenient debugging.
All critical operations are logged with context.
"""

import logging
import sys
from datetime import datetime, timezone
from typing import Any, Optional

from app.core.config import settings


class ColoredFormatter(logging.Formatter):
    """Colored console formatter for better readability during debugging."""

    COLORS = {
        "DEBUG": "\033[36m",     # Cyan
        "INFO": "\033[32m",      # Green
        "WARNING": "\033[33m",   # Yellow
        "ERROR": "\033[31m",     # Red
        "CRITICAL": "\033[41m",  # Red background
    }
    RESET = "\033[0m"
    BOLD = "\033[1m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, self.RESET)
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        
        # Base format
        level = f"{color}{self.BOLD}{record.levelname:8}{self.RESET}"
        name = f"\033[35m{record.name}\033[0m"
        message = record.getMessage()
        
        # Extra context if present
        extra_parts = []
        for key in ("user_id", "action", "entity", "entity_id", "ip", "duration_ms"):
            if hasattr(record, key):
                extra_parts.append(f"{key}={getattr(record, key)}")
        
        extra_str = f" | {' '.join(extra_parts)}" if extra_parts else ""
        
        return f"{timestamp} | {level} | {name} | {message}{extra_str}"


def setup_logging() -> logging.Logger:
    """Configure application-wide logging to console."""
    root_logger = logging.getLogger()
    
    # Clear existing handlers
    root_logger.handlers.clear()
    
    level = getattr(logging, settings.log_level.upper(), logging.DEBUG)
    root_logger.setLevel(level)
    
    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(ColoredFormatter())
    root_logger.addHandler(console_handler)
    
    # Reduce noise from third-party libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(logging.INFO)
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if settings.debug else logging.WARNING
    )
    
    app_logger = logging.getLogger("eklk")
    app_logger.info(
        "Logging initialized",
        extra={"action": "startup", "entity": "logger"}
    )
    return app_logger


# Global logger instance
logger = setup_logging()


def log_action(
    action: str,
    message: str,
    level: str = "info",
    user_id: Optional[int] = None,
    entity: Optional[str] = None,
    entity_id: Optional[Any] = None,
    **kwargs: Any,
) -> None:
    """
    Helper for consistent structured logging of business actions.
    """
    log_func = getattr(logger, level.lower(), logger.info)
    extra = {
        "action": action,
        "user_id": user_id,
        "entity": entity,
        "entity_id": entity_id,
        **kwargs,
    }
    log_func(message, extra=extra)
