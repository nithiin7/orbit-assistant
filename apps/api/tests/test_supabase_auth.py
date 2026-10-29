"""Cloud-mode authentication with Supabase access tokens.

Supabase is never contacted: tokens are signed with a key generated here, and the verifier is
given that key in place of the project's JWKS endpoint. The API runs against SQLite, since
the code under test (token verification and profile provisioning) does not depend on the
database engine.
"""

import time
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jwt import PyJWK, PyJWKClient
from jwt.algorithms import ECAlgorithm
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError

from orbit_api.api.auth import SupabaseAuthenticator
from orbit_api.api.dependencies import get_local_auth_service
from orbit_api.auth.supabase import (
    AuthProviderUnavailableError,
    InvalidAccessTokenError,
    SupabaseTokenVerifier,
)
from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.services.accounts import ExternalIdentity
from tests.support import bearer, query

PROJECT_URL = "https://project.supabase.co"
ISSUER = f"{PROJECT_URL}/auth/v1"
KEY_ID = "test-key"
PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())


class StaticKeys:
    """Stands in for the project's JWKS endpoint."""

    def __init__(self, *, unavailable: bool = False) -> None:
        jwk: dict[str, Any] = ECAlgorithm.to_jwk(PRIVATE_KEY.public_key(), as_dict=True)
        self._jwk = PyJWK.from_dict({**jwk, "kid": KEY_ID, "alg": "ES256", "use": "sig"})
        self._unavailable = unavailable

    def get_signing_key_from_jwt(self, token: str) -> PyJWK:
        if self._unavailable:
            raise PyJWKClientConnectionError("Fail to fetch data from the url")
        if jwt.get_unverified_header(token).get("kid") != KEY_ID:
            raise PyJWKClientError("Unable to find a signing key that matches")
        return self._jwk


def mint(
    subject: str | None = None,
    email: str = "ada@example.com",
    *,
    key: Any = PRIVATE_KEY,
    algorithm: str = "ES256",
    lifetime: int = 3600,
    **overrides: Any,
) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": ISSUER,
        "aud": "authenticated",
        "sub": subject or str(uuid.uuid4()),
        "email": email,
        "role": "authenticated",
        "is_anonymous": False,
        "iat": now,
        "exp": now + lifetime,
        "user_metadata": {"display_name": "Ada Lovelace"},
        **overrides,
    }
    claims = {name: value for name, value in claims.items() if value is not None}
    return jwt.encode(claims, key, algorithm=algorithm, headers={"kid": KEY_ID})


def verifier(keys: StaticKeys | None = None) -> SupabaseTokenVerifier:
    return SupabaseTokenVerifier(PROJECT_URL, keys=keys or StaticKeys())


@pytest.fixture
def cloud_app(app: FastAPI) -> FastAPI:
    app.state.authenticator = SupabaseAuthenticator(verifier())
    return app


@pytest.fixture
def client(cloud_app: FastAPI) -> Iterator[TestClient]:
    with TestClient(cloud_app) as test_client:
        yield test_client


class TestVerifier:
    def test_accepts_a_valid_token(self) -> None:
        subject = str(uuid.uuid4())

        identity = verifier().verify(mint(subject, email="Ada@Example.com"))

        assert identity == ExternalIdentity(
            subject=subject, email="ada@example.com", display_name="Ada Lovelace"
        )

    @pytest.mark.parametrize(
        "overrides",
        [
            {"lifetime": -120},
            {"aud": "anon"},
            {"iss": "https://attacker.example/auth/v1"},
            {"role": "anon"},
            {"role": "service_role"},
            {"is_anonymous": True},
            {"sub": "not-a-uuid"},
            {"email": None},
            {"exp": None},
        ],
        ids=lambda overrides: next(iter(overrides)),
    )
    def test_rejects_invalid_claims(self, overrides: dict[str, Any]) -> None:
        with pytest.raises(InvalidAccessTokenError):
            verifier().verify(mint(**overrides))

    def test_rejects_tokens_signed_with_another_key(self) -> None:
        other = ec.generate_private_key(ec.SECP256R1())

        with pytest.raises(InvalidAccessTokenError):
            verifier().verify(mint(key=other))

    def test_rejects_shared_secret_tokens(self) -> None:
        token = mint(key="a-shared-secret-of-sufficient-length-1234", algorithm="HS256")

        with pytest.raises(InvalidAccessTokenError):
            verifier().verify(token)

    @pytest.mark.parametrize("token", ["", "not.a.jwt", "a.b.c"])
    def test_rejects_malformed_tokens(self, token: str) -> None:
        with pytest.raises(InvalidAccessTokenError):
            verifier().verify(token)

    def test_reports_unreachable_signing_keys(self) -> None:
        with pytest.raises(AuthProviderUnavailableError):
            verifier(StaticKeys(unavailable=True)).verify(mint())

    def test_uses_the_projects_jwks_endpoint(self) -> None:
        keys = SupabaseTokenVerifier(PROJECT_URL)._keys  # pyright: ignore[reportPrivateUsage]

        assert isinstance(keys, PyJWKClient)
        assert keys.uri == f"{ISSUER}/.well-known/jwks.json"


