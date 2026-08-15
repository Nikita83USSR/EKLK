"""
Login via EcomKassa credentials only — no local users.
"""

from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import OAuth2PasswordRequestForm

from app.core.config import settings
from app.core.security import create_access_token
from app.core.deps import CurrentUser, save_session, clear_session
from app.clients.ecomkassa import EcomKassaClient, EcomKassaError
from app.schemas.auth import LoginRequest, TokenResponse, UserOut
from app.utils.logger import log_action

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest):
    """
    Логин = учётная запись EcomKassa (email + пароль).
    Проверяем через getToken; при успехе выдаём JWT ЛК.
    """
    login = data.username.strip()
    password = data.password
    group_code = data.group_code or settings.ecomkassa_group_code

    client = EcomKassaClient(
        login=login,
        password=password,
        group_code=group_code,
    )
    try:
        await client.get_token(force=True)
    except EcomKassaError as e:
        log_action("login_failed", f"EcomKassa auth failed: {login} — {e}", level="warning")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль EcomKassa",
        )
    finally:
        await client.close()

    save_session(login, password, group_code=group_code)
    token = create_access_token(login, extra={"username": login, "role": "operator"})
    log_action("login_success", f"EcomKassa user logged in: {login}", user_id=login)
    return TokenResponse(
        access_token=token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


@router.post("/login/form", response_model=TokenResponse)
async def login_form(form: OAuth2PasswordRequestForm = Depends()):
    return await login(LoginRequest(username=form.username, password=form.password))


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser):
    return UserOut(
        id=0,
        username=user["username"],
        email=user.get("email"),
        full_name=user.get("full_name"),
        role=user.get("role", "operator"),
    )


@router.post("/logout")
async def logout(user: CurrentUser):
    clear_session(user["username"])
    log_action("logout", f"User logged out: {user['username']}", user_id=user["username"])
    return {"ok": True}
