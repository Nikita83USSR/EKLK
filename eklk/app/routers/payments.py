"""
Payments Router
/api/v1/payments/*
Core business endpoint for creating and managing payments.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.core.deps import CurrentUser
from app.schemas.payment import PaymentCreate, PaymentUpdateStatus, PaymentOut, PaymentListOut
from app.services.payment_service import PaymentService

router = APIRouter(prefix="/payments", tags=["Payments (Платежи)"])


@router.post(
    "",
    response_model=PaymentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create new payment",
)
def create_payment(
    data: PaymentCreate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    """
    Create a payment linked to an existing check.
    Status starts as 'pending'.
    Use complete endpoint or status update to finalize.
    """
    service = PaymentService(db)
    return service.create_payment(data, current_user)


@router.post(
    "/{payment_id}/complete",
    response_model=PaymentOut,
    summary="Complete payment",
)
def complete_payment(
    payment_id: int,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    external_id: Optional[str] = None,
    external_status: Optional[str] = None,
):
    """
    Mark payment as completed.
    If the check becomes fully paid, its status is automatically set to 'paid'.
    """
    service = PaymentService(db)
    return service.complete_payment(payment_id, current_user, external_id, external_status)


@router.get(
    "",
    response_model=List[PaymentListOut],
    summary="List payments",
)
def list_payments(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    check_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List payments with optional filters."""
    service = PaymentService(db)
    return service.list_payments(
        current_user, check_id=check_id, status=status, skip=skip, limit=limit
    )


@router.get(
    "/{payment_id}",
    response_model=PaymentOut,
    summary="Get payment by ID",
)
def get_payment(
    payment_id: int,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    service = PaymentService(db)
    return service.get_payment(payment_id, current_user)


@router.patch(
    "/{payment_id}/status",
    response_model=PaymentOut,
    summary="Update payment status",
)
def update_payment_status(
    payment_id: int,
    data: PaymentUpdateStatus,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    """Update payment status (for external callbacks or manual ops)."""
    service = PaymentService(db)
    return service.update_status(payment_id, data, current_user)
