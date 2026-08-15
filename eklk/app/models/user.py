"""
User Model
Core entity for authorization.
"""

from datetime import datetime, timezone
from typing import Optional, List, TYPE_CHECKING

from sqlalchemy import String, Boolean, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.database import Base

if TYPE_CHECKING:
    from app.models.check import Check
    from app.models.payment import Payment


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    CASHIER = "cashier"
    MANAGER = "manager"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole), default=UserRole.CASHIER, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    last_login_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    checks: Mapped[List["Check"]] = relationship(
        "Check", back_populates="created_by_user", lazy="selectin"
    )
    payments: Mapped[List["Payment"]] = relationship(
        "Payment", back_populates="created_by_user", lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username} role={self.role}>"
