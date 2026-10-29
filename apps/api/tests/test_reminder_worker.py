"""The reminder worker and notifications, driven by a controllable clock.

Reminders are created through the API, which schedules them with the real clock (they are in
2030, so always in the future). The worker runs against the same SQLite file through its own
`Database`, as a separate worker process would, with a clock the test moves.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.database import Database, open_database
from orbit_api.main import create_app
from orbit_api.repositories.notifications import SqlNotificationRepository
from orbit_api.repositories.reminders import SqlOccurrenceRepository
from orbit_api.scheduler.worker import ReminderWorker, WorkerReport
from orbit_api.services.notifications.models import Notification
from orbit_api.services.reminders.models import ClaimedOccurrence
from orbit_api.services.transactions import ConflictError
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

pytestmark = pytest.mark.anyio

WORKSPACES = "/api/v1/workspaces"
NOTIFICATIONS = "/api/v1/me/notifications"
# 09:00 in Paris on 2030-01-15 (UTC+1).
DUE = datetime(2030, 1, 15, 8, 0, tzinfo=UTC)

Headers = dict[str, str]


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta: float) -> None:
        self.now += timedelta(**delta)


@pytest.fixture
def client(migrated_settings: Settings) -> Iterator[TestClient]:
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def grace(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="grace@example.com", display_name="Grace"))


def workspace_url(client: TestClient, headers: Headers) -> str:
    workspace: dict[str, Any] = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}"


@pytest.fixture
def home(client: TestClient, ada: Headers) -> str:
    return workspace_url(client, ada)


@pytest.fixture
async def database(migrated_settings: Settings) -> AsyncIterator[Database]:
    database = await open_database(migrated_settings)
    yield database
    await database.dispose()


@pytest.fixture
def clock() -> Clock:
    return Clock(DUE - timedelta(minutes=1))


@pytest.fixture
def worker(database: Database, clock: Clock) -> ReminderWorker:
    return ReminderWorker(database, clock=clock, max_attempts=3)


def create(client: TestClient, home: str, headers: Headers, **fields: Any) -> dict[str, Any]:
    body = {
        "title": "Reminder",
        "start_date": "2030-01-15",
        "time_of_day": "09:00",
        "timezone": "Europe/Paris",
        **fields,
    }
    response = client.post(f"{home}/reminders", json=body, headers=headers)
    assert response.status_code == 201, response.text
    reminder: dict[str, Any] = response.json()
    return reminder


def reminder(client: TestClient, home: str, headers: Headers, reminder_id: str) -> dict[str, Any]:
    response = client.get(f"{home}/reminders/{reminder_id}", headers=headers)
    assert response.status_code == 200, response.text
    found: dict[str, Any] = response.json()
    return found


def inbox(client: TestClient, headers: Headers, **params: Any) -> dict[str, Any]:
    response = client.get(NOTIFICATIONS, params={"limit": 100, **params}, headers=headers)
    assert response.status_code == 200, response.text
    page: dict[str, Any] = response.json()
    return page


def occurrences(settings: Settings) -> list[tuple[Any, ...]]:
    """(scheduled_for, status, attempts) of every occurrence, oldest first."""
    return query(
        settings.sqlite_path,
        "SELECT scheduled_for, status, attempts FROM reminder_occurrences ORDER BY scheduled_for",
    )


async def claim(database: Database, now: datetime, lease: timedelta) -> list[ClaimedOccurrence]:
    """Claim due occurrences as a worker would, then do nothing with them (as if it died)."""
    async with database.session() as session:
        claims = await SqlOccurrenceRepository(session).claim_due(now, now + lease, 50)
        await session.commit()
    return claims


# Delivery


async def test_due_occurrence_is_delivered_once(
    client: TestClient, ada: Headers, home: str, worker: ReminderWorker, clock: Clock
) -> None:
    created = create(client, home, ada, title="Call the dentist", description="Ask about Friday.")

    assert (await worker.run_once()).claimed == 0  # Not due yet.
    clock.now = DUE
    report = await worker.run_once()
    assert report.claimed == 1
    assert report.results == {"delivered": 1}
    assert (await worker.run_once()).claimed == 0  # Nothing left: no second delivery.

    page = inbox(client, ada)
    assert page["total"] == page["unread"] == 1
    notification = page["notifications"][0]
    assert notification["title"] == "Call the dentist"
    assert notification["body"] == "Ask about Friday."
    assert notification["reminder_id"] == created["id"]
    assert notification["workspace_id"] == created["workspace_id"]
    assert notification["scheduled_for"] == "2030-01-15T08:00:00Z"
    assert notification["created_at"] == "2030-01-15T08:00:00Z"
    assert notification["read_at"] is None

    done = reminder(client, home, ada, created["id"])
    assert done["status"] == "completed"
    assert done["next_occurrence_at"] is None
    assert done["last_outcome"] == "delivered"
    assert done["last_occurrence_at"] == "2030-01-15T08:00:00Z"


async def test_recurring_reminder_schedules_its_next_occurrence(
    client: TestClient,
    ada: Headers,
    home: str,
    worker: ReminderWorker,
    clock: Clock,
    migrated_settings: Settings,
) -> None:
    created = create(client, home, ada, recurrence={"frequency": "daily"})

    for _ in range(3):
        clock.now = datetime.fromisoformat(
            reminder(client, home, ada, created["id"])["next_occurrence_at"]
        )
        assert (await worker.run_once()).results == {"delivered": 1}

    assert [n["scheduled_for"] for n in inbox(client, ada)["notifications"]] == [
        "2030-01-17T08:00:00Z",
        "2030-01-16T08:00:00Z",
        "2030-01-15T08:00:00Z",
    ]
    assert (
        reminder(client, home, ada, created["id"])["next_occurrence_at"] == "2030-01-18T08:00:00Z"
    )
    assert [row[1] for row in occurrences(migrated_settings)] == [
        "delivered",
        "delivered",
        "delivered",
        "pending",
    ]


async def test_downtime_delivers_one_late_notification_then_resumes(
    client: TestClient, ada: Headers, home: str, worker: ReminderWorker, clock: Clock
) -> None:
    created = create(client, home, ada, recurrence={"frequency": "daily"})

    # The worker was stopped for three and a half days.
    clock.now = DUE + timedelta(days=3, hours=12)
    assert (await worker.run_once()).results == {"delivered": 1}

    notifications = inbox(client, ada)["notifications"]
    assert [n["scheduled_for"] for n in notifications] == ["2030-01-15T08:00:00Z"]
    assert notifications[0]["created_at"] == "2030-01-18T20:00:00Z"
    # Missed occurrences are not replayed; the next is the first one still ahead.
    assert (
        reminder(client, home, ada, created["id"])["next_occurrence_at"] == "2030-01-19T08:00:00Z"
    )
    assert (await worker.run_once()).claimed == 0


async def test_pending_occurrences_survive_a_restart(
    client: TestClient, ada: Headers, home: str, migrated_settings: Settings, clock: Clock
) -> None:
    create(client, home, ada)
    # Nothing runs in memory: a worker started later, on a fresh connection, finds the work.
    clock.now = DUE + timedelta(hours=1)
    restarted = await open_database(migrated_settings)
    try:
        assert (await ReminderWorker(restarted, clock=clock).run_once()).results == {"delivered": 1}
    finally:
        await restarted.dispose()
    assert inbox(client, ada)["total"] == 1


# Concurrency and recovery


async def test_concurrent_workers_deliver_each_occurrence_once(
    client: TestClient,
    ada: Headers,
    home: str,
    migrated_settings: Settings,
    clock: Clock,
) -> None:
    for index in range(20):
        create(client, home, ada, title=f"R{index}")
    clock.now = DUE
    databases = [await open_database(migrated_settings) for _ in range(3)]
    try:
        workers = [ReminderWorker(db, clock=clock, batch_size=7) for db in databases]
        reports = await asyncio.gather(*(w.run_once() for w in workers))
        reports += await asyncio.gather(*(w.run_once() for w in workers))
    finally:
        for db in databases:
            await db.dispose()

    assert sum(report.claimed for report in reports) == 20
    assert sum(report.results["delivered"] for report in reports) == 20
    titles = [n["title"] for n in inbox(client, ada)["notifications"]]
    assert sorted(titles) == sorted(f"R{index}" for index in range(20))
    assert {row[1] for row in occurrences(migrated_settings)} == {"delivered"}


async def test_a_crashed_workers_claim_is_recovered_after_its_lease(
    client: TestClient,
    ada: Headers,
    home: str,
    database: Database,
    worker: ReminderWorker,
    clock: Clock,
) -> None:
    create(client, home, ada)
    clock.now = DUE
    assert len(await claim(database, DUE, timedelta(minutes=2))) == 1

    # The lease is still held: nobody else takes the occurrence.
    assert (await worker.run_once()).claimed == 0
    clock.advance(minutes=2, seconds=1)
    report = await worker.run_once()

    assert report.results == {"delivered": 1}
    assert inbox(client, ada)["total"] == 1


async def test_a_worker_that_lost_its_claim_writes_nothing(
    client: TestClient,
    ada: Headers,
    home: str,
    database: Database,
    worker: ReminderWorker,
    clock: Clock,
    migrated_settings: Settings,
) -> None:
    create(client, home, ada)
    # A slow worker claims the occurrence, and its lease expires while it is stalled.
    [stale] = await claim(database, DUE, timedelta(seconds=30))
    clock.now = DUE + timedelta(minutes=1)
    assert (await worker.run_once()).results == {"delivered": 1}

    # The slow worker wakes up and tries to finish.
    slow = ReminderWorker(database, clock=clock)
    assert await slow._process(stale) == "skipped"  # pyright: ignore[reportPrivateUsage] -- simulates the stalled worker resuming

    assert inbox(client, ada)["total"] == 1
    assert occurrences(migrated_settings)[0][1:] == ("delivered", 2)


async def test_database_rejects_a_second_notification_for_an_occurrence(
    client: TestClient,
    ada: Headers,
    home: str,
    database: Database,
    worker: ReminderWorker,
    clock: Clock,
    migrated_settings: Settings,
) -> None:
    create(client, home, ada)
    clock.now = DUE
    await worker.run_once()
    [existing] = inbox(client, ada)["notifications"]
    [(user_id, workspace_id, occurrence_id)] = query(
        migrated_settings.sqlite_path,
        "SELECT user_id, workspace_id, occurrence_id FROM notifications",
    )

    async with database.session() as session:
        duplicate = Notification(
            id=uuid.uuid4(),
            user_id=uuid.UUID(user_id),
            workspace_id=uuid.UUID(workspace_id),
            reminder_id=uuid.UUID(existing["reminder_id"]),
            occurrence_id=uuid.UUID(occurrence_id),
            title="Again",
            body="",
            scheduled_for=DUE,
            created_at=DUE,
            read_at=None,
        )
        with pytest.raises(ConflictError):
            await SqlNotificationRepository(session).add(duplicate)


# Failures and retries


@pytest.fixture
def failing_notifications(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Make writing notifications fail while the returned list is non-empty (one pop per call)."""
    failures: list[int] = []
    original = SqlNotificationRepository.add

    async def add(self: SqlNotificationRepository, notification: Notification) -> None:
        if failures:
            failures.pop()
            raise ConnectionError("database connection lost")
        await original(self, notification)

    monkeypatch.setattr(SqlNotificationRepository, "add", add)
    return failures


