import hashlib
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from orbit_api.auth.passwords import Argon2PasswordHasher
from orbit_api.config import Settings
from orbit_api.main import create_app
from tests.support import FAST_PASSWORD_HASHER, PASSWORD, bearer, query, sign_up

SIGN_UP = "/api/v1/auth/local/sign-up"
SIGN_IN = "/api/v1/auth/local/sign-in"
SIGN_OUT = "/api/v1/auth/local/sign-out"


@pytest.fixture
def closed_client(migrated_settings: Settings) -> Iterator[TestClient]:
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": False}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    with TestClient(app) as client:
        yield client


def test_config_reports_local_sign_in_with_open_first_registration(client: TestClient) -> None:
    response = client.get("/api/v1/auth/config")

    assert response.status_code == 200
    assert response.json() == {"provider": "local", "registration_open": True}


def test_sign_up_creates_profile_and_personal_workspace(client: TestClient) -> None:
    response = client.post(
        SIGN_UP,
        json={"email": " Ada@Example.com ", "password": PASSWORD, "display_name": "  Ada  "},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == "ada@example.com"
    assert body["user"]["display_name"] == "Ada"
    assert body["user"]["auth_provider"] == "local"

    workspaces = client.get("/api/v1/workspaces", headers=bearer(body["access_token"])).json()
    assert [(w["name"], w["is_personal"], w["role"]) for w in workspaces["workspaces"]] == [
        ("Personal", True, "owner")
    ]


def test_several_people_can_register_on_one_machine_by_default(client: TestClient) -> None:
    ada = sign_up(client, email="ada@example.com", display_name="Ada")
    grace = sign_up(client, email="grace@example.com", display_name="Grace")

    assert client.get("/api/v1/auth/config").json()["registration_open"] is True
    assert client.get("/api/v1/me", headers=bearer(ada)).json()["display_name"] == "Ada"
    assert client.get("/api/v1/me", headers=bearer(grace)).json()["display_name"] == "Grace"


def test_registration_rejects_duplicate_emails(client: TestClient) -> None:
    sign_up(client, email="ada@example.com")

    response = client.post(
        SIGN_UP, json={"email": "ADA@example.com", "password": PASSWORD, "display_name": "Ada 2"}
    )
    assert response.status_code == 409


def test_closed_registration_allows_only_the_first_account(closed_client: TestClient) -> None:
    assert closed_client.get("/api/v1/auth/config").json()["registration_open"] is True
    sign_up(closed_client)

    assert closed_client.get("/api/v1/auth/config").json()["registration_open"] is False
    response = closed_client.post(
        SIGN_UP, json={"email": "eve@example.com", "password": PASSWORD, "display_name": "Eve"}
    )
    assert response.status_code == 403
    assert response.json() == {
        "detail": "This Orbit installation does not accept new accounts. Sign in instead."
    }


def test_passwords_and_session_tokens_are_stored_only_as_hashes(
    client: TestClient, migrated_settings: Settings
) -> None:
    token = sign_up(client)
    database = migrated_settings.sqlite_path

    [(password_hash,)] = query(database, "SELECT password_hash FROM local_credentials")
    [(token_hash,)] = query(database, "SELECT token_hash FROM local_sessions")
    assert password_hash.startswith("$argon2id$")
    assert PASSWORD not in password_hash
    assert token_hash == hashlib.sha256(token.encode()).hexdigest()


def test_sign_in_returns_a_working_session(client: TestClient) -> None:
    sign_up(client)

    response = client.post(SIGN_IN, json={"email": "ADA@example.com ", "password": PASSWORD})

    assert response.status_code == 200
    token = response.json()["access_token"]
    me = client.get("/api/v1/me", headers=bearer(token))
    assert me.status_code == 200
    assert me.json()["email"] == "ada@example.com"


@pytest.mark.parametrize(
    ("email", "password"),
    [("ada@example.com", "wrong password"), ("nobody@example.com", PASSWORD)],
)
def test_sign_in_failures_are_indistinguishable(
    client: TestClient, email: str, password: str
) -> None:
    sign_up(client)

    response = client.post(SIGN_IN, json={"email": email, "password": password})

    assert response.status_code == 401
    assert response.json() == {"detail": "The email or password is incorrect."}


def test_sign_in_upgrades_outdated_password_hashes(
    app: FastAPI, client: TestClient, migrated_settings: Settings
) -> None:
    sign_up(client)
    [(old_hash,)] = query(
        migrated_settings.sqlite_path, "SELECT password_hash FROM local_credentials"
    )

    app.state.password_hasher = Argon2PasswordHasher()  # Stronger default parameters.
    assert client.post(SIGN_IN, json={"email": "ada@example.com", "password": PASSWORD}).is_success

    [(new_hash,)] = query(
        migrated_settings.sqlite_path, "SELECT password_hash FROM local_credentials"
    )
    assert new_hash != old_hash
    assert not Argon2PasswordHasher().needs_rehash(new_hash)


def test_sign_out_revokes_only_the_current_session(client: TestClient) -> None:
    first = sign_up(client)
    second = client.post(SIGN_IN, json={"email": "ada@example.com", "password": PASSWORD}).json()[
        "access_token"
    ]

    assert client.post(SIGN_OUT, headers=bearer(first)).status_code == 204

    assert client.get("/api/v1/me", headers=bearer(first)).status_code == 401
    assert client.get("/api/v1/me", headers=bearer(second)).status_code == 200


def test_expired_sessions_are_rejected(client: TestClient, migrated_settings: Settings) -> None:
    token = sign_up(client)
    query(
        migrated_settings.sqlite_path,
        "UPDATE local_sessions SET created_at = ?, expires_at = ?",
        "1999-12-31 00:00:00.000000",
        "2000-01-01 00:00:00.000000",
    )

    assert client.get("/api/v1/me", headers=bearer(token)).status_code == 401


def test_sign_in_removes_the_users_expired_sessions(
    client: TestClient, migrated_settings: Settings
) -> None:
    sign_up(client)
    query(
        migrated_settings.sqlite_path,
        "UPDATE local_sessions SET created_at = ?, expires_at = ?",
        "1999-12-31 00:00:00.000000",
        "2000-01-01 00:00:00.000000",
    )

    client.post(SIGN_IN, json={"email": "ada@example.com", "password": PASSWORD})

    [(count,)] = query(migrated_settings.sqlite_path, "SELECT count(*) FROM local_sessions")
    assert count == 1


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer "},
        {"Authorization": "Bearer not-a-session"},
        {"Authorization": "Basic YWRhOnB3"},
        {"Authorization": "Bearer " + "x" * 5000},
    ],
)
def test_protected_endpoints_reject_missing_or_invalid_tokens(
    client: TestClient, headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/me", headers=headers)

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json() == {"detail": "Sign in to continue."}


def test_sign_out_requires_a_session(client: TestClient) -> None:
    assert client.post(SIGN_OUT).status_code == 401


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"email": "not-an-email", "password": PASSWORD, "display_name": "Ada"}, "email"),
        ({"email": "ada@example.com", "password": "short", "display_name": "Ada"}, "password"),
        ({"email": "ada@example.com", "password": "x" * 129, "display_name": "Ada"}, "password"),
        ({"email": "ada@example.com", "password": PASSWORD, "display_name": "   "}, "display_name"),
        (
            {"email": "ada@example.com", "password": PASSWORD, "display_name": "A\x00"},
            "display_name",
        ),
        (
            {"email": "ada@example.com", "password": PASSWORD, "display_name": "x" * 101},
            "display_name",
        ),
    ],
)
def test_sign_up_validates_input(client: TestClient, body: dict[str, str], field: str) -> None:
    response = client.post(SIGN_UP, json=body)

    assert response.status_code == 422
    assert [error["loc"] for error in response.json()["detail"]] == [["body", field]]


