"""App lock: a PIN or device authenticator unlocks a session that has been idle, enforced by the
API per session."""

import base64
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.services.app_lock.models import (
    InvalidDeviceResponseError,
    RegisteredKey,
    RelyingParty,
)
from tests.support import PASSWORD, bearer, query, sign_up

LOCK = "/api/v1/me/app-lock"
ORIGIN = {"Origin": "http://localhost:3000"}
LONG_AGO = "2000-01-01 00:00:00.000000"


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


class FakeDevices:
    """Stands in for WebAuthn: a 'credential' echoes the challenge it answers."""

    def registration_options(
        self,
        *,
        party: RelyingParty,
        user_id: Any,
        user_name: str,
        display_name: str,
        challenge: bytes,
        exclude: list[bytes],
    ) -> dict[str, Any]:
        return {"challenge": _b64(challenge), "rp": {"id": party.id}, "exclude": len(exclude)}

    def verify_registration(
        self, *, credential: dict[str, Any], challenge: bytes, party: RelyingParty
    ) -> RegisteredKey:
        if credential.get("challenge") != _b64(challenge):
            raise InvalidDeviceResponseError
        return RegisteredKey(
            credential_id=str(credential["rawId"]).encode(), public_key=b"key", sign_count=0
        )

    def authentication_options(
        self, *, party: RelyingParty, challenge: bytes, allow: list[bytes]
    ) -> dict[str, Any]:
        return {"challenge": _b64(challenge), "allow": [_b64(item) for item in allow]}

    def credential_id(self, credential: dict[str, Any]) -> bytes:
        return str(credential.get("rawId", "")).encode()

    def verify_authentication(
        self,
        *,
        credential: dict[str, Any],
        challenge: bytes,
        party: RelyingParty,
        public_key: bytes,
        sign_count: int,
    ) -> int:
        if credential.get("challenge") != _b64(challenge) or public_key != b"key":
            raise InvalidDeviceResponseError
        return sign_count + 1


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    app.state.device_authenticator = FakeDevices()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> dict[str, str]:
    return bearer(sign_up(client))


