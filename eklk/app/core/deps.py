"""
Auth depends on EcomKassa credentials — no local users.
Session stores password + firm profile (memory or Redis) for subsequent API calls.
"""

from __future__ import annotations

from typing import Annotated, Optional, Any
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.security import decode_access_token
from app.services.session_store import get_session_store

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


def save_session(
    login: str,
    password: str,
    group_code: str = "990",
    firm: Optional[dict] = None,
    ecom_token: Optional[str] = None,
) -> None:
    get_session_store().save(login, password, group_code=group_code, firm=firm, ecom_token=ecom_token)


def update_session_store(login: str, store_id: str | int) -> None:
    get_session_store().update_store(login, store_id)


def get_session(login: str) -> Optional[dict[str, Any]]:
    return get_session_store().get(login)


def clear_session(login: str) -> None:
    get_session_store().clear(login)


def update_session_fields(login: str, **fields: Any) -> None:
    get_session_store().update_fields(login, **fields)


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
        "group_code": str(session.get("group_code", "990")),
        "selected_store_id": session.get("selected_store_id"),
        "firm": session.get("firm"),
        "ecom_token": session.get("ecom_token"),
    }


CurrentUser = Annotated[dict, Depends(get_current_user)]
