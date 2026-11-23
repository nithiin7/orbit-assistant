"""People: adding, updating, and deleting people and their dates, the managed birthday reminder,
and isolation between workspaces.

The API uses the real clock, so reminder dates here are relative to today in UTC (every test
user's zone). The worker test uses a fixed clock.
"""

import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.database import Database, open_database
from orbit_api.main import create_app
from orbit_api.scheduler.worker import ReminderWorker
from orbit_api.services.people.dates import occurrence
from orbit_api.services.people.models import PersonDate
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

WORKSPACES = "/api/v1/workspaces"

Headers = dict[str, str]
Json = dict[str, Any]


@pytest.fixture
def client(migrated_settings: Settings) -> Iterator[TestClient]:
    """Two local accounts are needed to test isolation, so registration is explicitly open."""
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
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}"


@pytest.fixture
def ws(client: TestClient, ada: Headers) -> str:
    return workspace_url(client, ada)


def add(client: TestClient, ws: str, headers: Headers, **fields: Any) -> Json:
    response = client.post(f"{ws}/people", json={"name": "Priya", **fields}, headers=headers)
    assert response.status_code == 201, response.text
    person: Json = response.json()
    return person


def managed(client: TestClient, ws: str, headers: Headers) -> list[Json]:
    reminders: list[Json] = client.get(f"{ws}/reminders", headers=headers).json()["reminders"]
    return [r for r in reminders if r["commitment"] and r["commitment"]["kind"] == "person"]


def in_days(days: int) -> date:
    return datetime.now(UTC).date() + timedelta(days=days)


def on(day: date, **fields: Any) -> Json:
    return {"kind": "birthday", "month": day.month, "day": day.day, **fields}


# People


def test_add_with_only_a_name(client: TestClient, ws: str, ada: Headers) -> None:
    person = add(client, ws, ada, name="  Priya  ")
    assert person["name"] == "Priya"
    assert person["relationship"] == "friend"
    assert person["dates"] == []
    assert person["reminder_time"] == "09:00:00"
    assert person["timezone"] == "UTC"
    assert client.get(f"{ws}/people", headers=ada).json()["people"] == [person]
    assert managed(client, ws, ada) == []


def test_add_with_every_field_and_list_by_name(client: TestClient, ws: str, ada: Headers) -> None:
    add(client, ws, ada, name="zoe")
    person = add(
        client,
        ws,
        ada,
        name="Amma",
        relationship="family",
        phone="+91 98765 43210",
        email="amma@example.com",
        note="Loves jasmine.\nCall on Sundays.",
        favorite=True,
        dates=[
            {"kind": "birthday", "month": 2, "day": 29, "year": 1964},
            {"kind": "other", "label": "Name day", "month": 7, "day": 4},
        ],
        reminder_time="08:30",
        timezone="Asia/Kolkata",
    )
    assert person["dates"] == [
        {
            "kind": "birthday",
            "label": "",
            "month": 2,
            "day": 29,
            "year": 1964,
            "remind_days_before": None,
        },
        {
            "kind": "other",
            "label": "Name day",
            "month": 7,
            "day": 4,
            "year": None,
            "remind_days_before": None,
        },
    ]
    assert person["timezone"] == "Asia/Kolkata"
    names = [p["name"] for p in client.get(f"{ws}/people", headers=ada).json()["people"]]
    assert names == ["Amma", "zoe"]
    assert client.get(f"{ws}/people/{person['id']}", headers=ada).json() == person


@pytest.mark.parametrize(
    "fields",
    [
        {"name": ""},
        {"relationship": "enemy"},
        {"dates": [{"kind": "birthday", "month": 13, "day": 1}]},
        {"dates": [{"kind": "birthday", "month": 4, "day": 31}]},
        {"dates": [{"kind": "birthday", "month": 2, "day": 29, "year": 2023}]},
        {"dates": [{"kind": "birthday", "month": 1, "day": 1, "remind_days_before": 31}]},
        {"dates": [{"kind": "other", "month": 1, "day": 1}]},
        {"dates": [{"kind": "birthday", "label": "x", "month": 1, "day": 1}]},
        {"dates": [{"kind": "birthday", "month": 1, "day": 1}] * 2},
        {"timezone": "Mars/Olympus"},
    ],
)
def test_rejects_invalid_people(
    client: TestClient, ws: str, ada: Headers, fields: dict[str, Any]
) -> None:
    response = client.post(f"{ws}/people", json={"name": "Priya", **fields}, headers=ada)
    assert response.status_code == 422, response.text


