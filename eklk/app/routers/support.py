"""Remote support: presence, admin online list, connect approval."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db import get_db
from app.schemas.support import (
    AgentOut,
    ConnectIn,
    ConnectOut,
    PresenceIn,
    PublicConfigOut,
    RespondIn,
)
from app.services import support_service as svc
from app.utils.logger import log_action

logger = logging.getLogger("eklk.support.router")
router = APIRouter(prefix="/support", tags=["Support"])


@router.get("/config", response_model=PublicConfigOut)
async def support_config(user: CurrentUser):
    return PublicConfigOut(**svc.public_config())


@router.get("/me")
async def support_me(user: CurrentUser):
    login = str(user["username"])
    return {
        "is_admin": svc.is_support_admin(login),
        "login": login,
    }


@router.post("/presence")
async def presence(body: PresenceIn, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    try:
        row = await svc.upsert_presence(
            db,
            user=user,
            agent_id=body.agent_id,
            platform=body.platform,
            status=body.status,
        )
    except Exception as e:
        logger.error("presence failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Не удалось обновить статус помощника")
    log_action("support_presence", f"agent={row.agent_id} inn={row.inn}", user_id=user["username"])
    return {
        "ok": True,
        "agent_id": row.agent_id,
        "inn": row.inn,
        "firm_name": row.firm_name,
        "status": row.status,
    }


@router.post("/presence/offline")
async def presence_offline(body: PresenceIn, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    await svc.mark_offline(db, body.agent_id, str(user["username"]))
    return {"ok": True}


@router.get("/online", response_model=list[AgentOut])
async def online_agents(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    if not svc.is_support_admin(str(user["username"])):
        raise HTTPException(status_code=403, detail="Только для администратора поддержки")
    rows = await svc.list_online(db)
    return [AgentOut(**r) for r in rows]


@router.post("/connect", response_model=ConnectOut)
async def connect(body: ConnectIn, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    if not svc.is_support_admin(str(user["username"])):
        raise HTTPException(status_code=403, detail="Только для администратора поддержки")
    try:
        data = await svc.create_connect(db, admin_login=str(user["username"]), agent_id=body.agent_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    log_action(
        "support_connect",
        f"agent={body.agent_id} session={data['session_id']}",
        user_id=user["username"],
    )
    return ConnectOut(**data)


@router.get("/pending")
async def pending(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Клиент: есть ли входящий запрос на подключение."""
    data = await svc.pending_for_client(db, str(user["username"]))
    return {"pending": data}


@router.post("/session/{session_id}/respond")
async def respond(
    session_id: str,
    body: RespondIn,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    try:
        sess = await svc.respond_session(
            db, session_id=session_id, login=str(user["username"]), allow=body.allow
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    log_action(
        "support_respond",
        f"session={session_id} allow={body.allow}",
        user_id=user["username"],
    )
    return {"ok": True, "status": sess.status, "agent_id": sess.agent_id}


@router.post("/session/{session_id}/end")
async def end_session(session_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    login = str(user["username"])
    as_admin = svc.is_support_admin(login)
    try:
        await svc.end_session(db, session_id, login, as_admin=as_admin)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    return {"ok": True}
