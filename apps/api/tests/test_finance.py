"""Finance routes: accounts, categories, transactions, reports, export, and isolation.

Dates are fixed (2026 and 2028) and reports name their month, so nothing depends on today.
"""

import csv
import io
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
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


def finance_url(client: TestClient, headers: Headers) -> str:
    """The finance collection in the user's personal workspace."""
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    assert workspace["is_personal"]
    return f"{WORKSPACES}/{workspace['id']}/finance"


@pytest.fixture
def fin(client: TestClient, ada: Headers) -> str:
    return finance_url(client, ada)


def open_account(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    response = client.post(
        f"{fin}/accounts", json={"name": "HDFC Savings", "type": "bank", **fields}, headers=headers
    )
    assert response.status_code == 201, response.text
    account: Json = response.json()
    return account


def record(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    body = {"type": "expense", "occurred_on": "2026-02-10", "description": "Spent", **fields}
    response = client.post(f"{fin}/transactions", json=body, headers=headers)
    assert response.status_code == 201, response.text
    transaction: Json = response.json()
    return transaction


def category(client: TestClient, fin: str, headers: Headers, name: str) -> str:
    response = client.get(f"{fin}/categories", headers=headers)
    assert response.status_code == 200, response.text
    return next(entry["id"] for entry in response.json()["categories"] if entry["name"] == name)


def balances(client: TestClient, fin: str, headers: Headers) -> dict[str, int]:
    response = client.get(f"{fin}/accounts", headers=headers)
    assert response.status_code == 200, response.text
    return {account["name"]: account["balance"] for account in response.json()["accounts"]}


def summary(client: TestClient, fin: str, headers: Headers, month: str, **params: str) -> Json:
    response = client.get(f"{fin}/summary", params={"month": month, **params}, headers=headers)
    assert response.status_code == 200, response.text
    result: Json = response.json()
    return result


def descriptions(client: TestClient, fin: str, headers: Headers, **params: Any) -> list[str]:
    response = client.get(f"{fin}/transactions", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return [entry["description"] for entry in response.json()["transactions"]]


# Accounts and balances


def test_create_and_read_an_account(client: TestClient, ada: Headers, fin: str) -> None:
    account = open_account(
        client, fin, ada, name="  HDFC Savings ", opening_balance=1_250_050, notes="Salary account"
    )

    assert account["name"] == "HDFC Savings"
    assert account["type"] == "bank"
    assert account["account_class"] == "asset"
    assert account["currency"] == "INR"
    assert account["opening_balance"] == account["balance"] == 1_250_050
    assert account["archived"] is False
    assert client.get(f"{fin}/accounts/{account['id']}", headers=ada).json() == account


def test_balances_are_derived_from_the_opening_balance_and_the_ledger(
    client: TestClient, ada: Headers, fin: str
) -> None:
    bank = open_account(client, fin, ada, opening_balance=100_000)
    record(client, fin, ada, type="income", amount=5_000_000, account_id=bank["id"])
    record(client, fin, ada, type="expense", amount=120_050, account_id=bank["id"])
    record(client, fin, ada, type="refund", amount=2_050, account_id=bank["id"])

    assert balances(client, fin, ada) == {"HDFC Savings": 100_000 + 5_000_000 - 120_050 + 2_050}
    # Changing the opening balance moves the derived balance with it.
    client.patch(f"{fin}/accounts/{bank['id']}", json={"opening_balance": 0}, headers=ada)
    assert balances(client, fin, ada) == {"HDFC Savings": 5_000_000 - 120_050 + 2_050}


def test_credit_card_purchases_are_spending_and_bill_payments_are_transfers(
    client: TestClient, ada: Headers, fin: str
) -> None:
    bank = open_account(client, fin, ada, opening_balance=1_000_000)
    card = open_account(client, fin, ada, name="Amex", type="credit_card")
    shopping = category(client, fin, ada, "Shopping")
    record(
        client, fin, ada, amount=300_000, account_id=card["id"], category_id=shopping,
        description="Headphones",
    )  # fmt: skip

    # Spending on the card is a liability: the card's balance goes negative.
    assert balances(client, fin, ada) == {"Amex": -300_000, "HDFC Savings": 1_000_000}
    totals = client.get(f"{fin}/accounts", headers=ada).json()["totals"]
    assert totals == [{"currency": "INR", "assets": 1_000_000, "liabilities": 300_000}]

    paid = client.post(
        f"{fin}/transfers",
        json={
            "amount": 300_000,
            "occurred_on": "2026-02-25",
            "description": "Card bill",
            "from_account_id": bank["id"],
            "to_account_id": card["id"],
        },
        headers=ada,
    )
    assert paid.status_code == 201, paid.text
    assert paid.json()["type"] == "transfer"
    assert paid.json()["category_id"] is None

    # Paying the bill settles the liability without counting the purchase twice.
    assert balances(client, fin, ada) == {"Amex": 0, "HDFC Savings": 700_000}
    month = summary(client, fin, ada, "2026-02")
    assert (month["expenses"], month["income"], month["transactions"]) == (300_000, 0, 1)
    totals = client.get(f"{fin}/accounts", headers=ada).json()["totals"]
    assert totals == [{"currency": "INR", "assets": 700_000, "liabilities": 0}]


def test_investing_is_a_transfer_not_spending(client: TestClient, ada: Headers, fin: str) -> None:
    bank = open_account(client, fin, ada, opening_balance=500_000)
    broker = open_account(client, fin, ada, name="Zerodha", type="investment")
    record(
        client, fin, ada, type="transfer", amount=200_000, account_id=bank["id"],
        to_account_id=broker["id"], description="SIP",
    )  # fmt: skip

    assert balances(client, fin, ada) == {"HDFC Savings": 300_000, "Zerodha": 200_000}
    assert summary(client, fin, ada, "2026-02")["net"] == 0
    spending = client.get(f"{fin}/spending", params={"month": "2026-02"}, headers=ada).json()
    assert spending["categories"] == []
    # Moving money between your own assets leaves their total unchanged.
    totals = client.get(f"{fin}/accounts", headers=ada).json()["totals"]
    assert totals == [{"currency": "INR", "assets": 500_000, "liabilities": 0}]


def test_archived_accounts_keep_history_but_take_no_new_transactions(
    client: TestClient, ada: Headers, fin: str
) -> None:
    bank = open_account(client, fin, ada, opening_balance=10_000)
    old = record(client, fin, ada, amount=1_000, account_id=bank["id"])

    archived = client.post(f"{fin}/accounts/{bank['id']}/archive", headers=ada).json()
    assert archived["archived"] is True
    again = client.post(f"{fin}/accounts/{bank['id']}/archive", headers=ada).json()
    assert again["archived_at"] == archived["archived_at"]
    assert balances(client, fin, ada) == {"HDFC Savings": 9_000}

    refused = client.post(
        f"{fin}/transactions",
        json={
            "type": "expense",
            "amount": 500,
            "occurred_on": "2026-02-11",
            "description": "Tea",
            "account_id": bank["id"],
        },
        headers=ada,
    )
    assert refused.status_code == 422
    assert refused.json() == {
        "detail": "“HDFC Savings” is archived. Restore it to record transactions on it."
    }
    # A transaction already on it can still be corrected.
    fixed = client.patch(f"{fin}/transactions/{old['id']}", json={"amount": 1_500}, headers=ada)
    assert fixed.status_code == 200, fixed.text

    restored = client.post(f"{fin}/accounts/{bank['id']}/restore", headers=ada).json()
    assert restored["archived"] is False
    record(client, fin, ada, amount=500, account_id=bank["id"])
    assert balances(client, fin, ada) == {"HDFC Savings": 8_000}


def test_account_type_and_currency_are_fixed(client: TestClient, ada: Headers, fin: str) -> None:
    bank = open_account(client, fin, ada)

    for body in ({"currency": "USD"}, {"type": "cash"}, {}, {"name": None}):
        response = client.patch(f"{fin}/accounts/{bank['id']}", json=body, headers=ada)
        assert response.status_code == 422, body


@pytest.mark.parametrize(
    "body",
    [
        {"type": "loan"},
        {"currency": "inr"},
        {"currency": "XYZ"},
        {"opening_balance": 12.5},
        {"opening_balance": "100"},
        {"opening_balance": 10**13 + 1},
        {"name": ""},
        {"balance": 100},
        {"workspace_id": str(uuid.uuid4())},
    ],
)
def test_account_validation(client: TestClient, ada: Headers, fin: str, body: Json) -> None:
    response = client.post(
        f"{fin}/accounts", json={"name": "Cash", "type": "cash", **body}, headers=ada
    )

    assert response.status_code == 422


# Categories


def test_default_categories_are_seeded_once(client: TestClient, ada: Headers, fin: str) -> None:
    first = client.get(f"{fin}/categories", headers=ada).json()["categories"]
    second = client.get(f"{fin}/categories", headers=ada).json()["categories"]

    assert first == second
    names = {(entry["type"], entry["name"]) for entry in first}
    assert {("income", "Salary"), ("expense", "Groceries"), ("expense", "Rent")} <= names
    assert all(entry["is_default"] for entry in first)
    # Income first, then expense, each alphabetically.
    types = [entry["type"] for entry in first]
    assert types == sorted(types, reverse=True)
    income = [entry["name"] for entry in first if entry["type"] == "income"]
    assert income == sorted(income)


def test_manage_categories(client: TestClient, ada: Headers, fin: str) -> None:
    created = client.post(
        f"{fin}/categories", json={"name": "Pets", "type": "expense"}, headers=ada
    )
    assert created.status_code == 201
    assert created.json()["is_default"] is False
    pets = created.json()["id"]

    duplicate = client.post(
        f"{fin}/categories", json={"name": "groceries", "type": "expense"}, headers=ada
    )
    assert duplicate.status_code == 409
    assert duplicate.json() == {"detail": "A category with that name already exists."}
    # The same name is fine for the other type.
    other_type = client.post(
        f"{fin}/categories", json={"name": "Pets", "type": "income"}, headers=ada
    )
    assert other_type.status_code == 201

    groceries = category(client, fin, ada, "Groceries")
    renamed = client.patch(f"{fin}/categories/{groceries}", json={"name": "Kirana"}, headers=ada)
    assert renamed.status_code == 200
    assert renamed.json()["is_default"] is True
    # Renamed defaults aren't seeded again under their old name.
    names = [e["name"] for e in client.get(f"{fin}/categories", headers=ada).json()["categories"]]
    assert "Kirana" in names
    assert "Groceries" not in names

    built_in = client.delete(f"{fin}/categories/{groceries}", headers=ada)
    assert built_in.status_code == 409

    bank = open_account(client, fin, ada)
    used = record(client, fin, ada, amount=100, account_id=bank["id"], category_id=pets)
    in_use = client.delete(f"{fin}/categories/{pets}", headers=ada)
    assert in_use.status_code == 409
    assert in_use.json() == {
        "detail": "Transactions use this category. Move them to another category first."
    }

    client.patch(f"{fin}/transactions/{used['id']}", json={"category_id": None}, headers=ada)
    assert client.delete(f"{fin}/categories/{pets}", headers=ada).status_code == 204
    assert client.delete(f"{fin}/categories/{pets}", headers=ada).status_code == 404


# Transactions


def test_record_a_transaction(client: TestClient, ada: Headers, fin: str) -> None:
    bank = open_account(client, fin, ada)
    food = category(client, fin, ada, "Food and dining")

    created = record(
        client, fin, ada, amount=45_000, account_id=bank["id"], category_id=food,
        description="  Dinner ", notes="Birthday",
    )  # fmt: skip

    assert created["type"] == "expense"
    assert created["amount"] == 45_000
    assert created["currency"] == "INR"
    assert created["occurred_on"] == "2026-02-10"
    assert created["description"] == "Dinner"
    assert created["to_account_id"] is None
    assert client.get(f"{fin}/transactions/{created['id']}", headers=ada).json() == created


@pytest.mark.parametrize(
    ("body", "detail"),
    [
        ({"type": "transfer"}, "A transfer needs an account to move money to."),
        ({"type": "transfer", "to_account_id": "SELF"}, "Choose two different accounts for a "
         "transfer."),
        (
            {"type": "transfer", "to_account_id": "OTHER", "category_id": "EXPENSE"},
            "Transfers aren't income or spending, so they don't have a category.",
        ),
        ({"to_account_id": "OTHER"}, "Only transfers move money to a second account."),
        ({"type": "income", "category_id": "EXPENSE"}, "Choose an income category for income."),
        ({"category_id": "INCOME"}, "Choose an expense category for expenses and refunds."),
        ({"type": "refund", "category_id": "INCOME"}, "Choose an expense category for expenses "
         "and refunds."),
        ({"account_id": "MISSING"}, "That account doesn't exist in this workspace."),
        ({"category_id": "MISSING"}, "That category doesn't exist in this workspace."),
        (
            {"type": "transfer", "to_account_id": "DOLLARS"},
            "Both accounts in a transfer must use the same currency.",
        ),
    ],
)  # fmt: skip
def test_transaction_rules(
    client: TestClient, ada: Headers, fin: str, body: Json, detail: str
) -> None:
    bank = open_account(client, fin, ada)
    ids = {
        "SELF": bank["id"],
        "OTHER": open_account(client, fin, ada, name="Cash", type="cash")["id"],
        "DOLLARS": open_account(client, fin, ada, name="Chase", currency="USD")["id"],
        "EXPENSE": category(client, fin, ada, "Groceries"),
        "INCOME": category(client, fin, ada, "Salary"),
        "MISSING": str(uuid.uuid4()),
    }
    fields = {key: ids.get(value, value) for key, value in body.items()}

    response = client.post(
        f"{fin}/transactions",
        json={
            "type": "expense",
            "amount": 100,
            "occurred_on": "2026-02-10",
            "description": "X",
            "account_id": bank["id"],
            **fields,
        },
        headers=ada,
    )

    assert response.status_code == 422
    assert response.json() == {"detail": detail}


@pytest.mark.parametrize(
    "fields",
    [
        {"amount": 0},
        {"amount": -100},
        {"amount": 12.5},
        {"amount": 100.0},
        {"amount": "100"},
        {"amount": 10**13 + 1},
        {"type": "withdrawal"},
        {"description": ""},
        {"description": "a\x00b"},
        {"occurred_on": "1899-12-31"},
        {"occurred_on": "2026-02-30"},
        {"currency": "USD"},
        {"workspace_id": str(uuid.uuid4())},
    ],
)
def test_transaction_validation(client: TestClient, ada: Headers, fin: str, fields: Json) -> None:
    bank = open_account(client, fin, ada)
    body = {
        "type": "expense",
        "amount": 100,
        "occurred_on": "2026-02-10",
        "description": "X",
        "account_id": bank["id"],
        **fields,
    }

    response = client.post(f"{fin}/transactions", json=body, headers=ada)

    assert response.status_code == 422


def test_correct_a_transaction(client: TestClient, ada: Headers, fin: str) -> None:
    bank = open_account(client, fin, ada, opening_balance=100_000)
    cash = open_account(client, fin, ada, name="Cash", type="cash")
    groceries = category(client, fin, ada, "Groceries")
    spent = record(client, fin, ada, amount=10_000, account_id=bank["id"], category_id=groceries)

    unchanged = client.patch(
        f"{fin}/transactions/{spent['id']}", json={"amount": 10_000}, headers=ada
    )
    assert unchanged.json()["updated_at"] == spent["updated_at"]

    fixed = client.patch(f"{fin}/transactions/{spent['id']}", json={"amount": 12_000}, headers=ada)
    assert fixed.status_code == 200
    assert balances(client, fin, ada) == {"Cash": 0, "HDFC Savings": 88_000}

    # Turning the expense into a transfer must also drop its category.
    refused = client.patch(
        f"{fin}/transactions/{spent['id']}",
        json={"type": "transfer", "to_account_id": cash["id"]},
        headers=ada,
    )
    assert refused.status_code == 422
    moved = client.patch(
        f"{fin}/transactions/{spent['id']}",
        json={"type": "transfer", "to_account_id": cash["id"], "category_id": None},
        headers=ada,
    )
    assert moved.status_code == 200, moved.text
    assert balances(client, fin, ada) == {"Cash": 12_000, "HDFC Savings": 88_000}
    assert summary(client, fin, ada, "2026-02")["expenses"] == 0


def test_delete_a_transaction(client: TestClient, ada: Headers, fin: str) -> None:
    bank = open_account(client, fin, ada, opening_balance=5_000)
    spent = record(client, fin, ada, amount=1_000, account_id=bank["id"])

    assert client.delete(f"{fin}/transactions/{spent['id']}", headers=ada).status_code == 204

    assert balances(client, fin, ada) == {"HDFC Savings": 5_000}
    assert client.get(f"{fin}/transactions/{spent['id']}", headers=ada).status_code == 404
    assert client.delete(f"{fin}/transactions/{spent['id']}", headers=ada).status_code == 404


def test_filter_search_sort_and_page_history(client: TestClient, ada: Headers, fin: str) -> None:
    bank = open_account(client, fin, ada)
    cash = open_account(client, fin, ada, name="Cash", type="cash")
    rent = category(client, fin, ada, "Rent")
    salary = category(client, fin, ada, "Salary")
    for fields in (
        {"description": "January rent", "amount": 2_000_000, "occurred_on": "2026-01-01",
         "category_id": rent},
        {"description": "Salary", "type": "income", "amount": 9_000_000,
         "occurred_on": "2026-01-31", "category_id": salary},
        {"description": "ATM", "type": "transfer", "amount": 500_000,
         "occurred_on": "2026-02-01", "to_account_id": cash["id"]},
        {"description": "Chai", "amount": 2_000, "occurred_on": "2026-02-02",
         "account_id": cash["id"], "notes": "100% worth it"},
        {"description": "February rent", "amount": 2_000_000, "occurred_on": "2026-02-01",
         "category_id": rent},
    ):  # fmt: skip
        record(client, fin, ada, **{"account_id": bank["id"], **fields})

    # Newest first by default; ties on the date fall back to the newest recorded.
    assert descriptions(client, fin, ada) == [
        "Chai",
        "February rent",
        "ATM",
        "Salary",
        "January rent",
    ]
    assert descriptions(client, fin, ada, date_from="2026-02-01", date_to="2026-02-01") == [
        "February rent",
        "ATM",
    ]
    assert descriptions(client, fin, ada, type=["income", "transfer"]) == ["ATM", "Salary"]
    # An account's history includes transfers into it.
    assert descriptions(client, fin, ada, account_id=cash["id"]) == ["Chai", "ATM"]
    assert descriptions(client, fin, ada, category_id=rent) == ["February rent", "January rent"]
    assert descriptions(client, fin, ada, q="RENT") == ["February rent", "January rent"]
    # Notes are searched too, and `%` is matched literally.
    assert descriptions(client, fin, ada, q="100%") == ["Chai"]
    assert descriptions(client, fin, ada, q="%") == ["Chai"]
    assert descriptions(client, fin, ada, sort="amount")[0] == "Salary"
    assert descriptions(client, fin, ada, sort="date", order="asc")[0] == "January rent"

    page = client.get(f"{fin}/transactions", params={"limit": 2, "offset": 2}, headers=ada).json()
    assert [entry["description"] for entry in page["transactions"]] == ["ATM", "Salary"]
    assert page["total"] == 5

    transfers = client.get(f"{fin}/transfers", headers=ada).json()
    assert [entry["description"] for entry in transfers["transactions"]] == ["ATM"]

    backwards = client.get(
        f"{fin}/transactions",
        params={"date_from": "2026-02-02", "date_to": "2026-02-01"},
        headers=ada,
    )
    assert backwards.status_code == 422


# Reports


def test_monthly_summary_counts_only_the_calendar_month(
    client: TestClient, ada: Headers, fin: str
) -> None:
    bank = open_account(client, fin, ada)
    for day, amount in (("2026-01-31", 1), ("2026-02-01", 10), ("2026-02-28", 100),
                        ("2026-03-01", 1_000), ("2028-02-29", 10_000)):  # fmt: skip
        record(client, fin, ada, amount=amount, occurred_on=day, account_id=bank["id"])
    record(
        client, fin, ada, type="income", amount=50_000, occurred_on="2026-02-15",
        account_id=bank["id"],
    )  # fmt: skip
    record(
        client, fin, ada, type="refund", amount=5, occurred_on="2026-02-16", account_id=bank["id"]
    )

    february = summary(client, fin, ada, "2026-02")
    assert february == {
        "month": "2026-02",
        "currency": "INR",
        "income": 50_000,
        "expenses": 110,
        "refunds": 5,
        "net_expenses": 105,
        "net": 50_000 - 105,
        "transactions": 4,
    }
    assert summary(client, fin, ada, "2028-02")["expenses"] == 10_000
    assert summary(client, fin, ada, "2026-04")["transactions"] == 0

    for month in ("2026-13", "2026-1", "26-01", "1899-12"):
        response = client.get(f"{fin}/summary", params={"month": month}, headers=ada)
        assert response.status_code == 422, month


def test_trend_includes_months_without_transactions(
    client: TestClient, ada: Headers, fin: str
) -> None:
    bank = open_account(client, fin, ada)
    record(client, fin, ada, type="income", amount=900, occurred_on="2025-12-31",
           account_id=bank["id"])  # fmt: skip
    record(client, fin, ada, amount=300, occurred_on="2026-02-14", account_id=bank["id"])

    response = client.get(
        f"{fin}/trend", params={"month": "2026-02", "months": 3}, headers=ada
    ).json()

    assert response["currency"] == "INR"
    assert [(m["month"], m["income"], m["net_expenses"], m["net"]) for m in response["months"]] == [
        ("2025-12", 900, 0, 900),
        ("2026-01", 0, 0, 0),
        ("2026-02", 0, 300, -300),
    ]


def test_spending_by_category_nets_refunds(client: TestClient, ada: Headers, fin: str) -> None:
    bank = open_account(client, fin, ada)
    shopping = category(client, fin, ada, "Shopping")
    travel = category(client, fin, ada, "Travel")
    record(client, fin, ada, amount=5_000, account_id=bank["id"], category_id=shopping)
    record(client, fin, ada, type="refund", amount=2_000, account_id=bank["id"],
           category_id=shopping)  # fmt: skip
    record(client, fin, ada, amount=4_000, account_id=bank["id"], category_id=travel)
    record(client, fin, ada, amount=700, account_id=bank["id"])
    # Fully refunded spending disappears from the breakdown.
    groceries = category(client, fin, ada, "Groceries")
    record(client, fin, ada, amount=900, account_id=bank["id"], category_id=groceries)
    record(client, fin, ada, type="refund", amount=900, account_id=bank["id"],
           category_id=groceries)  # fmt: skip

    response = client.get(f"{fin}/spending", params={"month": "2026-02"}, headers=ada).json()

    assert response["total"] == 3_000 + 4_000 + 700
    assert [(entry["category_id"], entry["net"]) for entry in response["categories"]] == [
        (travel, 4_000),
        (shopping, 3_000),
        (None, 700),
    ]
    assert response["categories"][1]["refunds"] == 2_000


def test_reports_never_mix_currencies(client: TestClient, ada: Headers, fin: str) -> None:
    rupees = open_account(client, fin, ada, opening_balance=1_000)
    dollars = open_account(client, fin, ada, name="Chase", currency="USD", opening_balance=500)
    record(client, fin, ada, amount=100, account_id=rupees["id"])
    record(client, fin, ada, amount=7, account_id=dollars["id"])

    assert summary(client, fin, ada, "2026-02")["expenses"] == 100
    assert summary(client, fin, ada, "2026-02", currency="USD")["expenses"] == 7
    totals = client.get(f"{fin}/accounts", headers=ada).json()["totals"]
    assert totals == [
        {"currency": "INR", "assets": 900, "liabilities": 0},
        {"currency": "USD", "assets": 493, "liabilities": 0},
    ]


# Export


def test_export_transactions_as_csv(client: TestClient, ada: Headers, fin: str) -> None:
    bank = open_account(client, fin, ada)
    cash = open_account(client, fin, ada, name="=Cash", type="cash")
    rent = category(client, fin, ada, "Rent")
    record(client, fin, ada, amount=2_000_050, occurred_on="2026-02-01", account_id=bank["id"],
           category_id=rent, description="Rent, Feb", notes='Paid "late"\nby UPI')  # fmt: skip
    record(client, fin, ada, type="transfer", amount=500_000, occurred_on="2026-01-15",
           account_id=bank["id"], to_account_id=cash["id"], description="+ATM")  # fmt: skip
    record(client, fin, ada, amount=1, occurred_on="2026-03-01", account_id=bank["id"])

    response = client.get(
        f"{fin}/transactions/export",
        params={"date_from": "2026-01-01", "date_to": "2026-02-28"},
        headers=ada,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.headers["content-disposition"] == (
        'attachment; filename="orbit-transactions-2026-01-01-2026-02-28.csv"'
    )
    assert response.headers["cache-control"] == "no-store"
    rows = list(csv.reader(io.StringIO(response.text)))
    assert rows[0] == [
        "Date", "Type", "Description", "Category", "Account", "To account", "Amount", "Currency",
        "Notes", "ID",
    ]  # fmt: skip
    # Oldest first; text a spreadsheet would run as a formula is neutralized.
    assert rows[1][:9] == [
        "2026-01-15", "transfer", "'+ATM", "", "HDFC Savings", "'=Cash", "5000.00", "INR", "",
    ]  # fmt: skip
    assert rows[2][:9] == [
        "2026-02-01", "expense", "Rent, Feb", "Rent", "HDFC Savings", "", "20000.50", "INR",
        'Paid "late"\nby UPI',
    ]  # fmt: skip
    assert len(rows) == 3

    everything = client.get(f"{fin}/transactions/export", headers=ada)
    assert everything.headers["content-disposition"] == (
        'attachment; filename="orbit-transactions.csv"'
    )
    assert len(list(csv.reader(io.StringIO(everything.text)))) == 4


# Isolation


def test_other_users_finance_is_unreachable(
    client: TestClient, ada: Headers, grace: Headers, fin: str
) -> None:
    bank = open_account(client, fin, ada, opening_balance=100_000)
    rent = category(client, fin, ada, "Rent")
    spent = record(client, fin, ada, amount=1_000, account_id=bank["id"], category_id=rent)

    # Through Ada's workspace: Grace can't see that it exists.
    for method, path in (
        ("GET", "/accounts"),
        ("GET", f"/accounts/{bank['id']}"),
        ("POST", f"/accounts/{bank['id']}/archive"),
        ("GET", "/categories"),
        ("DELETE", f"/categories/{rent}"),
        ("GET", "/transactions"),
        ("GET", f"/transactions/{spent['id']}"),
        ("DELETE", f"/transactions/{spent['id']}"),
        ("GET", "/transactions/export"),
        ("GET", "/summary"),
        ("GET", "/spending"),
        ("GET", "/trend"),
    ):
        response = client.request(method, f"{fin}{path}", headers=grace)
        assert response.status_code == 404, (method, path)
        assert response.json() == {"detail": "Workspace not found."}

    # Through her own workspace: Ada's IDs don't resolve.
    own = finance_url(client, grace)
    assert client.get(f"{own}/accounts/{bank['id']}", headers=grace).status_code == 404
    assert client.get(f"{own}/transactions/{spent['id']}", headers=grace).status_code == 404
    assert (
        client.patch(
            f"{own}/transactions/{spent['id']}", json={"amount": 1}, headers=grace
        ).status_code
        == 404
    )
    assert client.delete(f"{own}/transactions/{spent['id']}", headers=grace).status_code == 404
    assert (
        client.patch(f"{own}/categories/{rent}", json={"name": "Mine"}, headers=grace).status_code
        == 404
    )
    assert client.post(f"{own}/accounts/{bank['id']}/archive", headers=grace).status_code == 404

    # And she can't point her own transactions at Ada's account or category.
    mine = open_account(client, own, grace)
    for fields in (
        {"account_id": bank["id"]},
        {"account_id": mine["id"], "category_id": rent},
        {"account_id": mine["id"], "type": "transfer", "to_account_id": bank["id"]},
    ):
        response = client.post(
            f"{own}/transactions",
            json={"type": "expense", "amount": 1, "occurred_on": "2026-02-10",
                  "description": "X", **fields},
            headers=grace,
        )  # fmt: skip
        assert response.status_code == 422, fields
    assert descriptions(client, own, grace) == []

    # Ada's data is untouched.
    assert balances(client, fin, ada) == {"HDFC Savings": 99_000}
    assert client.get(f"{fin}/transactions/{spent['id']}", headers=ada).json() == spent


def test_finance_requires_sign_in(client: TestClient, fin: str) -> None:
    response = client.get(f"{fin}/accounts")

    assert response.status_code == 401
