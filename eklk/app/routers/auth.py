"""
Auth Router
/api/v1/auth/*
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.core.deps import CurrentUser
from app.schemas.auth import RegisterRequest, LoginRequest, Token, UserResponse
from app.services.auth_service import AuthService
from app.utils.logger import log_action

router = APIRouter(prefix="/auth", tags=["Authorization"])


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register new user",
)
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    """
    Register a new user.
    Roles: admin, cashier, manager.
    First admin can be created freely; subsequent ones logged.
    """
    service = AuthService(db)
    user = service.register(data)
    return service.get_user_response(user)


@router.post(
    "/login",
    response_model=Token,
    summary="Login and get JWT",
)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    """
    Authenticate by username or email + password.
    Returns Bearer access token.
    """
    service = AuthService(db)
    return service.authenticate(data)


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Get current user profile",
)
def get_me(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Return profile of the authenticated user."""
    service = AuthService(db)
    log_action("profile_viewed", "User viewed own profile", user_id=current_user.id)
    return service.get_user_response(current_user)
