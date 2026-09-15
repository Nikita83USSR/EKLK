"""
Login via EcomKassa credentials only — no local users.
After login loads firm profile (organization + stores).

Long-lived browser session: httpOnly cookie eklk_sid + short access JWT.
Silent renew: POST /auth/refresh (cookie only).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status, Depends, Request, Response
from fastapi.security import OAuth2PasswordRequestForm

from app.core.config import settings
from app.core.security import create_access_token
from app.core.deps import (
    CurrentUser,
    save_session,
    clear_session,
    clear_sid,
    get_session,
    get_login_by_sid,
    touch_session,
    update_session_store,
    update_session_fields,
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
from app.services.session_store import default_session_ttl_seconds
from app.utils.logger import log_action
from app.core.rate_limit import allow as rate_allow, client_ip
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/auth", tags=["Auth"])


def _cookie_max_age(remember: bool) -> int:
    return default_session_ttl_seconds(remember)


def _set_session_cookie(response: Response, session_id: str, remember: bool) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=session_id,
        max_age=_cookie_max_age(remember),
        httponly=True,
        secure=bool(settings.session_cookie_secure),
        samesite=settings.session_cookie_samesite or "lax",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=bool(settings.session_cookie_secure),
        samesite=settings.session_cookie_samesite or "lax",
    )


def _sid_from_request(request: Request) -> str | None:
    return request.cookies.get(settings.session_cookie_name)


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, request: Request, response: Response):
    """
    Логин = учётная запись EcomKassa (email + пароль).
    Проверяем через getToken; затем загружаем профиль фирмы и магазины.
    remember=true → долгая httpOnly cookie eklk_sid (sliding via /auth/refresh).
    """
    ip = client_ip(request)
    if not rate_allow(f"login:{ip}", settings.rate_limit_login_per_minute, 60):
        log_action("rate_limit", f"login blocked ip={ip}", level="warning")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много попыток входа. Подождите минуту.",
        )

    login_name = data.username  # do not lower — EcomKassa logins are case-sensitive
    password = data.password
    remember = bool(data.remember)

    client = EcomKassaClient(login=login_name, password=password)
    firm_payload = None
    ecom_token = None
    try:
        ecom_token = await client.get_token(force=True)
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
        log_action("login_failed", f"EcomKassa auth failed: {e}", level="warning", user_id=login_name)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль EcomKassa",
        )
    finally:
        await client.close()

    stores = (firm_payload or {}).get("stores") or []
    default_store = stores[0].get("storeId") if stores else settings.ecomkassa_group_code
    group_code = str(default_store)

    sid = save_session(
        login_name,
        password,
        group_code=group_code,
        firm=firm_payload,
        ecom_token=ecom_token,
        remember=remember,
    )
    _set_session_cookie(response, sid, remember)

    token = create_access_token(login_name, extra={"username": login_name, "role": "operator"})
    firm_out = firm_from_payload(firm_payload)
    log_action(
        "login_success",
        f"EcomKassa user logged in: {login_name}, stores={len(stores)}, remember={remember}",
        user_id=login_name,
    )
    return TokenResponse(
        access_token=token,
        expires_in=settings.access_token_expire_minutes * 60,
        firm=firm_out,
        selected_store_id=default_store,
    )


@router.post("/login/form", response_model=TokenResponse)
async def login_form(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
):
    remember = False
    # optional form field
    try:
        form_data = await request.form()
        remember = str(form_data.get("remember") or "").lower() in ("1", "true", "yes", "on")
    except Exception:
        pass
    return await login(
        LoginRequest(username=form.username, password=form.password, remember=remember),
        request,
        response,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, response: Response):
    """
    Silent access JWT renew using httpOnly session cookie.
    Re-validates EcomKassa credentials via getToken; on failure clears session (password change).
    """
    sid = _sid_from_request(request)
    if not sid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Нет сессии",
            headers={"WWW-Authenticate": "Bearer"},
        )

    login_name = get_login_by_sid(sid)
    if not login_name:
        _clear_session_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Сессия истекла. Войдите снова.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    session = get_session(login_name)
    if not session or session.get("session_id") != sid:
        clear_sid(sid)
        _clear_session_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Сессия истекла. Войдите снова.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    password = session.get("password")
    group_code = str(session.get("group_code") or "990")
    remember = bool(session.get("remember"))

    client = EcomKassaClient(login=login_name, password=password, group_code=group_code)
    try:
        ecom_token = await client.get_token(force=True)
    except EcomKassaError as e:
        # Password changed in EcomKassa or account disabled
        log_action(
            "refresh_reauth",
            f"EcomKassa auth failed on refresh: {e}",
            level="warning",
            user_id=login_name,
        )
        clear_session(login_name)
        _clear_session_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Требуется повторный вход (пароль изменён или сессия недействительна)",
            headers={"WWW-Authenticate": "Bearer"},
        )
    finally:
        await client.close()

    update_session_fields(login_name, ecom_token=ecom_token)
    touch_session(login_name, session_id=sid)
    _set_session_cookie(response, sid, remember)

    token = create_access_token(login_name, extra={"username": login_name, "role": "operator"})
    firm_out = firm_from_payload(session.get("firm"))
    log_action("token_refresh", f"access renewed remember={remember}", user_id=login_name, level="debug")
    return TokenResponse(
        access_token=token,
        expires_in=settings.access_token_expire_minutes * 60,
        firm=firm_out,
        selected_store_id=session.get("selected_store_id"),
    )


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
            remember=bool(user.get("remember")),
            session_id=user.get("session_id"),
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
    """Запомнить выбранный магазин в сессии и в firm_settings (БД)."""
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
    try:
        await settings_svc.patch_user(
            db, str(user["username"]), {"selected_store_id": store_id}
        )
    except Exception:
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


@router.get("/ecom-token")
async def ecom_token(user: CurrentUser):
    """
    Токен API EcomKassa (getToken) для встраиваемых партнёрских виджетов
    (например ИИ-кассир). Не путать с JWT EKLK.
    """
    client = EcomKassaClient(
        login=user["username"],
        password=user["password"],
        group_code=user.get("group_code") or "990",
    )
    try:
        tok = await client.get_token(force=True)
        return {"token": tok}
    except EcomKassaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@router.post("/logout")
async def logout(request: Request, response: Response):
    """
    Clear server session and session cookie.
    Uses Bearer if valid; otherwise session cookie. Always clears cookie.
    """
    from app.core.security import decode_access_token
    from fastapi.security.utils import get_authorization_scheme_param

    login_name = None
    auth = request.headers.get("Authorization")
    if auth:
        scheme, token = get_authorization_scheme_param(auth)
        if scheme.lower() == "bearer" and token:
            payload = decode_access_token(token)
            if payload:
                login_name = payload.get("username") or payload.get("sub")

    sid = _sid_from_request(request)
    if not login_name and sid:
        login_name = get_login_by_sid(sid)

    if login_name:
        clear_session(str(login_name))
        log_action("logout", f"User logged out: {login_name}", user_id=login_name)
    elif sid:
        clear_sid(sid)

    _clear_session_cookie(response)
    return {"ok": True}
