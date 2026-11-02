"""External integrations through the API with a fake provider: connecting (OAuth state, PKCE,
scopes), token storage, refresh, and revocation, multiple accounts, calendar import and
incremental sync, recurring events, duplicates, pagination and checkpoints, rate limits,
conflicts and deletions, two-way changes, webhooks, mail, files, search, and isolation.

Events are in 2030, so they're always ahead of the real clock the API uses.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.scheduler.worker import IntegrationSync, ReminderWorker
from orbit_api.services.calendar.recurrence import EventRecurrence
from orbit_api.services.integrations.connectors import (
    AccountInfo,
    MessageDetail,
    MessageSummary,
    RemoteCalendar,
    RemoteEvent,
    RemoteFile,
    RemoteLabel,
)
from orbit_api.system.attachment_store import FileAttachmentStore
from tests.integration_fakes import FakeProvider, FakeRegistry
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

Headers = dict[str, str]
Json = dict[str, Any]

ADA = AccountInfo("google-ada", "ada@gmail.example", "Ada L")
ADA_WORK = AccountInfo("google-ada-work", "ada@work.example", "Ada at work")
ADA_MS = AccountInfo("ms-ada", "ada@outlook.example", "Ada (Outlook)")
ALL_SCOPES = ("openid", "cal.read", "cal.write", "mail.read", "files.read")
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def event(external_id: str, title: str = "Standup", **fields: Any) -> RemoteEvent:
    values: dict[str, Any] = {
        "external_id": external_id,
        "version": "",
        "title": title,
        "description": "",
        "location": "",
        "all_day": False,
        "timezone": "Europe/London",
        "start": datetime(2030, 1, 14, 9, 0),
        "end": datetime(2030, 1, 14, 9, 30),
    }
    values.update(fields)
    return RemoteEvent(**values)


@pytest.fixture
def google() -> FakeProvider:
    fake = FakeProvider("google")
    fake.calendars = [RemoteCalendar("primary", "Personal", True, "Europe/London", True)]
    fake.labels = [RemoteLabel("INBOX", "Inbox", True), RemoteLabel("Label_1", "Receipts", False)]
    return fake


@pytest.fixture
def microsoft() -> FakeProvider:
    fake = FakeProvider("microsoft", windowed=True)
    fake.calendars = [RemoteCalendar("cal-1", "Calendar", True, None, True)]
    return fake


@pytest.fixture
def app(migrated_settings: Settings, google: FakeProvider, microsoft: FakeProvider) -> FastAPI:
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    app.state.integration_connectors = FakeRegistry(google, microsoft)
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


def workspace(client: TestClient, headers: Headers) -> str:
    return client.get("/api/v1/workspaces", headers=headers).json()["workspaces"][0]["id"]


@pytest.fixture
def ws(client: TestClient, ada: Headers) -> str:
    return f"/api/v1/workspaces/{workspace(client, ada)}"


def sync(client: TestClient, app: FastAPI) -> int:
    """Run the worker's integration job once, as the embedded worker would."""
    settings: Settings = app.state.settings
    worker = ReminderWorker(
        app.state.database,
        files=FileAttachmentStore(settings.attachments_dir),
        integrations=IntegrationSync(settings, app.state.integration_connectors),
    )
    assert client.portal is not None
    return client.portal.call(worker.sync_integrations)


def connect(
    client: TestClient,
    ws: str,
    headers: Headers,
    fake: FakeProvider,
    account: AccountInfo = ADA,
    capabilities: tuple[str, ...] = ("calendar", "calendar_write", "mail", "files"),
    scopes: tuple[str, ...] = ALL_SCOPES,
) -> Json:
    started = client.post(
        f"{ws}/integrations/authorize",
        json={"provider": fake.provider, "capabilities": list(capabilities)},
        headers=headers,
    )
    assert started.status_code == 200, started.text
    state, code = fake.issue_code(started.json()["authorization_url"], account, scopes)
    done = client.post(
        "/api/v1/integrations/oauth/complete", json={"state": state, "code": code}, headers=headers
    )
    assert done.status_code == 200, done.text
    return done.json()


