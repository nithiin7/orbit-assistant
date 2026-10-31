"""Budgets through the API: creation and validation, spending eligibility (what the ledger says
counts as spending), conflicts, history that survives edits, rollover, copying, the month
overview and history, and isolation.

Budget writes use today's date (in UTC: the test users have no time zone preference), so dates
here are relative to the current month rather than fixed.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.services.finance.money import add_months, month_bounds
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"
LAKH = 100_000_00

Headers = dict[str, str]
Json = dict[str, Any]

TODAY = datetime.now(UTC).date()
THIS_MONTH = TODAY.replace(day=1)
LAST_MONTH = add_months(THIS_MONTH, -1)
TWO_MONTHS_AGO = add_months(THIS_MONTH, -2)
NEXT_MONTH = add_months(THIS_MONTH, 1)


def ym(month: date) -> str:
    return f"{month.year:04d}-{month.month:02d}"


def last_day(month: date) -> str:
    return month_bounds(month)[1].isoformat()


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
    body: Json = response.json()
    return body


def account(client: TestClient, fin: str, headers: Headers, name: str, kind: str = "bank") -> str:
    body = {"name": name, "type": kind, "opening_balance": 10 * LAKH if kind == "bank" else 0}
    return str(ok(client.post(f"{fin}/accounts", json=body, headers=headers), 201)["id"])


def category(client: TestClient, fin: str, headers: Headers, name: str) -> str:
    categories = ok(client.get(f"{fin}/categories", headers=headers))["categories"]
    return str(next(entry["id"] for entry in categories if entry["name"] == name))


def record(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    body = {"description": "Entry", "occurred_on": TODAY.isoformat(), **fields}
    return ok(client.post(f"{fin}/transactions", json=body, headers=headers), 201)


def add_budget(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    body = {
        "name": "Everything",
        "scope": "overall",
        "amount": 50_000_00,
        "start_date": THIS_MONTH.isoformat(),
        **fields,
    }
    return ok(client.post(f"{fin}/budgets", json=body, headers=headers), 201)


def current(client: TestClient, fin: str, headers: Headers, budget_id: str) -> Json:
    budgets = ok(client.get(f"{fin}/budgets", headers=headers))["budgets"]
    found: Json = next(entry for entry in budgets if entry["id"] == budget_id)
    period: Json = found["current_period"]
    return period


@pytest.fixture
def bank(client: TestClient, ada: Headers, fin: str) -> str:
    return account(client, fin, ada, "HDFC Savings")


def test_create_and_read_monthly_budgets(
    client: TestClient, ada: Headers, fin: str, bank: str
) -> None:
    groceries = category(client, fin, ada, "Groceries")
    overall = add_budget(client, fin, ada)
    food = add_budget(
        client,
        fin,
        ada,
        name="Groceries",
        scope="category",
        category_id=groceries,
        amount=10_000_00,
        notes="Weekly shop",
    )
    assert overall["recurring"] is True
    assert overall["status"] == "active"
    assert overall["alert_thresholds"] == [50, 75, 90, 100]
    assert food["category_id"] == groceries
    assert food["current_period"]["start"] == THIS_MONTH.isoformat()
    assert food["current_period"]["end"] == last_day(THIS_MONTH)

    record(
        client, fin, ada, type="expense", amount=7_600_00, account_id=bank, category_id=groceries
    )
    period = current(client, fin, ada, food["id"])
    assert period["spent"] == 7_600_00
    assert period["remaining"] == 2_400_00
    assert period["utilization_percent"] == "76.00"
    assert period["status"] == "approaching"
    assert current(client, fin, ada, overall["id"])["spent"] == 7_600_00


@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ({"start_date": THIS_MONTH.replace(day=2).isoformat()}, "starts on the first day"),
        ({"end_date": THIS_MONTH.replace(day=20).isoformat()}, "ends on the last day"),
        ({"period": "custom"}, "needs an end date"),
        (
            {
                "period": "custom",
                "end_date": add_months(THIS_MONTH, 13).isoformat(),
            },
            "at most a year",
        ),
        (
            {"period": "custom", "end_date": last_day(THIS_MONTH), "rollover": "surplus"},
            "Only monthly budgets roll over",
        ),
    ],
)
def test_budget_rules(
    client: TestClient, ada: Headers, fin: str, fields: Json, message: str
) -> None:
    body = {
        "name": "Everything",
        "scope": "overall",
        "amount": 1_000_00,
        "start_date": THIS_MONTH.isoformat(),
        **fields,
    }
    response = client.post(f"{fin}/budgets", json=body, headers=ada)
    assert response.status_code == 422, response.text
    assert message in response.json()["detail"]


@pytest.mark.parametrize(
    "fields",
    [
        {"amount": 0},
        {"amount": 12.5},
        {"amount": "100"},
        {"scope": "category"},
        {"category_id": str(uuid.uuid4())},
        {"alert_thresholds": [0]},
        {"alert_thresholds": [201]},
        {"alert_thresholds": [10, 20, 30, 40, 50, 60, 70]},
        {"state": "archived"},
    ],
)
def test_budget_validation(client: TestClient, ada: Headers, fin: str, fields: Json) -> None:
    body = {
        "name": "Everything",
        "scope": "overall",
        "amount": 1_000_00,
        "start_date": THIS_MONTH.isoformat(),
        **fields,
    }
    assert client.post(f"{fin}/budgets", json=body, headers=ada).status_code == 422


def test_category_budgets_need_an_expense_category_in_the_workspace(
    client: TestClient, ada: Headers, grace: Headers, fin: str
) -> None:
    salary = category(client, fin, ada, "Salary")
    response = client.post(
        f"{fin}/budgets",
        json={
            "name": "Salary",
            "scope": "category",
            "category_id": salary,
            "amount": 1_000_00,
            "start_date": THIS_MONTH.isoformat(),
        },
        headers=ada,
    )
    assert response.status_code == 422
    assert "expense category" in response.json()["detail"]

    graces_fin = finance_url(client, grace)
    graces = category(client, graces_fin, grace, "Groceries")
    response = client.post(
        f"{fin}/budgets",
        json={
            "name": "Groceries",
            "scope": "category",
            "category_id": graces,
            "amount": 1_000_00,
            "start_date": THIS_MONTH.isoformat(),
        },
        headers=ada,
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "That category doesn't exist in this workspace."


def test_only_genuine_spending_counts(
    client: TestClient, ada: Headers, fin: str, bank: str
) -> None:
    """Income, transfers (a card bill, money moved to investments), investment purchases, and loan
    principal never count. Loan interest, fees, and recorded subscription and bill payments count
    once; an expected bill doesn't; refunds reduce their category."""
    card = account(client, fin, ada, "Card", "credit_card")
    groceries = category(client, fin, ada, "Groceries")
    budget = add_budget(client, fin, ada)

    record(
        client,
        fin,
        ada,
        type="income",
        amount=1 * LAKH,
        account_id=bank,
        category_id=category(client, fin, ada, "Salary"),
    )
    # A ₹2,000 card purchase is spending when made; paying the card bill is a transfer.
    record(
        client, fin, ada, type="expense", amount=2_000_00, account_id=card, category_id=groceries
    )
    ok(
        client.post(
            f"{fin}/transfers",
            json={
                "from_account_id": bank,
                "to_account_id": card,
                "amount": 2_000_00,
                "occurred_on": TODAY.isoformat(),
                "description": "Card bill",
            },
            headers=ada,
        ),
        201,
    )
    # A ₹500 refund of the groceries.
    record(client, fin, ada, type="refund", amount=500_00, account_id=card, category_id=groceries)

    # An investment purchase funded from the bank, with ₹20 of charges (a genuine expense).
    investment = ok(
        client.post(
            f"{fin}/investment-accounts",
            json={"name": "Zerodha", "kind": "brokerage"},
            headers=ada,
        ),
        201,
    )
    holding = ok(
        client.post(
            f"{fin}/holdings",
            json={
                "account_id": investment["account_id"],
                "kind": "stock",
                "name": "Infosys",
                "symbol": "INFY",
            },
            headers=ada,
        ),
        201,
    )
    ok(
        client.post(
            f"{fin}/investment-transactions",
            json={
                "holding_id": holding["id"],
                "type": "buy",
                "trade_date": TODAY.isoformat(),
                "amount": 10_000_00,
                "quantity": "10",
                "fees": 20_00,
                "settlement": "account",
                "cash_account_id": bank,
            },
            headers=ada,
        ),
        201,
    )

    # A loan EMI: principal is a transfer, interest is spending.
    loan = ok(
        client.post(
            f"{fin}/loans",
            json={
                "name": "Car loan",
                "lender": "SBI",
                "loan_type": "vehicle",
                "principal": 1 * LAKH,
                "interest_rate_bps": 1200,
                "start_date": add_months(THIS_MONTH, -1).isoformat(),
                "tenure_months": 12,
                "first_payment_date": THIS_MONTH.isoformat(),
            },
            headers=ada,
        ),
        201,
    )
    installment = ok(client.get(f"{fin}/loans/{loan['id']}", headers=ada))["installments"][0]
    paid = ok(
        client.post(
            f"{fin}/loans/{loan['id']}/installments/{installment['id']}/pay",
            json={"from_account_id": bank, "paid_on": TODAY.isoformat()},
            headers=ada,
        )
    )
    interest = paid["interest"]
    assert interest > 0

    # A subscription paid this month counts once; a bill only once a payment is recorded.
    subscription = ok(
        client.post(
            f"{fin}/recurring-payments",
            json={
                "kind": "subscription",
                "name": "Netflix",
                "amount": 649_00,
                "frequency": "monthly",
                "next_due_date": THIS_MONTH.isoformat(),
                "category_id": category(client, fin, ada, "Entertainment"),
            },
            headers=ada,
        ),
        201,
    )
    ok(
        client.post(
            f"{fin}/recurring-payments/{subscription['id']}/occurrences",
            json={
                "mode": "create",
                "due_date": THIS_MONTH.isoformat(),
                "account_id": bank,
                "paid_on": TODAY.isoformat(),
            },
            headers=ada,
        ),
        201,
    )
    ok(
        client.post(
            f"{fin}/recurring-payments",
            json={
                "kind": "bill",
                "name": "Electricity",
                "amount": 3_000_00,
                "frequency": "monthly",
                "next_due_date": THIS_MONTH.isoformat(),
            },
            headers=ada,
        ),
        201,
    )

    expected = 2_000_00 - 500_00 + 20_00 + interest + 649_00
    assert current(client, fin, ada, budget["id"])["spent"] == expected
    # The same figure as the dashboard's monthly spending.
    summary = ok(client.get(f"{fin}/summary", params={"month": ym(THIS_MONTH)}, headers=ada))
    assert summary["net_expenses"] == expected


