"""Push notifications: encryption, the routes, and the worker's best-effort delivery."""

import base64
import json
import stat
import uuid
from collections.abc import AsyncIterator, Iterator, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx2
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.database import Database, open_database
from orbit_api.main import create_app
from orbit_api.providers.push.web_push import WebPushSender, encrypt_payload
from orbit_api.scheduler.worker import ReminderWorker
from orbit_api.services.push.models import (
    PushMessage,
    PushOutcome,
    PushSubscription,
    decode_key,
    is_push_endpoint,
)
from orbit_api.system.attachment_store import FileAttachmentStore
from orbit_api.system.push_keys import VapidKeys
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

PUSH = "/api/v1/me/push"
WORKSPACES = "/api/v1/workspaces"
ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-one"
DUE = datetime(2030, 1, 15, 8, 0, tzinfo=UTC)

Headers = dict[str, str]


def encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def device_keys() -> dict[str, str]:
    public = (
        ec.generate_private_key(ec.SECP256R1())
        .public_key()
        .public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    )
    return {"p256dh": encode(public), "auth": encode(b"0123456789abcdef")}


def subscription(endpoint: str = ENDPOINT) -> dict[str, str]:
    return {"endpoint": endpoint, **device_keys()}


class FakeSender:
    """Records what would be sent; `outcome` is what every device reports."""

    def __init__(self) -> None:
        self.sent: list[tuple[list[str], PushMessage]] = []
        self.outcome: PushOutcome = "sent"
        self.key: str | None = "public-key"
        self.error: Exception | None = None

    def public_key(self) -> str | None:
        return self.key

    async def send(
        self, subscriptions: Sequence[PushSubscription], message: PushMessage
    ) -> list[PushOutcome]:
        if self.error is not None:
            raise self.error
        self.sent.append(([item.endpoint for item in subscriptions], message))
        return [self.outcome] * len(subscriptions)


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def sender() -> FakeSender:
    return FakeSender()


@pytest.fixture
def app(migrated_settings: Settings, sender: FakeSender) -> FastAPI:
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    app.state.push_sender = sender
    return app


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def grace(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="grace@example.com", display_name="Grace"))


@pytest.fixture
async def database(migrated_settings: Settings) -> AsyncIterator[Database]:
    database = await open_database(migrated_settings)
    yield database
    await database.dispose()


def subscribe(client: TestClient, headers: Headers, endpoint: str = ENDPOINT) -> dict[str, Any]:
    response = client.put(f"{PUSH}/subscriptions", json=subscription(endpoint), headers=headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def prefer(client: TestClient, headers: Headers, **changes: bool) -> None:
    body = {"reminders": True, "briefing": True, "show_details": False, **changes}
    response = client.put(f"{PUSH}/preferences", json=body, headers=headers)
    assert response.status_code == 200, response.text


def add_reminder(client: TestClient, headers: Headers) -> None:
    workspace = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]["id"]
    response = client.post(
        f"{WORKSPACES}/{workspace}/reminders",
        json={
            "title": "Call the dentist",
            "description": "Ask about Friday.",
            "start_date": "2030-01-15",
            "time_of_day": "09:00",
            "timezone": "Europe/Paris",
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text


# Encryption and sending


def test_encryption_matches_the_rfc_8291_example() -> None:
    sender_private = decode_key("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
    encrypted = encrypt_payload(
        b"When I grow up, I want to be a watermelon",
        decode_key(
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
        ),
        decode_key("BTBZMqHH6r4Tts7J_aSIgg"),
        sender_key=ec.derive_private_key(int.from_bytes(sender_private, "big"), ec.SECP256R1()),
        salt=decode_key("DGv6ra1nlYgDCS1FRnbzlw"),
    )

    assert encode(encrypted) == (
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmY"
        "WAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexS"
        "gSxsj_Qulcy4a-fN"
    )


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://web.push.apple.com/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ],
)
def test_browser_push_services_are_accepted(endpoint: str) -> None:
    assert is_push_endpoint(endpoint)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/fcm/send/abc",
        "https://127.0.0.1/abc",
        "https://localhost/abc",
        "https://169.254.169.254/latest/meta-data",
        "https://fcm.googleapis.com.evil.example/abc",
        "https://evilpush.apple.com/abc",
        "https://fcm.googleapis.com:8443/abc",
        "https://user:secret@fcm.googleapis.com/abc",
        "https://fcm.googleapis.com:not-a-port/abc",
        "not a url",
    ],
)
def test_other_addresses_are_refused(endpoint: str) -> None:
    assert not is_push_endpoint(endpoint)


