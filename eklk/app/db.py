"""Async SQLAlchemy engine / session. SQLite by default (DATABASE_URL)."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

logger = logging.getLogger("eklk.db")


class Base(DeclarativeBase):
    pass


def _engine_kwargs(url: str) -> dict:
    kw: dict = {"echo": False}
    if url.startswith("sqlite"):
        # check_same_thread for sqlite; timeout reduces "database is locked" under load
        kw["connect_args"] = {"check_same_thread": False, "timeout": 15}
    return kw


engine = create_async_engine(settings.database_url, **_engine_kwargs(settings.database_url))
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Set False if init_db fails — settings routes still answer with defaults
db_available: bool = True


async def init_db() -> None:
    """Create tables if missing. Never aborts application startup on failure."""
    global db_available
    try:
        from app import models  # noqa: F401

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        db_available = True
        logger.info("Database schema ready")
    except Exception as e:
        db_available = False
        logger.error(
            "Database init failed — app continues without persistent settings: %s",
            e,
            exc_info=True,
        )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Yield a session. If the engine is broken, still yield a session object;
    callers (settings service) must treat operational errors as degraded mode.
    """
    session: AsyncSession | None = None
    try:
        session = SessionLocal()
        yield session
    except Exception as e:
        logger.error("get_db session error: %s", e, exc_info=True)
        if session is not None:
            try:
                await session.rollback()
            except Exception:
                pass
        raise
    finally:
        if session is not None:
            try:
                await session.close()
            except Exception:
                pass
