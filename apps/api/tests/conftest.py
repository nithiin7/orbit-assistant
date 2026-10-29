from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app


@pytest.fixture
def settings() -> Settings:
    return Settings(env="test", _env_file=None)  # pyright: ignore[reportCallIssue]


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client
