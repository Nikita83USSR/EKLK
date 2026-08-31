"""Async SQLAlchemy engine / session. SQLite by default (DATABASE_URL).

Stage E: WAL + busy_timeout for safe concurrent access from 2 uvicorn workers.
Each worker uses its own connections (NullPool for SQLite — no shared pool
across processes). Transactions stay short in settings_service (no network I/O
inside SQLite transactions).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings

logger = logging.getLogger("eklk.db")


class Base(DeclarativeBase):
    pass


def _is_sqlite(url: str) -> bool:
    return url.startswith("sqlite")


def _engine_kwargs(url: str) -> dict:
    kw: dict = {"echo": False}
    if _is_sqlite(url):
        # timeout: seconds wait on locked DB (SQLite Python API)
        kw["connect_args"] = {"check_same_thread": False, "timeout": 30}
        # NullPool: no connection reuse across checkouts — correct for multi-process
        # SQLite (each worker process must not share pooled connections).
        kw["poolclass"] = NullPool
    return kw


engine = create_async_engine(settings.database_url, **_engine_kwargs(settings.database_url))
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Set False if init_db fails — settings routes still answer with defaults
db_available: bool = True


def _apply_sqlite_pragmas(dbapi_conn, _connection_record) -> None:
    """WAL + busy_timeout on every new SQLite connection (per worker process)."""
    try:
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")  # ms
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
    except Exception as e:
        logger.warning("SQLite PRAGMA setup failed: %s", e)


if _is_sqlite(settings.database_url):
    # aiosqlite: listen on the sync engine underlying the async engine
    event.listen(engine.sync_engine, "connect", _apply_sqlite_pragmas)


async def init_db() -> None:
    """Create tables if missing. Never aborts application startup on failure."""
    global db_available
    try:
        from app import models  # noqa: F401

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            if _is_sqlite(settings.database_url):
                # Confirm WAL once at startup (logged for ops)
                mode = await conn.exec_driver_sql("PRAGMA journal_mode")
                row = mode.fetchone()
                logger.info(
                    "Database schema ready (sqlite journal_mode=%s, busy_timeout=30000ms)",
                    row[0] if row else "?",
                )
            else:
                logger.info("Database schema ready")
        db_available = True
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
