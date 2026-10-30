"""Loans, subscriptions, bills, their payments, upcoming payments, the dashboard summary,
reminders, and isolation, through the API.

Dates are fixed and every status-dependent request names `today`, so nothing depends on the
real date. Reminder tests use 2030 so their times are always in the future.
"""

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"
LAKH = 100_000_00

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


@pytest.fixture
def grace(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="grace@example.com", display_name="Grace"))


def workspace_url(client: TestClient, headers: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}"


@pytest.fixture
def home(client: TestClient, ada: Headers) -> str:
    return workspace_url(client, ada)


@pytest.fixture
def fin(home: str) -> str:
    return f"{home}/finance"


@pytest.fixture
def bank(client: TestClient, ada: Headers, fin: str) -> Json:
    response = client.post(
        f"{fin}/accounts",
        json={"name": "HDFC Savings", "type": "bank", "opening_balance": 10 * LAKH},
        headers=ada,
    )
    assert response.status_code == 201, response.text
    account: Json = response.json()
    return account


def ok(response: Any, code: int = 200) -> Json:
    assert response.status_code == code, response.text
    body: Json = response.json()
    return body


def add_loan(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    body = {
        "name": "Car loan",
        "lender": "SBI",
        "loan_type": "vehicle",
        "principal": 6 * LAKH,
        "interest_rate_bps": 1200,
        "start_date": "2026-01-01",
        "tenure_months": 12,
        "first_payment_date": "2026-02-05",
        **fields,
    }
    return ok(client.post(f"{fin}/loans", json=body, headers=headers), 201)


def loan_detail(
    client: TestClient, fin: str, headers: Headers, loan_id: str, **params: Any
) -> Json:
    return ok(client.get(f"{fin}/loans/{loan_id}", params=params, headers=headers))


def add_recurring(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    body = {
        "kind": "subscription",
        "name": "Netflix",
        "provider": "Netflix",
        "amount": 649_00,
        "frequency": "monthly",
        "next_due_date": "2026-03-15",
        **fields,
    }
    return ok(client.post(f"{fin}/recurring-payments", json=body, headers=headers), 201)


def balances(client: TestClient, fin: str, headers: Headers) -> dict[str, int]:
    accounts = ok(client.get(f"{fin}/accounts", headers=headers))["accounts"]
    return {account["name"]: account["balance"] for account in accounts}


def spending(client: TestClient, fin: str, headers: Headers, month: str) -> Json:
    return ok(client.get(f"{fin}/summary", params={"month": month}, headers=headers))


def payments(client: TestClient, fin: str, headers: Headers, **params: Any) -> list[Json]:
    items: list[Json] = ok(client.get(f"{fin}/payments", params=params, headers=headers))[
        "payments"
    ]
    return items


def category_id(client: TestClient, fin: str, headers: Headers, name: str) -> str:
    categories = ok(client.get(f"{fin}/categories", headers=headers))["categories"]
    return next(entry["id"] for entry in categories if entry["name"] == name)


# Loans


def test_a_new_loan_gets_a_liability_account_and_a_full_schedule(
    client: TestClient, ada: Headers, fin: str
) -> None:
    loan = add_loan(client, fin, ada)

    assert loan["status"] == "active"
    assert loan["outstanding_principal"] == loan["principal"] == 6 * LAKH
    assert loan["repaid_principal"] == 0
    # The standard EMI for ₹6,00,000 at 12% over 12 months.
    assert loan["emi_amount"] == 53_309_27
    assert loan["next_payment_date"] == "2026-02-05"
    assert loan["total_installments"] == 12 and loan["paid_installments"] == 0

    accounts = ok(client.get(f"{fin}/accounts", headers=ada))
    [account] = accounts["accounts"]
    assert account["id"] == loan["account_id"]
    assert account["type"] == "loan" and account["account_class"] == "liability"
    assert account["balance"] == -6 * LAKH
    assert accounts["totals"] == [{"currency": "INR", "assets": 0, "liabilities": 6 * LAKH}]

    schedule = loan_detail(client, fin, ada, loan["id"], today="2026-01-10")["installments"]
    assert [entry["sequence"] for entry in schedule] == list(range(1, 13))
    assert schedule[0]["due_date"] == "2026-02-05" and schedule[-1]["due_date"] == "2027-01-05"
    assert schedule[0]["interest"] == 6_000_00  # 1% of the balance a month
    assert schedule[0]["principal"] + schedule[0]["interest"] == schedule[0]["amount"]
    assert sum(entry["principal"] for entry in schedule) == 6 * LAKH
    assert schedule[-1]["balance_after"] == 0
    assert {entry["status"] for entry in schedule} == {"upcoming"}


def test_a_loan_already_being_repaid_schedules_only_what_is_left(
    client: TestClient, ada: Headers, fin: str
) -> None:
    loan = add_loan(
        client, fin, ada,
        outstanding_principal=3 * LAKH, next_payment_date="2026-08-05", emi_amount=53_310_00,
    )  # fmt: skip

    assert loan["outstanding_principal"] == 3 * LAKH
    assert loan["repaid_principal"] == 3 * LAKH
    assert loan["emi_amount"] == 53_310_00
    schedule = loan_detail(client, fin, ada, loan["id"])["installments"]
    # Six of the twelve installments fell due before August: the remaining six are tracked.
    assert [entry["sequence"] for entry in schedule] == list(range(7, 13))
    assert schedule[0]["due_date"] == "2026-08-05"
    assert sum(entry["principal"] for entry in schedule) == 3 * LAKH


@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ({"outstanding_principal": 7 * LAKH}, "more than the amount borrowed"),
        ({"tenure_months": 13, "emi_frequency": "quarterly"}, "whole number of quarters"),
        ({"emi_amount": 1_000_00}, "doesn't cover the interest"),
        ({"next_payment_date": "2027-02-05"}, "after the last installment"),
        ({"first_payment_date": "2025-12-01"}, "before the loan starts"),
        ({"payment_account_id": str(uuid.uuid4())}, "doesn't exist in this workspace"),
    ],
)
def test_loan_rules(client: TestClient, ada: Headers, fin: str, fields: Json, message: str) -> None:
    response = client.post(
        f"{fin}/loans",
        json={
            "name": "Loan", "loan_type": "personal", "principal": 6 * LAKH,
            "interest_rate_bps": 1200, "start_date": "2026-01-01", "tenure_months": 12,
            "first_payment_date": "2026-02-05", **fields,
        },
        headers=ada,
    )  # fmt: skip
    assert response.status_code == 422, response.text
    assert message in response.json()["detail"]


