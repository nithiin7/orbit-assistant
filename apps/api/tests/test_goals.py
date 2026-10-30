"""Savings goals through the API: progress, contributions and withdrawals, how they meet the
ledger (transfers, never expenses), duplicate prevention, and isolation."""

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.services.finance.money import add_months
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"
LAKH = 100_000_00

Headers = dict[str, str]
Json = dict[str, Any]

TODAY = datetime.now(UTC).date()
THIS_MONTH = TODAY.replace(day=1)


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


def finance_url(client: TestClient, headers: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}/finance"


@pytest.fixture
def fin(client: TestClient, ada: Headers) -> str:
    return finance_url(client, ada)


def ok(response: Any, code: int = 200) -> Json:
    assert response.status_code == code, response.text
    if code == 204:
        return {}
    body: Json = response.json()
    return body


def account(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    body = {"name": "HDFC", "type": "bank", "opening_balance": 5 * LAKH, **fields}
    return ok(client.post(f"{fin}/accounts", json=body, headers=headers), 201)


def add_goal(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    body = {
        "name": "Emergency fund",
        "category": "emergency_fund",
        "target_amount": 3 * LAKH,
        "start_date": THIS_MONTH.isoformat(),
        **fields,
    }
    return ok(client.post(f"{fin}/savings-goals", json=body, headers=headers), 201)


def contribute(
    client: TestClient, fin: str, headers: Headers, goal_id: str, code: int = 201, **fields: Any
) -> Json:
    return ok(
        client.post(f"{fin}/savings-goals/{goal_id}/contributions", json=fields, headers=headers),
        code,
    )


def goal(client: TestClient, fin: str, headers: Headers, goal_id: str) -> Json:
    return ok(client.get(f"{fin}/savings-goals/{goal_id}", headers=headers))


def balances(client: TestClient, fin: str, headers: Headers) -> dict[str, int]:
    accounts = ok(client.get(f"{fin}/accounts", headers=headers))["accounts"]
    return {entry["name"]: entry["balance"] for entry in accounts}


def test_progress_and_suggested_contribution(client: TestClient, ada: Headers, fin: str) -> None:
    target = add_months(THIS_MONTH, 9)
    created = add_goal(client, fin, ada, target_date=target.isoformat(), priority="high")
    assert created["saved"] == 0
    assert created["progress_percent"] == "0.00"
    # Ten months, this one included: ₹3,00,000 ÷ 10.
    assert created["months_left"] == 10
    assert created["suggested_monthly"] == 30_000_00
    assert created["account"] is None

    contribute(client, fin, ada, created["id"], amount=1 * LAKH, mode="allocate")
    after = goal(client, fin, ada, created["id"])
    assert after["saved"] == 1 * LAKH
    assert after["remaining"] == 2 * LAKH
    assert after["progress_percent"] == "33.33"
    assert after["this_month"] == 1 * LAKH
    assert after["available"] == 1 * LAKH
    # ₹2,00,000 over 10 months.
    assert after["suggested_monthly"] == 20_000_00

    # The target can change; contributions stay.
    changed = ok(
        client.patch(
            f"{fin}/savings-goals/{created['id']}",
            json={"target_amount": 1 * LAKH, "target_date": None},
            headers=ada,
        )
    )
    assert changed["reached"] is True
    assert changed["progress_percent"] == "100.00"
    assert changed["suggested_monthly"] is None


def test_allocations_and_withdrawals_never_touch_spending(
    client: TestClient, ada: Headers, fin: str
) -> None:
    account(client, fin, ada)
    created = add_goal(client, fin, ada)
    contribute(client, fin, ada, created["id"], amount=50_000_00)
    contribute(client, fin, ada, created["id"], amount=10_000_00, type="withdrawal")
    assert goal(client, fin, ada, created["id"])["saved"] == 40_000_00

    too_much = client.post(
        f"{fin}/savings-goals/{created['id']}/contributions",
        json={"amount": 40_000_01, "type": "withdrawal"},
        headers=ada,
    )
    assert too_much.status_code == 422
    assert "more than the goal has saved" in too_much.json()["detail"]

    summary = ok(client.get(f"{fin}/summary", headers=ada))
    assert summary["net_expenses"] == 0 and summary["income"] == 0
    history = ok(client.get(f"{fin}/savings-goals/{created['id']}/contributions", headers=ada))
    assert sorted(entry["type"] for entry in history["contributions"]) == [
        "contribution",
        "withdrawal",
    ]


def test_transfers_into_the_linked_account(
    client: TestClient, ada: Headers, fin: str, migrated_settings: Settings
) -> None:
    bank = account(client, fin, ada)
    savings = account(client, fin, ada, name="Savings", type="savings", opening_balance=0)
    created = add_goal(client, fin, ada, account_id=savings["id"])

    entry = contribute(
        client, fin, ada, created["id"], amount=20_000_00, mode="transfer", account_id=bank["id"]
    )
    assert entry["transaction_id"] is not None
    transaction = ok(client.get(f"{fin}/transactions/{entry['transaction_id']}", headers=ada))
    assert transaction["type"] == "transfer"
    assert transaction["account_id"] == bank["id"]
    assert transaction["to_account_id"] == savings["id"]
    assert balances(client, fin, ada) == {"HDFC": 5 * LAKH - 20_000_00, "Savings": 20_000_00}
    # A transfer between your own accounts is neither income nor spending.
    summary = ok(client.get(f"{fin}/summary", headers=ada))
    assert summary["net_expenses"] == 0 and summary["income"] == 0

    view = goal(client, fin, ada, created["id"])
    assert view["saved"] == 20_000_00
    assert view["account"] == {
        "account_id": savings["id"],
        "name": "Savings",
        "balance": 20_000_00,
        "allocated": 20_000_00,
    }

    # The ledger won't delete a transfer a contribution records.
    blocked = client.delete(f"{fin}/transactions/{entry['transaction_id']}", headers=ada)
    assert blocked.status_code == 409
    assert "savings goal contribution" in blocked.json()["detail"]

    # A withdrawal transfers back out; available is capped by what the account holds.
    out = contribute(
        client,
        fin,
        ada,
        created["id"],
        amount=5_000_00,
        type="withdrawal",
        mode="transfer",
        account_id=bank["id"],
    )
    assert balances(client, fin, ada)["Savings"] == 15_000_00
    contribute(client, fin, ada, created["id"], amount=10_000_00)
    capped = goal(client, fin, ada, created["id"])
    assert capped["saved"] == 25_000_00
    assert capped["available"] == 15_000_00

    # Undoing can delete the transfer too, all in one transaction.
    ok(
        client.delete(
            f"{fin}/savings-goals/{created['id']}/contributions/{out['id']}",
            params={"delete_transaction": True},
            headers=ada,
        ),
        204,
    )
    assert client.get(f"{fin}/transactions/{out['transaction_id']}", headers=ada).status_code == 404
    assert query(migrated_settings.sqlite_path, "SELECT count(*) FROM finance_transactions") == [
        (1,)
    ]


def test_link_existing_transfers_once(client: TestClient, ada: Headers, fin: str) -> None:
    bank = account(client, fin, ada)
    savings = account(client, fin, ada, name="Savings", type="savings", opening_balance=0)
    created = add_goal(client, fin, ada, account_id=savings["id"])
    other = add_goal(client, fin, ada, name="Holiday", account_id=savings["id"])
    moved = ok(
        client.post(
            f"{fin}/transfers",
            json={
                "from_account_id": bank["id"],
                "to_account_id": savings["id"],
                "amount": 12_000_00,
                "occurred_on": TODAY.isoformat(),
                "description": "Monthly saving",
            },
            headers=ada,
        ),
        201,
    )
    linked = contribute(client, fin, ada, created["id"], mode="link", transaction_id=moved["id"])
    assert linked["amount"] == 12_000_00
    assert linked["occurred_on"] == TODAY.isoformat()

    for goal_id in (created["id"], other["id"]):
        again = client.post(
            f"{fin}/savings-goals/{goal_id}/contributions",
            json={"mode": "link", "transaction_id": moved["id"]},
            headers=ada,
        )
        assert again.status_code == 409
        assert again.json()["detail"] == "That transfer is already recorded against a savings goal."

    # Only transfers into the goal's account can be linked as contributions.
    expense = ok(
        client.post(
            f"{fin}/transactions",
            json={
                "type": "expense",
                "amount": 1_00,
                "account_id": bank["id"],
                "occurred_on": TODAY.isoformat(),
                "description": "Tea",
            },
            headers=ada,
        ),
        201,
    )
    not_transfer = client.post(
        f"{fin}/savings-goals/{other['id']}/contributions",
        json={"mode": "link", "transaction_id": expense["id"]},
        headers=ada,
    )
    assert not_transfer.status_code == 422
    assert "Only transfers" in not_transfer.json()["detail"]
    wrong_way = client.post(
        f"{fin}/savings-goals/{other['id']}/contributions",
        json={"mode": "link", "transaction_id": moved["id"], "type": "withdrawal"},
        headers=ada,
    )
    assert wrong_way.status_code == 422

    # Two goals in one account: what they've earmarked together is shown on each.
    contribute(client, fin, ada, other["id"], amount=3_000_00)
    assert goal(client, fin, ada, other["id"])["account"]["allocated"] == 15_000_00


@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ({"type": "credit_card"}, "Keep savings in"),
        ({"type": "investment"}, "Keep savings in"),
        ({"currency": "USD"}, "goal's currency"),
    ],
)
def test_linked_accounts_must_hold_savings(
    client: TestClient, ada: Headers, fin: str, fields: Json, message: str
) -> None:
    linked = account(client, fin, ada, name="Other", opening_balance=0, **fields)
    response = client.post(
        f"{fin}/savings-goals",
        json={
            "name": "Car",
            "target_amount": 1_00,
            "start_date": THIS_MONTH.isoformat(),
            "account_id": linked["id"],
        },
        headers=ada,
    )
    assert response.status_code == 422
    assert message in response.json()["detail"]