def test_update_and_delete(client: TestClient, ws: str, ada: Headers) -> None:
    person = add(client, ws, ada, dates=[on(in_days(10))])
    url = f"{ws}/people/{person['id']}"
    response = client.patch(url, json={"name": "Priya S", "favorite": True}, headers=ada)
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["name"] == "Priya S"
    assert updated["favorite"] is True
    assert updated["dates"] == person["dates"]

    cleared = client.patch(url, json={"dates": []}, headers=ada).json()
    assert cleared["dates"] == []
    assert client.patch(url, json={}, headers=ada).status_code == 422
    assert client.patch(url, json={"name": None}, headers=ada).status_code == 422

    assert client.delete(url, headers=ada).status_code == 204
    assert client.get(url, headers=ada).status_code == 404
    assert client.delete(url, headers=ada).status_code == 404


# Reminders


def test_birthday_creates_one_managed_reminder(client: TestClient, ws: str, ada: Headers) -> None:
    birthday = in_days(10)
    person = add(client, ws, ada, dates=[on(birthday, remind_days_before=3)])
    [reminder] = managed(client, ws, ada)
    assert reminder["commitment"]["id"] == person["id"]
    assert reminder["title"] == "Priya's birthday is in 3 days"
    assert reminder["next_occurrence_at"] == f"{in_days(7).isoformat()}T09:00:00Z"

    # Changing the dates re-points the same reminder; nothing is duplicated.
    url = f"{ws}/people/{person['id']}"
    year = birthday.year - 30
    client.patch(url, json={"dates": [on(birthday, year=year, remind_days_before=0)]}, headers=ada)
    [moved] = managed(client, ws, ada)
    assert moved["id"] == reminder["id"]
    assert moved["title"] == "Priya turns 30 today"
    assert moved["next_occurrence_at"] == f"{birthday.isoformat()}T09:00:00Z"

    # It can't be edited or deleted through the reminders API.
    reminder_url = f"{ws}/reminders/{reminder['id']}"
    assert client.patch(reminder_url, json={"title": "x"}, headers=ada).status_code == 409
    assert client.delete(reminder_url, headers=ada).status_code == 409

    # Turning the reminder off, or deleting the person, removes it.
    client.patch(url, json={"dates": [on(birthday)]}, headers=ada)
    assert managed(client, ws, ada) == []
    client.patch(url, json={"dates": [on(birthday, remind_days_before=1)]}, headers=ada)
    assert len(managed(client, ws, ada)) == 1
    client.delete(url, headers=ada)
    assert managed(client, ws, ada) == []


@pytest.fixture
async def database(migrated_settings: Settings) -> AsyncIterator[Database]:
    database = await open_database(migrated_settings)
    yield database
    await database.dispose()


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


@pytest.mark.anyio
async def test_worker_delivers_and_moves_to_next_year(
    client: TestClient, ws: str, ada: Headers, database: Database
) -> None:
    birthday = in_days(10)
    person = add(client, ws, ada, dates=[on(birthday, remind_days_before=0)])
    clock = Clock(
        datetime.combine(birthday, datetime.min.time(), UTC) + timedelta(hours=9, seconds=30)
    )
    worker = ReminderWorker(database, clock=clock)
    assert (await worker.run_once()).claimed == 1

    inbox = client.get("/api/v1/me/notifications", headers=ada).json()["notifications"]
    assert [n["title"] for n in inbox] == ["Priya's birthday is today"]
    assert inbox[0]["link"] == f"/people?person={person['id']}"
    [reminder] = managed(client, ws, ada)
    next_year = occurrence(PersonDate("birthday", birthday.month, birthday.day), birthday.year + 1)
    assert reminder["next_occurrence_at"] == f"{next_year.isoformat()}T09:00:00Z"
    assert (await worker.run_once()).claimed == 0


# Isolation


def test_people_are_private_to_their_workspace(
    client: TestClient, ws: str, ada: Headers, grace: Headers
) -> None:
    person = add(client, ws, ada)
    url = f"{ws}/people/{person['id']}"
    assert client.get(f"{ws}/people", headers=grace).status_code == 404
    assert client.get(url, headers=grace).status_code == 404
    assert client.patch(url, json={"name": "x"}, headers=grace).status_code == 404
    assert client.delete(url, headers=grace).status_code == 404

    graces = workspace_url(client, grace)
    assert client.get(f"{graces}/people/{person['id']}", headers=grace).status_code == 404
    assert client.get(f"{graces}/people", headers=grace).json()["people"] == []
    assert client.get(f"{ws}/people/{uuid.uuid4()}", headers=ada).status_code == 404


