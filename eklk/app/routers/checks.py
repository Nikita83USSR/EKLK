"""
Checks Router
/api/v1/checks/*
Core business endpoint for creating and managing чеки.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.core.deps import CurrentUser
from app.schemas.check import CheckCreate, CheckUpdateStatus, CheckOut, CheckListOut
from app.services.check_service import CheckService

router = APIRouter(prefix="/checks", tags=["Checks (Чеки)"])


@router.post(
    "",
    response_model=CheckOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create new check",
)
def create_check(
    data: CheckCreate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    """
    Create a fiscal-like check with items.
    Automatically calculates totals and VAT.
    Status starts as 'created'.
    """
    service = CheckService(db)
    check = service.create_check(data, current_user)
    return check


@router.get(
    "",
    response_model=List[CheckListOut],
    summary="List checks",
)
def list_checks(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    status: Optional[str] = Query(None, description="Filter by status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List checks with optional status filter. Newest first."""
    service = CheckService(db)
    return service.list_checks(current_user, status=status, skip=skip, limit=limit)


@router.get(
    "/{check_id}",
    response_model=CheckOut,
    summary="Get check by ID",
)
def get_check(
    check_id: int,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    """Get full check details including items."""
    service = CheckService(db)
    return service.get_check(check_id, current_user)


@router.patch(
    "/{check_id}/status",
    response_model=CheckOut,
    summary="Update check status",
)
def update_check_status(
    check_id: int,
    data: CheckUpdateStatus,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    """
    Transition check status with business rules:
    created → paid | cancelled
    paid → refunded
    """
    service = CheckService(db)
    return service.update_status(check_id, data, current_user)
