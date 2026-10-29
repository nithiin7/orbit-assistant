from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from orbit_api import __version__
from orbit_api.api.dependencies import get_session
from orbit_api.config import Settings
from orbit_api.db.database import DatabaseSchemaError
from orbit_api.main import create_app


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
