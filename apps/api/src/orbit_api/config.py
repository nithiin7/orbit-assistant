"""Centralized, environment-driven application configuration."""

from functools import lru_cache
from typing import Literal, Self

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "production"]
LogLevel = Literal["critical", "error", "warning", "info", "debug"]

LOCAL_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]


class Settings(BaseSettings):
    """Settings read from `ORBIT_*` environment variables and an optional `.env` file."""

    model_config = SettingsConfigDict(
        env_prefix="ORBIT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: Environment = "development"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    log_level: LogLevel = "info"
    cors_origins: list[str] = LOCAL_ORIGINS

    @property
    def is_development(self) -> bool:
        return self.env == "development"

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @model_validator(mode="after")
    def _validate_production(self) -> Self:
        if self.is_production and "*" in self.cors_origins:
            raise ValueError("ORBIT_CORS_ORIGINS must list explicit origins in production.")
        return self


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings, loaded once."""
    return Settings()