def test_validation_errors_never_echo_submitted_values(client: TestClient) -> None:
    secret = "hunter2"  # Too short, so it fails validation.

    response = client.post(
        SIGN_UP, json={"email": "ada@example.com", "password": secret, "display_name": "Ada"}
    )

    assert response.status_code == 422
    assert secret not in response.text
    assert set(response.json()["detail"][0]) == {"loc", "msg", "type"}


def test_sign_up_rejects_unknown_fields(client: TestClient) -> None:
    response = client.post(
        SIGN_UP,
        json={
            "email": "ada@example.com",
            "password": PASSWORD,
            "display_name": "Ada",
            "user_id": "00000000-0000-0000-0000-000000000001",
        },
    )

    assert response.status_code == 422


def test_local_endpoints_are_unavailable_in_cloud_mode(tmp_path: Path) -> None:
    cloud = Settings(
        env="test",
        storage_mode="cloud",
        database_url="postgresql://orbit:pw@db.example/orbit",
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="sb_publishable_test",
        sqlite_path=tmp_path / "unused.sqlite3",
        _env_file=None,  # pyright: ignore[reportCallIssue]
    )
    # Without `with`, the app does not run its lifespan, so no database connection is made;
    # the mode check rejects the request before any database access.
    client = TestClient(create_app(cloud))

    response = client.post(SIGN_IN, json={"email": "ada@example.com", "password": PASSWORD})

    assert response.status_code == 404
    assert response.json() == {"detail": "Local accounts are not available in cloud mode."}


