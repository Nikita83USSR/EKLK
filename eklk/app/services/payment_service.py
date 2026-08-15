"""
Payment Service
Business logic for creating and managing payments.
Must work perfectly — transactional with check status update.
"""

from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.models.payment import Payment, PaymentMethod, PaymentStatus
from app.models.check import Check, CheckStatus
from app.models.user import User
from app.schemas.payment import PaymentCreate, PaymentUpdateStatus
from app.utils.logger import log_action


class PaymentService:
    def __init__(self, db: Session):
        self.db = db

    def create_payment(self, data: PaymentCreate, current_user: User) -> Payment:
        """
        Create a payment linked to a check.
        Validates check exists, amount matches, and updates check status on success.
        """
        check = self.db.get(Check, data.check_id)
        if not check or check.is_archived:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Check not found",
            )
        
        if check.status not in (CheckStatus.CREATED, CheckStatus.PAID):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot create payment for check in status '{check.status.value}'",
            )
        
        try:
            method = PaymentMethod(data.method)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid method. Allowed: {[m.value for m in PaymentMethod]}",
            )
        
        amount = Decimal(str(data.amount)).quantize(Decimal("0.01"))
        
        # Soft validation: payment amount should not greatly exceed remaining
        # For MVP we allow partial payments, but log if mismatch
        existing_payments = (
            self.db.query(Payment)
            .filter(
                Payment.check_id == check.id,
                Payment.status == PaymentStatus.COMPLETED,
                Payment.is_refund == False,
            )
            .all()
        )
        paid_so_far = sum((p.amount for p in existing_payments), Decimal("0.00"))
        remaining = check.total_amount - paid_so_far
        
        if amount > remaining + Decimal("0.01"):  # small tolerance
            log_action(
                "payment_amount_warning",
                f"Payment amount {amount} > remaining {remaining} for check {check.check_number}",
                level="warning",
                user_id=current_user.id,
                entity="payment",
            )
        
        payment = Payment(
            check_id=check.id,
            amount=amount,
            method=method,
            status=PaymentStatus.PENDING,
            description=data.description,
            external_id=data.external_id,
            created_by=current_user.id,
            is_refund=False,
        )
        
        self.db.add(payment)
        self.db.commit()
        self.db.refresh(payment)
        
        log_action(
            "payment_created",
            f"Payment created: {payment.payment_number}, amount={amount}, method={method.value}",
            user_id=current_user.id,
            entity="payment",
            entity_id=payment.id,
        )
        return payment

    def complete_payment(
        self,
        payment_id: int,
        current_user: User,
        external_id: Optional[str] = None,
        external_status: Optional[str] = None,
    ) -> Payment:
        """
        Mark payment as completed and update related check if fully paid.
        """
        payment = self.db.get(Payment, payment_id)
        if not payment:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
        
        if payment.status not in (PaymentStatus.PENDING, PaymentStatus.PROCESSING):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot complete payment in status '{payment.status.value}'",
            )
        
        payment.status = PaymentStatus.COMPLETED
        payment.completed_at = datetime.now(timezone.utc)
        if external_id:
            payment.external_id = external_id
        if external_status:
            payment.external_status = external_status
        
        # Check if check is fully paid
        check = payment.check
        completed_payments = (
            self.db.query(Payment)
            .filter(
                Payment.check_id == check.id,
                Payment.status == PaymentStatus.COMPLETED,
                Payment.is_refund == False,
            )
            .all()
        )
        total_paid = sum((p.amount for p in completed_payments), Decimal("0.00")) + payment.amount
        
        if total_paid >= check.total_amount and check.status == CheckStatus.CREATED:
            check.status = CheckStatus.PAID
            check.paid_at = datetime.now(timezone.utc)
            log_action(
                "check_fully_paid",
                f"Check {check.check_number} marked as PAID after payment {payment.payment_number}",
                user_id=current_user.id,
                entity="check",
                entity_id=check.id,
            )
        
        self.db.commit()
        self.db.refresh(payment)
        
        log_action(
            "payment_completed",
            f"Payment completed: {payment.payment_number}",
            user_id=current_user.id,
            entity="payment",
            entity_id=payment.id,
        )
        return payment

    def update_status(
        self,
        payment_id: int,
        data: PaymentUpdateStatus,
        current_user: User,
    ) -> Payment:
        payment = self.db.get(Payment, payment_id)
        if not payment:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
        
        try:
            new_status = PaymentStatus(data.status)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status. Allowed: {[s.value for s in PaymentStatus]}",
            )
        
        old_status = payment.status
        payment.status = new_status
        
        if data.external_id is not None:
            payment.external_id = data.external_id
        if data.external_status is not None:
            payment.external_status = data.external_status
        if data.error_message is not None:
            payment.error_message = data.error_message
        
        if new_status == PaymentStatus.COMPLETED:
            payment.completed_at = datetime.now(timezone.utc)
            # Re-use complete logic for check update
            self.complete_payment(payment_id, current_user, data.external_id, data.external_status)
            return payment
        
        self.db.commit()
        self.db.refresh(payment)
        
        log_action(
            "payment_status_updated",
            f"Payment {payment.payment_number}: {old_status.value} → {new_status.value}",
            user_id=current_user.id,
            entity="payment",
            entity_id=payment.id,
        )
        return payment

    def get_payment(self, payment_id: int, current_user: User) -> Payment:
        payment = self.db.get(Payment, payment_id)
        if not payment:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
        return payment

    def list_payments(
        self,
        current_user: User,
        check_id: Optional[int] = None,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> List[Payment]:
        query = self.db.query(Payment)
        if check_id:
            query = query.filter(Payment.check_id == check_id)
        if status:
            try:
                st = PaymentStatus(status)
                query = query.filter(Payment.status == st)
            except ValueError:
                pass
        return query.order_by(Payment.created_at.desc()).offset(skip).limit(limit).all()