# Money owed


def finance_setup(client: TestClient, ws: str, headers: Headers) -> tuple[str, str, str]:
    """An INR bank account, the Food and dining category, and a ₹1,000 dinner paid from it."""
    fin = f"{ws}/finance"
    account = client.post(
        f"{fin}/accounts", json={"name": "HDFC", "type": "bank"}, headers=headers
    ).json()["id"]
    categories = client.get(f"{fin}/categories", headers=headers).json()["categories"]
    food = next(entry["id"] for entry in categories if entry["name"] == "Food and dining")
    dinner = client.post(
        f"{fin}/transactions",
        json={
            "type": "expense",
            "amount": 100_000,
            "occurred_on": "2030-02-10",
            "description": "Dinner",
            "account_id": account,
            "category_id": food,
        },
        headers=headers,
    ).json()["id"]
    return account, food, dinner


def owe(client: TestClient, ws: str, headers: Headers, person: Json, **fields: Any) -> Any:
    body = {
        "kind": "they_owe",
        "amount": 50_000,
        "currency": "INR",
        "occurred_on": "2030-02-10",
        "description": "Dinner",
        **fields,
    }
    return client.post(f"{ws}/people/{person['id']}/ledger", json=body, headers=headers)


def ledger(client: TestClient, ws: str, headers: Headers) -> Json:
    response = client.get(f"{ws}/people/ledger", headers=headers)
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


def test_balances_follow_every_kind_of_entry(client: TestClient, ws: str, ada: Headers) -> None:
    priya = add(client, ws, ada)
    sam = add(client, ws, ada, name="Sam")
    assert owe(client, ws, ada, priya, amount=30_000).status_code == 201
    assert owe(client, ws, ada, priya, kind="they_paid", amount=10_000).status_code == 201
    assert owe(client, ws, ada, sam, kind="i_owe", amount=5_000).status_code == 201
    assert owe(client, ws, ada, sam, kind="i_owe", amount=700, currency="USD").status_code == 201
    assert owe(client, ws, ada, sam, kind="i_paid", amount=5_000).status_code == 201

    body = ledger(client, ws, ada)
    assert len(body["entries"]) == 5
    balances = {(b["person_id"], b["currency"]): b["amount"] for b in body["balances"]}
    # Sam's INR is settled, so only their USD remains; currencies are never mixed.
    assert balances == {(priya["id"], "INR"): 20_000, (sam["id"], "USD"): -700}


def test_split_a_share_from_an_expense(client: TestClient, ws: str, ada: Headers) -> None:
    priya = add(client, ws, ada)
    sam = add(client, ws, ada, name="Sam")
    _account, _food, dinner = finance_setup(client, ws, ada)

    response = owe(client, ws, ada, priya, transaction_id=dinner)
    assert response.status_code == 201, response.text
    entry = response.json()
    assert entry["transaction"]["id"] == dinner
    assert entry["transaction"]["amount"] == 100_000
    assert owe(client, ws, ada, sam, amount=40_000, transaction_id=dinner).status_code == 201

    # Shares can't add up to more than the expense, on create or edit.
    too_much = owe(client, ws, ada, sam, amount=20_000, transaction_id=dinner)
    assert too_much.status_code == 422
    assert too_much.json()["detail"] == "The shares add up to more than the expense."
    url = f"{ws}/people/{priya['id']}/ledger/{entry['id']}"
    assert client.patch(url, json={"amount": 70_000}, headers=ada).status_code == 422
    assert client.patch(url, json={"amount": 60_000}, headers=ada).status_code == 200

    # Only an expense, in its currency, for a share someone owes you.
    assert owe(client, ws, ada, priya, kind="i_owe", transaction_id=dinner).status_code == 422
    assert owe(client, ws, ada, priya, currency="USD", transaction_id=dinner).status_code == 422
    assert owe(client, ws, ada, priya, transaction_id=str(uuid.uuid4())).status_code == 422

    # Deleting the expense keeps the entry and clears the link.
    assert client.delete(f"{ws}/finance/transactions/{dinner}", headers=ada).status_code == 204
    assert all(e["transaction"] is None for e in ledger(client, ws, ada)["entries"])