def enable_calendar(
    client: TestClient, ws: str, headers: Headers, connection: Json, **changes: Any
) -> Json:
    base = f"{ws}/integrations/connections/{connection['id']}"
    resource = client.get(base, headers=headers).json()["resources"][0]
    response = client.patch(
        f"{base}/calendars/{resource['id']}", json={"enabled": True, **changes}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def events(client: TestClient, ws: str, headers: Headers) -> list[Json]:
    response = client.get(
        f"{ws}/calendar/range",
        params={"start": "2030-01-01", "end": "2030-03-01", "timezone": "Europe/London"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["occurrences"]


def runs(client: TestClient, ws: str, headers: Headers, connection: Json) -> list[Json]:
    return client.get(
        f"{ws}/integrations/connections/{connection['id']}/runs", headers=headers
    ).json()["runs"]


# Providers and OAuth


def test_providers_list_capabilities_with_purposes(
    client: TestClient, ws: str, ada: Headers
) -> None:
    body = client.get(f"{ws}/integrations/providers", headers=ada).json()
    google = next(p for p in body["providers"] if p["provider"] == "google")
    assert google["configured"] is True
    mail = next(c for c in google["capabilities"] if c["capability"] == "mail")
    assert "never sends" in mail["purpose"]
    assert mail["scopes"] == ["mail.read"]
    assert body["webhooks"] is False


def test_unconfigured_provider_is_listed_but_not_connectable(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    app.state.integration_connectors = FakeRegistry(google)
    body = client.get(f"{ws}/integrations/providers", headers=ada).json()
    assert {p["provider"]: p["configured"] for p in body["providers"]} == {
        "google": True,
        "microsoft": False,
    }
    response = client.post(
        f"{ws}/integrations/authorize",
        json={"provider": "microsoft", "capabilities": ["calendar"]},
        headers=ada,
    )
    assert response.status_code == 409


def test_connecting_uses_pkce_and_stores_only_encrypted_tokens(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    started = client.post(
        f"{ws}/integrations/authorize",
        json={"provider": "google", "capabilities": ["calendar"]},
        headers=ada,
    ).json()["authorization_url"]
    assert "code_challenge=" in started and "state=" in started
    assert "cal.read" in started and "mail.read" not in started  # Only what was asked for.
    state, code = google.issue_code(started, ADA, ("openid", "cal.read"))
    connection = client.post(
        "/api/v1/integrations/oauth/complete", json={"state": state, "code": code}, headers=ada
    ).json()
    assert connection["account_email"] == ADA.email
    assert connection["capabilities"] == ["calendar"]
    assert connection["status"] == "active"
    text = str(connection)
    assert "access-" not in text and "refresh-" not in text

    database = app.state.settings.sqlite_path
    rows = query(
        database,
        "SELECT access_token_ciphertext, refresh_token_ciphertext FROM integration_connections",
    )
    assert rows and not rows[0][0].startswith("access-") and not rows[0][1].startswith("refresh-")
    # The state is stored only as a digest, and is gone once used.
    assert query(database, "SELECT count(*) FROM integration_oauth_states") == [(0,)]
    # The account's calendars are listed but not selected.
    detail = client.get(f"{ws}/integrations/connections/{connection['id']}", headers=ada).json()
    assert [(r["name"], r["enabled"]) for r in detail["resources"]] == [("Personal", False)]


def test_oauth_state_is_single_use_and_bound_to_the_person(
    client: TestClient, ws: str, ada: Headers, grace: Headers, google: FakeProvider
) -> None:
    url = client.post(
        f"{ws}/integrations/authorize",
        json={"provider": "google", "capabilities": ["calendar"]},
        headers=ada,
    ).json()["authorization_url"]
    state, code = google.issue_code(url, ADA, ("cal.read",))
    # Someone else completing Ada's authorization (login CSRF) fails, and burns the state.
    stolen = client.post(
        "/api/v1/integrations/oauth/complete", json={"state": state, "code": code}, headers=grace
    )
    assert stolen.status_code == 400
    replay = client.post(
        "/api/v1/integrations/oauth/complete", json={"state": state, "code": code}, headers=ada
    )
    assert replay.status_code == 400
    unknown = client.post(
        "/api/v1/integrations/oauth/complete",
        json={"state": "x" * 43, "code": code},
        headers=ada,
    )
    assert unknown.status_code == 400


def test_denied_consent_and_missing_scopes_connect_nothing(
    client: TestClient, ws: str, ada: Headers, google: FakeProvider
) -> None:
    def start() -> str:
        return client.post(
            f"{ws}/integrations/authorize",
            json={"provider": "google", "capabilities": ["mail"]},
            headers=ada,
        ).json()["authorization_url"]

    state, _ = google.issue_code(start(), ADA, ())
    denied = client.post(
        "/api/v1/integrations/oauth/complete",
        json={"state": state, "error": "access_denied"},
        headers=ada,
    )
    assert denied.status_code == 400
    assert "wasn't granted" in denied.json()["detail"]

    state, code = google.issue_code(start(), ADA, ("openid",))  # Unticked the mail scope.
    missing = client.post(
        "/api/v1/integrations/oauth/complete", json={"state": state, "code": code}, headers=ada
    )
    assert missing.status_code == 400
    assert client.get(f"{ws}/integrations/connections", headers=ada).json()["connections"] == []


def test_multiple_accounts_and_reconnecting_the_same_one(
    client: TestClient, ws: str, ada: Headers, google: FakeProvider, microsoft: FakeProvider
) -> None:
    first = connect(client, ws, ada, google, ADA)
    connect(client, ws, ada, google, ADA_WORK)
    connect(client, ws, ada, microsoft, ADA_MS)
    again = connect(client, ws, ada, google, ADA)
    assert again["id"] == first["id"]
    emails = [
        c["account_email"]
        for c in client.get(f"{ws}/integrations/connections", headers=ada).json()["connections"]
    ]
    assert sorted(emails) == sorted([ADA.email, ADA_WORK.email, ADA_MS.email])


def test_connections_are_isolated_between_people_and_workspaces(
    client: TestClient, ws: str, ada: Headers, grace: Headers, google: FakeProvider
) -> None:
    connection = connect(client, ws, ada, google)
    grace_ws = f"/api/v1/workspaces/{workspace(client, grace)}"
    assert (
        client.get(f"{grace_ws}/integrations/connections", headers=grace).json()["connections"]
        == []
    )
    assert (
        client.get(
            f"{grace_ws}/integrations/connections/{connection['id']}", headers=grace
        ).status_code
        == 404
    )
    # Ada's workspace through Grace's session is not found either.
    assert client.get(f"{ws}/integrations/connections", headers=grace).status_code == 404
    other = client.post("/api/v1/workspaces", json={"name": "Side"}, headers=ada).json()
    side = f"/api/v1/workspaces/{other['id']}"
    assert (
        client.get(f"{side}/integrations/connections/{connection['id']}", headers=ada).status_code
        == 404
    )


# Calendar synchronization


def test_selecting_a_calendar_imports_its_events_once(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1", "Standup"))
    google.put(
        "primary",
        event(
            "e2", "Dentist", all_day=True, start=datetime(2030, 1, 20), end=datetime(2030, 1, 21)
        ),
    )
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    assert sync(client, app) == 1

    imported = events(client, ws, ada)
    assert sorted(o["title"] for o in imported) == ["Dentist", "Standup"]
    standup = next(o for o in imported if o["title"] == "Standup")
    assert standup["timezone"] == "Europe/London" and standup["start"].startswith(
        "2030-01-14T09:00"
    )
    run = runs(client, ws, ada, connection)[0]
    assert (run["status"], run["imported"], run["full"]) == ("succeeded", 2, True)

    # Synchronizing again, with nothing new, changes nothing and imports nothing twice.
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)
    assert len(events(client, ws, ada)) == 2
    latest = runs(client, ws, ada, connection)[0]
    assert (latest["imported"], latest["full"]) == (0, False)

    # The origin of an imported event is visible.
    origins = client.get(
        f"{ws}/integrations/origins",
        params={"entity_type": "event", "entity_id": standup["event_id"]},
        headers=ada,
    ).json()["origins"]
    assert origins[0]["provider"] == "google" and origins[0]["resource_name"] == "Personal"
    assert origins[0]["two_way"] is False


def test_incremental_changes_and_deletions(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1", "Standup"))
    google.put("primary", event("e2", "Lunch"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)

    google.put(
        "primary",
        event(
            "e1",
            "Standup (moved)",
            start=datetime(2030, 1, 14, 10, 0),
            end=datetime(2030, 1, 14, 10, 30),
        ),
    )
    google.remove("primary", "e2")
    google.put("primary", event("e3", "Review"))
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)

    titles = {o["title"]: o["start"] for o in events(client, ws, ada)}
    assert set(titles) == {"Standup (moved)", "Review"}
    assert titles["Standup (moved)"].startswith("2030-01-14T10:00")
    run = runs(client, ws, ada, connection)[0]
    assert (run["imported"], run["updated"], run["deleted"]) == (1, 1, 1)


def test_imported_events_are_found_by_search(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1", "Quarterly planning", location="Room 4"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    found = client.get(f"{ws}/search", params={"q": "quarterly"}, headers=ada).json()
    calendar = next(g for g in found["groups"] if g["module"] == "events")
    assert [hit["title"] for hit in calendar["hits"]] == ["Quarterly planning"]


def test_recurring_series_with_changed_and_cancelled_occurrences(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    rule = EventRecurrence(frequency="weekly", weekdays=frozenset({"mon"}), count=4)
    google.put("primary", event("series", "Weekly sync", recurrence=rule))
    # The second Monday moved an hour later; the third cancelled.
    google.put(
        "primary",
        event(
            "series_20300121",
            "Weekly sync (late)",
            parent_id="series",
            original_start=datetime(2030, 1, 21, 9, 0),
            start=datetime(2030, 1, 21, 10, 0),
            end=datetime(2030, 1, 21, 10, 30),
        ),
    )
    google.put(
        "primary",
        event(
            "series_20300128",
            "",
            parent_id="series",
            original_start=datetime(2030, 1, 28, 9, 0),
            cancelled=True,
        ),
    )
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)

    occurrences = events(client, ws, ada)
    assert [(o["title"], o["start"][:16]) for o in occurrences] == [
        ("Weekly sync", "2030-01-14T09:00"),
        ("Weekly sync (late)", "2030-01-21T10:00"),
        ("Weekly sync", "2030-02-04T09:00"),
    ]
    assert all(o["recurring"] for o in occurrences)
    assert len({o["event_id"] for o in occurrences}) == 1  # One Orbit series, not copies.


def test_occurrences_arriving_before_their_series_are_adopted(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    """With small pages, an occurrence can come a page before its series."""
    google.page_size = 1
    rule = EventRecurrence(frequency="daily", count=3)
    # Sorted by ID, "a-…" (the occurrence) comes before "b-series".
    google.put("primary", event("b-series", "Daily", recurrence=rule))
    google.put(
        "primary",
        event(
            "a-occurrence",
            "Daily (changed)",
            parent_id="b-series",
            original_start=datetime(2030, 1, 15, 9, 0),
            start=datetime(2030, 1, 15, 11, 0),
            end=datetime(2030, 1, 15, 11, 30),
        ),
    )
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    occurrences = events(client, ws, ada)
    assert [(o["title"], o["start"][:16]) for o in occurrences] == [
        ("Daily", "2030-01-14T09:00"),
        ("Daily (changed)", "2030-01-15T11:00"),
        ("Daily", "2030-01-16T09:00"),
    ]


def test_expanded_occurrences_of_unsupported_rules_are_standalone(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, microsoft: FakeProvider
) -> None:
    for day in (6, 13):
        microsoft.put(
            "cal-1",
            event(
                f"occ-{day}",
                "Book club",
                parent_id="master",
                expanded=True,
                timezone="UTC",
                start=datetime(2030, 2, day, 18, 0),
                end=datetime(2030, 2, day, 19, 0),
            ),
        )
    connection = connect(client, ws, ada, microsoft, ADA_MS)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    occurrences = events(client, ws, ada)
    assert [o["title"] for o in occurrences] == ["Book club", "Book club"]
    assert not any(o["recurring"] for o in occurrences)


def test_pagination_checkpoints_and_resuming_an_interrupted_run(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.page_size = 2
    for i in range(7):
        google.put(
            "primary",
            event(
                f"e{i}",
                f"Event {i}",
                start=datetime(2030, 1, 10 + i, 9),
                end=datetime(2030, 1, 10 + i, 10),
            ),
        )
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    # A run yields after a bounded number of pages, keeping its checkpoint.
    settings: Settings = app.state.settings
    from orbit_api.services.integrations import calendar_sync

    original = calendar_sync.MAX_PAGES_PER_RUN
    calendar_sync.MAX_PAGES_PER_RUN = 2
    try:
        worker = ReminderWorker(
            app.state.database,
            integrations=IntegrationSync(settings, app.state.integration_connectors),
        )
        assert client.portal is not None
        client.portal.call(worker.sync_integrations)
        assert len(events(client, ws, ada)) == 4
        assert runs(client, ws, ada, connection)[0]["status"] == "queued"
        checkpoint = query(settings.sqlite_path, "SELECT checkpoint FROM integration_resources")
        assert checkpoint[0][0] is not None
        # A new worker (after a restart) continues from the checkpoint.
        worker = ReminderWorker(
            app.state.database,
            integrations=IntegrationSync(settings, app.state.integration_connectors),
        )
        assert client.portal is not None
        client.portal.call(worker.sync_integrations)
    finally:
        calendar_sync.MAX_PAGES_PER_RUN = original
    assert len(events(client, ws, ada)) == 7
    run = runs(client, ws, ada, connection)[0]
    assert (run["status"], run["imported"]) == ("succeeded", 7)


def test_expired_cursor_triggers_a_full_sync_that_reconciles_deletions(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1", "Keep"))
    google.put("primary", event("e2", "Gone"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    # The provider forgets e2 without logging it, and invalidates the sync token.
    google.events["primary"].pop("e2")
    google.expire_next_cursor = True
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)
    assert [o["title"] for o in events(client, ws, ada)] == ["Keep"]
    run = runs(client, ws, ada, connection)[0]
    assert run["full"] is True and run["deleted"] == 1


def test_rate_limits_back_off_and_retry(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1"))
    google.rate_limits = 1
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    run = runs(client, ws, ada, connection)[0]
    assert run["status"] == "queued" and run["attempts"] == 1
    assert "rate limiting" in run["error"]
    assert run["next_attempt_at"] is not None
    # Due now (the test skips the wait), the retry succeeds.
    query(
        app.state.settings.sqlite_path,
        "UPDATE integration_sync_runs SET next_attempt_at = '2000-01-01 00:00:00'",
    )
    sync(client, app)
    assert runs(client, ws, ada, connection)[0]["status"] == "succeeded"
    assert len(events(client, ws, ada)) == 1


def test_one_failing_provider_does_not_stop_another(
    client: TestClient,
    app: FastAPI,
    ws: str,
    ada: Headers,
    google: FakeProvider,
    microsoft: FakeProvider,
) -> None:
    google.put("primary", event("g1", "From Google"))
    microsoft.put("cal-1", event("m1", "From Outlook", timezone="UTC"))
    g = connect(client, ws, ada, google)
    m = connect(client, ws, ada, microsoft, ADA_MS)
    enable_calendar(client, ws, ada, g)
    enable_calendar(client, ws, ada, m)
    google.revoke_all()  # Google's tokens stop working.
    sync(client, app)
    assert [o["title"] for o in events(client, ws, ada)] == ["From Outlook"]
    assert runs(client, ws, ada, g)[0]["status"] == "failed"
    assert runs(client, ws, ada, m)[0]["status"] == "succeeded"


# Tokens


def test_expired_access_tokens_are_refreshed_once(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1"))
    google.token_lifetime = timedelta(seconds=30)  # Inside the refresh margin.
    connection = connect(client, ws, ada, google)
    assert google.refreshes == 1  # Listing calendars after connecting needed a fresh token.
    enable_calendar(client, ws, ada, connection)
    google.token_lifetime = timedelta(hours=1)
    sync(client, app)
    assert len(events(client, ws, ada)) == 1
    before = google.refreshes
    # A token revoked early (refused before its expiry) is refreshed and the call retried.
    google.access.clear()
    check = client.post(f"{ws}/integrations/connections/{connection['id']}/check", headers=ada)
    assert check.json()["status"] == "active"
    assert google.refreshes == before + 1


def test_revoked_consent_requires_reconnecting_and_notifies(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    google.revoke_all()
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)
    detail = client.get(f"{ws}/integrations/connections/{connection['id']}", headers=ada).json()
    assert detail["connection"]["status"] == "reauth_required"
    assert detail["runs"][0]["status"] == "failed"
    # Imported data is kept.
    assert len(events(client, ws, ada)) == 1
    inbox = client.get("/api/v1/me/notifications", headers=ada).json()["notifications"]
    assert inbox[0]["title"] == f"Reconnect {ADA.email}"
    # Synchronizing is refused until reconnected; reconnecting restores it.
    refused = client.post(
        f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada
    )
    assert refused.status_code == 409
    connect(client, ws, ada, google)
    detail = client.get(f"{ws}/integrations/connections/{connection['id']}", headers=ada).json()
    assert detail["connection"]["status"] == "active"


def test_disconnecting_revokes_and_deletes_tokens(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    kept = client.delete(f"{ws}/integrations/connections/{connection['id']}", headers=ada).json()
    assert kept == {"revoked": True, "removed_events": 0, "trashed_documents": 0}
    assert google.revoked and google.revoked[0].startswith("refresh-")
    database = app.state.settings.sqlite_path
    assert query(database, "SELECT count(*) FROM integration_connections") == [(0,)]
    assert query(database, "SELECT count(*) FROM integration_links") == [(0,)]
    # The imported event stays, as an ordinary Orbit event.
    assert len(events(client, ws, ada)) == 1


def test_disconnecting_can_remove_imported_records(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, microsoft: FakeProvider
) -> None:
    microsoft.put("cal-1", event("m1", timezone="UTC"))
    connection = connect(client, ws, ada, microsoft, ADA_MS)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    result = client.delete(
        f"{ws}/integrations/connections/{connection['id']}",
        params={"remove_imported": "true"},
        headers=ada,
    ).json()
    # Microsoft has no revocation endpoint for one app; the response says so.
    assert result == {"revoked": False, "removed_events": 1, "trashed_documents": 0}
    assert events(client, ws, ada) == []


# Conflicts and two-way changes


def _first_event_id(client: TestClient, ws: str, ada: Headers) -> str:
    return events(client, ws, ada)[0]["event_id"]


def test_changes_on_both_sides_become_a_conflict_and_nothing_is_overwritten(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1", "Standup"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    event_id = _first_event_id(client, ws, ada)
    client.patch(f"{ws}/calendar/events/{event_id}", json={"title": "Standup (Orbit)"}, headers=ada)
    google.put("primary", event("e1", "Standup (Google)"))
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)

    assert events(client, ws, ada)[0]["title"] == "Standup (Orbit)"
    conflicts = client.get(f"{ws}/integrations/conflicts", headers=ada).json()["conflicts"]
    assert len(conflicts) == 1
    assert conflicts[0]["link"]["conflict_kind"] == "both_changed"
    assert conflicts[0]["external"]["title"] == "Standup (Google)"

    resolved = client.post(
        f"{ws}/integrations/conflicts/{conflicts[0]['link']['id']}/resolve",
        json={"resolution": "keep_external"},
        headers=ada,
    )
    assert resolved.json()["link"]["status"] == "synced"
    assert events(client, ws, ada)[0]["title"] == "Standup (Google)"
    assert client.get(f"{ws}/integrations/conflicts", headers=ada).json()["conflicts"] == []


def test_keeping_orbits_version_on_an_import_only_calendar(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1", "Standup"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    event_id = _first_event_id(client, ws, ada)
    client.patch(f"{ws}/calendar/events/{event_id}", json={"title": "Mine"}, headers=ada)
    google.put("primary", event("e1", "Theirs"))
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)
    link = client.get(f"{ws}/integrations/conflicts", headers=ada).json()["conflicts"][0]["link"]
    kept = client.post(
        f"{ws}/integrations/conflicts/{link['id']}/resolve",
        json={"resolution": "keep_orbit"},
        headers=ada,
    ).json()["link"]
    assert kept["status"] == "local_changes"
    assert google.pushes == []  # Import-only: nothing is sent.
    assert events(client, ws, ada)[0]["title"] == "Mine"


def test_deleted_externally_after_an_orbit_change_is_kept(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1", "Standup"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    event_id = _first_event_id(client, ws, ada)
    client.patch(f"{ws}/calendar/events/{event_id}", json={"location": "Room 2"}, headers=ada)
    google.remove("primary", "e1")
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)
    conflict = client.get(f"{ws}/integrations/conflicts", headers=ada).json()["conflicts"][0]
    assert conflict["link"]["conflict_kind"] == "deleted_remotely"
    assert conflict["external"] is None
    assert len(events(client, ws, ada)) == 1
    detached = client.post(
        f"{ws}/integrations/conflicts/{conflict['link']['id']}/resolve",
        json={"resolution": "keep_orbit"},
        headers=ada,
    ).json()
    assert detached == {"link": None}
    assert len(events(client, ws, ada)) == 1
    origins = client.get(
        f"{ws}/integrations/origins",
        params={"entity_type": "event", "entity_id": event_id},
        headers=ada,
    ).json()["origins"]
    assert origins == []  # Now an Orbit-only event.


def test_events_deleted_in_orbit_are_not_imported_again(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1", "Standup"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    client.delete(f"{ws}/calendar/events/{_first_event_id(client, ws, ada)}", headers=ada)
    google.put("primary", event("e1", "Standup (renamed)"))
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)
    assert events(client, ws, ada) == []
    assert google.pushes == []  # And the deletion isn't sent to Google.


def test_two_way_calendars_send_orbit_changes_with_the_known_version(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1", "Standup"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection, direction="two_way")
    sync(client, app)
    known = google.events["primary"]["e1"].version
    event_id = _first_event_id(client, ws, ada)
    client.patch(
        f"{ws}/calendar/events/{event_id}", json={"title": "Standup (edited in Orbit)"}, headers=ada
    )
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)
    assert [(p[0], p[1].title, p[2]) for p in google.pushes] == [
        ("e1", "Standup (edited in Orbit)", known)
    ]
    assert google.events["primary"]["e1"].title == "Standup (edited in Orbit)"
    assert runs(client, ws, ada, connection)[0]["exported"] == 1
    # The provider's echo of Orbit's own change isn't a conflict.
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)
    assert client.get(f"{ws}/integrations/conflicts", headers=ada).json()["conflicts"] == []


def test_two_way_needs_the_write_capability(
    client: TestClient, ws: str, ada: Headers, google: FakeProvider
) -> None:
    connection = connect(client, ws, ada, google, capabilities=("calendar",), scopes=("cal.read",))
    base = f"{ws}/integrations/connections/{connection['id']}"
    resource = client.get(base, headers=ada).json()["resources"][0]
    response = client.patch(
        f"{base}/calendars/{resource['id']}", json={"direction": "two_way"}, headers=ada
    )
    assert response.status_code == 409


def test_adding_an_orbit_event_to_an_external_calendar(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    connection = connect(client, ws, ada, google)
    resource = enable_calendar(client, ws, ada, connection, direction="two_way")
    created = client.post(
        f"{ws}/calendar/events",
        json={
            "title": "Dinner",
            "start": "2030-01-18T19:00",
            "end": "2030-01-18T21:00",
            "timezone": "Europe/London",
        },
        headers=ada,
    ).json()
    url = f"{ws}/integrations/connections/{connection['id']}/calendars/{resource['id']}/events"
    link = client.post(url, json={"event_id": created["id"]}, headers=ada)
    assert link.status_code == 201, link.text
    assert link.json()["origin"] == "orbit"
    assert google.pushes[0][0] == "create" and google.pushes[0][1].title == "Dinner"
    again = client.post(url, json={"event_id": created["id"]}, headers=ada)
    assert again.status_code == 409
    # Synchronizing doesn't import Orbit's own event back as a copy.
    sync(client, app)
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)
    assert [o["title"] for o in events(client, ws, ada)] == ["Dinner"]


# Runs


def test_cancelling_and_retrying_runs(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.put("primary", event("e1"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    base = f"{ws}/integrations/connections/{connection['id']}"
    run = runs(client, ws, ada, connection)[0]
    cancelled = client.post(f"{base}/runs/{run['id']}/cancel", headers=ada).json()
    assert cancelled["status"] == "cancelled"
    sync(client, app)
    assert events(client, ws, ada) == []
    assert client.post(f"{base}/runs/{run['id']}/cancel", headers=ada).status_code == 409
    retried = client.post(f"{base}/runs/{run['id']}/retry", headers=ada)
    assert retried.status_code == 202 and retried.json()["trigger"] == "retry"
    sync(client, app)
    assert len(events(client, ws, ada)) == 1


def test_an_unexpected_failure_is_recorded_and_retried(
    client: TestClient,
    app: FastAPI,
    ws: str,
    ada: Headers,
    google: FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    google.put("primary", event("e1"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    from orbit_api.services.integrations.calendar_sync import CalendarSync

    original = CalendarSync.process
    calls = {"n": 0}

    async def crash_once(self: CalendarSync, *args: Any) -> Any:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")
        return await original(self, *args)

    monkeypatch.setattr(CalendarSync, "process", crash_once)
    sync(client, app)
    run = runs(client, ws, ada, connection)[0]
    assert run["status"] == "queued" and run["attempts"] == 1
    assert "RuntimeError" in run["error"] and "boom" not in run["error"]
    query(
        app.state.settings.sqlite_path,
        "UPDATE integration_sync_runs SET next_attempt_at = '2000-01-01 00:00:00'",
    )
    sync(client, app)
    assert runs(client, ws, ada, connection)[0]["status"] == "succeeded"


def test_scheduled_synchronization_is_queued_when_due(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection, sync_interval_minutes=15)
    sync(client, app)  # The initial run.
    google.put("primary", event("e1", "Later"))
    sync(client, app)
    assert events(client, ws, ada) == []  # Not due yet.
    query(
        app.state.settings.sqlite_path,
        "UPDATE integration_resources SET next_sync_at = '2000-01-01 00:00:00'",
    )
    sync(client, app)
    assert [o["title"] for o in events(client, ws, ada)] == ["Later"]
    assert runs(client, ws, ada, connection)[0]["trigger"] == "scheduled"


# Webhooks


def test_google_push_notifications_are_verified(
    client: TestClient,
    app: FastAPI,
    ws: str,
    ada: Headers,
    google: FakeProvider,
    migrated_settings: Settings,
) -> None:
    app.state.settings = migrated_settings.model_copy(
        update={"integrations_webhook_url": "https://orbit.example/api/v1/integrations/webhooks"}
    )
    google.put("primary", event("e1"))
    connection = connect(client, ws, ada, google)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    channel = query(
        app.state.settings.sqlite_path,
        "SELECT channel_id, channel_token_hash FROM integration_resources",
    )[0]
    assert channel[0] and channel[1] and google.watches[0] not in str(channel)

    url = "/api/v1/integrations/webhooks/google"
    forged = client.post(
        url,
        headers={
            "X-Goog-Channel-ID": channel[0],
            "X-Goog-Channel-Token": "wrong",
            "X-Goog-Resource-State": "exists",
        },
    )
    assert forged.status_code == 404
    assert client.post(url).status_code == 404
    genuine = client.post(
        url,
        headers={
            "X-Goog-Channel-ID": channel[0],
            "X-Goog-Channel-Token": google.watches[0],
            "X-Goog-Resource-State": "exists",
        },
    )
    assert genuine.status_code == 204
    assert runs(client, ws, ada, connection)[0]["trigger"] == "webhook"


def test_microsoft_validation_and_client_state(
    client: TestClient,
    app: FastAPI,
    ws: str,
    ada: Headers,
    microsoft: FakeProvider,
    migrated_settings: Settings,
) -> None:
    url = "/api/v1/integrations/webhooks/microsoft"
    echoed = client.post(url, params={"validationToken": "abc 123"})
    assert echoed.status_code == 200 and echoed.text == "abc 123"
    assert echoed.headers["content-type"].startswith("text/plain")

    app.state.settings = migrated_settings.model_copy(
        update={"integrations_webhook_url": "https://orbit.example/api/v1/integrations/webhooks"}
    )
    connection = connect(client, ws, ada, microsoft, ADA_MS)
    enable_calendar(client, ws, ada, connection)
    sync(client, app)
    channel_id = query(
        app.state.settings.sqlite_path, "SELECT channel_id FROM integration_resources"
    )[0][0]
    before = len(runs(client, ws, ada, connection))
    forged = client.post(
        url, json={"value": [{"subscriptionId": channel_id, "clientState": "nope"}]}
    )
    assert forged.status_code == 202
    assert len(runs(client, ws, ada, connection)) == before
    client.post(
        url, json={"value": [{"subscriptionId": channel_id, "clientState": microsoft.watches[0]}]}
    )
    assert len(runs(client, ws, ada, connection)) == before + 1
    assert client.post(url, content=b"not json").status_code == 400


# Mail


def _message(
    message_id: str, subject: str, label: str = "INBOX", days_ago: int = 1
) -> MessageDetail:
    return MessageDetail(
        MessageSummary(
            external_id=message_id,
            thread_id=f"t-{message_id}",
            subject=subject,
            sender="Shop <shop@example.com>",
            received_at=datetime.now(UTC) - timedelta(days=days_ago),
            snippet="Your order",
            label_ids=(label,),
            url=f"https://mail.example/{message_id}",
        ),
        ("ada@gmail.example",),
        "Your order has shipped.",
    )


def test_mail_is_shown_only_from_chosen_labels_and_dates(
    client: TestClient, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.messages = {
        "m1": _message("m1", "Order shipped"),
        "m2": _message("m2", "Old newsletter", days_ago=200),
        "m3": _message("m3", "Receipt", label="Label_1"),
    }
    connection = connect(client, ws, ada, google)
    base = f"{ws}/integrations/connections/{connection['id']}/mail"
    # Nothing is listed until a label is chosen.
    assert (
        client.get(f"{base}/messages", params={"label_id": "INBOX"}, headers=ada).status_code == 403
    )
    labels = client.put(
        f"{base}/labels", json={"label_ids": ["INBOX", "made-up"]}, headers=ada
    ).json()["labels"]
    assert {label["id"]: label["selected"] for label in labels} == {"INBOX": True, "Label_1": False}

    listed = client.get(f"{base}/messages", params={"label_id": "INBOX"}, headers=ada).json()
    assert [m["subject"] for m in listed["messages"]] == [
        "Order shipped"
    ]  # Old mail is out of range.
    assert (
        client.get(f"{base}/messages", params={"label_id": "Label_1"}, headers=ada).status_code
        == 403
    )
    assert client.get(f"{base}/messages/m3", headers=ada).status_code == 403
    assert client.get(f"{base}/messages/m2", headers=ada).status_code == 403
    detail = client.get(f"{base}/messages/m1", headers=ada).json()
    assert detail["body"] == "Your order has shipped." and detail["links"] == []


def test_tasks_notes_and_reminders_from_an_email_are_linked(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.messages = {"m1": _message("m1", "Pay the invoice")}
    connection = connect(client, ws, ada, google)
    base = f"{ws}/integrations/connections/{connection['id']}/mail"
    client.put(f"{base}/labels", json={"label_ids": ["INBOX"]}, headers=ada)

    task = client.post(f"{base}/messages/m1/task", json={"title": "Pay the invoice"}, headers=ada)
    assert task.status_code == 201, task.text
    note = client.post(
        f"{base}/messages/m1/note", json={"title": "Invoice", "text": "Due soon"}, headers=ada
    )
    assert note.status_code == 201, note.text
    reminder = client.post(
        f"{base}/messages/m1/reminder",
        json={
            "title": "Pay",
            "start_date": "2030-01-05",
            "time_of_day": "09:00",
            "timezone": "UTC",
        },
        headers=ada,
    )
    assert reminder.status_code == 201, reminder.text

    links = client.get(f"{base}/messages/m1", headers=ada).json()["links"]
    assert sorted(link["entity_type"] for link in links) == ["note", "reminder", "task"]
    assert all(link["title"] == "Pay the invoice" and link["origin"] == "linked" for link in links)
    task_id = task.json()["id"]
    assert client.get(f"{ws}/tasks/{task_id}", headers=ada).json()["title"] == "Pay the invoice"
    origins = client.get(
        f"{ws}/integrations/origins",
        params={"entity_type": "task", "entity_id": task_id},
        headers=ada,
    ).json()["origins"]
    assert origins[0]["link"]["external_url"] == "https://mail.example/m1"
    # No message content is stored, only links.
    stored = query(app.state.settings.sqlite_path, "SELECT remote_snapshot FROM integration_links")
    assert all(row[0] in (None, "null") for row in stored)
    # Out-of-scope mail can't be turned into records.
    google.messages["m9"] = _message("m9", "Hidden", label="Label_1")
    assert (
        client.post(f"{base}/messages/m9/task", json={"title": "x"}, headers=ada).status_code == 403
    )


def test_mail_needs_the_mail_capability(
    client: TestClient, ws: str, ada: Headers, google: FakeProvider
) -> None:
    connection = connect(client, ws, ada, google, capabilities=("calendar",), scopes=("cal.read",))
    response = client.get(
        f"{ws}/integrations/connections/{connection['id']}/mail/labels", headers=ada
    )
    assert response.status_code == 409


# Files


def _file(
    file_id: str, name: str, version: str = "1", parent: str = "root", folder: bool = False
) -> RemoteFile:
    return RemoteFile(
        external_id=file_id,
        name=name,
        folder=folder,
        mime_type="application/pdf" if not folder else "folder",
        size=len(PDF),
        modified_at=datetime(2030, 1, 1, tzinfo=UTC),
        version=version,
        parent_id=parent,
        url=f"https://drive.example/{file_id}",
    )


def test_importing_files_into_documents_and_detecting_changes(
    client: TestClient, app: FastAPI, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.files = {
        "f1": (_file("f1", "Lease.pdf"), PDF),
        "dir": (_file("dir", "Taxes", folder=True), b""),
        "f2": (_file("f2", "Return.pdf", parent="dir"), PDF),
    }
    connection = connect(client, ws, ada, google)
    base = f"{ws}/integrations/connections/{connection['id']}/files"
    root = client.get(base, headers=ada).json()["files"]
    assert [f["name"] for f in root] == ["Lease.pdf", "Taxes"]
    inside = client.get(base, params={"folder_id": "dir"}, headers=ada).json()["files"]
    assert [f["name"] for f in inside] == ["Return.pdf"]
    assert client.post(f"{base}/dir/import", json={}, headers=ada).status_code == 422

    imported = client.post(f"{base}/f1/import", json={}, headers=ada)
    assert imported.status_code == 201, imported.text
    document_id = imported.json()["document_id"]
    detail = client.get(f"{ws}/documents/{document_id}", headers=ada).json()
    assert detail["document"]["title"] == "Lease"
    duplicate = client.post(f"{base}/f1/import", json={}, headers=ada)
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "This file is already in Documents."
    listed = client.get(base, headers=ada).json()["files"]
    assert listed[0]["imported"]["entity_id"] == document_id

    # Changed at the provider: marked, never overwritten.
    google.files["f1"] = (_file("f1", "Lease.pdf", version="2"), PDF + b"%more\n")
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)
    link = client.get(base, headers=ada).json()["files"][0]["imported"]
    assert link["status"] == "update_available"
    updated = client.post(f"{base}/links/{link['id']}/update", headers=ada)
    assert updated.status_code == 200, updated.text
    assert updated.json()["link"]["status"] == "synced"
    detail = client.get(f"{ws}/documents/{document_id}", headers=ada).json()
    assert len(detail["versions"]) == 2

    # Deleted at the provider: the document is kept, the link says so.
    del google.files["f1"]
    client.post(f"{ws}/integrations/connections/{connection['id']}/sync", json={}, headers=ada)
    sync(client, app)
    assert query(app.state.settings.sqlite_path, "SELECT status FROM integration_links") == [
        ("missing",)
    ]
    assert client.get(f"{ws}/documents/{document_id}", headers=ada).status_code == 200


def test_files_are_validated_like_uploads(
    client: TestClient, ws: str, ada: Headers, google: FakeProvider
) -> None:
    google.files = {"x": (_file("x", "Fake.pdf"), b"MZ\x90\x00 not a pdf")}
    connection = connect(client, ws, ada, google)
    response = client.post(
        f"{ws}/integrations/connections/{connection['id']}/files/x/import", json={}, headers=ada
    )
    assert response.status_code == 415
    assert client.get(f"{ws}/documents", headers=ada).json()["documents"] == []


def test_workspace_deletion_removes_its_connections(
    client: TestClient, app: FastAPI, ada: Headers, google: FakeProvider
) -> None:
    other = client.post("/api/v1/workspaces", json={"name": "Side"}, headers=ada).json()
    side = f"/api/v1/workspaces/{other['id']}"
    connect(client, side, ada, google)
    assert client.delete(side, headers=ada).status_code == 204
    assert query(
        app.state.settings.sqlite_path, "SELECT count(*) FROM integration_connections"
    ) == [(0,)]


def test_unknown_ids_are_not_found(client: TestClient, ws: str, ada: Headers) -> None:
    missing = uuid.uuid4()
    assert client.get(f"{ws}/integrations/connections/{missing}", headers=ada).status_code == 404
    response = client.post(
        f"{ws}/integrations/conflicts/{missing}/resolve",
        json={"resolution": "keep_orbit"},
        headers=ada,
    )
    assert response.status_code == 404