def test_overlapping_budgets_for_the_same_spending_conflict(
    client: TestClient, ada: Headers, fin: str
) -> None:
    groceries = category(client, fin, ada, "Groceries")
    recurring = add_budget(client, fin, ada)
    response = client.post(
        f"{fin}/budgets",
        json={
            "name": "This month",
            "scope": "overall",
            "amount": 1_000_00,
            "start_date": NEXT_MONTH.isoformat(),
            "end_date": last_day(NEXT_MONTH),
        },
        headers=ada,
    )
    assert response.status_code == 409
    assert "“Everything” already covers" in response.json()["detail"]

    # A category budget, another currency, or a period that doesn't overlap is fine.
    add_budget(client, fin, ada, name="Groceries", scope="category", category_id=groceries)
    add_budget(client, fin, ada, name="Dollars", currency="USD")
    ok(
        client.patch(
            f"{fin}/budgets/{recurring['id']}",
            json={"end_date": last_day(THIS_MONTH)},
            headers=ada,
        )
    )
    add_budget(client, fin, ada, name="Next month", start_date=NEXT_MONTH.isoformat())

    # Archiving frees the period; restoring checks again.
    ok(client.post(f"{fin}/budgets/{recurring['id']}/archive", headers=ada))
    ok(client.patch(f"{fin}/budgets/{recurring['id']}", json={"end_date": None}, headers=ada))
    assert client.post(f"{fin}/budgets/{recurring['id']}/restore", headers=ada).status_code == 409