def test_repayment_records_a_refund_so_spending_is_your_share(
    client: TestClient, ws: str, ada: Headers
) -> None:
    priya = add(client, ws, ada)
    account, food, dinner = finance_setup(client, ws, ada)
    owe(client, ws, ada, priya, transaction_id=dinner)

    record = {"account_id": account, "category_id": food}
    response = owe(
        client,
        ws,
        ada,
        priya,
        kind="they_paid",
        description="Priya paid you back",
        record_in_finance=record,
    )
    assert response.status_code == 201, response.text
    repaid = response.json()
    assert repaid["transaction"]["type"] == "refund"
    assert repaid["transaction"]["category_id"] == food

    spending = client.get(f"{ws}/finance/spending", params={"month": "2030-02"}, headers=ada).json()
    assert spending["total"] == 50_000
    assert ledger(client, ws, ada)["balances"] == []

    # The recorded repayment keeps its amount; its date and description can change.
    url = f"{ws}/people/{priya['id']}/ledger/{repaid['id']}"
    assert client.patch(url, json={"amount": 1}, headers=ada).status_code == 422
    assert client.patch(url, json={"description": "Paid back"}, headers=ada).status_code == 200
    # Deleting it leaves the refund in Finance.
    assert client.delete(url, headers=ada).status_code == 204
    spending = client.get(f"{ws}/finance/spending", params={"month": "2030-02"}, headers=ada).json()
    assert spending["total"] == 50_000


def test_paying_someone_back_records_an_expense(client: TestClient, ws: str, ada: Headers) -> None:
    sam = add(client, ws, ada, name="Sam")
    account, food, _dinner = finance_setup(client, ws, ada)
    owe(client, ws, ada, sam, kind="i_owe", amount=30_000)
    response = owe(
        client,
        ws,
        ada,
        sam,
        kind="i_paid",
        amount=30_000,
        record_in_finance={"account_id": account, "category_id": food},
    )
    assert response.status_code == 201, response.text
    assert response.json()["transaction"]["type"] == "expense"

    # Only repayments are recorded, in the account's currency, with an expense category.
    bad = {"account_id": account, "category_id": food}
    assert owe(client, ws, ada, sam, kind="they_owe", record_in_finance=bad).status_code == 422
    usd = owe(client, ws, ada, sam, kind="i_paid", currency="USD", record_in_finance=bad)
    assert usd.status_code == 422
    unknown = {"account_id": account, "category_id": str(uuid.uuid4())}
    assert owe(client, ws, ada, sam, kind="i_paid", record_in_finance=unknown).status_code == 422
    # Nothing was half-recorded: one dinner and one repayment.
    transactions = client.get(f"{ws}/finance/transactions", headers=ada).json()["transactions"]
    assert len(transactions) == 2


@pytest.mark.parametrize(
    "fields",
    [
        {"amount": 0},
        {"amount": 12.5},
        {"currency": "XYZ"},
        {"description": ""},
        {"kind": "gift"},
    ],
)
def test_rejects_invalid_entries(
    client: TestClient, ws: str, ada: Headers, fields: dict[str, Any]
) -> None:
    assert owe(client, ws, ada, add(client, ws, ada), **fields).status_code == 422


def test_ledger_is_private_and_goes_with_the_person(
    client: TestClient, ws: str, ada: Headers, grace: Headers
) -> None:
    priya = add(client, ws, ada)
    entry = owe(client, ws, ada, priya).json()
    url = f"{ws}/people/{priya['id']}/ledger/{entry['id']}"
    assert client.get(f"{ws}/people/ledger", headers=grace).status_code == 404
    assert owe(client, ws, grace, priya).status_code == 404
    assert client.patch(url, json={"amount": 1}, headers=grace).status_code == 404
    assert client.delete(url, headers=grace).status_code == 404

    # Grace can't attach her entries to Ada's person, or Ada's expense to her own person.
    graces = workspace_url(client, grace)
    assert owe(client, graces, grace, priya).status_code == 404
    _account, _food, dinner = finance_setup(client, ws, ada)
    hers = add(client, graces, grace, name="Hers")
    assert owe(client, graces, grace, hers, transaction_id=dinner).status_code == 422

    # Another person's entry can't be reached through someone else's URL.
    sam = add(client, ws, ada, name="Sam")
    wrong = f"{ws}/people/{sam['id']}/ledger/{entry['id']}"
    assert client.delete(wrong, headers=ada).status_code == 404

    client.delete(f"{ws}/people/{priya['id']}", headers=ada)
    assert ledger(client, ws, ada)["entries"] == []
