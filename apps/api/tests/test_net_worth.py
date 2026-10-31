"""Other assets, net worth, and snapshots through the API, plus the worker's month-end snapshots.

Every request that depends on the date names `today`.
"""

import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.database import open_database
from orbit_api.main import create_app
from orbit_api.scheduler.worker import ReminderWorker
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"
LAKH = 100_000_00
TODAY = "2025-12-31"

Headers = dict[str, str]
Json = dict[str, Any]


@pytest.fixture
def client(migrated_settings: Settings) -> Iterator[TestClient]:
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


def finance_url(client: TestClient, headers: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}/finance"


@pytest.fixture
def fin(client: TestClient, ada: Headers) -> str:
    return finance_url(client, ada)


def ok(response: Any, code: int = 200) -> Json:
    assert response.status_code == code, response.text
    body: Json = response.json()
    return body


def post(client: TestClient, url: str, headers: Headers, body: Json, code: int = 201) -> Json:
    return ok(client.post(url, json=body, headers=headers), code)


def net_worth(client: TestClient, fin: str, headers: Headers, **params: Any) -> Json:
    return ok(client.get(f"{fin}/net-worth", params={"today": TODAY, **params}, headers=headers))


def item(worth: Json, name: str) -> Json:
    return next(entry for entry in worth["items"] if entry["name"] == name)


