"""PostgreSQL integration tests. Opt-in: they need a disposable PostgreSQL database.

Run with `ORBIT_TEST_DATABASE_URL=postgresql://... uv run pytest -m postgres`. The database is
migrated up and back down to an empty schema, so never point this at real data.
"""

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.migrate import downgrade, upgrade
from orbit_api.main import create_app

TEST_DATABASE_URL = os.environ.get("ORBIT_TEST_DATABASE_URL")

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="ORBIT_TEST_DATABASE_URL is not set"),
]


@pytest.fixture
def cloud_settings() -> Iterator[Settings]:
    settings = Settings(
        env="test",
        storage_mode="cloud",
        database_url=TEST_DATABASE_URL,
        _env_file=None,  # pyright: ignore[reportCallIssue]
    )
    upgrade(settings)
    yield settings
    downgrade(settings, "base")


def test_cloud_mode_serves_requests_against_postgres(cloud_settings: Settings) -> None:
    with TestClient(create_app(cloud_settings)) as client:
        response = client.get("/api/v1/health/database")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "storage_mode": "cloud"}