async def test_a_transient_failure_is_retried_with_backoff(
    client: TestClient,
    ada: Headers,
    home: str,
    worker: ReminderWorker,
    clock: Clock,
    failing_notifications: list[int],
    migrated_settings: Settings,
) -> None:
    create(client, home, ada)
    failing_notifications.append(1)
    clock.now = DUE

    assert (await worker.run_once()).results == {"retrying": 1}
    assert inbox(client, ada)["total"] == 0
    [(_, status, attempts)] = occurrences(migrated_settings)
    assert (status, attempts) == ("pending", 1)

    clock.advance(seconds=29)
    assert (await worker.run_once()).claimed == 0  # Backing off for 30 seconds.
    clock.advance(seconds=1)
    assert (await worker.run_once()).results == {"delivered": 1}
    assert inbox(client, ada)["total"] == 1


async def test_repeated_failures_are_kept_and_can_be_retried(
    client: TestClient,
    ada: Headers,
    home: str,
    worker: ReminderWorker,
    clock: Clock,
    failing_notifications: list[int],
    migrated_settings: Settings,
) -> None:
    created = create(client, home, ada, recurrence={"frequency": "daily"})
    failing_notifications.extend([1, 1, 1])
    clock.now = DUE

    results: list[WorkerReport] = []
    for _ in range(3):
        results.append(await worker.run_once())
        clock.advance(minutes=5)
    assert [dict(r.results) for r in results] == [{"retrying": 1}, {"retrying": 1}, {"failed": 1}]

    failed = reminder(client, home, ada, created["id"])
    assert failed["status"] == "overdue"
    assert failed["last_outcome"] == "failed"
    # The schedule continues past the failed occurrence.
    assert failed["next_occurrence_at"] == "2030-01-16T08:00:00Z"
    assert await worker.status() == {"failed": 1, "pending": 1}
    last_error = query(
        migrated_settings.sqlite_path,
        "SELECT last_error FROM reminder_occurrences WHERE status = 'failed'",
    )
    assert last_error == [("ConnectionError",)]

    assert await worker.retry_failed() == 1
    assert (await worker.run_once()).results == {"delivered": 1}
    assert [n["scheduled_for"] for n in inbox(client, ada)["notifications"]] == [
        "2030-01-15T08:00:00Z"
    ]
    recovered = reminder(client, home, ada, created["id"])
    assert recovered["status"] == "scheduled"
    assert recovered["next_occurrence_at"] == "2030-01-16T08:00:00Z"