def test_first_request_provisions_profile_and_personal_workspace(
    client: TestClient, migrated_settings: Settings
) -> None:
    subject = str(uuid.uuid4())
    token = mint(subject)

    response = client.get("/api/v1/me", headers=bearer(token))

    assert response.status_code == 200
    profile = response.json()
    assert profile["email"] == "ada@example.com"
    assert profile["display_name"] == "Ada Lovelace"
    assert profile["auth_provider"] == "supabase"
    assert query(
        migrated_settings.sqlite_path, "SELECT auth_provider, auth_subject FROM users"
    ) == [("supabase", subject)]

    workspaces = client.get("/api/v1/workspaces", headers=bearer(token)).json()["workspaces"]
    assert [(w["name"], w["is_personal"]) for w in workspaces] == [("Personal", True)]


def test_provisioning_is_idempotent(client: TestClient, migrated_settings: Settings) -> None:
    subject = str(uuid.uuid4())

    first = client.get("/api/v1/me", headers=bearer(mint(subject))).json()
    second = client.get("/api/v1/me", headers=bearer(mint(subject))).json()

    assert first["id"] == second["id"]
    assert query(migrated_settings.sqlite_path, "SELECT count(*) FROM workspaces") == [(1,)]


def test_profile_email_follows_supabase(client: TestClient) -> None:
    subject = str(uuid.uuid4())
    client.get("/api/v1/me", headers=bearer(mint(subject, email="ada@example.com")))

    profile = client.get("/api/v1/me", headers=bearer(mint(subject, email="ada@new.example")))

    assert profile.json()["email"] == "ada@new.example"


def test_display_name_falls_back_to_the_email_name(client: TestClient) -> None:
    token = mint(email="grace@example.com", user_metadata={"display_name": "\x00"})

    assert client.get("/api/v1/me", headers=bearer(token)).json()["display_name"] == "grace"


def test_invalid_tokens_are_rejected_without_creating_profiles(
    client: TestClient, migrated_settings: Settings
) -> None:
    response = client.get("/api/v1/me", headers=bearer(mint(lifetime=-120)))

    assert response.status_code == 401
    assert query(migrated_settings.sqlite_path, "SELECT count(*) FROM users") == [(0,)]


def test_unreachable_signing_keys_fail_closed_with_503(cloud_app: FastAPI) -> None:
    cloud_app.state.authenticator = SupabaseAuthenticator(verifier(StaticKeys(unavailable=True)))
    with TestClient(cloud_app) as client:
        response = client.get("/api/v1/me", headers=bearer(mint()))

    assert response.status_code == 503
    assert response.json() == {"detail": "Sign-in could not be verified. Try again shortly."}


def test_local_session_tokens_are_not_accepted_in_cloud_mode(client: TestClient) -> None:
    assert client.get("/api/v1/me", headers=bearer("a-local-session-token")).status_code == 401


def test_supabase_users_are_isolated(client: TestClient) -> None:
    ada = bearer(mint(email="ada@example.com"))
    grace = bearer(mint(email="grace@example.com"))
    ada_workspace = client.get("/api/v1/workspaces", headers=ada).json()["workspaces"][0]

    assert client.get(f"/api/v1/workspaces/{ada_workspace['id']}", headers=grace).status_code == 404
    grace_workspaces = client.get("/api/v1/workspaces", headers=grace).json()["workspaces"]
    assert ada_workspace["id"] not in {w["id"] for w in grace_workspaces}


def test_cloud_config_exposes_only_public_supabase_settings(tmp_path: Path) -> None:
    settings = Settings(
        env="test",
        storage_mode="cloud",
        database_url="postgresql://orbit:hunter2-secret@db.example/orbit",
        supabase_url=PROJECT_URL,
        supabase_publishable_key="sb_publishable_test",
        sqlite_path=tmp_path / "unused.sqlite3",
        _env_file=None,  # pyright: ignore[reportCallIssue]
    )
    app = create_app(settings)
    # The cloud branch never consults local accounts; avoid needing a PostgreSQL server.
    app.dependency_overrides[get_local_auth_service] = lambda: None

    response = TestClient(app).get("/api/v1/auth/config")

    assert response.json() == {
        "provider": "supabase",
        "supabase_url": PROJECT_URL,
        "supabase_publishable_key": "sb_publishable_test",
    }
    assert "hunter2" not in response.text
