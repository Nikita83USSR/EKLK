"""
EKLK Database Setup
SQLAlchemy engine and session management.
"""

from collections.abc import Generator
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase, Session
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.utils.logger import logger

# SQLite specific for development reliability
connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    # Use StaticPool for SQLite in-memory / file to avoid connection issues
    engine = create_engine(
        settings.database_url,
        connect_args=connect_args,
        poolclass=StaticPool,
        echo=settings.debug,  # Log SQL in debug mode
    )
else:
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        echo=settings.debug,
    )


# Enable foreign keys for SQLite
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    if settings.database_url.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Base class for all models."""
    pass


def get_db() -> Generator[Session, None, None]:
    """
    Dependency that provides a database session.
    Ensures proper cleanup after request.
    """
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        logger.error(f"Database session error: {e}", extra={"action": "db_error"})
        db.rollback()
        raise
    finally:
        db.close()


def init_db() -> None:
    """Create all tables. Call on application startup."""
    from app.models import user, check, payment  # noqa: F401
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables initialized", extra={"action": "startup", "entity": "database"})
