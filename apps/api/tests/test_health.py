import json
import logging
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from orbit_api import __version__
from orbit_api.__main__ import log_config
from orbit_api.api.dependencies import get_session
from orbit_api.config import Settings
from orbit_api.db.database import DatabaseSchemaError
from orbit_api.db.migrate import downgrade
from orbit_api.main import create_app
from orbit_api.observability import JsonFormatter, RequestIdFilter, request_id_var


def test_health_reports_ok(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "orbit-api", "version": __version__}


def test_health_allows_configured_cors_origin(client: TestClient) -> None:
    origin = "http://localhost:3000"
    response = client.get("/api/v1/health", headers={"Origin": origin})

    assert response.headers["access-control-allow-origin"] == origin


def test_health_rejects_unknown_cors_origin(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"Origin": "https://evil.example"})

    assert "access-control-allow-origin" not in response.headers


def test_database_health_reports_storage_mode(client: TestClient) -> None:
    response = client.get("/api/v1/health/database")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "storage_mode": "local"}


def test_database_health_returns_503_without_details_when_unreachable(
    migrated_settings: Settings, tmp_path: Path
) -> None:
    # SQLite cannot open a file inside a directory that does not exist.
    unreachable = tmp_path / "missing" / "orbit.sqlite3"

    async def unreachable_session() -> AsyncIterator[AsyncSession]:
        engine = create_async_engine(f"sqlite+aiosqlite:///{unreachable}")
        try:
            async with AsyncSession(engine) as session:
                yield session
        finally:
            await engine.dispose()

    app = create_app(migrated_settings)
    app.dependency_overrides[get_session] = unreachable_session
    with TestClient(app) as client:
        response = client.get("/api/v1/health/database")

    assert response.status_code == 503
    assert response.json() == {"detail": "The database is unavailable."}
    assert str(tmp_path) not in response.text


def test_app_does_not_start_on_an_unmigrated_database(settings: Settings) -> None:
    with pytest.raises(DatabaseSchemaError), TestClient(create_app(settings)):
        pass


def test_liveness_needs_nothing_but_the_process(client: TestClient) -> None:
    response = client.get("/api/v1/health/live")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readiness_reports_a_reachable_migrated_database(client: TestClient) -> None:
    response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_readiness_fails_when_the_schema_falls_behind(
    client: TestClient, migrated_settings: Settings
) -> None:
    # The API started on a migrated database, which was then rolled back underneath it.
    downgrade(migrated_settings, "0021")

    response = client.get("/api/v1/health/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "outdated"}


def test_every_response_has_a_request_id_and_security_headers(client: TestClient) -> None:
    response = client.get("/api/v1/me")  # A 401, from deep inside the app.

    assert len(response.headers["x-request-id"]) == 32
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["cache-control"] == "no-store"


def test_a_callers_plain_request_id_is_kept_and_anything_else_replaced(
    client: TestClient,
) -> None:
    kept = client.get("/api/v1/health", headers={"X-Request-ID": "proxy-abc.123"})
    replaced = client.get("/api/v1/health", headers={"X-Request-ID": "bad id\nwith newline"})

    assert kept.headers["x-request-id"] == "proxy-abc.123"
    assert replaced.headers["x-request-id"] != "bad id\nwith newline"


def test_request_logs_leave_out_query_strings(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="orbit_api.requests")

    response = client.get(
        "/api/v1/auth/config", params={"q": "my medical results"}, headers={"X-Request-ID": "t-1"}
    )

    assert response.status_code == 200
    [record] = [r for r in caplog.records if r.name == "orbit_api.requests"]
    assert record.getMessage() == f"GET /api/v1/auth/config 200 {record.__dict__['duration_ms']}ms"
    assert "medical" not in caplog.text


def test_successful_health_probes_are_not_logged_but_failures_are(
    client: TestClient, caplog: pytest.LogCaptureFixture, migrated_settings: Settings
) -> None:
    caplog.set_level(logging.INFO, logger="orbit_api.requests")

    client.get("/api/v1/health/live")
    downgrade(migrated_settings, "0021")
    client.get("/api/v1/health/ready")

    messages = [r.getMessage() for r in caplog.records if r.name == "orbit_api.requests"]
    assert [m.rsplit(" ", 1)[0] for m in messages] == ["GET /api/v1/health/ready 503"]


def test_log_records_carry_the_request_id_and_can_be_json() -> None:
    record = logging.LogRecord("orbit_api.x", logging.INFO, "", 0, "Saved %s", ("it",), None)
    record.__dict__["http_status"] = 201
    token = request_id_var.set("abc")
    try:
        RequestIdFilter().filter(record)
    finally:
        request_id_var.reset(token)

    entry = json.loads(JsonFormatter().format(record))

    assert entry["message"] == "Saved it"
    assert entry["request_id"] == "abc"
    assert entry["http_status"] == 201


def test_the_server_log_config_turns_on_json_logs(settings: Settings) -> None:
    text = log_config(settings)
    as_json = log_config(settings.model_copy(update={"log_format": "json"}))

    assert "format" in text["formatters"]["orbit"]
    assert as_json["formatters"]["orbit"] == {"()": "orbit_api.observability.JsonFormatter"}
    assert as_json["loggers"]["orbit_api"]["handlers"] == ["orbit"]