def _enable(client: TestClient, headers: dict[str, str], pin: str = "2468") -> dict[str, Any]:
    response = client.put(f"{LOCK}/pin", json={"pin": pin}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _workspaces(client: TestClient, headers: dict[str, str]) -> int:
    return client.get("/api/v1/workspaces", headers=headers).status_code


def _age_sessions(settings: Settings, column: str = "last_active_at") -> None:
    query(settings.sqlite_path, f"UPDATE app_lock_sessions SET {column} = ?", LONG_AGO)


def _age_sign_in(settings: Settings) -> None:
    """Make the local session look signed in long ago, so it can't skip the current PIN."""
    query(
        settings.sqlite_path,
        "UPDATE local_sessions SET created_at = ?",
        "2020-01-01 00:00:00.000000",
    )


def test_app_lock_is_off_until_a_pin_is_set(client: TestClient, ada: dict[str, str]) -> None:
    status = client.get(LOCK, headers=ada).json()

    assert status["enabled"] is False
    assert status["locked"] is False
    assert status["pin_length"] is None
    assert client.post(f"{LOCK}/lock", headers=ada).json()["locked"] is False
    assert _workspaces(client, ada) == 200


def test_setting_a_pin_turns_the_lock_on_without_locking(
    client: TestClient, ada: dict[str, str], migrated_settings: Settings
) -> None:
    status = _enable(client, ada, "135790")

    assert status["enabled"] is True
    assert status["locked"] is False
    assert status["pin_length"] == 6
    assert status["lock_after_minutes"] == 5
    assert status["sign_out_after_minutes"] is None
    assert _workspaces(client, ada) == 200
    [(pin_hash,)] = query(migrated_settings.sqlite_path, "SELECT pin_hash FROM app_lock_settings")
    assert "135790" not in pin_hash


@pytest.mark.parametrize("pin", ["123", "123456789", "12a4", "١٢٣٤"])
def test_pins_are_four_to_eight_digits(client: TestClient, ada: dict[str, str], pin: str) -> None:
    response = client.put(f"{LOCK}/pin", json={"pin": pin}, headers=ada)

    assert response.status_code == 422


def test_a_locked_session_is_refused_until_it_unlocks(
    client: TestClient, ada: dict[str, str]
) -> None:
    _enable(client, ada)

    assert client.post(f"{LOCK}/lock", headers=ada).json()["locked"] is True

    refused = client.get("/api/v1/workspaces", headers=ada)
    assert refused.status_code == 423
    assert refused.json() == {"detail": "Orbit is locked. Unlock it to continue."}
    assert client.post(f"{LOCK}/activity", headers=ada).status_code == 423
    # The lock screen can still greet the person and read the lock state.
    assert client.get("/api/v1/me", headers=ada).json()["display_name"] == "Ada"
    assert client.get(LOCK, headers=ada).json()["locked"] is True

    wrong = client.post(f"{LOCK}/unlock", json={"pin": "1111"}, headers=ada)
    assert wrong.status_code == 422
    assert wrong.json() == {"detail": "Incorrect PIN. 4 tries left."}
    assert client.get(LOCK, headers=ada).json()["attempts_left"] == 4

    unlocked = client.post(f"{LOCK}/unlock", json={"pin": "2468"}, headers=ada)
    assert unlocked.status_code == 200
    assert unlocked.json()["locked"] is False
    assert unlocked.json()["attempts_left"] == 5
    assert _workspaces(client, ada) == 200


def test_an_idle_session_locks_even_if_the_browser_never_said_so(
    client: TestClient, ada: dict[str, str], migrated_settings: Settings
) -> None:
    _enable(client, ada)
    assert client.post(f"{LOCK}/activity", headers=ada).status_code == 204

    _age_sessions(migrated_settings)

    assert _workspaces(client, ada) == 423
    assert client.post(f"{LOCK}/unlock", json={"pin": "2468"}, headers=ada).status_code == 200
    assert _workspaces(client, ada) == 200


def test_locking_is_per_session(client: TestClient, ada: dict[str, str]) -> None:
    _enable(client, ada)
    signed_in = client.post(
        "/api/v1/auth/local/sign-in", json={"email": "ada@example.com", "password": PASSWORD}
    )
    other = bearer(signed_in.json()["access_token"])

    client.post(f"{LOCK}/lock", headers=ada)

    assert _workspaces(client, ada) == 423
    assert _workspaces(client, other) == 200


def test_an_idle_session_is_signed_out_after_the_sign_out_delay(
    client: TestClient, ada: dict[str, str], migrated_settings: Settings
) -> None:
    _enable(client, ada)
    timing = client.put(
        f"{LOCK}/timing",
        json={"lock_after_minutes": 1, "sign_out_after_minutes": 60},
        headers=ada,
    )
    assert timing.status_code == 200
    assert timing.json()["sign_out_after_minutes"] == 60

    _age_sessions(migrated_settings)

    assert client.get("/api/v1/me", headers=ada).status_code == 401
    assert client.post(f"{LOCK}/unlock", json={"pin": "2468"}, headers=ada).status_code == 401


def test_too_many_wrong_pins_sign_the_session_out(client: TestClient, ada: dict[str, str]) -> None:
    _enable(client, ada)
    client.post(f"{LOCK}/lock", headers=ada)

    details = [
        client.post(f"{LOCK}/unlock", json={"pin": "0000"}, headers=ada).json()["detail"]
        for _ in range(4)
    ]
    last = client.post(f"{LOCK}/unlock", json={"pin": "0000"}, headers=ada)

    assert details[-1] == "Incorrect PIN. 1 try left."
    assert last.status_code == 401
    # The right PIN can't bring the session back.
    assert client.post(f"{LOCK}/unlock", json={"pin": "2468"}, headers=ada).status_code == 401
    assert client.get("/api/v1/me", headers=ada).status_code == 401


@pytest.mark.parametrize(
    "timing",
    [
        {"lock_after_minutes": 0, "sign_out_after_minutes": None},
        {"lock_after_minutes": 1441, "sign_out_after_minutes": None},
        {"lock_after_minutes": 30, "sign_out_after_minutes": 30},
        {"lock_after_minutes": 5, "sign_out_after_minutes": 43201},
    ],
)
def test_timing_is_validated(
    client: TestClient, ada: dict[str, str], timing: dict[str, Any]
) -> None:
    _enable(client, ada)

    assert client.put(f"{LOCK}/timing", json=timing, headers=ada).status_code == 422


def test_timing_needs_the_lock_on(client: TestClient, ada: dict[str, str]) -> None:
    response = client.put(
        f"{LOCK}/timing",
        json={"lock_after_minutes": 5, "sign_out_after_minutes": None},
        headers=ada,
    )

    assert response.status_code == 409


def test_changing_the_pin_needs_the_current_one(
    client: TestClient, ada: dict[str, str], migrated_settings: Settings
) -> None:
    _enable(client, ada)
    _age_sign_in(migrated_settings)
    assert client.get(LOCK, headers=ada).json()["recently_signed_in"] is False

    missing = client.put(f"{LOCK}/pin", json={"pin": "9999"}, headers=ada)
    wrong = client.put(f"{LOCK}/pin", json={"pin": "9999", "current_pin": "1111"}, headers=ada)
    changed = client.put(f"{LOCK}/pin", json={"pin": "97531", "current_pin": "2468"}, headers=ada)

    assert missing.json() == {"detail": "Enter your current PIN."}
    assert wrong.json() == {"detail": "Incorrect PIN. 4 tries left."}
    assert changed.status_code == 200
    assert changed.json()["pin_length"] == 5
    client.post(f"{LOCK}/lock", headers=ada)
    assert client.post(f"{LOCK}/unlock", json={"pin": "97531"}, headers=ada).status_code == 200


def test_a_fresh_sign_in_can_reset_a_forgotten_pin(client: TestClient, ada: dict[str, str]) -> None:
    _enable(client, ada)

    assert client.get(LOCK, headers=ada).json()["recently_signed_in"] is True
    reset = client.put(f"{LOCK}/pin", json={"pin": "8642"}, headers=ada)

    assert reset.status_code == 200


def test_unlocking_always_needs_the_pin(client: TestClient, ada: dict[str, str]) -> None:
    _enable(client, ada)
    client.post(f"{LOCK}/lock", headers=ada)

    assert client.post(f"{LOCK}/unlock", json={}, headers=ada).status_code == 422
    assert client.put(f"{LOCK}/pin", json={"pin": "8642"}, headers=ada).status_code == 423


def test_turning_the_lock_off(
    client: TestClient, ada: dict[str, str], migrated_settings: Settings
) -> None:
    _enable(client, ada)
    _age_sign_in(migrated_settings)

    refused = client.post(f"{LOCK}/disable", json={"current_pin": "1111"}, headers=ada)
    disabled = client.post(f"{LOCK}/disable", json={"current_pin": "2468"}, headers=ada)

    assert refused.status_code == 422
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False
    for table in ("app_lock_settings", "app_lock_sessions", "app_lock_credentials"):
        assert query(migrated_settings.sqlite_path, f"SELECT COUNT(*) FROM {table}") == [(0,)]
    assert client.post(f"{LOCK}/disable", json={}, headers=ada).status_code == 409


def _add_device(client: TestClient, headers: dict[str, str], raw_id: str = "mac") -> Any:
    options = client.post(f"{LOCK}/devices/options", headers={**headers, **ORIGIN})
    assert options.status_code == 200, options.text
    challenge = options.json()["options"]["challenge"]
    return client.post(
        f"{LOCK}/devices",
        json={
            "credential": {"rawId": raw_id, "challenge": challenge},
            "label": "  Ada's Mac  ",
        },
        headers={**headers, **ORIGIN},
    )


def _unlock_with_device(
    client: TestClient, headers: dict[str, str], raw_id: str = "mac"
) -> tuple[Any, str]:
    options = client.post(f"{LOCK}/unlock/options", headers={**headers, **ORIGIN})
    assert options.status_code == 200, options.text
    challenge = options.json()["options"]["challenge"]
    response = client.post(
        f"{LOCK}/unlock/device",
        json={"credential": {"rawId": raw_id, "challenge": challenge}},
        headers={**headers, **ORIGIN},
    )
    return response, challenge


def test_a_device_authenticator_unlocks_the_session(
    client: TestClient, ada: dict[str, str]
) -> None:
    _enable(client, ada)
    added = _add_device(client, ada)
    assert added.status_code == 200, added.text
    [device] = added.json()["devices"]
    assert device["label"] == "Ada's Mac"
    assert device["credential_id"] == _b64(b"mac")
    assert device["last_used_at"] is None

    client.post(f"{LOCK}/lock", headers=ada)
    unlocked, challenge = _unlock_with_device(client, ada)

    assert unlocked.status_code == 200, unlocked.text
    assert unlocked.json()["locked"] is False
    assert unlocked.json()["devices"][0]["last_used_at"] is not None
    assert _workspaces(client, ada) == 200

    # A challenge works once.
    client.post(f"{LOCK}/lock", headers=ada)
    replay = client.post(
        f"{LOCK}/unlock/device",
        json={"credential": {"rawId": "mac", "challenge": challenge}},
        headers={**ada, **ORIGIN},
    )
    assert replay.status_code == 422
    assert _workspaces(client, ada) == 423


def test_device_responses_that_dont_verify_are_refused(
    client: TestClient, ada: dict[str, str]
) -> None:
    _enable(client, ada)
    _add_device(client, ada)
    client.post(f"{LOCK}/lock", headers=ada)

    unknown, _ = _unlock_with_device(client, ada, raw_id="someone-else")
    client.post(f"{LOCK}/unlock/options", headers={**ada, **ORIGIN})
    forged = client.post(
        f"{LOCK}/unlock/device",
        json={"credential": {"rawId": "mac", "challenge": "made-up"}},
        headers={**ada, **ORIGIN},
    )

    assert unknown.status_code == 422
    assert forged.status_code == 422
    assert _workspaces(client, ada) == 423


def test_devices_need_a_known_web_origin(client: TestClient, ada: dict[str, str]) -> None:
    _enable(client, ada)

    for headers in (ada, {**ada, "Origin": "https://attacker.example"}):
        response = client.post(f"{LOCK}/devices/options", headers=headers)
        assert response.status_code == 422


def test_unlock_options_need_a_registered_device(client: TestClient, ada: dict[str, str]) -> None:
    _enable(client, ada)

    assert client.post(f"{LOCK}/unlock/options", headers={**ada, **ORIGIN}).status_code == 404


def test_devices_need_the_lock_on_and_an_unlocked_session(
    client: TestClient, ada: dict[str, str]
) -> None:
    assert client.post(f"{LOCK}/devices/options", headers={**ada, **ORIGIN}).status_code == 409

    _enable(client, ada)
    client.post(f"{LOCK}/lock", headers=ada)

    assert client.post(f"{LOCK}/devices/options", headers={**ada, **ORIGIN}).status_code == 423


def test_people_can_only_remove_their_own_devices(client: TestClient, ada: dict[str, str]) -> None:
    _enable(client, ada)
    [device] = _add_device(client, ada).json()["devices"]
    mallory = bearer(sign_up(client, "mallory@example.com", display_name="Mallory"))

    assert client.delete(f"{LOCK}/devices/{device['id']}", headers=mallory).status_code == 404
    removed = client.delete(f"{LOCK}/devices/{device['id']}", headers=ada)

    assert removed.status_code == 200
    assert removed.json()["devices"] == []


def test_one_persons_lock_never_affects_another(client: TestClient, ada: dict[str, str]) -> None:
    _enable(client, ada)
    client.post(f"{LOCK}/lock", headers=ada)
    mallory = bearer(sign_up(client, "mallory@example.com", display_name="Mallory"))

    assert client.get(LOCK, headers=mallory).json()["enabled"] is False
    assert _workspaces(client, mallory) == 200
    # Mallory's PIN attempts can't unlock or end Ada's session.
    assert client.post(f"{LOCK}/unlock", json={"pin": "2468"}, headers=mallory).status_code == 409
    assert _workspaces(client, ada) == 423