# Changes to the reminder or its task


async def test_completed_task_cancels_occurrences_but_keeps_the_schedule(
    client: TestClient,
    ada: Headers,
    home: str,
    worker: ReminderWorker,
    clock: Clock,
) -> None:
    task_id = client.post(f"{home}/tasks", json={"title": "Water plants"}, headers=ada).json()["id"]
    created = create(client, home, ada, task_id=task_id, recurrence={"frequency": "daily"})
    client.post(f"{home}/tasks/{task_id}/complete", headers=ada)

    clock.now = DUE
    assert (await worker.run_once()).results == {"cancelled": 1}
    assert inbox(client, ada)["total"] == 0
    assert reminder(client, home, ada, created["id"])["last_outcome"] == "cancelled"

    client.post(f"{home}/tasks/{task_id}/reopen", headers=ada)
    clock.advance(days=1)
    assert (await worker.run_once()).results == {"delivered": 1}
    assert inbox(client, ada)["total"] == 1


async def test_disabling_during_delivery_cancels_and_stops(
    client: TestClient,
    ada: Headers,
    home: str,
    database: Database,
    worker: ReminderWorker,
    clock: Clock,
    migrated_settings: Settings,
) -> None:
    created = create(client, home, ada, recurrence={"frequency": "daily"})
    [held] = await claim(database, DUE, timedelta(minutes=2))

    response = client.patch(
        f"{home}/reminders/{created['id']}", json={"enabled": False}, headers=ada
    )
    assert response.status_code == 200
    clock.now = DUE
    assert await worker._process(held) == "cancelled"  # pyright: ignore[reportPrivateUsage] -- finishes the held claim

    assert inbox(client, ada)["total"] == 0
    assert [row[1] for row in occurrences(migrated_settings)] == ["cancelled"]


