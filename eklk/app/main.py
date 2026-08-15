"""
EKLK — Electronic Check & Payment System
Main application entry point.

Business product focused on reliability of:
- Authorization
- Check (чек) creation
- Payment creation
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from app.core.config import settings
from app.database import init_db
from app.utils.logger import logger, log_action
from app.routers import auth, checks, payments


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup / shutdown lifecycle."""
    logger.info("=" * 60)
    logger.info(f"Starting {settings.app_name} v{settings.app_version}")
    logger.info(f"Environment: {settings.environment} | Debug: {settings.debug}")
    logger.info("=" * 60)
    
    init_db()
    log_action("startup", f"{settings.app_name} started successfully", entity="app")
    
    yield
    
    log_action("shutdown", f"{settings.app_name} shutting down", entity="app")
    logger.info("Application stopped")


app = FastAPI(
    title=settings.app_name,
    description=(
        "EKLK — надёжная система электронных чеков и платежей.\n\n"
        "Основные возможности:\n"
        "- **Авторизация** (JWT, роли: admin / cashier / manager)\n"
        "- **Создание чеков** с позициями, НДС, фискальными атрибутами\n"
        "- **Создание платежей** с привязкой к чеку и автоматическим обновлением статуса\n\n"
        "Все критические операции логируются в консоль для удобной отладки."
    ),
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# CORS — for frontend integration later
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.debug else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning(
        f"Validation error on {request.method} {request.url.path}: {exc.errors()}",
        extra={"action": "validation_error"},
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors(), "body": exc.body},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(
        f"Unhandled exception on {request.method} {request.url.path}: {exc}",
        extra={"action": "unhandled_error"},
        exc_info=True,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error. Check logs for details."},
    )


# Include routers
app.include_router(auth.router, prefix="/api/v1")
app.include_router(checks.router, prefix="/api/v1")
app.include_router(payments.router, prefix="/api/v1")


@app.get("/", tags=["Health"])
def root():
    return {
        "service": settings.app_name,
        "version": settings.app_version,
        "status": "ok",
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
def health():
    return {"status": "healthy"}