def test_contribution_rules(client: TestClient, ada: Headers, fin: str) -> None:
    bank = account(client, fin, ada)
    savings = account(client, fin, ada, name="Savings", type="savings", opening_balance=0)
    unlinked = add_goal(client, fin, ada)
    transfer = client.post(
        f"{fin}/savings-goals/{unlinked['id']}/contributions",
        json={"amount": 1_00, "mode": "transfer", "account_id": bank["id"]},
        headers=ada,
    )
    assert transfer.status_code == 422
    assert "Link an account" in transfer.json()["detail"]
    for body in (
        {"mode": "allocate"},
        {"mode": "allocate", "amount": 1_00, "account_id": bank["id"]},
        {"mode": "link"},
        {"mode": "link", "transaction_id": bank["id"], "amount": 1_00},
        {"amount": 1.5},
    ):
        response = client.post(
            f"{fin}/savings-goals/{unlinked['id']}/contributions", json=body, headers=ada
        )
        assert response.status_code == 422, body

    # Paused goals take no contributions but can be withdrawn from.
    contribute(client, fin, ada, unlinked["id"], amount=2_000_00)
    ok(client.patch(f"{fin}/savings-goals/{unlinked['id']}", json={"state": "paused"}, headers=ada))
    paused = client.post(
        f"{fin}/savings-goals/{unlinked['id']}/contributions", json={"amount": 1_00}, headers=ada
    )
    assert paused.status_code == 422
    contribute(client, fin, ada, unlinked["id"], amount=500_00, type="withdrawal")

    # Linked transfers fix the goal's account.
    linked = add_goal(client, fin, ada, name="Bike", account_id=savings["id"])
    contribute(
        client, fin, ada, linked["id"], amount=1_000_00, mode="transfer", account_id=bank["id"]
    )
    relink = client.patch(
        f"{fin}/savings-goals/{linked['id']}", json={"account_id": bank["id"]}, headers=ada
    )
    assert relink.status_code == 422