def test_edits_change_the_current_period_and_keep_history(
    client: TestClient, ada: Headers, fin: str, bank: str
) -> None:
    groceries = category(client, fin, ada, "Groceries")
    record(
        client,
        fin,
        ada,
        type="expense",
        amount=4_000_00,
        account_id=bank,
        category_id=groceries,
        occurred_on=LAST_MONTH.isoformat(),
    )
    budget = add_budget(client, fin, ada, amount=5_000_00, start_date=TWO_MONTHS_AGO.isoformat())
    ok(client.patch(f"{fin}/budgets/{budget['id']}", json={"amount": 8_000_00}, headers=ada))

    detail = ok(client.get(f"{fin}/budgets/{budget['id']}", headers=ada))
    periods = detail["periods"]
    assert [period["start"] for period in periods] == [
        THIS_MONTH.isoformat(),
        LAST_MONTH.isoformat(),
        TWO_MONTHS_AGO.isoformat(),
    ]
    assert [period["base_amount"] for period in periods] == [8_000_00, 5_000_00, 5_000_00]
    assert [period["closed"] for period in periods] == [False, True, True]
    assert periods[1]["spent"] == 4_000_00
    assert periods[1]["spent_at_close"] == 4_000_00
    assert detail["periods_closed"] == 2
    assert detail["periods_within"] == 2

    # A finished period can't be moved out from under its history.
    response = client.patch(
        f"{fin}/budgets/{budget['id']}", json={"start_date": THIS_MONTH.isoformat()}, headers=ada
    )
    assert response.status_code == 422
    response = client.patch(
        f"{fin}/budgets/{budget['id']}", json={"end_date": last_day(TWO_MONTHS_AGO)}, headers=ada
    )
    assert response.status_code == 422

    # The history endpoint reads the amounts each month had.
    history = ok(client.get(f"{fin}/budgets/history", params={"months": 3}, headers=ada))["months"]
    assert [entry["total"] for entry in history] == [5_000_00, 5_000_00, 8_000_00]
    assert [entry["spent"] for entry in history] == [0, 4_000_00, 0]
    assert history[1]["budgets_within"] == 1