PASSWORD_CHANGE = "/api/v1/auth/local/password"


def _sign_in(client: TestClient, password: str, email: str = "ada@example.com") -> int:
    response = client.post(SIGN_IN, json={"email": email, "password": password})
    return response.status_code


def test_changing_the_password_ends_every_other_session(client: TestClient) -> None:
    current = sign_up(client)
    other = client.post(SIGN_IN, json={"email": "ada@example.com", "password": PASSWORD}).json()

    response = client.post(
        PASSWORD_CHANGE,
        json={"current_password": PASSWORD, "new_password": "a brand new secret"},
        headers=bearer(current),
    )

    assert response.status_code == 204
    assert client.get("/api/v1/me", headers=bearer(current)).status_code == 200
    assert client.get("/api/v1/me", headers=bearer(other["access_token"])).status_code == 401
    assert _sign_in(client, PASSWORD) == 401
    assert _sign_in(client, "a brand new secret") == 200


def test_changing_the_password_needs_the_current_one(client: TestClient) -> None:
    token = sign_up(client)

    response = client.post(
        PASSWORD_CHANGE,
        json={"current_password": "not my password", "new_password": "a brand new secret"},
        headers=bearer(token),
    )

    # 403 keeps the web app signed in; 401 would mean the session itself is invalid.
    assert response.status_code == 403
    assert _sign_in(client, PASSWORD) == 200


def test_a_new_password_must_meet_the_length_rule(client: TestClient) -> None:
    token = sign_up(client)

    response = client.post(
        PASSWORD_CHANGE,
        json={"current_password": PASSWORD, "new_password": "short"},
        headers=bearer(token),
    )

    assert response.status_code == 422
    assert _sign_in(client, PASSWORD) == 200


def test_changing_the_password_requires_a_session(client: TestClient) -> None:
    response = client.post(
        PASSWORD_CHANGE, json={"current_password": PASSWORD, "new_password": "whatever123"}
    )

    assert response.status_code == 401


def test_repeated_failed_sign_ins_are_refused_for_a_while(client: TestClient) -> None:
    sign_up(client)

    statuses = [_sign_in(client, f"guess {attempt}") for attempt in range(10)]
    blocked = client.post(SIGN_IN, json={"email": "ada@example.com", "password": PASSWORD})

    assert statuses == [401] * 10
    # Even the right password waits: otherwise the limit would confirm a correct guess.
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0
    # Other accounts are unaffected.
    sign_up(client, "grace@example.com", display_name="Grace")
    assert _sign_in(client, PASSWORD, "grace@example.com") == 200


def test_a_successful_sign_in_resets_the_failure_count(client: TestClient) -> None:
    sign_up(client)

    for attempt in range(9):
        _sign_in(client, f"guess {attempt}")
    assert _sign_in(client, PASSWORD) == 200

    assert [_sign_in(client, f"again {attempt}") for attempt in range(9)] == [401] * 9


def test_failed_password_changes_count_towards_the_limit(client: TestClient) -> None:
    token = sign_up(client)

    for attempt in range(10):
        client.post(
            PASSWORD_CHANGE,
            json={"current_password": f"guess {attempt}", "new_password": "a brand new secret"},
            headers=bearer(token),
        )
    response = client.post(
        PASSWORD_CHANGE,
        json={"current_password": PASSWORD, "new_password": "a brand new secret"},
        headers=bearer(token),
    )

    assert response.status_code == 429


def test_sign_ups_from_one_address_are_limited(client: TestClient) -> None:
    for number in range(10):
        sign_up(client, f"person{number}@example.com", display_name=f"Person {number}")

    response = client.post(
        "/api/v1/auth/local/sign-up",
        json={"email": "one-more@example.com", "password": PASSWORD, "display_name": "More"},
    )

    assert response.status_code == 429