@pytest.mark.parametrize(
    "fields",
    [
        {"principal": 1.5},
        {"principal": 0},
        {"interest_rate_bps": 8.5},
        {"interest_rate_bps": 10_001},
        {"loan_type": "mortgage"},
        {"currency": "inr"},
        {"account_id": str(uuid.uuid4())},
        {"status": "closed"},
    ],
)
def test_loan_validation(client: TestClient, ada: Headers, fin: str, fields: Json) -> None:
    body = {
        "name": "Loan", "loan_type": "personal", "principal": 6 * LAKH, "interest_rate_bps": 1200,
        "start_date": "2026-01-01", "tenure_months": 12, "first_payment_date": "2026-02-05",
    }  # fmt: skip
    assert client.post(f"{fin}/loans", json={**body, **fields}, headers=ada).status_code == 422


def test_loan_accounts_cannot_be_created_on_their_own(
    client: TestClient, ada: Headers, fin: str
) -> None:
    response = client.post(f"{fin}/accounts", json={"name": "Loan", "type": "loan"}, headers=ada)
    assert response.status_code == 422


def test_paying_an_emi_splits_principal_and_interest_without_double_counting(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    loan = add_loan(client, fin, ada)
    first = loan_detail(client, fin, ada, loan["id"])["installments"][0]

    paid = ok(
        client.post(
            f"{fin}/loans/{loan['id']}/installments/{first['id']}/pay",
            json={"paid_on": "2026-02-05", "from_account_id": bank["id"]},
            headers=ada,
        )
    )
    assert paid["state"] == "paid" and paid["status"] == "paid"
    assert paid["paid_on"] == "2026-02-05"
    assert paid["principal"] == first["principal"] and paid["interest"] == 6_000_00
    assert paid["balance_after"] == 6 * LAKH - first["principal"]

    # The bank paid the whole EMI; the loan's balance fell by the principal only.
    assert balances(client, fin, ada) == {
        "HDFC Savings": 10 * LAKH - first["amount"],
        "Car loan": -(6 * LAKH - first["principal"]),
    }
    # Only interest is spending: the principal transfer is not, and the EMI isn't counted again.
    month = spending(client, fin, ada, "2026-02")
    assert month["expenses"] == 6_000_00
    assert month["transactions"] == 1

    transactions = ok(client.get(f"{fin}/transactions", headers=ada))["transactions"]
    by_type = {entry["type"]: entry for entry in transactions}
    assert set(by_type) == {"transfer", "expense"}
    assert by_type["transfer"]["id"] == paid["principal_transaction_id"]
    assert by_type["transfer"]["to_account_id"] == loan["account_id"]
    assert by_type["expense"]["id"] == paid["interest_transaction_id"]
    assert by_type["expense"]["category_id"] == category_id(client, fin, ada, "Loan interest")

    view = ok(client.get(f"{fin}/loans/{loan['id']}", headers=ada))["loan"]
    assert view["outstanding_principal"] == 6 * LAKH - first["principal"]
    assert view["paid_installments"] == 1
    assert view["next_payment_date"] == "2026-03-05"


def test_an_installment_is_paid_once_and_its_transactions_are_protected(
    client: TestClient, ada: Headers, fin: str, bank: Json, migrated_settings: Settings
) -> None:
    loan = add_loan(client, fin, ada)
    first = loan_detail(client, fin, ada, loan["id"])["installments"][0]
    pay = f"{fin}/loans/{loan['id']}/installments/{first['id']}/pay"
    body = {"paid_on": "2026-02-05", "from_account_id": bank["id"]}
    paid = ok(client.post(pay, json=body, headers=ada))

    again = client.post(pay, json=body, headers=ada)
    assert again.status_code == 409
    assert again.json()["detail"] == "This installment is already paid."
    count = query(migrated_settings.sqlite_path, "SELECT count(*) FROM finance_transactions")
    assert count == [(2,)]

    # The ledger won't drop a transaction that records the payment.
    blocked = client.delete(f"{fin}/transactions/{paid['principal_transaction_id']}", headers=ada)
    assert blocked.status_code == 409
    assert "Undo that payment first" in blocked.json()["detail"]

    undone = ok(
        client.post(
            f"{fin}/loans/{loan['id']}/installments/{first['id']}/undo",
            params={"delete_transactions": True},
            headers=ada,
        )
    )
    assert undone["state"] == "scheduled" and undone["principal_transaction_id"] is None
    assert balances(client, fin, ada) == {"HDFC Savings": 10 * LAKH, "Car loan": -6 * LAKH}
    assert ok(client.get(f"{fin}/transactions", headers=ada))["total"] == 0


def test_link_existing_transactions_to_an_installment(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    loan = add_loan(client, fin, ada)
    first, second = loan_detail(client, fin, ada, loan["id"])["installments"][:2]
    principal = ok(
        client.post(
            f"{fin}/transfers",
            json={
                "amount": 47_000_00, "occurred_on": "2026-02-06", "description": "EMI",
                "from_account_id": bank["id"], "to_account_id": loan["account_id"],
            },
            headers=ada,
        ),
        201,
    )  # fmt: skip
    interest = ok(
        client.post(
            f"{fin}/transactions",
            json={
                "type": "expense", "amount": 6_000_00, "occurred_on": "2026-02-06",
                "description": "EMI interest", "account_id": bank["id"],
            },
            headers=ada,
        ),
        201,
    )  # fmt: skip
    url = f"{fin}/loans/{loan['id']}/installments"

    # Interest can't stand in for principal, and amounts come from the transactions.
    wrong = client.post(
        f"{url}/{first['id']}/pay",
        json={"paid_on": "2026-02-06", "principal_transaction_id": interest["id"]},
        headers=ada,
    )
    assert wrong.status_code == 422
    assert "transfer into the loan's account" in wrong.json()["detail"]
    mixed = client.post(
        f"{url}/{first['id']}/pay",
        json={
            "paid_on": "2026-02-06", "principal_transaction_id": principal["id"],
            "from_account_id": bank["id"],
        },
        headers=ada,
    )  # fmt: skip
    assert mixed.status_code == 422

    paid = ok(
        client.post(
            f"{url}/{first['id']}/pay",
            json={
                "paid_on": "2026-02-06", "principal_transaction_id": principal["id"],
                "interest_transaction_id": interest["id"],
            },
            headers=ada,
        )
    )  # fmt: skip
    assert (paid["principal"], paid["interest"]) == (47_000_00, 6_000_00)
    assert paid["balance_after"] == 6 * LAKH - 47_000_00

    # A transaction pays one installment only.
    reused = client.post(
        f"{url}/{second['id']}/pay",
        json={"paid_on": "2026-03-05", "interest_transaction_id": interest["id"]},
        headers=ada,
    )
    assert reused.status_code == 409
    assert reused.json()["detail"] == "That transaction already records another payment."


def test_adjust_skip_and_reschedule_installments(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    loan = add_loan(client, fin, ada)
    schedule = loan_detail(client, fin, ada, loan["id"])["installments"]
    url = f"{fin}/loans/{loan['id']}/installments"

    adjusted = ok(
        client.patch(
            f"{url}/{schedule[0]['id']}",
            json={"due_date": "2026-02-07", "interest": 6_100_00},
            headers=ada,
        )
    )
    assert adjusted["due_date"] == "2026-02-07" and adjusted["interest"] == 6_100_00
    assert adjusted["adjusted"] is True
    assert adjusted["amount"] == schedule[0]["principal"] + 6_100_00
    assert client.patch(f"{url}/{schedule[0]['id']}", json={}, headers=ada).status_code == 422

    skipped = ok(client.post(f"{url}/{schedule[1]['id']}/skip", headers=ada))
    assert skipped["state"] == "skipped"
    assert client.post(f"{url}/{skipped['id']}/skip", headers=ada).status_code == 409
    assert (
        client.patch(f"{url}/{skipped['id']}", json={"interest": 1}, headers=ada).status_code == 409
    )

    # A prepayment (a transfer into the loan account), then a reschedule keeping the EMI count.
    ok(
        client.post(
            f"{fin}/transfers",
            json={
                "amount": 2 * LAKH, "occurred_on": "2026-02-10", "description": "Prepayment",
                "from_account_id": bank["id"], "to_account_id": loan["account_id"],
            },
            headers=ada,
        ),
        201,
    )  # fmt: skip
    rescheduled = ok(client.post(f"{fin}/loans/{loan['id']}/reschedule", json={}, headers=ada))
    assert rescheduled["outstanding_principal"] == 4 * LAKH
    assert rescheduled["emi_amount"] < loan["emi_amount"]
    after = loan_detail(client, fin, ada, loan["id"])["installments"]
    states = [entry["state"] for entry in after]
    assert states.count("skipped") == 1 and states.count("scheduled") == 11
    scheduled = [entry for entry in after if entry["state"] == "scheduled"]
    assert sum(entry["principal"] for entry in scheduled) == 4 * LAKH
    # The skipped installment keeps its number; new ones continue after it.
    assert min(entry["sequence"] for entry in scheduled) == 3

    # A larger EMI shortens the tenure instead.
    shorter = ok(
        client.post(
            f"{fin}/loans/{loan['id']}/reschedule", json={"emi_amount": 1 * LAKH}, headers=ada
        )
    )
    assert shorter["emi_amount"] == 1 * LAKH
    remaining = [
        entry
        for entry in loan_detail(client, fin, ada, loan["id"])["installments"]
        if entry["state"] == "scheduled"
    ]
    assert len(remaining) == 5
    assert sum(entry["principal"] for entry in remaining) == 4 * LAKH


def test_closing_a_loan_stops_expecting_its_installments(
    client: TestClient, ada: Headers, fin: str
) -> None:
    loan = add_loan(client, fin, ada)
    window = {"today": "2026-01-10", "date_from": "2026-01-01", "date_to": "2026-04-30"}
    assert len(payments(client, fin, ada, **window)) == 3

    closed = ok(client.patch(f"{fin}/loans/{loan['id']}", json={"status": "closed"}, headers=ada))
    assert closed["status"] == "closed"
    assert payments(client, fin, ada, **window) == []

    ok(client.patch(f"{fin}/loans/{loan['id']}", json={"status": "active"}, headers=ada))
    assert len(payments(client, fin, ada, **window)) == 3


# Subscriptions and bills


def test_subscription_costs_and_schedule(client: TestClient, ada: Headers, fin: str) -> None:
    yearly = add_recurring(
        client, fin, ada, name="Prime", amount=1_499_00, frequency="yearly",
        next_due_date="2026-06-01", start_date="2024-06-01", trial_ends_on=None,
    )  # fmt: skip
    monthly = add_recurring(client, fin, ada)

    assert yearly["monthly_cost"] == 124_92 and yearly["annual_cost"] == 1_499_00
    assert monthly["monthly_cost"] == 649_00 and monthly["annual_cost"] == 7_788_00
    assert monthly["status"] == "active" and monthly["next_due_date"] == "2026-03-15"
    assert monthly["start_date"] == "2026-03-15"

    listed = ok(
        client.get(
            f"{fin}/recurring-payments", params={"kind": "subscription", "today": "2026-05-20"},
            headers=ada,
        )
    )["recurring_payments"]  # fmt: skip
    by_name = {entry["name"]: entry for entry in listed}
    # March, April, and May are unpaid by May 20.
    assert by_name["Netflix"]["overdue"] == 3
    assert by_name["Netflix"]["next_due_date"] == "2026-03-15"
    assert by_name["Prime"]["overdue"] == 0


def test_record_renewals_create_link_manual_and_duplicates(
    client: TestClient, ada: Headers, fin: str, bank: Json, migrated_settings: Settings
) -> None:
    entertainment = category_id(client, fin, ada, "Entertainment")
    sub = add_recurring(client, fin, ada, account_id=bank["id"], category_id=entertainment)
    url = f"{fin}/recurring-payments/{sub['id']}/occurrences"

    created = ok(
        client.post(url, json={"due_date": "2026-03-15", "paid_on": "2026-03-15"}, headers=ada),
        201,
    )
    assert created["state"] == "paid" and created["amount"] == 649_00
    transaction = ok(client.get(f"{fin}/transactions/{created['transaction_id']}", headers=ada))
    assert transaction["type"] == "expense"
    assert transaction["category_id"] == entertainment
    assert transaction["account_id"] == bank["id"]
    assert spending(client, fin, ada, "2026-03")["expenses"] == 649_00

    duplicate = client.post(
        url, json={"due_date": "2026-03-15", "paid_on": "2026-03-16"}, headers=ada
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "That payment is already recorded."

    # Marked paid by hand: history, but not spending.
    manual = ok(
        client.post(
            url,
            json={"due_date": "2026-04-15", "paid_on": "2026-04-15", "mode": "manual",
                  "amount": 699_00},
            headers=ada,
        ),
        201,
    )  # fmt: skip
    assert manual["transaction_id"] is None and manual["amount"] == 699_00
    assert spending(client, fin, ada, "2026-04")["expenses"] == 0

    expense = ok(
        client.post(
            f"{fin}/transactions",
            json={"type": "expense", "amount": 649_00, "occurred_on": "2026-05-14",
                  "description": "Netflix", "account_id": bank["id"]},
            headers=ada,
        ),
        201,
    )  # fmt: skip
    linked = ok(
        client.post(
            url,
            json={"due_date": "2026-05-15", "paid_on": "2026-05-14", "mode": "link",
                  "transaction_id": expense["id"]},
            headers=ada,
        ),
        201,
    )  # fmt: skip
    assert linked["transaction_id"] == expense["id"]
    relink = client.post(
        url,
        json={"due_date": "2026-06-15", "paid_on": "2026-06-15", "mode": "link",
              "transaction_id": expense["id"]},
        headers=ada,
    )  # fmt: skip
    assert relink.status_code == 409

    not_on_schedule = client.post(
        url, json={"due_date": "2026-06-16", "paid_on": "2026-06-16"}, headers=ada
    )
    assert not_on_schedule.status_code == 422

    history = ok(client.get(url, headers=ada))["occurrences"]
    assert [entry["due_date"] for entry in history] == ["2026-05-15", "2026-04-15", "2026-03-15"]
    count = query(migrated_settings.sqlite_path, "SELECT count(*) FROM finance_transactions")
    assert count == [(2,)]

    # Undo keeps the expense unless asked; then the ledger lets it go.
    client.delete(f"{url}/{linked['id']}", headers=ada)
    assert ok(client.get(f"{fin}/transactions/{expense['id']}", headers=ada))["id"]
    assert client.delete(f"{fin}/transactions/{expense['id']}", headers=ada).status_code == 204
    response = client.delete(
        f"{url}/{created['id']}", params={"delete_transaction": True}, headers=ada
    )
    assert response.status_code == 204
    assert (
        client.get(f"{fin}/transactions/{created['transaction_id']}", headers=ada).status_code
        == 404
    )
    assert spending(client, fin, ada, "2026-03")["expenses"] == 0


def test_schedule_changes_pausing_and_cancelling_keep_history(
    client: TestClient, ada: Headers, fin: str
) -> None:
    sub = add_recurring(client, fin, ada)
    url = f"{fin}/recurring-payments/{sub['id']}"
    ok(
        client.post(
            f"{url}/occurrences",
            json={"due_date": "2026-03-15", "paid_on": "2026-03-15", "mode": "manual"},
            headers=ada,
        ),
        201,
    )
    ok(client.post(f"{url}/occurrences/skip", json={"due_date": "2026-04-15"}, headers=ada), 201)

    changed = ok(
        client.patch(url, json={"next_due_date": "2026-05-01", "amount": 799_00}, headers=ada)
    )
    assert changed["next_due_date"] == "2026-05-01" and changed["amount"] == 799_00
    history = ok(client.get(f"{url}/occurrences", headers=ada))["occurrences"]
    assert [(entry["due_date"], entry["state"], entry["amount"]) for entry in history] == [
        ("2026-04-15", "skipped", None),
        ("2026-03-15", "paid", 649_00),
    ]

    window = {"today": "2026-05-10", "date_from": "2026-03-01", "date_to": "2026-06-30"}
    statuses = [(item["due_date"], item["status"]) for item in payments(client, fin, ada, **window)]
    assert statuses == [
        ("2026-03-15", "paid"),
        ("2026-04-15", "skipped"),
        ("2026-05-01", "overdue"),
        ("2026-06-01", "upcoming"),
    ]

    paused = ok(client.patch(url, json={"state": "paused"}, headers=ada))
    assert paused["status"] == "paused" and paused["next_due_date"] is None
    assert [item["status"] for item in payments(client, fin, ada, **window)] == ["paid", "skipped"]
    blocked = client.post(
        f"{url}/occurrences", json={"due_date": "2026-06-01", "paid_on": "2026-06-01"}, headers=ada
    )
    assert blocked.status_code == 409

    # Resuming restarts on the cadence's next date from today, not with a backlog.
    resumed = ok(
        client.patch(url, params={"today": "2026-05-10"}, json={"state": "active"}, headers=ada)
    )
    assert resumed["status"] == "active"
    assert resumed["next_due_date"] >= "2026-05-01"

    cancelled = ok(client.patch(url, json={"state": "cancelled"}, headers=ada))
    assert cancelled["status"] == "cancelled"
    assert len(ok(client.get(f"{url}/occurrences", headers=ada))["occurrences"]) == 2


def test_bills_with_variable_amounts_are_estimates_until_paid(
    client: TestClient, ada: Headers, fin: str
) -> None:
    bill = add_recurring(
        client, fin, ada, kind="bill", name="Electricity", provider="BESCOM", amount=1_800_00,
        amount_varies=True, next_due_date="2026-03-10", end_date="2026-05-10",
    )  # fmt: skip
    url = f"{fin}/recurring-payments/{bill['id']}/occurrences"
    ok(
        client.post(
            url,
            json={"due_date": "2026-03-10", "paid_on": "2026-03-09", "mode": "manual",
                  "amount": 2_134_50},
            headers=ada,
        ),
        201,
    )  # fmt: skip

    items = payments(
        client, fin, ada, today="2026-04-10", date_from="2026-03-01", date_to="2026-12-31",
        kind="bill",
    )  # fmt: skip
    assert [(i["due_date"], i["status"], i["amount"], i["estimated"]) for i in items] == [
        ("2026-03-10", "paid", 2_134_50, False),
        ("2026-04-10", "due", 1_800_00, True),
        # Nothing after the end date.
        ("2026-05-10", "upcoming", 1_800_00, True),
    ]
    expired = ok(
        client.get(f"{fin}/recurring-payments/{bill['id']}", params={"today": "2026-06-01"},
                   headers=ada)
    )  # fmt: skip
    assert expired["status"] == "expired"


def test_recurring_payment_rules(client: TestClient, ada: Headers, fin: str, bank: Json) -> None:
    salary = category_id(client, fin, ada, "Salary")
    for fields, message in (
        ({"category_id": salary}, "expense category"),
        ({"category_id": str(uuid.uuid4())}, "doesn't exist"),
        ({"account_id": str(uuid.uuid4())}, "doesn't exist"),
        ({"currency": "USD", "account_id": bank["id"]}, "account in USD"),
        ({"start_date": "2026-04-01"}, "start date"),
        ({"end_date": "2026-03-01"}, "end date"),
    ):
        response = client.post(
            f"{fin}/recurring-payments",
            json={"kind": "bill", "name": "Rent", "amount": 1, "frequency": "monthly",
                  "next_due_date": "2026-03-15", **fields},
            headers=ada,
        )  # fmt: skip
        assert response.status_code == 422, fields
        assert message in response.json()["detail"], fields
    for fields in ({"frequency": "daily"}, {"amount": 10.5}, {"kind": "loan"}, {"state": "paused"}):
        response = client.post(
            f"{fin}/recurring-payments",
            json={"kind": "bill", "name": "Rent", "amount": 1, "frequency": "monthly",
                  "next_due_date": "2026-03-15", **fields},
            headers=ada,
        )  # fmt: skip
        assert response.status_code == 422, fields


def test_a_category_used_by_a_bill_cannot_be_deleted(
    client: TestClient, ada: Headers, fin: str
) -> None:
    pets = ok(
        client.post(f"{fin}/categories", json={"name": "Pets", "type": "expense"}, headers=ada), 201
    )
    add_recurring(client, fin, ada, kind="bill", name="Pet insurance", category_id=pets["id"])
    response = client.delete(f"{fin}/categories/{pets['id']}", headers=ada)
    assert response.status_code == 409
    assert "Subscriptions or bills use this category" in response.json()["detail"]


# Upcoming payments and the dashboard


def test_upcoming_payments_combine_every_commitment_with_filters(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    add_loan(client, fin, ada, payment_account_id=bank["id"])
    add_recurring(client, fin, ada, next_due_date="2026-02-05")
    add_recurring(
        client, fin, ada, kind="bill", name="Rent", amount=25_000_00, next_due_date="2026-01-31"
    )
    window = {"today": "2026-02-05", "date_from": "2026-02-01", "date_to": "2026-02-28"}

    items = payments(client, fin, ada, **window)
    assert [(i["kind"], i["name"], i["due_date"], i["status"]) for i in items] == [
        ("bill", "Rent", "2026-01-31", "overdue"),
        ("loan", "Car loan", "2026-02-05", "due"),
        ("subscription", "Netflix", "2026-02-05", "due"),
        ("bill", "Rent", "2026-02-28", "upcoming"),
    ]
    loan_item = items[1]
    assert loan_item["account_id"] == bank["id"]
    assert loan_item["principal"] + loan_item["interest"] == loan_item["amount"]

    assert [i["name"] for i in payments(client, fin, ada, kind="bill", **window)] == [
        "Rent",
        "Rent",
    ]
    assert [i["kind"] for i in payments(client, fin, ada, status="due", **window)] == [
        "loan",
        "subscription",
    ]
    without_overdue = payments(client, fin, ada, include_overdue=False, **window)
    assert "overdue" not in {i["status"] for i in without_overdue}
    reversed_range = client.get(
        f"{fin}/payments", params={"date_from": "2026-03-01", "date_to": "2026-02-01"}, headers=ada
    )
    assert reversed_range.status_code == 422


def test_dashboard_summary(client: TestClient, ada: Headers, fin: str, bank: Json) -> None:
    loan = add_loan(client, fin, ada)
    add_loan(client, fin, ada, name="Old loan", emi_frequency="quarterly")
    old = next(
        entry
        for entry in ok(client.get(f"{fin}/loans", headers=ada))["loans"]
        if entry["name"] == "Old loan"
    )
    ok(client.patch(f"{fin}/loans/{old['id']}", json={"status": "closed"}, headers=ada))
    add_recurring(client, fin, ada, next_due_date="2026-02-20")
    add_recurring(
        client,
        fin,
        ada,
        name="Prime",
        amount=1_499_00,
        frequency="yearly",
        next_due_date="2026-09-01",
    )
    add_recurring(client, fin, ada, name="Paused", amount=99_00, next_due_date="2026-02-25")
    paused = next(
        entry
        for entry in ok(client.get(f"{fin}/recurring-payments", headers=ada))["recurring_payments"]
        if entry["name"] == "Paused"
    )
    ok(
        client.patch(
            f"{fin}/recurring-payments/{paused['id']}", json={"state": "paused"}, headers=ada
        )
    )
    add_recurring(
        client, fin, ada, kind="bill", name="Rent", amount=25_000_00, next_due_date="2026-02-01"
    )
    add_recurring(
        client,
        fin,
        ada,
        kind="bill",
        name="USD bill",
        currency="USD",
        amount=10_00,
        next_due_date="2026-02-12",
    )

    summary = ok(
        client.get(f"{fin}/commitments/summary", params={"today": "2026-02-10"}, headers=ada)
    )
    assert summary["today"] == "2026-02-10"
    # Only the active loan: closed ones and other currencies don't count.
    assert summary["active_loans"] == 1
    assert summary["loans_outstanding"] == 6 * LAKH
    assert summary["monthly_emi"] == loan["emi_amount"]
    assert summary["active_subscriptions"] == 2
    assert summary["monthly_subscriptions"] == 649_00 + 124_92
    assert summary["annual_subscriptions"] == 7_788_00 + 1_499_00
    # Rent on Mar 1 is within 30 days; Feb 1 is overdue.
    assert summary["upcoming_bills"] == {"count": 1, "amount": 25_000_00}
    assert summary["overdue"]["count"] == 2  # Rent (Feb 1) and the loan's Feb 5 EMI
    assert summary["overdue"]["amount"] == 25_000_00 + loan["next_payment_amount"]
    # Netflix on Feb 20 is the only payment left this month.
    assert summary["due_this_month"] == {"count": 1, "amount": 649_00}

    usd = ok(
        client.get(
            f"{fin}/commitments/summary", params={"today": "2026-02-10", "currency": "USD"},
            headers=ada,
        )
    )  # fmt: skip
    assert usd["due_this_month"] == {"count": 1, "amount": 10_00}
    assert usd["loans_outstanding"] == 0


# Reminders


def reminders(client: TestClient, home: str, headers: Headers) -> list[Json]:
    found: list[Json] = ok(client.get(f"{home}/reminders", headers=headers))["reminders"]
    return found


def test_commitments_manage_one_reminder_each(
    client: TestClient, ada: Headers, home: str, fin: str, bank: Json
) -> None:
    client.patch("/api/v1/me", json={"timezone": "Asia/Kolkata"}, headers=ada)
    sub = add_recurring(
        client, fin, ada, next_due_date="2030-01-15", account_id=bank["id"],
        reminder={"days_before": 3, "time_of_day": "08:30"},
    )  # fmt: skip
    assert sub["reminder"] == {
        "days_before": 3,
        "time_of_day": "08:30:00",
        "timezone": "Asia/Kolkata",
    }

    [reminder] = reminders(client, home, ada)
    assert reminder["commitment"] == {"kind": "recurring_payment", "id": sub["id"]}
    assert reminder["title"] == "Netflix renewal due 15 Jan 2030"
    assert reminder["description"] == "INR 649.00"
    assert reminder["start_date"] == "2030-01-12"
    assert reminder["timezone"] == "Asia/Kolkata"
    # 08:30 in Kolkata is 03:00 UTC.
    assert reminder["next_occurrence_at"] == "2030-01-12T03:00:00Z"

    # Managed by the subscription: the reminders API won't change it.
    url = f"{home}/reminders/{reminder['id']}"
    assert client.patch(url, json={"title": "Edited"}, headers=ada).status_code == 409
    assert client.delete(url, headers=ada).status_code == 409

    # Paying moves it to the next renewal; editing again never makes a second reminder.
    ok(
        client.post(
            f"{fin}/recurring-payments/{sub['id']}/occurrences",
            json={"due_date": "2030-01-15", "paid_on": "2030-01-10"},
            headers=ada,
        ),
        201,
    )
    ok(
        client.patch(
            f"{fin}/recurring-payments/{sub['id']}", json={"name": "Netflix 4K"}, headers=ada
        )
    )
    [moved] = reminders(client, home, ada)
    assert moved["id"] == reminder["id"]
    assert moved["title"] == "Netflix 4K renewal due 15 Feb 2030"
    assert moved["start_date"] == "2030-02-12"

    # Pausing removes it; turning reminders off does too.
    ok(client.patch(f"{fin}/recurring-payments/{sub['id']}", json={"state": "paused"}, headers=ada))
    assert reminders(client, home, ada) == []
    ok(
        client.patch(
            f"{fin}/recurring-payments/{sub['id']}",
            json={"state": "active", "next_due_date": "2030-03-15"},
            headers=ada,
        )
    )
    assert [entry["start_date"] for entry in reminders(client, home, ada)] == ["2030-03-12"]
    ok(client.patch(f"{fin}/recurring-payments/{sub['id']}", json={"reminder": None}, headers=ada))
    assert reminders(client, home, ada) == []


def test_loan_reminders_follow_the_next_installment(
    client: TestClient, ada: Headers, home: str, fin: str, bank: Json
) -> None:
    loan = add_loan(
        client, fin, ada, start_date="2029-12-01", first_payment_date="2030-01-05",
        reminder={"days_before": 0, "timezone": "UTC"},
    )  # fmt: skip
    [reminder] = reminders(client, home, ada)
    assert reminder["commitment"] == {"kind": "loan", "id": loan["id"]}
    assert reminder["title"] == "Car loan EMI due 5 Jan 2030"
    assert reminder["next_occurrence_at"] == "2030-01-05T09:00:00Z"

    first = loan_detail(client, fin, ada, loan["id"])["installments"][0]
    ok(client.post(f"{fin}/loans/{loan['id']}/installments/{first['id']}/skip", headers=ada))
    assert reminders(client, home, ada)[0]["title"] == "Car loan EMI due 5 Feb 2030"

    ok(client.patch(f"{fin}/loans/{loan['id']}", json={"status": "closed"}, headers=ada))
    assert reminders(client, home, ada) == []


# Isolation and authorization


def test_other_users_commitments_are_unreachable(
    client: TestClient, ada: Headers, grace: Headers, fin: str, bank: Json
) -> None:
    loan = add_loan(client, fin, ada)
    sub = add_recurring(client, fin, ada)
    installment = loan_detail(client, fin, ada, loan["id"])["installments"][0]
    expense = ok(
        client.post(
            f"{fin}/transactions",
            json={"type": "expense", "amount": 1, "occurred_on": "2026-02-01",
                  "description": "Ada's", "account_id": bank["id"]},
            headers=ada,
        ),
        201,
    )  # fmt: skip

    # Grace can't reach Ada's workspace at all.
    assert client.get(f"{fin}/loans", headers=grace).status_code == 404
    assert client.get(f"{fin}/payments", headers=grace).status_code == 404

    theirs = f"{workspace_url(client, grace)}/finance"
    assert client.get(f"{theirs}/loans/{loan['id']}", headers=grace).status_code == 404
    assert client.get(f"{theirs}/recurring-payments/{sub['id']}", headers=grace).status_code == 404
    assert (
        client.post(
            f"{theirs}/loans/{loan['id']}/installments/{installment['id']}/skip", headers=grace
        ).status_code
        == 404
    )
    assert ok(client.get(f"{theirs}/loans", headers=grace))["loans"] == []
    assert ok(client.get(f"{theirs}/payments", headers=grace))["payments"] == []

    # Ada's accounts and transactions can't be used from Grace's workspace.
    borrowed = client.post(
        f"{theirs}/loans",
        json={
            "name": "Loan", "loan_type": "personal", "principal": 1_000_00,
            "interest_rate_bps": 0, "start_date": "2026-01-01", "tenure_months": 2,
            "first_payment_date": "2026-02-01", "payment_account_id": bank["id"],
        },
        headers=grace,
    )  # fmt: skip
    assert borrowed.status_code == 422
    own = add_recurring(client, theirs, grace)
    stolen = client.post(
        f"{theirs}/recurring-payments/{own['id']}/occurrences",
        json={"due_date": "2026-03-15", "paid_on": "2026-03-15", "mode": "link",
              "transaction_id": expense["id"]},
        headers=grace,
    )  # fmt: skip
    assert stolen.status_code == 422
    assert stolen.json()["detail"] == "That transaction doesn't exist in this workspace."


def test_commitments_require_sign_in(client: TestClient, fin: str) -> None:
    for path in ("/loans", "/recurring-payments", "/payments", "/commitments/summary"):
        assert client.get(f"{fin}{path}").status_code == 401