def test_withdrawals_depend_on_their_contributions(
    client: TestClient, ada: Headers, fin: str
) -> None:
    created = add_goal(client, fin, ada)
    first = contribute(client, fin, ada, created["id"], amount=2_000_00)
    contribute(client, fin, ada, created["id"], amount=1_500_00, type="withdrawal")
    blocked = client.delete(
        f"{fin}/savings-goals/{created['id']}/contributions/{first['id']}", headers=ada
    )
    assert blocked.status_code == 422
    assert "Withdrawals depend" in blocked.json()["detail"]


def test_states_and_deletion(client: TestClient, ada: Headers, fin: str) -> None:
    created = add_goal(client, fin, ada)
    completed = ok(
        client.patch(
            f"{fin}/savings-goals/{created['id']}", json={"state": "completed"}, headers=ada
        )
    )
    assert completed["completed_at"] is not None
    reopened = ok(
        client.patch(f"{fin}/savings-goals/{created['id']}", json={"state": "active"}, headers=ada)
    )
    assert reopened["completed_at"] is None

    contribute(client, fin, ada, created["id"], amount=1_00)
    blocked = client.delete(f"{fin}/savings-goals/{created['id']}", headers=ada)
    assert blocked.status_code == 409
    assert "Cancel it instead" in blocked.json()["detail"]
    cancelled = ok(
        client.patch(
            f"{fin}/savings-goals/{created['id']}", json={"state": "cancelled"}, headers=ada
        )
    )
    assert cancelled["state"] == "cancelled"
    assert cancelled["saved"] == 1_00

    empty = add_goal(client, fin, ada, name="Phone")
    ok(client.delete(f"{fin}/savings-goals/{empty['id']}", headers=ada), 204)
    names = [
        entry["name"] for entry in ok(client.get(f"{fin}/savings-goals", headers=ada))["goals"]
    ]
    assert names == ["Emergency fund"]


