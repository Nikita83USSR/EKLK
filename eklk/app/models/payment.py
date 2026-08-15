"""
Payment Model
Payment entity linked to checks. Core business object.
"""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, TYPE_CHECKING
import enum
import uuid

from sqlalchemy import (
    String, Numeric, DateTime, Enum as SAEnum,
    ForeignKey, Text, Boolean
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.check import Check


class PaymentMethod(str, enum.Enum):
    CASH = "cash"               # Наличные
    CARD = "card"               # Банковская карта
    SBP = "sbp"                 # Система быстрых платежей
    ELECTRONIC = "electronic"   # Электронные деньги
    OTHER = "other"


class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    
    # Unique payment identifier
    payment_number: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False,
        default=lambda: f"PAY-{uuid.uuid4().hex[:12].upper()}"
    )
    
    # Link to check
    check_id: Mapped[int] = mapped_column(
        ForeignKey("checks.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    method: Mapped[PaymentMethod] = mapped_column(
        SAEnum(PaymentMethod), nullable=False, default=PaymentMethod.CASH
    )
    status: Mapped[PaymentStatus] = mapped_column(
        SAEnum(PaymentStatus), nullable=False, default=PaymentStatus.PENDING, index=True
    )
    
    # External references (bank, acquiring, etc.)
    external_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    external_status: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    
    # Description
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Error info if failed
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    is_refund: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    
    # Audit
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    created_by_user: Mapped["User"] = relationship("User", back_populates="payments")
    check: Mapped["Check"] = relationship("Check", back_populates="payments")

    def __repr__(self) -> str:
        return f"<Payment id={self.id} number={self.payment_number} status={self.status} amount={self.amount}>"
