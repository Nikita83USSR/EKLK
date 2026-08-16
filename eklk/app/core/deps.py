"""
Auth depends on EcomKassa credentials — no local users.
Session stores password + firm profile in memory for subsequent API calls.
"""

from __future__ import annotations

from typing import Annotated, Optional, Any
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

# login -> {password, group_code, firm, selected_store_id}
# In-memory; for multi-worker deploy use Redis later.
SESSIONS: dict[str, dict[str, Any]] = {}


def save_session(
    login: str,
    password: str,
    group_code: str = "990",
    firm: Optional[dict] = None,
) -> None:
    prev = SESSIONS.get(login) or {}
    selected = prev.get("selected_store_id")
    stores = (firm or {}).get("stores") or prev.get("firm", {}).get("stores") or []
    # keep previous selection if still valid
    if selected is not None:
        ids = {str(s.get("storeId")) for s in stores}
        if str(selected) not in ids:
            selected = None
    if selected is None and stores:
        selected = stores[0].get("storeId")
    if selected is not None:
        group_code = str(selected)
    SESSIONS[login] = {
        "login": login,
        "password": password,
        "group_code": str(group_code),
        "firm": firm or prev.get("firm"),
        "selected_store_id": selected if selected is not None else group_code,
    }


def update_session_store(login: str, store_id: str | int) -> None:
    session = SESSIONS.get(login)
    if not session:
        return
    session["selected_store_id"] = store_id
    session["group_code"] = str(store_id)


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
        "group_code": str(session.get("group_code", "990")),
        "selected_store_id": session.get("selected_store_id"),
        "firm": session.get("firm"),
    }


CurrentUser = Annotated[dict, Depends(get_current_user)]
