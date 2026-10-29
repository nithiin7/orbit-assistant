"""Helpers shared by API tests."""

import sqlite3
from pathlib import Path
from typing import Any

from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from orbit_api.auth.passwords import Argon2PasswordHasher

FAST_PASSWORD_HASHER = Argon2PasswordHasher(
    PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1)
)
PASSWORD = "correct horse battery"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def sign_up(
    client: TestClient,
    email: str = "ada@example.com",
    password: str = PASSWORD,
    display_name: str = "Ada",
) -> str:
    """Create a local account and return its session token."""
    response = client.post(
        "/api/v1/auth/local/sign-up",
        json={"email": email, "password": password, "display_name": display_name},
    )
    assert response.status_code == 201, response.text
    token: str = response.json()["access_token"]
    return token


def query(database: Path, sql: str, *params: object) -> list[tuple[Any, ...]]:
    """Run SQL directly against the test database, bypassing the API."""
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        return connection.execute(sql, params).fetchall()
