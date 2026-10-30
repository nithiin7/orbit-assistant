"""Budget alerts and period closing by the reminder worker, against the API's database.

Budgets and transactions are created through the API (with today's real date); the worker runs on
its own `Database`, as a separate worker process would, with a clock the test sets.
"""

import asyncio
import sqlite3
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, time, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.database import Database, open_database
from orbit_api.main import create_app
from orbit_api.scheduler.worker import ReminderWorker
from orbit_api.services.finance.money import month_bounds
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

pytestmark = pytest.mark.anyio

WORKSPACES = "/api/v1/workspaces"
NOTIFICATIONS = "/api/v1/me/notifications"

Headers = dict[str, str]
Json = dict[str, Any]

NOW = datetime.now(UTC)
TODAY = NOW.date()
THIS_MONTH = TODAY.replace(day=1)


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


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
def fin(client: TestClient, ada: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=ada).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}/finance"


@pytest.fixture
def bank(client: TestClient, ada: Headers, fin: str) -> str:
    response = client.post(
        f"{fin}/accounts",
        json={"name": "HDFC", "type": "bank", "opening_balance": 10_00_000_00},
        headers=ada,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


@pytest.fixture
async def database(migrated_settings: Settings) -> AsyncIterator[Database]:
    database = await open_database(migrated_settings)
    yield database
    await database.dispose()


@pytest.fixture
def clock() -> Clock:
    return Clock(NOW)


@pytest.fixture
def worker(database: Database, clock: Clock) -> ReminderWorker:
    return ReminderWorker(database, clock=clock)


def ok(response: Any, code: int = 200) -> Json:
    assert response.status_code == code, response.text
    body: Json = response.json()
    return body


def add_budget(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    body = {
        "name": "Everything",
        "scope": "overall",
        "amount": 10_000_00,
        "start_date": THIS_MONTH.isoformat(),
        **fields,
    }
    return ok(client.post(f"{fin}/budgets", json=body, headers=headers), 201)


def spend(
    client: TestClient, fin: str, headers: Headers, account: str, amount: int, kind: str = "expense"
) -> None:
    ok(
        client.post(
            f"{fin}/transactions",
            json={
                "type": kind,
                "amount": amount,
                "account_id": account,
                "occurred_on": TODAY.isoformat(),
                "description": "Shopping",
            },
            headers=headers,
        ),
        201,
    )


def inbox(client: TestClient, headers: Headers) -> list[Json]:
    notifications: list[Json] = ok(client.get(NOTIFICATIONS, headers=headers))["notifications"]
    return notifications


async def test_crossing_thresholds_notifies_once_each(
    client: TestClient, ada: Headers, fin: str, bank: str, worker: ReminderWorker, clock: Clock
) -> None:
    add_budget(client, fin, ada)
    assert await worker.check_budgets() == (0, 0)

    # 80% at once: 50% and 75% are crossed, and only the higher one notifies.
    spend(client, fin, ada, bank, 8_000_00)
    assert await worker.check_budgets() == (0, 1)
    [first] = inbox(client, ada)
    assert first["title"] == "Everything: 75% of budget used"
    assert first["body"] == (f"INR 8000.00 of INR 10000.00 spent ({THIS_MONTH.strftime('%B %Y')}).")
    assert first["reminder_id"] is None

    # Checking again sends nothing.
    assert await worker.check_budgets() == (0, 0)

    # A refund takes spending back under 50%, and spending rises again: no repeats.
    spend(client, fin, ada, bank, 5_000_00, kind="refund")
    assert await worker.check_budgets() == (0, 0)
    spend(client, fin, ada, bank, 2_000_00)
    assert await worker.check_budgets() == (0, 0)
    # 95%: only 90% is new.
    spend(client, fin, ada, bank, 4_500_00)
    clock.now += timedelta(minutes=5)
    assert await worker.check_budgets() == (0, 1)
    titles = [entry["title"] for entry in inbox(client, ada)]
    assert titles[0] == "Everything: 90% of budget used"

    # Overspending crosses 100%.
    spend(client, fin, ada, bank, 2_000_00)
    clock.now += timedelta(minutes=5)
    assert await worker.check_budgets() == (0, 1)
    assert inbox(client, ada)[0]["title"] == "Everything: budget exceeded"
    assert len(inbox(client, ada)) == 3


async def test_raising_a_budget_does_not_repeat_alerts(
    client: TestClient, ada: Headers, fin: str, bank: str, worker: ReminderWorker
) -> None:
    budget = add_budget(client, fin, ada)
    spend(client, fin, ada, bank, 9_500_00)
    assert await worker.check_budgets() == (0, 1)
    ok(client.patch(f"{fin}/budgets/{budget['id']}", json={"amount": 20_000_00}, headers=ada))
    spend(client, fin, ada, bank, 9_000_00)
    # 92.5% of the new amount: 90% was already announced this period.
    assert await worker.check_budgets() == (0, 0)


async def test_disabled_and_archived_budgets_stay_quiet(
    client: TestClient, ada: Headers, fin: str, bank: str, worker: ReminderWorker
) -> None:
    quiet = add_budget(client, fin, ada, alerts_enabled=False)
    groceries = next(
        entry["id"]
        for entry in ok(client.get(f"{fin}/categories", headers=ada))["categories"]
        if entry["name"] == "Groceries"
    )
    archived = add_budget(
        client, fin, ada, name="Groceries", scope="category", category_id=groceries
    )
    ok(client.post(f"{fin}/budgets/{archived['id']}/archive", headers=ada))
    ok(
        client.post(
            f"{fin}/transactions",
            json={
                "type": "expense",
                "amount": 20_000_00,
                "account_id": bank,
                "category_id": groceries,
                "occurred_on": TODAY.isoformat(),
                "description": "Groceries",
            },
            headers=ada,
        ),
        201,
    )
    assert await worker.check_budgets() == (0, 0)
    assert inbox(client, ada) == []

    # Turning alerts on picks up where spending is now.
    ok(
        client.patch(
            f"{fin}/budgets/{quiet['id']}",
            json={"alerts_enabled": True, "alert_thresholds": [80, 120]},
            headers=ada,
        )
    )
    assert await worker.check_budgets() == (0, 1)
    assert inbox(client, ada)[0]["title"] == "Everything: budget exceeded"


async def test_concurrent_checks_send_one_alert(
    client: TestClient,
    ada: Headers,
    fin: str,
    bank: str,
    migrated_settings: Settings,
    clock: Clock,
) -> None:
    add_budget(client, fin, ada)
    spend(client, fin, ada, bank, 9_500_00)
    databases = [await open_database(migrated_settings) for _ in range(3)]
    try:
        results = await asyncio.gather(
            *(ReminderWorker(database, clock=clock).check_budgets() for database in databases)
        )
    finally:
        for database in databases:
            await database.dispose()
    assert sum(alerts for _, alerts in results) == 1
    assert len(inbox(client, ada)) == 1
    rows = query(migrated_settings.sqlite_path, "SELECT threshold FROM finance_budget_alerts")
    assert sorted(row[0] for row in rows) == [50, 75, 90]


async def test_the_database_refuses_a_second_alert_for_a_threshold(
    client: TestClient,
    ada: Headers,
    fin: str,
    bank: str,
    worker: ReminderWorker,
    migrated_settings: Settings,
) -> None:
    add_budget(client, fin, ada)
    spend(client, fin, ada, bank, 6_000_00)
    await worker.check_budgets()
    [(period_id, workspace_id)] = query(
        migrated_settings.sqlite_path,
        "SELECT period_id, workspace_id FROM finance_budget_alerts",
    )
    with pytest.raises(sqlite3.IntegrityError):
        query(
            migrated_settings.sqlite_path,
            "INSERT INTO finance_budget_alerts (id, workspace_id, period_id, threshold, spent,"
            " available, created_at) VALUES (?, ?, ?, 50, 0, 0, '2026-01-01')",
            uuid.uuid4().hex,
            workspace_id,
            period_id,
        )


async def test_periods_close_on_the_owners_local_date(
    client: TestClient,
    ada: Headers,
    fin: str,
    bank: str,
    worker: ReminderWorker,
    clock: Clock,
    migrated_settings: Settings,
) -> None:
    budget = add_budget(client, fin, ada, rollover="surplus")
    spend(client, fin, ada, bank, 3_000_00)
    month_end = month_bounds(THIS_MONTH)[1]

    def closed() -> list[tuple[Any, ...]]:
        return query(
            migrated_settings.sqlite_path,
            "SELECT period_start, spent_at_close FROM finance_budget_periods"
            " WHERE closed_at IS NOT NULL",
        )

    # 20:00 UTC on the month's last day: still that day in UTC, so nothing closes.
    clock.now = datetime.combine(month_end, time(20, 0), tzinfo=UTC)
    assert await worker.check_budgets() == (0, 0)
    assert closed() == []

    # In Kolkata (UTC+5:30) it is already the next month: the period closes, once.
    ok(client.patch("/api/v1/me", json={"timezone": "Asia/Kolkata"}, headers=ada))
    assert await worker.check_budgets() == (1, 0)
    assert closed() == [(THIS_MONTH.isoformat(), 3_000_00)]
    assert await worker.check_budgets() == (0, 0)

    # The next month's period carries the ₹7,000 left over.
    next_month = month_end + timedelta(days=1)
    rows = query(
        migrated_settings.sqlite_path,
        "SELECT base_amount, rollover_amount FROM finance_budget_periods WHERE period_start = ?",
        next_month.isoformat(),
    )
    assert rows == [(10_000_00, 7_000_00)]
    detail = ok(
        client.get(
            f"{fin}/budgets/{budget['id']}", params={"today": next_month.isoformat()}, headers=ada
        )
    )
    assert detail["periods"][0]["available"] == 17_000_00
    assert detail["periods_within"] == 1