async def test_rescheduling_during_delivery_keeps_the_new_time(
    client: TestClient,
    ada: Headers,
    home: str,
    database: Database,
    worker: ReminderWorker,
    clock: Clock,
) -> None:
    created = create(client, home, ada)
    [held] = await claim(database, DUE, timedelta(minutes=2))

    # The API can't replace an occurrence a worker holds; the worker schedules the new time.
    client.patch(f"{home}/reminders/{created['id']}", json={"time_of_day": "18:00"}, headers=ada)
    clock.now = DUE
    assert await worker._process(held) == "delivered"  # pyright: ignore[reportPrivateUsage] -- finishes the held claim

    assert (
        reminder(client, home, ada, created["id"])["next_occurrence_at"] == "2030-01-15T17:00:00Z"
    )


async def test_deleting_during_delivery_delivers_nothing(
    client: TestClient,
    ada: Headers,
    home: str,
    database: Database,
    worker: ReminderWorker,
    clock: Clock,
) -> None:
    created = create(client, home, ada)
    [held] = await claim(database, DUE, timedelta(minutes=2))

    assert client.delete(f"{home}/reminders/{created['id']}", headers=ada).status_code == 204
    clock.now = DUE
    assert await worker._process(held) == "skipped"  # pyright: ignore[reportPrivateUsage] -- finishes the held claim

    assert inbox(client, ada)["total"] == 0


# Notifications


