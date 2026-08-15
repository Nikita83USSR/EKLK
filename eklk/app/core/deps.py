"""
FastAPI Dependencies
Authentication and authorization guards.
"""

from typing import Annotated, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.core.security import decode_access_token
from app.models.user import User, UserRole
from app.utils.logger import logger, log_action

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """
    Extract and validate current user from JWT.
    Raises 401 if invalid or inactive.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    payload = decode_access_token(token)
    if payload is None:
        log_action("auth_failed", "Invalid or expired token", level="warning")
        raise credentials_exception
    
    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_exception
    
    try:
        user_id_int = int(user_id)
    except (TypeError, ValueError):
        raise credentials_exception
    
    user = db.get(User, user_id_int)
    if user is None:
        log_action("auth_failed", f"User not found: id={user_id}", level="warning")
        raise credentials_exception
    
    if not user.is_active:
        log_action(
            "auth_failed",
            f"Inactive user attempted access: id={user.id}",
            level="warning",
            user_id=user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    
    return user


def get_current_active_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    return current_user


def require_roles(*roles: UserRole):
    """
    Dependency factory for role-based access control.
    """
    def role_checker(
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if current_user.role not in roles and current_user.role != UserRole.ADMIN:
            log_action(
                "auth_forbidden",
                f"Insufficient role: {current_user.role}, required={roles}",
                level="warning",
                user_id=current_user.id,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required roles: {[r.value for r in roles]}",
            )
        return current_user
    return role_checker


# Type aliases for cleaner signatures
CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]
