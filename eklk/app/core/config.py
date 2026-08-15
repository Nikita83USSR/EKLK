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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