def message() -> PushMessage:
    return PushMessage(
        title="Orbit",
        body="You have a reminder.",
        link="/reminders",
        tag="reminder-1",
        ttl_seconds=60,
        urgency="high",
    )


def stored(endpoint: str = ENDPOINT) -> PushSubscription:
    keys = device_keys()
    return PushSubscription(uuid.uuid4(), uuid.uuid4(), endpoint, keys["p256dh"], keys["auth"])


def web_sender(tmp_path: Path, handler: Any) -> WebPushSender:
    keys = VapidKeys(True, None, tmp_path / "web-push.key")
    return WebPushSender(keys, "mailto:admin@example.com", httpx2.MockTransport(handler))


@pytest.mark.anyio
async def test_a_message_is_encrypted_and_identifies_the_server(tmp_path: Path) -> None:
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(201)

    sender = web_sender(tmp_path, handler)
    assert await sender.send([stored()], message()) == ["sent"]

    request = requests[0]
    assert request.headers["content-encoding"] == "aes128gcm"
    assert request.headers["ttl"] == "60"
    assert request.headers["urgency"] == "high"
    assert b"You have a reminder" not in request.content

    token = request.headers["authorization"].removeprefix("vapid t=").split(",")[0]
    public_key = ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), decode_key(sender.public_key() or "")
    )
    claims = jwt.decode(
        token, public_key, algorithms=["ES256"], audience="https://fcm.googleapis.com"
    )
    assert claims["sub"] == "mailto:admin@example.com"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("status", "outcome"),
    [
        (201, "sent"),
        (404, "gone"),
        (410, "gone"),
        (403, "failed"),
        (429, "failed"),
        (500, "failed"),
    ],
)
async def test_a_push_service_reply_becomes_an_outcome(
    tmp_path: Path, status: int, outcome: PushOutcome
) -> None:
    def handler(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(status)

    sender = web_sender(tmp_path, handler)

    assert await sender.send([stored()], message()) == [outcome]


@pytest.mark.anyio
async def test_a_redirect_is_not_followed(tmp_path: Path) -> None:
    calls = 0

    def handler(_request: httpx2.Request) -> httpx2.Response:
        nonlocal calls
        calls += 1
        return httpx2.Response(307, headers={"Location": "https://127.0.0.1/internal"})

    sender = web_sender(tmp_path, handler)

    assert await sender.send([stored()], message()) == ["failed"]
    assert calls == 1


@pytest.mark.anyio
async def test_an_unreachable_device_is_reported_not_raised(tmp_path: Path) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("unreachable", request=request)

    assert await web_sender(tmp_path, handler).send([stored()], message()) == ["failed"]


def test_the_generated_key_is_private_and_stable(tmp_path: Path) -> None:
    path = tmp_path / "data" / "web-push.key"

    first = VapidKeys(True, None, path).public_key()

    assert first is not None
    assert VapidKeys(True, None, path).public_key() == first
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert [item.name for item in path.parent.iterdir()] == ["web-push.key"]


def test_push_is_unavailable_without_a_key_or_when_turned_off(tmp_path: Path) -> None:
    assert VapidKeys(True, None, None).public_key() is None
    assert VapidKeys(False, None, tmp_path / "web-push.key").public_key() is None
    assert not (tmp_path / "web-push.key").exists()


def test_an_invalid_key_makes_push_unavailable() -> None:
    assert VapidKeys(True, "not-a-key!", None).public_key() is None


# Routes


def test_push_starts_private_with_no_devices(client: TestClient, ada: Headers) -> None:
    response = client.get(PUSH, headers=ada)

    assert response.status_code == 200
    assert response.json() == {
        "available": True,
        "public_key": "public-key",
        "reminders": True,
        "briefing": True,
        "show_details": False,
        "devices": 0,
    }


def test_turning_a_device_on_and_off(client: TestClient, ada: Headers) -> None:
    assert subscribe(client, ada)["devices"] == 1
    assert subscribe(client, ada)["devices"] == 1  # The same device again.

    response = client.post(f"{PUSH}/subscriptions/remove", json={"endpoint": ENDPOINT}, headers=ada)

    assert response.status_code == 200
    assert response.json()["devices"] == 0


def test_the_device_address_is_never_returned(client: TestClient, ada: Headers) -> None:
    assert ENDPOINT not in json.dumps(subscribe(client, ada))
    assert ENDPOINT not in client.get(PUSH, headers=ada).text


@pytest.mark.parametrize(
    "changes",
    [
        {"endpoint": "https://127.0.0.1/internal"},
        {"endpoint": "http://fcm.googleapis.com/fcm/send/abc"},
        {"p256dh": encode(b"too short")},
        {"p256dh": "not base64!"},
        {"auth": encode(b"short")},
        {"endpoint": "https://fcm.googleapis.com/" + "a" * 2048},
    ],
)
def test_an_unusable_subscription_is_refused(
    client: TestClient, ada: Headers, changes: dict[str, str]
) -> None:
    response = client.put(f"{PUSH}/subscriptions", json={**subscription(), **changes}, headers=ada)

    assert response.status_code == 422
    assert client.get(PUSH, headers=ada).json()["devices"] == 0


def test_someone_else_cannot_turn_your_device_off(
    client: TestClient, ada: Headers, grace: Headers
) -> None:
    subscribe(client, ada)

    client.post(f"{PUSH}/subscriptions/remove", json={"endpoint": ENDPOINT}, headers=grace)

    assert client.get(PUSH, headers=ada).json()["devices"] == 1


def test_a_shared_device_follows_whoever_turned_push_on_last(
    client: TestClient, ada: Headers, grace: Headers
) -> None:
    subscribe(client, ada)
    subscribe(client, grace)

    assert client.get(PUSH, headers=ada).json()["devices"] == 0
    assert client.get(PUSH, headers=grace).json()["devices"] == 1


def test_only_the_newest_devices_are_kept(client: TestClient, ada: Headers) -> None:
    for index in range(22):
        subscribe(client, ada, f"https://fcm.googleapis.com/fcm/send/{index}")

    assert client.get(PUSH, headers=ada).json()["devices"] == 20


def test_preferences_are_saved_per_person(client: TestClient, ada: Headers, grace: Headers) -> None:
    prefer(client, ada, reminders=False, show_details=True)

    mine = client.get(PUSH, headers=ada).json()
    assert (mine["reminders"], mine["briefing"], mine["show_details"]) == (False, True, True)
    assert client.get(PUSH, headers=grace).json()["reminders"] is True


def test_a_test_notification_reaches_only_your_devices(
    client: TestClient, ada: Headers, grace: Headers, sender: FakeSender
) -> None:
    subscribe(client, ada)
    subscribe(client, grace, "https://web.push.apple.com/grace")

    response = client.post(f"{PUSH}/test", headers=ada)

    assert response.status_code == 200
    assert response.json() == {"sent": 1}
    assert [endpoints for endpoints, _ in sender.sent] == [[ENDPOINT]]


def test_a_server_without_a_key_says_so(
    client: TestClient, ada: Headers, sender: FakeSender
) -> None:
    sender.key = None

    assert client.get(PUSH, headers=ada).json()["available"] is False
    saved = client.put(f"{PUSH}/subscriptions", json=subscription(), headers=ada)
    assert saved.status_code == 503
    assert client.post(f"{PUSH}/test", headers=ada).status_code == 503


# The worker


@pytest.mark.anyio
async def test_a_reminder_pushes_no_content_by_default(
    client: TestClient, ada: Headers, database: Database, sender: FakeSender
) -> None:
    subscribe(client, ada)
    add_reminder(client, ada)

    report = await ReminderWorker(database, clock=Clock(DUE), push=sender).run_once()

    assert report.results == {"delivered": 1}
    endpoints, pushed = sender.sent[0]
    assert endpoints == [ENDPOINT]
    assert (pushed.title, pushed.body, pushed.link) == (
        "Orbit",
        "You have a reminder.",
        "/reminders",
    )


@pytest.mark.anyio
async def test_a_reminder_shows_its_content_when_asked(
    client: TestClient, ada: Headers, database: Database, sender: FakeSender
) -> None:
    subscribe(client, ada)
    prefer(client, ada, show_details=True)
    add_reminder(client, ada)

    await ReminderWorker(database, clock=Clock(DUE), push=sender).run_once()

    assert (sender.sent[0][1].title, sender.sent[0][1].body) == (
        "Call the dentist",
        "Ask about Friday.",
    )


@pytest.mark.anyio
async def test_turning_reminders_off_stops_their_push_only(
    client: TestClient, ada: Headers, database: Database, sender: FakeSender
) -> None:
    subscribe(client, ada)
    prefer(client, ada, reminders=False)
    add_reminder(client, ada)

    await ReminderWorker(database, clock=Clock(DUE), push=sender).run_once()

    assert sender.sent == []
    assert client.get("/api/v1/me/notifications", headers=ada).json()["total"] == 1


@pytest.mark.anyio
async def test_a_device_that_is_gone_is_forgotten(
    client: TestClient, ada: Headers, database: Database, sender: FakeSender
) -> None:
    subscribe(client, ada)
    add_reminder(client, ada)
    sender.outcome = "gone"

    await ReminderWorker(database, clock=Clock(DUE), push=sender).run_once()

    assert client.get(PUSH, headers=ada).json()["devices"] == 0


@pytest.mark.anyio
async def test_a_push_failure_never_fails_the_reminder(
    client: TestClient,
    ada: Headers,
    database: Database,
    sender: FakeSender,
    migrated_settings: Settings,
) -> None:
    subscribe(client, ada)
    add_reminder(client, ada)
    sender.error = RuntimeError("push service exploded")

    report = await ReminderWorker(database, clock=Clock(DUE), push=sender).run_once()

    assert report.results == {"delivered": 1}
    assert client.get("/api/v1/me/notifications", headers=ada).json()["total"] == 1
    statuses = query(migrated_settings.sqlite_path, "SELECT status FROM reminder_occurrences")
    assert ("delivered",) in statuses


@pytest.mark.anyio
async def test_a_reminder_is_not_pushed_again_on_the_next_poll(
    client: TestClient, ada: Headers, database: Database, sender: FakeSender
) -> None:
    subscribe(client, ada)
    add_reminder(client, ada)
    worker = ReminderWorker(database, clock=Clock(DUE + timedelta(seconds=1)), push=sender)

    await worker.run_once()
    await worker.run_once()

    assert len(sender.sent) == 1


def schedule_briefing(client: TestClient, headers: Headers) -> None:
    workspace = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]["id"]
    response = client.put(
        f"{WORKSPACES}/{workspace}/briefings/settings",
        json={"horizon_days": 7, "hidden": [], "prepare_at": "00:00"},
        headers=headers,
    )
    assert response.status_code == 200, response.text


