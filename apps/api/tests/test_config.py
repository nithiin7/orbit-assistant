import pytest
from pydantic import ValidationError

from orbit_api.config import LOCAL_ORIGINS, Settings
from orbit_api.main import create_app


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
