from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "EKLK"
    app_version: str = "1.0.0"
    debug: bool = True
    secret_key: str = Field(default="dev-secret-change-in-production-min-32-chars!!")
    access_token_expire_minutes: int = 480
    algorithm: str = "HS256"

    ecomkassa_base_url: str = "https://app.ecomkassa.ru"
    ecomkassa_login: str = "sales@ecomkassa.ru"
    ecomkassa_password: str = "ecomkassa1"
    ecomkassa_group_code: str = "990"
    ecomkassa_api_version: str = "v5"

    database_url: str = "sqlite+aiosqlite:///./eklk.db"
    log_level: str = "DEBUG"

    # ИИ-кассир (iikassa.ru) — partner-embed
    iikassa_embed_url: str = "https://functions.poehali.dev/10219b97-9c66-4c02-b8a3-939f2d6e06c6"
    iikassa_partner_id: str = "widget"  # как в официальном widget.js (opts.partnerId || "widget")
    # Секрет для action=issue (логин/пароль кассы). Выдаёт владелец проекта ИИ-кассира.
    # Без секрета используется action=issue_from_token (токен EcomKassa).
    iikassa_partner_secret: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
