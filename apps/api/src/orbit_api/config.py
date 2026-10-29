"""Centralized, environment-driven application configuration."""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator, model_validator
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

    # Cloud mode authenticates with Supabase Auth. Both values are public by design: the URL
    # locates the project's signing keys, and the publishable (anon) key is sent to browsers.
    supabase_url: AnyHttpUrl | None = None
    supabase_publishable_key: str | None = None

    # Local mode authenticates with accounts stored in the SQLite database.
    local_session_ttl_hours: int = Field(default=24 * 14, ge=1, le=24 * 90)
    # Several people can share one machine, each with their own private workspaces. Unset means
    # open outside production and first-account-only in production, where a reachable server
    # should not accept strangers by default.
    local_open_registration: bool | None = None

    # Reminders are delivered by a worker that polls the database. Unset runs one inside each
    # API process, except in tests, which drive the worker directly. `orbit-worker` runs it as a
    # separate process; any number of workers can safely share a database.
    scheduler_in_api: bool | None = None
    scheduler_poll_seconds: float = Field(default=15, ge=1, le=300)

    @property
    def is_development(self) -> bool:
        return self.env == "development"

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def local_registration_open(self) -> bool:
        """Whether local accounts beyond the first may register."""
        if self.local_open_registration is None:
            return not self.is_production
        return self.local_open_registration

    @property
    def scheduler_embedded(self) -> bool:
        """Whether the API process runs the reminder worker."""
        if self.scheduler_in_api is None:
            return self.env != "test"
        return self.scheduler_in_api

    @property
    def postgres_url(self) -> URL:
        """The validated asyncpg URL for cloud mode. Contains credentials; never log it."""
        if self.database_url is None:
            raise ValueError("ORBIT_DATABASE_URL is not configured.")
        return _parse_postgres_url(self.database_url.get_secret_value())

    @property
    def supabase_base_url(self) -> str:
        """The Supabase project URL without a trailing slash. Cloud mode only."""
        if self.supabase_url is None:
            raise ValueError("ORBIT_SUPABASE_URL is not configured.")
        return str(self.supabase_url).rstrip("/")

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
            if self.supabase_url is not None or self.supabase_publishable_key is not None:
                raise ValueError(
                    "ORBIT_SUPABASE_URL and ORBIT_SUPABASE_PUBLISHABLE_KEY are only used in "
                    "cloud mode. Set ORBIT_STORAGE_MODE=cloud, or unset them."
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
        if self.supabase_url is None or not self.supabase_publishable_key:
            raise ValueError(
                "ORBIT_SUPABASE_URL and ORBIT_SUPABASE_PUBLISHABLE_KEY are required when "
                "ORBIT_STORAGE_MODE is 'cloud'; cloud mode signs users in with Supabase Auth."
            )
        if self.is_production and self.supabase_url.scheme != "https":
            raise ValueError("ORBIT_SUPABASE_URL must use https in production.")
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
