from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import OAuth2PasswordRequestForm

from app.core.config import settings
from app.core.security import create_access_token
from app.core.deps import get_user_by_username, CurrentUser, DEMO_USERS
from app.schemas.auth import LoginRequest, TokenResponse, UserOut
from app.utils.logger import log_action

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest):
    user = get_user_by_username(data.username)
    if not user or user["password"] != data.password:
        log_action("login_failed", f"Failed login: {data.username}", level="warning")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный логин или пароль")
    token = create_access_token(user["id"], extra={"username": user["username"], "role": user["role"]})
    log_action("login_success", f"User {user['username']} logged in", user_id=user["id"])
    return TokenResponse(access_token=token, expires_in=settings.access_token_expire_minutes * 60)


@router.post("/login/form", response_model=TokenResponse)
async def login_form(form: OAuth2PasswordRequestForm = Depends()):
    return await login(LoginRequest(username=form.username, password=form.password))


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser):
    return UserOut(
        id=user["id"],
        username=user["username"],
        email=user.get("email"),
        full_name=user.get("full_name"),
        role=user.get("role", "operator"),
    )