async def test_notification_read_state(
    client: TestClient, ada: Headers, home: str, worker: ReminderWorker, clock: Clock
) -> None:
    for day in ("2030-01-15", "2030-01-16", "2030-01-17"):
        create(client, home, ada, title=day, start_date=day)
    clock.now = DUE + timedelta(days=3)
    await worker.run_once()
    newest, middle, oldest = inbox(client, ada)["notifications"]
    assert client.get(f"{NOTIFICATIONS}/unread-count", headers=ada).json() == {"unread": 3}

    read = client.patch(f"{NOTIFICATIONS}/{middle['id']}", json={"read": True}, headers=ada)
    assert read.status_code == 200
    first_read_at = read.json()["read_at"]
    assert first_read_at is not None
    again = client.patch(f"{NOTIFICATIONS}/{middle['id']}", json={"read": True}, headers=ada)
    assert again.json()["read_at"] == first_read_at  # Idempotent: keeps the first read time.

    unread = inbox(client, ada, unread=True)
    assert [n["id"] for n in unread["notifications"]] == [newest["id"], oldest["id"]]
    assert unread["total"] == unread["unread"] == 2

    reopened = client.patch(f"{NOTIFICATIONS}/{middle['id']}", json={"read": False}, headers=ada)
    assert reopened.json()["read_at"] is None

    assert client.post(f"{NOTIFICATIONS}/read-all", headers=ada).json() == {"count": 3}
    assert client.post(f"{NOTIFICATIONS}/read-all", headers=ada).json() == {"count": 0}
    assert client.get(f"{NOTIFICATIONS}/unread-count", headers=ada).json() == {"unread": 0}

    page = client.get(NOTIFICATIONS, params={"limit": 1, "offset": 1}, headers=ada).json()
    assert [n["id"] for n in page["notifications"]] == [middle["id"]]
    assert page["total"] == 3


@pytest.mark.parametrize("body", [{}, {"read": None}, {"read": [True]}, {"read": True, "x": 1}])
async def test_notification_update_is_validated(
    client: TestClient, ada: Headers, body: dict[str, Any]
) -> None:
    response = client.patch(f"{NOTIFICATIONS}/{uuid.uuid4()}", json=body, headers=ada)

    assert response.status_code == 422


async def test_notifications_are_private_to_their_recipient(
    client: TestClient,
    ada: Headers,
    grace: Headers,
    home: str,
    worker: ReminderWorker,
    clock: Clock,
) -> None:
    create(client, home, ada, title="Secret")
    clock.now = DUE
    await worker.run_once()
    [adas] = inbox(client, ada)["notifications"]

    assert inbox(client, grace) == {"notifications": [], "total": 0, "unread": 0}
    assert client.get(f"{NOTIFICATIONS}/unread-count", headers=grace).json() == {"unread": 0}
    response = client.patch(f"{NOTIFICATIONS}/{adas['id']}", json={"read": True}, headers=grace)
    assert response.status_code == 404
    assert client.post(f"{NOTIFICATIONS}/read-all", headers=grace).json() == {"count": 0}
    assert inbox(client, ada)["unread"] == 1
    assert client.get(NOTIFICATIONS).status_code == 401


async def test_notifications_outlive_their_reminder_but_not_their_workspace(
    client: TestClient, ada: Headers, worker: ReminderWorker, clock: Clock
) -> None:
    lab = client.post(WORKSPACES, json={"name": "Lab"}, headers=ada).json()["id"]
    created = create(client, f"{WORKSPACES}/{lab}", ada)
    clock.now = DUE
    await worker.run_once()

    client.delete(f"{WORKSPACES}/{lab}/reminders/{created['id']}", headers=ada)
    [kept] = inbox(client, ada)["notifications"]
    assert kept["reminder_id"] is None
    assert kept["title"] == "Reminder"

    client.delete(f"{WORKSPACES}/{lab}", headers=ada)
    assert inbox(client, ada)["total"] == 0


# Lifecycle


async def test_worker_loop_stops_promptly(database: Database, clock: Clock) -> None:
    stop = asyncio.Event()
    task = asyncio.create_task(ReminderWorker(database, clock=clock).run(stop, poll_interval=60))
    await asyncio.sleep(0.05)

    stop.set()
    await asyncio.wait_for(task, timeout=5)


def test_embedded_worker_starts_and_stops_with_the_api(migrated_settings: Settings) -> None:
    settings = migrated_settings.model_copy(
        update={"scheduler_in_api": True, "scheduler_poll_seconds": 1}
    )
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/v1/health").status_code == 200
