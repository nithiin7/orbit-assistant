"""Monthly planning through the API: expected income, fixed commitments, variable spending,
savings, investments, and what remains, planned against actual, without double counting."""

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.services.finance.money import add_months
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

WORKSPACES = "/api/v1/workspaces"
LAKH = 100_000_00

Headers = dict[str, str]
Json = dict[str, Any]

TODAY = datetime.now(UTC).date()
THIS_MONTH = TODAY.replace(day=1)
NEXT_MONTH = add_months(THIS_MONTH, 1)


def ym(month: Any) -> str:
    return f"{month.year:04d}-{month.month:02d}"


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


def category(client: TestClient, fin: str, headers: Headers, name: str) -> str:
    categories = ok(client.get(f"{fin}/categories", headers=headers))["categories"]
    return str(next(entry["id"] for entry in categories if entry["name"] == name))


def post(client: TestClient, url: str, headers: Headers, body: Json, code: int = 201) -> Json:
    return ok(client.post(url, json=body, headers=headers), code)


def plan(client: TestClient, fin: str, headers: Headers, **params: Any) -> Json:
    return ok(client.get(f"{fin}/plan", params=params, headers=headers))


def test_expected_income_carries_forward_until_changed(
    client: TestClient, ada: Headers, fin: str
) -> None:
    empty = plan(client, fin, ada)
    assert empty["expected_income"] is None
    assert empty["income"] == {"planned": None, "actual": 0}
    assert empty["remaining"]["planned"] is None

    saved = ok(
        client.put(
            f"{fin}/plan/{ym(THIS_MONTH)}",
            json={"expected_income": 1 * LAKH, "notes": "Salary"},
            headers=ada,
        )
    )
    assert saved == {
        "month": ym(THIS_MONTH),
        "currency": "INR",
        "expected_income": 1 * LAKH,
        "notes": "Salary",
    }
    this_month = plan(client, fin, ada)
    assert this_month["income_source"] == "this_month"
    assert this_month["notes"] == "Salary"
    later = plan(client, fin, ada, month=ym(NEXT_MONTH))
    assert later["expected_income"] == 1 * LAKH
    assert later["income_source"] == "earlier"
    assert later["income_month"] == ym(THIS_MONTH)

    ok(client.put(f"{fin}/plan/{ym(THIS_MONTH)}", json={"expected_income": 90_000_00}, headers=ada))
    assert plan(client, fin, ada)["expected_income"] == 90_000_00
    ok(client.delete(f"{fin}/plan/{ym(THIS_MONTH)}", headers=ada), 204)
    assert plan(client, fin, ada)["expected_income"] is None

    for body in ({"expected_income": -1}, {"expected_income": 1.5}, {"expected_income": "1"}):
        assert client.put(f"{fin}/plan/{ym(THIS_MONTH)}", json=body, headers=ada).status_code == 422