def briefing_worker(database: Database, settings: Settings, sender: FakeSender) -> ReminderWorker:
    files = FileAttachmentStore(settings.attachments_dir)
    return ReminderWorker(database, clock=Clock(DUE), files=files, push=sender)


@pytest.mark.anyio
async def test_a_prepared_briefing_is_pushed_once(
    client: TestClient,
    ada: Headers,
    database: Database,
    sender: FakeSender,
    migrated_settings: Settings,
) -> None:
    subscribe(client, ada)
    schedule_briefing(client, ada)
    worker = briefing_worker(database, migrated_settings, sender)

    assert await worker.prepare_briefings() == 1
    assert await worker.prepare_briefings() == 0

    assert len(sender.sent) == 1
    assert (sender.sent[0][1].body, sender.sent[0][1].link) == (
        "Your daily briefing is ready.",
        "/",
    )


@pytest.mark.anyio
async def test_turning_the_briefing_off_stops_its_push(
    client: TestClient,
    ada: Headers,
    database: Database,
    sender: FakeSender,
    migrated_settings: Settings,
) -> None:
    subscribe(client, ada)
    prefer(client, ada, briefing=False)
    schedule_briefing(client, ada)

    assert await briefing_worker(database, migrated_settings, sender).prepare_briefings() == 1

    assert sender.sent == []
