from typing import Annotated, Optional
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer

from app.core.security import decode_access_token
from app.core.config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

# Simple in-memory users for ЛК (demo). In production → DB.
DEMO_USERS = {
    "admin": {
        "id": 1,
        "username": "admin",
        "password": "admin123",  # plain for demo; hash in real use
        "email": "admin@eklk.local",
        "full_name": "Администратор EKLK",
        "role": "admin",
    },
    "operator": {
        "id": 2,
        "username": "operator",
        "password": "operator123",
        "email": "operator@eklk.local",
        "full_name": "Оператор",
        "role": "operator",
    },
}


def get_user_by_username(username: str) -> Optional[dict]:
    return DEMO_USERS.get(username)


async def get_current_user(token: Annotated[Optional[str], Depends(oauth2_scheme)]) -> dict:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    username = payload.get("username") or payload.get("sub")
    user = get_user_by_username(str(username)) if not str(username).isdigit() else None
    if not user:
        # fallback by id
        for u in DEMO_USERS.values():
            if str(u["id"]) == str(payload.get("sub")):
                user = u
                break
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


CurrentUser = Annotated[dict, Depends(get_current_user)]
