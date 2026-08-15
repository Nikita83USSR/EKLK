"""
EKLK Configuration
Centralized settings for reliability and security.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = Field(default="EKLK", description="Application name")
    app_version: str = Field(default="1.0.0")
    debug: bool = Field(default=True)
    environment: str = Field(default="development")

    # Security
    secret_key: str = Field(
        default="dev-secret-key-change-in-production-must-be-long-and-random-32+",
        min_length=32,
    )
    access_token_expire_minutes: int = Field(default=60)
    algorithm: str = Field(default="HS256")

    # Database
    database_url: str = Field(default="sqlite:////tmp/eklk.db")

    # Logging
    log_level: str = Field(default="DEBUG")
    log_format: str = Field(default="detailed")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