def test_a_month_planned_against_actual(client: TestClient, ada: Headers, fin: str) -> None:
    bank = post(
        client,
        f"{fin}/accounts",
        ada,
        {"name": "HDFC", "type": "bank", "opening_balance": 10 * LAKH},
    )["id"]
    savings = post(client, f"{fin}/accounts", ada, {"name": "Savings", "type": "savings"})["id"]
    ok(client.put(f"{fin}/plan/{ym(THIS_MONTH)}", json={"expected_income": 1 * LAKH}, headers=ada))
    post(
        client,
        f"{fin}/transactions",
        ada,
        {
            "type": "income",
            "amount": 1 * LAKH,
            "account_id": bank,
            "category_id": category(client, fin, ada, "Salary"),
            "occurred_on": TODAY.isoformat(),
            "description": "Salary",
        },
    )

    # Rent: a bill in the Rent category, paid. Netflix: a subscription, not yet paid.
    rent = post(
        client,
        f"{fin}/recurring-payments",
        ada,
        {
            "kind": "bill",
            "name": "Rent",
            "amount": 20_000_00,
            "frequency": "monthly",
            "next_due_date": THIS_MONTH.isoformat(),
            "category_id": category(client, fin, ada, "Rent"),
        },
    )
    post(
        client,
        f"{fin}/recurring-payments/{rent['id']}/occurrences",
        ada,
        {"due_date": THIS_MONTH.isoformat(), "paid_on": TODAY.isoformat(), "account_id": bank},
    )
    post(
        client,
        f"{fin}/recurring-payments",
        ada,
        {
            "kind": "subscription",
            "name": "Netflix",
            "amount": 649_00,
            "frequency": "monthly",
            "next_due_date": THIS_MONTH.isoformat(),
        },
    )

    # An EMI paid: principal is an allocation, interest is spending.
    loan = post(
        client,
        f"{fin}/loans",
        ada,
        {
            "name": "Car loan",
            "lender": "SBI",
            "loan_type": "vehicle",
            "principal": 1 * LAKH,
            "interest_rate_bps": 1200,
            "start_date": add_months(THIS_MONTH, -1).isoformat(),
            "tenure_months": 12,
            "first_payment_date": THIS_MONTH.isoformat(),
        },
    )
    installment = ok(client.get(f"{fin}/loans/{loan['id']}", headers=ada))["installments"][0]
    paid = ok(
        client.post(
            f"{fin}/loans/{loan['id']}/installments/{installment['id']}/pay",
            json={"from_account_id": bank, "paid_on": TODAY.isoformat()},
            headers=ada,
        )
    )
    emi = paid["principal"] + paid["interest"]

    # Variable spending, an investment, and a goal contribution moved to savings.
    post(
        client,
        f"{fin}/transactions",
        ada,
        {
            "type": "expense",
            "amount": 8_000_00,
            "account_id": bank,
            "category_id": category(client, fin, ada, "Groceries"),
            "occurred_on": TODAY.isoformat(),
            "description": "Groceries",
        },
    )
    zerodha = post(
        client, f"{fin}/investment-accounts", ada, {"name": "Zerodha", "kind": "mutual_fund"}
    )
    fund = post(
        client,
        f"{fin}/holdings",
        ada,
        {"account_id": zerodha["account_id"], "kind": "mutual_fund", "name": "Index fund"},
    )
    post(
        client,
        f"{fin}/sip-plans",
        ada,
        {"holding_id": fund["id"], "amount": 5_000_00, "next_due_date": THIS_MONTH.isoformat()},
    )
    post(
        client,
        f"{fin}/transfers",
        ada,
        {
            "from_account_id": bank,
            "to_account_id": zerodha["account_id"],
            "amount": 5_000_00,
            "occurred_on": TODAY.isoformat(),
            "description": "SIP money",
        },
    )
    target = add_months(THIS_MONTH, 9)
    goal = post(
        client,
        f"{fin}/savings-goals",
        ada,
        {
            "name": "Emergency fund",
            "target_amount": 1 * LAKH,
            "start_date": THIS_MONTH.isoformat(),
            "target_date": target.isoformat(),
            "account_id": savings,
        },
    )
    post(
        client,
        f"{fin}/savings-goals/{goal['id']}/contributions",
        ada,
        {"amount": 10_000_00, "mode": "transfer", "account_id": bank},
    )
    post(
        client,
        f"{fin}/budgets",
        ada,
        {
            "name": "Everything",
            "scope": "overall",
            "amount": 40_000_00,
            "start_date": THIS_MONTH.isoformat(),
        },
    )

    result = plan(client, fin, ada)
    fixed = result["fixed"]
    assert fixed["rent"] == {"planned": 20_000_00, "actual": 20_000_00}
    assert fixed["subscriptions"] == {"planned": 649_00, "actual": 0}
    assert fixed["bills"] == {"planned": 0, "actual": 0}
    assert fixed["emi"] == {"planned": emi, "actual": emi}
    assert fixed["planned_interest"] == paid["interest"]
    assert fixed["total"] == {"planned": 20_000_00 + 649_00 + emi, "actual": 20_000_00 + emi}

    # Variable spending leaves out the rent and the interest, already in fixed commitments.
    assert result["variable"]["actual"] == 8_000_00
    assert result["variable_basis"] == "overall_budget"
    assert result["variable"]["planned"] == 40_000_00 - (20_000_00 + 649_00 + paid["interest"])
    # Ten months to save the remaining ₹90,000.
    assert result["savings"] == {"planned": 9_000_00, "actual": 10_000_00}
    assert result["investments"] == {"planned": 5_000_00, "actual": 5_000_00}

    # Spending is consumption only; principal, the investment, and savings are allocations.
    assert result["spending"] == 20_000_00 + paid["interest"] + 8_000_00
    assert result["allocations"] == paid["principal"] + 5_000_00 + 10_000_00
    assert result["flows"]["loan_principal"] == paid["principal"]

    outflows = fixed["total"]["actual"] + 8_000_00 + 10_000_00 + 5_000_00
    assert result["remaining"]["actual"] == 1 * LAKH - outflows
    planned_out = fixed["total"]["planned"] + result["variable"]["planned"] + 9_000_00 + 5_000_00
    assert result["remaining"]["planned"] == 1 * LAKH - planned_out


def test_plans_are_private(client: TestClient, ada: Headers, grace: Headers, fin: str) -> None:
    ok(client.put(f"{fin}/plan/{ym(THIS_MONTH)}", json={"expected_income": 1 * LAKH}, headers=ada))
    assert client.get(f"{fin}/plan", headers=grace).status_code == 404
    assert (
        client.put(
            f"{fin}/plan/{ym(THIS_MONTH)}", json={"expected_income": 1}, headers=grace
        ).status_code
        == 404
    )
    graces = finance_url(client, grace)
    assert plan(client, graces, grace)["expected_income"] is None
    assert plan(client, fin, ada)["expected_income"] == 1 * LAKH