def test_goal_validation(client: TestClient, ada: Headers, fin: str) -> None:
    for fields in (
        {"target_amount": 0},
        {"category": "yacht"},
        {"priority": "urgent"},
        {"target_date": add_months(THIS_MONTH, -1).isoformat()},
        {"saved": 100},
    ):
        body = {
            "name": "Car",
            "target_amount": 1_00,
            "start_date": THIS_MONTH.isoformat(),
            **fields,
        }
        response = client.post(f"{fin}/savings-goals", json=body, headers=ada)
        assert response.status_code == 422, fields


def test_other_users_goals_are_unreachable(
    client: TestClient, ada: Headers, grace: Headers, fin: str
) -> None:
    bank = account(client, fin, ada)
    created = add_goal(client, fin, ada)
    entry = contribute(client, fin, ada, created["id"], amount=1_00)
    path = f"{fin}/savings-goals/{created['id']}"
    assert client.get(path, headers=grace).status_code == 404
    assert client.patch(path, json={"name": "Mine"}, headers=grace).status_code == 404
    assert (
        client.post(f"{path}/contributions", json={"amount": 1}, headers=grace).status_code == 404
    )

    graces = finance_url(client, grace)
    own = f"{graces}/savings-goals/{created['id']}"
    assert client.get(own, headers=grace).status_code == 404
    assert client.delete(own, headers=grace).status_code == 404
    assert client.get(f"{own}/contributions", headers=grace).status_code == 404
    assert client.delete(f"{own}/contributions/{entry['id']}", headers=grace).status_code == 404
    # Ada's account can't be linked from Grace's workspace.
    response = client.post(
        f"{graces}/savings-goals",
        json={
            "name": "Car",
            "target_amount": 1_00,
            "start_date": THIS_MONTH.isoformat(),
            "account_id": bank["id"],
        },
        headers=grace,
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "That account doesn't exist in this workspace."
    assert goal(client, fin, ada, created["id"])["saved"] == 1_00
