"""
Auth depends on EcomKassa credentials — no local users.
Session stores password in memory for subsequent API calls.
"""

from __future__ import annotations

from typing import Annotated, Optional, Any
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

# login -> {password, group_code}
# In-memory; for multi-worker deploy use Redis later.
SESSIONS: dict[str, dict[str, Any]] = {}


def save_session(login: str, password: str, group_code: str = "990") -> None:
    SESSIONS[login] = {
        "login": login,
        "password": password,
        "group_code": group_code,
    }


def get_session(login: str) -> Optional[dict[str, Any]]:
    return SESSIONS.get(login)


def clear_session(login: str) -> None:
    SESSIONS.pop(login, None)


async def get_current_user(token: Annotated[Optional[str], Depends(oauth2_scheme)]) -> dict:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Не авторизован",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Сессия истекла. Войдите снова.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    login = payload.get("username") or payload.get("sub")
    if not login:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный токен")

    session = get_session(str(login))
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Сессия истекла. Войдите снова.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "id": login,
        "username": login,
        "email": login,
        "full_name": login,
        "role": "operator",
        "password": session["password"],
        "group_code": session.get("group_code", "990"),
    }


CurrentUser = Annotated[dict, Depends(get_current_user)]