def test_surplus_rollover_carries_unspent_money_once(
    client: TestClient, ada: Headers, fin: str, bank: str, migrated_settings: Settings
) -> None:
    groceries = category(client, fin, ada, "Groceries")
    record(
        client,
        fin,
        ada,
        type="expense",
        amount=8_000_00,
        account_id=bank,
        category_id=groceries,
        occurred_on=LAST_MONTH.isoformat(),
    )
    budget = add_budget(
        client,
        fin,
        ada,
        amount=10_000_00,
        start_date=LAST_MONTH.isoformat(),
        rollover="surplus",
    )
    period = current(client, fin, ada, budget["id"])
    assert period["base_amount"] == 10_000_00
    assert period["rollover_amount"] == 2_000_00
    assert period["available"] == 12_000_00

    # A late correction to last month changes its history, not the rollover it passed on.
    record(
        client,
        fin,
        ada,
        type="expense",
        amount=1_000_00,
        account_id=bank,
        category_id=groceries,
        occurred_on=LAST_MONTH.isoformat(),
    )
    ok(client.patch(f"{fin}/budgets/{budget['id']}", json={"name": "Renamed"}, headers=ada))
    detail = ok(client.get(f"{fin}/budgets/{budget['id']}", headers=ada))
    assert detail["periods"][0]["rollover_amount"] == 2_000_00
    assert detail["periods"][1]["spent"] == 9_000_00
    assert detail["periods"][1]["spent_at_close"] == 8_000_00
    rows = query(migrated_settings.sqlite_path, "SELECT count(*) FROM finance_budget_periods")
    assert rows == [(2,)]


