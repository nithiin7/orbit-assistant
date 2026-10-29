from pathlib import Path

import pytest
from pydantic import ValidationError

from orbit_api.config import DEFAULT_SQLITE_PATH, LOCAL_ORIGINS, Settings
from orbit_api.main import create_app

# Cloud mode signs users in with Supabase Auth, so it needs the project's public settings.
SUPABASE = {
    "supabase_url": "https://project.supabase.co",
    "supabase_publishable_key": "sb_publishable_test",
}


def make_settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **overrides)  # pyright: ignore[reportCallIssue, reportArgumentType]


def test_defaults_are_safe_for_local_development() -> None:
    settings = make_settings()

    assert settings.env == "development"
    assert settings.api_host == "127.0.0.1"
    assert settings.cors_origins == LOCAL_ORIGINS


def test_reads_prefixed_environment_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ORBIT_API_PORT", "9000")
    monkeypatch.setenv("ORBIT_CORS_ORIGINS", '["https://orbit.example"]')

    settings = make_settings()

    assert settings.api_port == 9000
    assert settings.cors_origins == ["https://orbit.example"]


def test_rejects_wildcard_cors_in_production() -> None:
    with pytest.raises(ValidationError, match="explicit origins"):
        make_settings(env="production", cors_origins=["*"])


def test_production_disables_interactive_docs() -> None:
    app = create_app(make_settings(env="production", cors_origins=["https://orbit.example"]))

    assert app.docs_url is None
    assert app.openapi_url is None


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({}, True),
        ({"env": "production", "cors_origins": ["https://orbit.example"]}, False),
        ({"local_open_registration": False}, False),
        (
            {
                "env": "production",
                "cors_origins": ["https://orbit.example"],
                "local_open_registration": True,
            },
            True,
        ),
    ],
)
def test_local_registration_is_open_by_default_except_in_production(
    overrides: dict[str, object], expected: bool
) -> None:
    assert make_settings(**overrides).local_registration_open is expected


def test_storage_defaults_to_local_sqlite_outside_the_web_app() -> None:
    settings = make_settings()

    assert settings.storage_mode == "local"
    assert settings.sqlite_path == DEFAULT_SQLITE_PATH
    assert DEFAULT_SQLITE_PATH.parent.name == ".data"
    assert "web" not in DEFAULT_SQLITE_PATH.parts


def test_expands_home_in_sqlite_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    settings = make_settings(sqlite_path="~/orbit/orbit.sqlite3")

    assert settings.sqlite_path == tmp_path.resolve() / "orbit" / "orbit.sqlite3"


def test_rejects_directory_as_sqlite_path(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="must be a file path"):
        make_settings(sqlite_path=tmp_path)


def test_local_mode_rejects_a_database_url() -> None:
    """A configured URL means cloud storage was probably intended; never silently use local."""
    with pytest.raises(ValidationError, match="ORBIT_STORAGE_MODE is 'local'"):
        make_settings(database_url="postgresql://orbit:pw@db.example/orbit")


def test_cloud_mode_requires_a_database_url() -> None:
    with pytest.raises(ValidationError, match="ORBIT_DATABASE_URL is required"):
        make_settings(storage_mode="cloud")


@pytest.mark.parametrize(
    "url",
    [
        "postgres://orbit:pw@db.example:5432/orbit",
        "postgresql://orbit:pw@db.example:5432/orbit",
        "postgresql+asyncpg://orbit:pw@db.example:5432/orbit",
    ],
)
def test_cloud_mode_normalizes_postgres_urls_to_asyncpg(url: str) -> None:
    settings = make_settings(storage_mode="cloud", database_url=url, **SUPABASE)

    assert settings.postgres_url.drivername == "postgresql+asyncpg"
    assert settings.postgres_url.host == "db.example"
    assert settings.postgres_url.database == "orbit"


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("mysql://orbit:pw@db.example/orbit", "must be a PostgreSQL URL"),
        ("sqlite:///orbit.db", "must be a PostgreSQL URL"),
        ("postgresql+psycopg://orbit:pw@db.example/orbit", "must be a PostgreSQL URL"),
        ("postgresql://orbit:pw@db.example", "host and a database name"),
        ("not a url", "not a valid database URL"),
    ],
)
def test_cloud_mode_rejects_invalid_urls(url: str, message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        make_settings(storage_mode="cloud", database_url=url)


def test_validation_errors_never_echo_the_database_password() -> None:
    with pytest.raises(ValidationError) as error:
        make_settings(database_url="postgresql://orbit:hunter2-secret@db.example/orbit")

    assert "hunter2-secret" not in str(error.value)


def test_database_url_is_masked_in_repr() -> None:
    settings = make_settings(
        storage_mode="cloud",
        database_url="postgresql://orbit:hunter2-secret@db.example/orbit",
        **SUPABASE,
    )

    assert "hunter2-secret" not in repr(settings)


def test_cloud_mode_requires_supabase_auth_settings() -> None:
    with pytest.raises(ValidationError, match="ORBIT_SUPABASE_URL and ORBIT_SUPABASE_PUB"):
        make_settings(storage_mode="cloud", database_url="postgresql://o:pw@db.example/orbit")


def test_local_mode_rejects_supabase_settings() -> None:
    """Supabase settings suggest cloud mode was intended; never silently use local accounts."""
    with pytest.raises(ValidationError, match="only used in cloud mode"):
        make_settings(**SUPABASE)


def test_supabase_url_is_normalized_without_a_trailing_slash() -> None:
    settings = make_settings(
        storage_mode="cloud",
        database_url="postgresql://o:pw@db.example/orbit",
        supabase_url="https://project.supabase.co/",
        supabase_publishable_key="sb_publishable_test",
    )

    assert settings.supabase_base_url == "https://project.supabase.co"


def test_production_requires_https_for_supabase() -> None:
    with pytest.raises(ValidationError, match="must use https"):
        make_settings(
            env="production",
            cors_origins=["https://orbit.example"],
            storage_mode="cloud",
            database_url="postgresql://o:pw@db.example/orbit?ssl=require",
            supabase_url="http://project.supabase.co",
            supabase_publishable_key="sb_publishable_test",
        )


def test_production_cloud_mode_requires_tls() -> None:
    production = {"env": "production", "cors_origins": ["https://orbit.example"], **SUPABASE}
    with pytest.raises(ValidationError, match="must require TLS"):
        make_settings(
            **production, storage_mode="cloud", database_url="postgresql://o:pw@db.example/orbit"
        )

    settings = make_settings(
        **production,
        storage_mode="cloud",
        database_url="postgresql://o:pw@db.example/orbit?ssl=require",
    )
    assert settings.postgres_url.query["ssl"] == "require"
