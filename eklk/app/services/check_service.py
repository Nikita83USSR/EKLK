"""
Check Service
Business logic for creating and managing checks (чеки).
Critical path — must be reliable and transactional.
"""

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional

from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.models.check import Check, CheckItem, CheckStatus, CheckType
from app.models.user import User
from app.schemas.check import CheckCreate, CheckUpdateStatus
from app.utils.logger import log_action


class CheckService:
    def __init__(self, db: Session):
        self.db = db

    def _calculate_item_amounts(self, item_data) -> tuple[Decimal, Decimal]:
        """Calculate amount and VAT for a single item."""
        quantity = Decimal(str(item_data.quantity))
        price = Decimal(str(item_data.price))
        vat_rate = Decimal(str(item_data.vat_rate))
        
        amount = (quantity * price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        # VAT included in price (common in RU)
        vat_amount = (amount * vat_rate / (Decimal("100") + vat_rate)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        return amount, vat_amount

    def create_check(self, data: CheckCreate, current_user: User) -> Check:
        """
        Create a new check with items.
        Calculates totals, creates fiscal-like number, sets status to CREATED.
        Transactional.
        """
        try:
            check_type = CheckType(data.check_type)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid check_type. Allowed: {[t.value for t in CheckType]}",
            )
        
        if not data.items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Check must contain at least one item",
            )
        
        total_amount = Decimal("0.00")
        total_vat = Decimal("0.00")
        items_to_create: list[CheckItem] = []
        
        for item_data in data.items:
            amount, vat_amount = self._calculate_item_amounts(item_data)
            total_amount += amount
            total_vat += vat_amount
            
            items_to_create.append(
                CheckItem(
                    name=item_data.name.strip(),
                    quantity=Decimal(str(item_data.quantity)),
                    price=Decimal(str(item_data.price)),
                    amount=amount,
                    vat_rate=Decimal(str(item_data.vat_rate)),
                    vat_amount=vat_amount,
                    product_code=item_data.product_code,
                    unit=item_data.unit or "шт",
                )
            )
        
        discount = Decimal(str(data.discount_amount or 0))
        if discount > total_amount:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Discount cannot exceed total amount",
            )
        
        final_total = (total_amount - discount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        
        check = Check(
            check_type=check_type,
            status=CheckStatus.CREATED,
            total_amount=final_total,
            vat_amount=total_vat,
            discount_amount=discount,
            customer_email=data.customer_email,
            customer_phone=data.customer_phone,
            customer_name=data.customer_name,
            comment=data.comment,
            created_by=current_user.id,
            fiscal_sign=f"FS{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
            fiscal_document_number=None,
        )
        
        self.db.add(check)
        self.db.flush()
        
        for item in items_to_create:
            item.check_id = check.id
            self.db.add(item)
        
        self.db.commit()
        self.db.refresh(check)
        
        log_action(
            "check_created",
            f"Check created: {check.check_number}, total={check.total_amount}",
            user_id=current_user.id,
            entity="check",
            entity_id=check.id,
        )
        return check

    def get_check(self, check_id: int, current_user: User) -> Check:
        check = self.db.get(Check, check_id)
        if not check or check.is_archived:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Check not found")
        return check

    def list_checks(
        self,
        current_user: User,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> List[Check]:
        query = self.db.query(Check).filter(Check.is_archived == False)
        if status:
            try:
                st = CheckStatus(status)
                query = query.filter(Check.status == st)
            except ValueError:
                pass
        return query.order_by(Check.created_at.desc()).offset(skip).limit(limit).all()

    def update_status(
        self,
        check_id: int,
        data: CheckUpdateStatus,
        current_user: User,
    ) -> Check:
        check = self.get_check(check_id, current_user)
        
        try:
            new_status = CheckStatus(data.status)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status. Allowed: {[s.value for s in CheckStatus]}",
            )
        
        old_status = check.status
        
        allowed_transitions = {
            CheckStatus.DRAFT: {CheckStatus.CREATED, CheckStatus.CANCELLED},
            CheckStatus.CREATED: {CheckStatus.PAID, CheckStatus.CANCELLED},
            CheckStatus.PAID: {CheckStatus.REFUNDED},
            CheckStatus.CANCELLED: set(),
            CheckStatus.REFUNDED: set(),
        }
        
        if new_status not in allowed_transitions.get(old_status, set()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot transition from {old_status.value} to {new_status.value}",
            )
        
        check.status = new_status
        if data.comment:
            check.comment = (check.comment or "") + f"\n[Status change] {data.comment}"
        
        now = datetime.now(timezone.utc)
        if new_status == CheckStatus.PAID:
            check.paid_at = now
        elif new_status == CheckStatus.CANCELLED:
            check.cancelled_at = now
        
        self.db.commit()
        self.db.refresh(check)
        
        log_action(
            "check_status_updated",
            f"Check {check.check_number}: {old_status.value} → {new_status.value}",
            user_id=current_user.id,
            entity="check",
            entity_id=check.id,
        )
        return check
