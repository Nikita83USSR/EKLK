"""
Check (Чек) Model
Fiscal-like receipt entity. Core business object.
"""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, List, TYPE_CHECKING
import enum
import uuid

from sqlalchemy import (
    String, Integer, Numeric, DateTime, Enum as SAEnum,
    ForeignKey, Text, Boolean
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.payment import Payment


class CheckStatus(str, enum.Enum):
    DRAFT = "draft"
    CREATED = "created"
    PAID = "paid"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


class CheckType(str, enum.Enum):
    SALE = "sale"           # Приход
    REFUND = "refund"       # Возврат прихода
    EXPENSE = "expense"     # Расход
    REFUND_EXPENSE = "refund_expense"  # Возврат расхода


class Check(Base):
    __tablename__ = "checks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    
    # Unique fiscal-like identifier
    check_number: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False,
        default=lambda: f"CHK-{uuid.uuid4().hex[:12].upper()}"
    )
    
    # Fiscal attributes (inspired by 54-FZ)
    check_type: Mapped[CheckType] = mapped_column(
        SAEnum(CheckType), default=CheckType.SALE, nullable=False
    )
    status: Mapped[CheckStatus] = mapped_column(
        SAEnum(CheckStatus), default=CheckStatus.DRAFT, nullable=False, index=True
    )
    
    # Amounts
    total_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    vat_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    discount_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    
    # Customer info (optional)
    customer_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    customer_phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    customer_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    # Description / comment
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Fiscal mark simulation (placeholder for real OFD integration)
    fiscal_sign: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    fiscal_document_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    # Soft delete / archive
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    
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
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    created_by_user: Mapped["User"] = relationship("User", back_populates="checks")
    items: Mapped[List["CheckItem"]] = relationship(
        "CheckItem",
        back_populates="check",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    payments: Mapped[List["Payment"]] = relationship(
        "Payment",
        back_populates="check",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Check id={self.id} number={self.check_number} status={self.status} total={self.total_amount}>"


class CheckItem(Base):
    __tablename__ = "check_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    check_id: Mapped[int] = mapped_column(ForeignKey("checks.id", ondelete="CASCADE"), nullable=False, index=True)
    
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=Decimal("1.000"))
    price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)  # quantity * price
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("20.00"))  # %
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=Decimal("0.00"))
    
    product_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, default="шт")

    check: Mapped["Check"] = relationship("Check", back_populates="items")

    def __repr__(self) -> str:
        return f"<CheckItem id={self.id} name={self.name} amount={self.amount}>"
