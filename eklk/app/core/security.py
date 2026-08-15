"""
EKLK Security Module
Password hashing and JWT token management.
Critical for authorization reliability.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.utils.logger import logger, log_action

# Password hashing context (bcrypt)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against its hash."""
    try:
        result = pwd_context.verify(plain_password, hashed_password)
        return result
    except Exception as e:
        logger.error(f"Password verification error: {e}", extra={"action": "auth_error"})
        return False


def get_password_hash(password: str) -> str:
    """Hash a password using bcrypt."""
    return pwd_context.hash(password)


def create_access_token(
    subject: str | int,
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[dict[str, Any]] = None,
) -> str:
    """
    Create a JWT access token.
    Subject is typically the user ID.
    """
    if expires_delta is None:
        expires_delta = timedelta(minutes=settings.access_token_expire_minutes)
    
    expire = datetime.now(timezone.utc) + expires_delta
    to_encode: dict[str, Any] = {
        "sub": str(subject),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "access",
    }
    if extra_claims:
        to_encode.update(extra_claims)
    
    encoded_jwt = jwt.encode(
        to_encode,
        settings.secret_key,
        algorithm=settings.algorithm,
    )
    
    log_action(
        action="token_created",
        message=f"Access token created for subject={subject}",
        level="debug",
        user_id=int(subject) if str(subject).isdigit() else None,
        entity="token",
    )
    return encoded_jwt


def decode_access_token(token: str) -> Optional[dict[str, Any]]:
    """
    Decode and validate JWT access token.
    Returns payload or None if invalid.
    """
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.algorithm],
        )
        if payload.get("type") != "access":
            logger.warning("Token has invalid type", extra={"action": "auth_error"})
            return None
        return payload
    except JWTError as e:
        logger.warning(f"JWT decode error: {e}", extra={"action": "auth_error"})
        return None
    except Exception as e:
        logger.error(f"Unexpected token decode error: {e}", extra={"action": "auth_error"})
        return None