def test_full_rollover_carries_overspending_but_never_below_zero(
    client: TestClient, ada: Headers, fin: str, bank: str
) -> None:
    groceries = category(client, fin, ada, "Groceries")
    record(
        client,
        fin,
        ada,
        type="expense",
        amount=25_000_00,
        account_id=bank,
        category_id=groceries,
        occurred_on=TWO_MONTHS_AGO.isoformat(),
    )
    record(
        client,
        fin,
        ada,
        type="expense",
        amount=12_000_00,
        account_id=bank,
        category_id=groceries,
        occurred_on=LAST_MONTH.isoformat(),
    )
    budget = add_budget(
        client,
        fin,
        ada,
        amount=10_000_00,
        start_date=TWO_MONTHS_AGO.isoformat(),
        rollover="full",
    )
    periods = ok(client.get(f"{fin}/budgets/{budget['id']}", headers=ada))["periods"]
    # Two months ago: ₹15,000 over, capped at the next month's ₹10,000.
    assert periods[1]["rollover_amount"] == -10_000_00
    assert periods[1]["available"] == 0
    assert periods[1]["status"] == "exceeded"
    # Last month: ₹12,000 spent of nothing; again capped at this month's base.
    assert periods[0]["rollover_amount"] == -10_000_00
    assert periods[0]["available"] == 0
    assert periods[0]["utilization_percent"] is None


def test_custom_periods(client: TestClient, ada: Headers, fin: str, bank: str) -> None:
    travel = category(client, fin, ada, "Travel")
    start = THIS_MONTH.replace(day=5)
    trip = add_budget(
        client,
        fin,
        ada,
        name="Goa trip",
        scope="category",
        category_id=travel,
        period="custom",
        start_date=start.isoformat(),
        end_date=add_months(start, 1).isoformat(),
        amount=30_000_00,
    )
    assert trip["recurring"] is False
    assert trip["current_period"]["start"] == start.isoformat()
    record(
        client,
        fin,
        ada,
        type="expense",
        amount=6_000_00,
        account_id=bank,
        category_id=travel,
        occurred_on=start.isoformat(),
    )
    record(
        client,
        fin,
        ada,
        type="expense",
        amount=1_000_00,
        account_id=bank,
        category_id=travel,
        occurred_on=THIS_MONTH.isoformat(),
    )
    # Only spending inside the custom range counts.
    assert current(client, fin, ada, trip["id"])["spent"] == 6_000_00
    # Its dates can move while it is open.
    moved = ok(
        client.patch(
            f"{fin}/budgets/{trip['id']}",
            json={"start_date": THIS_MONTH.isoformat()},
            headers=ada,
        )
    )
    assert moved["current_period"]["start"] == THIS_MONTH.isoformat()
    assert moved["current_period"]["spent"] == 7_000_00


def test_copy_a_previous_month(client: TestClient, ada: Headers, fin: str) -> None:
    groceries = category(client, fin, ada, "Groceries")
    dining = category(client, fin, ada, "Food and dining")
    add_budget(
        client,
        fin,
        ada,
        name="Groceries",
        scope="category",
        category_id=groceries,
        amount=9_000_00,
        start_date=LAST_MONTH.isoformat(),
        end_date=last_day(LAST_MONTH),
    )
    recurring = add_budget(
        client,
        fin,
        ada,
        name="Dining",
        scope="category",
        category_id=dining,
        start_date=LAST_MONTH.isoformat(),
    )
    result = ok(
        client.post(
            f"{fin}/budgets/copy",
            json={"from_month": ym(LAST_MONTH), "to_month": ym(THIS_MONTH)},
            headers=ada,
        )
    )
    assert [entry["name"] for entry in result["created"]] == ["Groceries"]
    copied = result["created"][0]
    assert copied["amount"] == 9_000_00
    assert copied["start_date"] == THIS_MONTH.isoformat()
    assert copied["end_date"] == last_day(THIS_MONTH)
    assert result["skipped"] == [recurring["id"]]

    # Copying again finds everything covered.
    again = ok(
        client.post(
            f"{fin}/budgets/copy",
            json={"from_month": ym(LAST_MONTH), "to_month": ym(THIS_MONTH)},
            headers=ada,
        )
    )
    assert again["created"] == []
    same = client.post(
        f"{fin}/budgets/copy",
        json={"from_month": ym(THIS_MONTH), "to_month": ym(THIS_MONTH)},
        headers=ada,
    )
    assert same.status_code == 422


