"""
Login via EcomKassa credentials only — no local users.
After login loads firm profile (organization + stores).
"""

from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import OAuth2PasswordRequestForm

from app.core.config import settings
from app.core.security import create_access_token
from app.core.deps import (
    CurrentUser,
    save_session,
    clear_session,
    update_session_store,
)
from app.clients.ecomkassa import EcomKassaClient, EcomKassaError
from app.db import get_db
from app.schemas.auth import (
    LoginRequest,
    TokenResponse,
    UserOut,
    FirmOut,
    SelectStoreRequest,
    firm_from_payload,
)
from app.services import settings_service as settings_svc
from app.utils.logger import log_action
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest):
    """
    Логин = учётная запись EcomKassa (email + пароль).
    Проверяем через getToken; затем загружаем профиль фирмы и магазины.
    """
    # Регистр логина сохраняем — EcomKassa чувствителен к case (не .lower())
    login_name = data.username.strip()
    password = data.password

    client = EcomKassaClient(login=login_name, password=password)
    firm_payload = None
    try:
        await client.get_token(force=True)
        try:
            firm_payload = await client.get_firm_profile()
        except EcomKassaError as e:
            log_action(
                "firm_profile_warn",
                f"Could not load firm profile: {e}",
                level="warning",
                user_id=login_name,
            )
            firm_payload = None
    except EcomKassaError as e:
        log_action("login_failed", f"EcomKassa auth failed: {login_name} — {e}", level="warning")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль EcomKassa",
        )
    finally:
        await client.close()

    stores = (firm_payload or {}).get("stores") or []
    default_store = stores[0].get("storeId") if stores else settings.ecomkassa_group_code
    group_code = str(default_store)

    save_session(login_name, password, group_code=group_code, firm=firm_payload)
    token = create_access_token(login_name, extra={"username": login_name, "role": "operator"})
    firm_out = firm_from_payload(firm_payload)
    log_action(
        "login_success",
        f"EcomKassa user logged in: {login_name}, stores={len(stores)}",
        user_id=login_name,
    )
    return TokenResponse(
        access_token=token,
        expires_in=settings.access_token_expire_minutes * 60,
        firm=firm_out,
        selected_store_id=default_store,
    )


@router.post("/login/form", response_model=TokenResponse)
async def login_form(form: OAuth2PasswordRequestForm = Depends()):
    return await login(LoginRequest(username=form.username, password=form.password))


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser):
    firm_out = firm_from_payload(user.get("firm"))
    return UserOut(
        id=0,
        username=user["username"],
        email=user.get("email"),
        full_name=user.get("full_name"),
        role=user.get("role", "operator"),
        firm=firm_out,
        selected_store_id=user.get("selected_store_id"),
    )


@router.get("/firm", response_model=FirmOut)
async def get_firm(user: CurrentUser):
    """Профиль организации и список магазинов (из сессии или повторный запрос)."""
    firm = user.get("firm")
    if firm:
        out = firm_from_payload(firm)
        if out:
            return out

    client = EcomKassaClient(
        login=user["username"],
        password=user["password"],
        group_code=user.get("group_code") or "990",
    )
    try:
        payload = await client.get_firm_profile()
        save_session(
            user["username"],
            user["password"],
            group_code=user.get("group_code") or "990",
            firm=payload,
        )
        return firm_from_payload(payload) or FirmOut()
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@router.post("/select-store")
async def select_store(
    body: SelectStoreRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Запомнить выбранный магазин в RAM-сессии и в firm_settings (БД)."""
    firm = user.get("firm") or {}
    stores = firm.get("stores") or []
    store_id = body.store_id
    match = None
    for s in stores:
        if str(s.get("storeId")) == str(store_id):
            match = s
            break
    if stores and not match:
        raise HTTPException(
            status_code=400,
            detail=f"Магазин storeId={store_id} не найден в профиле фирмы",
        )
    update_session_store(user["username"], store_id)
    firm_id = settings_svc.firm_id_from_user(user)
    if firm_id:
        try:
            await settings_svc.patch_firm(db, firm_id, {"selected_store_id": store_id})
        except Exception:
            # Prefs are best-effort; session already updated
            pass
    log_action(
        "store_selected",
        f"store_id={store_id}",
        user_id=user["username"],
    )
    return {
        "ok": True,
        "store_id": store_id,
        "store_name": (match or {}).get("storeName"),
        "group_code": str(store_id),
    }


@router.post("/logout")
async def logout(user: CurrentUser):
    clear_session(user["username"])
    log_action("logout", f"User logged out: {user['username']}", user_id=user["username"])
    return {"ok": True}
