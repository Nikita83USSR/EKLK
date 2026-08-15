"""
Auth Service
Business logic for registration and login.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import or_
from fastapi import HTTPException, status

from app.models.user import User, UserRole
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.config import settings
from app.schemas.auth import RegisterRequest, LoginRequest, Token, UserResponse
from app.utils.logger import log_action


class AuthService:
    def __init__(self, db: Session):
        self.db = db

    def register(self, data: RegisterRequest) -> User:
        """Register a new user with validation."""
        # Check uniqueness
        existing = self.db.query(User).filter(
            or_(User.email == data.email, User.username == data.username)
        ).first()
        if existing:
            field = "email" if existing.email == data.email else "username"
            log_action(
                "register_failed",
                f"Duplicate {field}: {getattr(data, field)}",
                level="warning",
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"User with this {field} already exists",
            )
        
        # Validate role
        try:
            role = UserRole(data.role) if data.role else UserRole.CASHIER
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid role. Allowed: {[r.value for r in UserRole]}",
            )
        
        # Only allow admin creation carefully (in real system via invite or first user)
        if role == UserRole.ADMIN:
            admin_count = self.db.query(User).filter(User.role == UserRole.ADMIN).count()
            if admin_count > 0:
                # In production restrict this more strictly
                log_action("register_admin_attempt", "Admin registration attempt", level="warning")
        
        user = User(
            email=data.email.lower().strip(),
            username=data.username.strip(),
            hashed_password=get_password_hash(data.password),
            full_name=data.full_name.strip() if data.full_name else None,
            role=role,
            is_active=True,
            is_verified=False,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        
        log_action(
            "user_registered",
            f"New user registered: {user.username}",
            user_id=user.id,
            entity="user",
            entity_id=user.id,
        )
        return user

    def authenticate(self, data: LoginRequest) -> Token:
        """Authenticate user and return JWT."""
        user = self.db.query(User).filter(
            or_(
                User.username == data.username,
                User.email == data.username.lower(),
            )
        ).first()
        
        if not user or not verify_password(data.password, user.hashed_password):
            log_action(
                "login_failed",
                f"Failed login attempt for: {data.username}",
                level="warning",
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        if not user.is_active:
            log_action(
                "login_failed",
                f"Inactive user login attempt: {user.username}",
                level="warning",
                user_id=user.id,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is inactive",
            )
        
        # Update last login
        user.last_login_at = datetime.now(timezone.utc)
        self.db.commit()
        
        access_token = create_access_token(
            subject=user.id,
            extra_claims={"role": user.role.value, "username": user.username},
        )
        
        log_action(
            "login_success",
            f"User logged in: {user.username}",
            user_id=user.id,
            entity="user",
            entity_id=user.id,
        )
        
        return Token(
            access_token=access_token,
            token_type="bearer",
            expires_in=settings.access_token_expire_minutes * 60,
        )

    def get_user_response(self, user: User) -> UserResponse:
        return UserResponse(
            id=user.id,
            email=user.email,
            username=user.username,
            full_name=user.full_name,
            role=user.role.value,
            is_active=user.is_active,
            is_verified=user.is_verified,
            created_at=user.created_at.isoformat(),
            last_login_at=user.last_login_at.isoformat() if user.last_login_at else None,
        )