def test_month_overview(client: TestClient, ada: Headers, fin: str, bank: str) -> None:
    groceries = category(client, fin, ada, "Groceries")
    dining = category(client, fin, ada, "Food and dining")
    add_budget(
        client,
        fin,
        ada,
        name="Groceries",
        scope="category",
        category_id=groceries,
        amount=10_000_00,
    )
    add_budget(
        client, fin, ada, name="Dining", scope="category", category_id=dining, amount=5_000_00
    )
    record(
        client, fin, ada, type="expense", amount=9_500_00, account_id=bank, category_id=groceries
    )
    record(
        client,
        fin,
        ada,
        type="expense",
        amount=2_000_00,
        account_id=bank,
        category_id=category(client, fin, ada, "Transport"),
    )
    record(client, fin, ada, type="expense", amount=300_00, account_id=bank)

    overview = ok(client.get(f"{fin}/budgets/overview", headers=ada))
    assert overview["month"] == ym(THIS_MONTH)
    assert overview["basis"] == "categories"
    assert overview["total"] == 15_000_00
    assert overview["spent"] == 11_800_00
    assert overview["remaining"] == 3_200_00
    assert overview["unbudgeted"] == 2_300_00
    assert overview["budgets_counted"] == 2
    assert overview["budgets_within"] == 2
    assert [entry["category_id"] for entry in overview["categories"]][:2] == [
        groceries,
        category(client, fin, ada, "Transport"),
    ]
    assert overview["categories"][0]["budget"] == 10_000_00
    statuses = {entry["name"]: entry["current_period"]["status"] for entry in overview["budgets"]}
    assert statuses == {"Groceries": "near", "Dining": "on_track"}

    # An overall budget becomes the month's total.
    add_budget(client, fin, ada, amount=20_000_00)
    overview = ok(client.get(f"{fin}/budgets/overview", headers=ada))
    assert overview["basis"] == "overall"
    assert overview["total"] == 20_000_00
    # Another currency has nothing.
    dollars = ok(client.get(f"{fin}/budgets/overview", params={"currency": "USD"}, headers=ada))
    assert dollars["total"] is None and dollars["spent"] == 0


def test_delete_and_category_protection(client: TestClient, ada: Headers, fin: str) -> None:
    own = ok(
        client.post(f"{fin}/categories", json={"name": "Pets", "type": "expense"}, headers=ada),
        201,
    )
    budget = add_budget(client, fin, ada, name="Pets", scope="category", category_id=own["id"])
    blocked = client.delete(f"{fin}/categories/{own['id']}", headers=ada)
    assert blocked.status_code == 409
    assert "budget" in blocked.json()["detail"]

    assert client.delete(f"{fin}/budgets/{budget['id']}", headers=ada).status_code == 204
    assert client.get(f"{fin}/budgets/{budget['id']}", headers=ada).status_code == 404
    assert client.delete(f"{fin}/categories/{own['id']}", headers=ada).status_code == 204


def test_other_users_budgets_are_unreachable(
    client: TestClient, ada: Headers, grace: Headers, fin: str
) -> None:
    budget = add_budget(client, fin, ada)
    path = f"{fin}/budgets/{budget['id']}"
    # Through Ada's workspace: Grace can't reach it.
    assert client.get(f"{fin}/budgets", headers=grace).status_code == 404
    assert client.get(path, headers=grace).status_code == 404
    assert client.patch(path, json={"name": "Mine"}, headers=grace).status_code == 404
    assert client.delete(path, headers=grace).status_code == 404
    # Through her own workspace: Ada's IDs don't resolve.
    graces = finance_url(client, grace)
    own_path = f"{graces}/budgets/{budget['id']}"
    assert client.get(own_path, headers=grace).status_code == 404
    assert client.patch(own_path, json={"name": "Mine"}, headers=grace).status_code == 404
    assert client.post(f"{own_path}/archive", headers=grace).status_code == 404
    assert client.delete(own_path, headers=grace).status_code == 404
    assert ok(client.get(f"{graces}/budgets", headers=grace))["budgets"] == []
    assert ok(client.get(path, headers=ada))["budget"]["name"] == "Everything"


def test_budgets_require_sign_in(client: TestClient, fin: str) -> None:
    assert client.get(f"{fin}/budgets").status_code == 401
    assert client.post(f"{fin}/budgets", json={}).status_code == 401
