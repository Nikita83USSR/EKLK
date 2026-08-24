from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.utils.logger import logger, log_action
from app.routers import auth, ecom, orders, catalog, reports
from app.routers import templates as templates_router

BASE_DIR = Path(__file__).resolve().parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 60)
    logger.info(f"{settings.app_name} v{settings.app_version} starting")
    logger.info(f"API backend (фискальный шлюз EcomKassa): {settings.ecomkassa_base_url} | protocol={settings.ecomkassa_api_version} | default_group={settings.ecomkassa_group_code}")
    logger.info("=" * 60)
    log_action("startup", "Application started")
    yield
    log_action("shutdown", "Application stopped")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="EKLK — личный кабинет и API для работы с EcomKassa (чеки + платежи)",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(ecom.router, prefix="/api/v1")
app.include_router(orders.router, prefix="/api/v1")
app.include_router(templates_router.router, prefix="/api/v1")
app.include_router(catalog.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")

jinja_templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return jinja_templates.TemplateResponse("index.html", {"request": request, "app_name": settings.app_name})


# SPA-пути разделов ЛК (клиентский роутинг в app.js).
# В дальнейшем: query/path-параметры (uuid, order_id, фильтры списка и т.д.).
@app.get("/create", response_class=HTMLResponse)
@app.get("/payment", response_class=HTMLResponse)
@app.get("/templates", response_class=HTMLResponse)
@app.get("/orders", response_class=HTMLResponse)
@app.get("/settings", response_class=HTMLResponse)
@app.get("/catalog", response_class=HTMLResponse)
@app.get("/reports", response_class=HTMLResponse)
async def spa_section(request: Request):
    return jinja_templates.TemplateResponse("index.html", {"request": request, "app_name": settings.app_name})


@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.app_name, "version": settings.app_version}


@app.exception_handler(Exception)
async def global_exc(request: Request, exc: Exception):
    logger.error(f"Unhandled: {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
