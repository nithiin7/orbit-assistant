"""Centralized, environment-driven application configuration."""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError

Environment = Literal["development", "test", "production"]
LogLevel = Literal["critical", "error", "warning", "info", "debug"]
StorageMode = Literal["local", "cloud"]

LOCAL_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]

# Development default: `apps/api/.data/`, which is git-ignored and outside the web app.
DEFAULT_SQLITE_PATH = Path(__file__).resolve().parents[2] / ".data" / "orbit.sqlite3"

POSTGRES_DRIVER = "postgresql+asyncpg"
_POSTGRES_SCHEMES = {"postgres", "postgresql", POSTGRES_DRIVER}
_TLS_SSL_MODES = {"require", "verify-ca", "verify-full"}


class Settings(BaseSettings):
    """Settings read from `ORBIT_*` environment variables and an optional `.env` file."""

    model_config = SettingsConfigDict(
        env_prefix="ORBIT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # Validation errors must never echo the database URL, which contains a password.
        hide_input_in_errors=True,
    )

    env: Environment = "development"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    log_level: LogLevel = "info"
    cors_origins: list[str] = LOCAL_ORIGINS

    storage_mode: StorageMode = "local"
    sqlite_path: Path = DEFAULT_SQLITE_PATH
    database_url: SecretStr | None = None
    database_pool_size: int = Field(default=5, ge=1)
    database_max_overflow: int = Field(default=5, ge=0)

    @property
    def is_development(self) -> bool:
        return self.env == "development"

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def postgres_url(self) -> URL:
        """The validated asyncpg URL for cloud mode. Contains credentials; never log it."""
        if self.database_url is None:
            raise ValueError("ORBIT_DATABASE_URL is not configured.")
        return _parse_postgres_url(self.database_url.get_secret_value())

    @field_validator("sqlite_path")
    @classmethod
    def _resolve_sqlite_path(cls, path: Path) -> Path:
        return path.expanduser().resolve()

    @model_validator(mode="after")
    def _validate_production(self) -> Self:
        if self.is_production and "*" in self.cors_origins:
            raise ValueError("ORBIT_CORS_ORIGINS must list explicit origins in production.")
        return self

    @model_validator(mode="after")
    def _validate_storage(self) -> Self:
        if self.storage_mode == "local":
            # Refuse rather than ignore: a URL here suggests cloud storage was intended, and
            # silently using local storage would mislead the user about where data is saved.
            if self.database_url is not None:
                raise ValueError(
                    "ORBIT_DATABASE_URL is set but ORBIT_STORAGE_MODE is 'local'. "
                    "Set ORBIT_STORAGE_MODE=cloud, or unset ORBIT_DATABASE_URL."
                )
            if self.sqlite_path.is_dir():
                raise ValueError("ORBIT_SQLITE_PATH must be a file path, not a directory.")
            return self

        if self.database_url is None:
            raise ValueError("ORBIT_DATABASE_URL is required when ORBIT_STORAGE_MODE is 'cloud'.")
        url = self.postgres_url
        if self.is_production and url.query.get("ssl") not in _TLS_SSL_MODES:
            raise ValueError(
                "ORBIT_DATABASE_URL must require TLS in production "
                "(add ?ssl=require, verify-ca, or verify-full)."
            )
        return self


def _parse_postgres_url(raw: str) -> URL:
    """Parse a PostgreSQL connection string and select the asyncpg driver."""
    try:
        url = make_url(raw)
    except ArgumentError:
        raise ValueError("ORBIT_DATABASE_URL is not a valid database URL.") from None
    if url.drivername not in _POSTGRES_SCHEMES:
        raise ValueError(
            "ORBIT_DATABASE_URL must be a PostgreSQL URL (postgresql://...) in cloud mode."
        )
    if not url.host or not url.database:
        raise ValueError("ORBIT_DATABASE_URL must include a host and a database name.")
    return url.set(drivername=POSTGRES_DRIVER)


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings, loaded once."""
    return Settings()