def account(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    return post(client, f"{fin}/accounts", headers, fields)


# Assets


def test_assets_keep_a_valuation_history(client: TestClient, ada: Headers, fin: str) -> None:
    gold = post(
        client,
        f"{fin}/assets",
        ada,
        {
            "name": "Gold coins",
            "category": "gold",
            "purchase_date": "2020-01-01",
            "purchase_cost": 2 * LAKH,
            "current_value": 3 * LAKH,
            "valued_on": "2025-06-30",
        },
    )
    assert (gold["value"], gold["valued_on"], gold["counted"]) == (3 * LAKH, "2025-06-30", True)
    post(
        client,
        f"{fin}/assets/{gold['id']}/valuations",
        ada,
        {"valued_on": "2025-12-01", "value": 3_20_000_00},
        code=200,
    )
    history = ok(client.get(f"{fin}/assets/{gold['id']}/valuations", headers=ada))["valuations"]
    assert [entry["value"] for entry in history] == [3_20_000_00, 3 * LAKH]

    current = ok(client.get(f"{fin}/assets/{gold['id']}", params={"today": TODAY}, headers=ada))
    assert (current["value"], current["freshness"]) == (3_20_000_00, "current")
    stale = ok(
        client.get(f"{fin}/assets/{gold['id']}", params={"today": "2027-06-01"}, headers=ada)
    )
    assert stale["freshness"] == "stale"
    # Before the newer valuation, the older one applied.
    worth = net_worth(client, fin, ada, as_of="2025-07-01")
    assert item(worth, "Gold coins")["value"] == 3 * LAKH

    duplicate = client.post(
        f"{fin}/assets", json={"name": "gold COINS", "category": "gold"}, headers=ada
    )
    assert duplicate.status_code == 409


def test_an_asset_without_a_valuation_counts_at_purchase_cost_and_says_so(
    client: TestClient, ada: Headers, fin: str
) -> None:
    post(
        client,
        f"{fin}/assets",
        ada,
        {"name": "Car", "category": "vehicle", "purchase_cost": 8 * LAKH},
    )
    worth = net_worth(client, fin, ada)
    car = item(worth, "Car")
    assert (car["value"], car["source"], car["freshness"]) == (8 * LAKH, "cost", "missing")
    assert worth["quality"]["missing"] == 1


def test_assets_already_in_an_account_balance_are_not_counted_twice(
    client: TestClient, ada: Headers, fin: str
) -> None:
    wallet = account(client, fin, ada, name="Cash at home", type="cash", opening_balance=20_000_00)
    loan_account = account(client, fin, ada, name="Card", type="credit_card", opening_balance=0)
    cash = post(
        client,
        f"{fin}/assets",
        ada,
        {
            "name": "Home cash",
            "category": "cash",
            "current_value": 20_000_00,
            "valued_on": "2025-12-01",
            "linked_account_id": wallet["id"],
        },
    )
    assert cash["counted"] is False
    assert "Cash at home" in cash["excluded_reason"]
    # Linked to a liability, an asset still counts: the debt and the asset are different things.
    bike = post(
        client,
        f"{fin}/assets",
        ada,
        {
            "name": "Bike",
            "category": "vehicle",
            "current_value": 50_000_00,
            "valued_on": "2025-12-01",
            "linked_account_id": loan_account["id"],
        },
    )
    assert bike["counted"] is True
    left_out = post(
        client,
        f"{fin}/assets",
        ada,
        {
            "name": "Painting",
            "category": "other",
            "current_value": 1_000_00,
            "include_in_net_worth": False,
        },
    )
    assert left_out["counted"] is False

    worth = net_worth(client, fin, ada)
    assert worth["assets"] == 20_000_00 + 50_000_00
    assert item(worth, "Home cash")["counted"] is False

    ok(client.patch(f"{fin}/assets/{bike['id']}", json={"archived": True}, headers=ada))
    assert net_worth(client, fin, ada)["assets"] == 20_000_00


# Net worth


def test_net_worth_counts_every_source_once(client: TestClient, ada: Headers, fin: str) -> None:
    bank = account(client, fin, ada, name="Bank", type="bank", opening_balance=5 * LAKH)
    card = account(client, fin, ada, name="Card", type="credit_card", opening_balance=-30_000_00)
    post(
        client,
        f"{fin}/loans",
        ada,
        {
            "name": "Car loan",
            "loan_type": "vehicle",
            "principal": 4 * LAKH,
            "interest_rate_bps": 900,
            "start_date": "2025-01-01",
            "tenure_months": 24,
            "first_payment_date": "2025-02-01",
        },
    )
    broker = post(
        client, f"{fin}/investment-accounts", ada, {"name": "Broker", "kind": "brokerage"}
    )
    stock = post(
        client,
        f"{fin}/holdings",
        ada,
        {"account_id": broker["account_id"], "kind": "stock", "name": "TCS"},
    )
    # Buying at cost from the bank changes nothing until the price moves.
    before = net_worth(client, fin, ada)
    post(
        client,
        f"{fin}/investment-transactions",
        ada,
        {
            "type": "buy",
            "holding_id": stock["id"],
            "trade_date": "2025-03-01",
            "amount": LAKH,
            "quantity": "25",
            "settlement": "account",
            "cash_account_id": bank["id"],
        },
    )
    after = net_worth(client, fin, ada)
    assert after["net_worth"] == before["net_worth"]
    assert after["assets"] == before["assets"]
    # Unpriced, at cost, and flagged.
    assert item(after, "TCS")["source"] == "cost"

    post(
        client,
        f"{fin}/holdings/{stock['id']}/prices",
        ada,
        {"price_date": "2025-12-30", "price": "4400"},
        code=200,
    )
    post(
        client,
        f"{fin}/assets",
        ada,
        {
            "name": "Flat",
            "category": "property",
            "current_value": 50 * LAKH,
            "valued_on": "2025-12-01",
        },
    )
    worth = net_worth(client, fin, ada)

    assert worth["assets"] == 4 * LAKH + 1_10_000_00 + 50 * LAKH
    assert worth["liabilities"] == 30_000_00 + 4 * LAKH
    assert worth["net_worth"] == worth["assets"] - worth["liabilities"]
    groups = {group["key"]: group["value"] for group in worth["groups"]}
    assert groups == {
        "cash": 4 * LAKH,
        "stocks": 1_10_000_00,
        "other_assets": 50 * LAKH,
        "credit_cards": 30_000_00,
        "loans": 4 * LAKH,
    }
    # The broker's cash is zero (the transfer in was spent), so it isn't listed.
    assert all(entry["name"] != "Broker" for entry in worth["items"])
    tcs = item(worth, "TCS")
    assert (tcs["source"], tcs["valued_on"], tcs["freshness"]) == (
        "market",
        "2025-12-30",
        "current",
    )
    assert item(worth, "Car loan")["side"] == "liability"
    assert item(worth, "Card")["value"] == 30_000_00
    assert card["id"]


def test_a_loan_repayment_reduces_liabilities_through_the_ledger(
    client: TestClient, ada: Headers, fin: str
) -> None:
    bank = account(client, fin, ada, name="Bank", type="bank", opening_balance=5 * LAKH)
    loan = post(
        client,
        f"{fin}/loans",
        ada,
        {
            "name": "Loan",
            "loan_type": "personal",
            "principal": 1_20_000_00,
            "interest_rate_bps": 0,
            "start_date": "2025-01-01",
            "tenure_months": 12,
            "first_payment_date": "2025-02-01",
        },
    )
    detail = ok(client.get(f"{fin}/loans/{loan['id']}", headers=ada))
    first = detail["installments"][0]
    post(
        client,
        f"{fin}/loans/{loan['id']}/installments/{first['id']}/pay",
        ada,
        {"paid_on": "2025-02-01", "from_account_id": bank["id"]},
        code=200,
    )
    worth = net_worth(client, fin, ada)
    assert item(worth, "Loan")["value"] == 1_10_000_00
    assert worth["net_worth"] == 4_90_000_00 - 1_10_000_00
    # As of before the payment, the full principal was owed.
    assert item(net_worth(client, fin, ada, as_of="2025-01-15"), "Loan")["value"] == 1_20_000_00


def test_unprofiled_investment_accounts_count_at_cost_and_currencies_stay_apart(
    client: TestClient, ada: Headers, fin: str
) -> None:
    account(client, fin, ada, name="Old MF account", type="investment", opening_balance=LAKH)
    account(client, fin, ada, name="US bank", type="bank", currency="USD", opening_balance=1_000_00)
    worth = net_worth(client, fin, ada)
    assert worth["currencies"] == ["INR", "USD"]
    assert worth["currency"] == "INR"
    old = item(worth, "Old MF account")
    assert (old["group"], old["source"], old["freshness"]) == (
        "investments_at_cost",
        "cost",
        "missing",
    )
    assert worth["assets"] == LAKH
    usd = net_worth(client, fin, ada, currency="USD")
    assert usd["net_worth"] == 1_000_00


def test_deposit_estimates_are_marked_as_estimates(
    client: TestClient, ada: Headers, fin: str
) -> None:
    bank = account(client, fin, ada, name="Bank", type="bank", opening_balance=5 * LAKH)
    fds = post(client, f"{fin}/investment-accounts", ada, {"name": "FDs", "kind": "deposit"})
    post(
        client,
        f"{fin}/deposits",
        ada,
        {
            "account_id": fds["account_id"],
            "kind": "fixed",
            "name": "FD",
            "interest_rate_bps": 700,
            "start_date": "2025-01-01",
            "maturity_date": "2026-01-01",
            "amount": LAKH,
            "cash_account_id": bank["id"],
        },
    )
    worth = net_worth(client, fin, ada, today="2026-01-01")
    fd = item(worth, "FD")
    assert (fd["source"], fd["freshness"], fd["value"]) == ("estimate", "estimated", 1_07_185_90)
    assert "not guaranteed" in fd["note"]
    assert worth["quality"]["estimated"] == 1
    # Bank 4,00,000 plus the deposit; the bank balance isn't counted again.
    assert worth["assets"] == 4 * LAKH + 1_07_185_90


# Snapshots


def test_snapshots_are_idempotent_per_month(
    client: TestClient, ada: Headers, fin: str, migrated_settings: Settings
) -> None:
    account(client, fin, ada, name="Bank", type="bank", opening_balance=LAKH)
    first = post(client, f"{fin}/net-worth/snapshots", ada, {"today": TODAY})
    assert (first["month"], first["as_of"], first["source"]) == ("2025-12", TODAY, "manual")
    assert first["net_worth"] == LAKH
    again = post(client, f"{fin}/net-worth/snapshots", ada, {"today": TODAY}, code=200)
    assert again["id"] == first["id"]
    assert query(
        migrated_settings.sqlite_path, "SELECT count(*) FROM finance_net_worth_snapshots"
    ) == [(1,)]

    # The current month can be refreshed on purpose; a past month can't.
    account(client, fin, ada, name="Wallet", type="wallet", opening_balance=5_000_00)
    refreshed = post(client, f"{fin}/net-worth/snapshots", ada, {"today": TODAY, "refresh": True})
    assert refreshed["id"] == first["id"]
    assert refreshed["net_worth"] == LAKH + 5_000_00

    backfill = post(client, f"{fin}/net-worth/snapshots", ada, {"today": TODAY, "month": "2025-06"})
    assert (backfill["source"], backfill["as_of"]) == ("backfill", "2025-06-30")
    past = client.post(
        f"{fin}/net-worth/snapshots",
        json={"today": TODAY, "month": "2025-06", "refresh": True},
        headers=ada,
    )
    assert past.status_code == 409
    future = client.post(
        f"{fin}/net-worth/snapshots", json={"today": TODAY, "month": "2026-01"}, headers=ada
    )
    assert future.status_code == 422

    history = ok(client.get(f"{fin}/net-worth/snapshots", headers=ada))["snapshots"]
    assert [entry["month"] for entry in history] == ["2025-06", "2025-12"]

    # Changes compare today with earlier snapshots.
    worth = net_worth(client, fin, ada, today="2026-06-15")
    by_months = {entry["months"]: entry for entry in worth["changes"]}
    assert by_months[6]["snapshot"]["month"] == "2025-12"
    assert by_months[6]["change"] == 0
    assert by_months[1]["snapshot"] is None


def test_the_worker_takes_month_end_snapshots_once(
    client: TestClient, ada: Headers, fin: str, migrated_settings: Settings
) -> None:
    account(client, fin, ada, name="Bank", type="bank", opening_balance=LAKH)
    account(client, fin, ada, name="US", type="bank", currency="USD", opening_balance=100_00)
    clock = datetime(2026, 2, 3, 9, 0, tzinfo=UTC)

    async def run() -> tuple[int, int]:
        database = await open_database(migrated_settings)
        try:
            worker = ReminderWorker(database, clock=lambda: clock)
            return await worker.take_snapshots(), await worker.take_snapshots()
        finally:
            await database.dispose()

    first, second = asyncio.run(run())
    assert (first, second) == (2, 0)
    rows = query(
        migrated_settings.sqlite_path,
        "SELECT currency, period_start, as_of, source, net_worth"
        " FROM finance_net_worth_snapshots ORDER BY currency",
    )
    assert rows == [
        ("INR", "2026-01-01", "2026-01-31", "scheduled", LAKH),
        ("USD", "2026-01-01", "2026-01-31", "scheduled", 100_00),
    ]
