"""Investments through the API: investment accounts, mutual funds and SIPs, stocks with FIFO,
dividends and fees, deposits and their maturity reminders, ledger integration, isolation.

Trades are dated in 2025 so they are in the past whatever the real date; views that depend on
the date name `today`. Reminder tests use 2030 so their times are in the future.
"""

import asyncio
import uuid
from collections.abc import Iterator
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.database import open_database
from orbit_api.main import create_app
from orbit_api.repositories.investments import build_investment_service
from orbit_api.services.investments.valuation import Quote
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


def add_account(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    body = {"name": "HDFC Savings", "type": "bank", "opening_balance": 10 * LAKH, **fields}
    return ok(client.post(f"{fin}/accounts", json=body, headers=headers), 201)


@pytest.fixture
def bank(client: TestClient, ada: Headers, fin: str) -> Json:
    return add_account(client, fin, ada)


def add_investment_account(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    body = {"name": "Zerodha", "kind": "brokerage", "provider": "Zerodha", **fields}
    return ok(client.post(f"{fin}/investment-accounts", json=body, headers=headers), 201)


def add_holding(
    client: TestClient, fin: str, headers: Headers, account_id: str, **fields: Any
) -> Json:
    body = {
        "account_id": account_id,
        "kind": "stock",
        "name": "Infosys",
        "symbol": "INFY",
        "exchange": "nse",
        **fields,
    }
    return ok(client.post(f"{fin}/holdings", json=body, headers=headers), 201)


def record(client: TestClient, fin: str, headers: Headers, **fields: Any) -> Json:
    return ok(client.post(f"{fin}/investment-transactions", json=fields, headers=headers), 201)


def holding(client: TestClient, fin: str, headers: Headers, holding_id: str, **params: Any) -> Json:
    return ok(
        client.get(
            f"{fin}/holdings/{holding_id}", params={"today": TODAY, **params}, headers=headers
        )
    )


def investment_account(client: TestClient, fin: str, headers: Headers, account_id: str) -> Json:
    return ok(
        client.get(
            f"{fin}/investment-accounts/{account_id}", params={"today": TODAY}, headers=headers
        )
    )


def balances(client: TestClient, fin: str, headers: Headers) -> dict[str, int]:
    accounts = ok(client.get(f"{fin}/accounts", headers=headers))["accounts"]
    return {account["name"]: account["balance"] for account in accounts}


def summary(client: TestClient, fin: str, headers: Headers, month: str) -> Json:
    return ok(client.get(f"{fin}/summary", params={"month": month}, headers=headers))


def ledger(client: TestClient, fin: str, headers: Headers, transaction_id: str) -> Json:
    return ok(client.get(f"{fin}/transactions/{transaction_id}", headers=headers))


def category_name(client: TestClient, fin: str, headers: Headers, category_id: str) -> str:
    categories = ok(client.get(f"{fin}/categories", headers=headers))["categories"]
    return next(entry["name"] for entry in categories if entry["id"] == category_id)


# Investment accounts


def test_an_investment_account_is_an_investment_finance_account(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    account = add_investment_account(client, fin, ada, linked_account_id=bank["id"])
    assert account["kind"] == "brokerage"
    assert account["currency"] == "INR"
    assert (account["ledger_balance"], account["cash"], account["value"]) == (0, 0, 0)

    # It shows in Accounts like any other investment account; nothing is duplicated.
    accounts = ok(client.get(f"{fin}/accounts", headers=ada))["accounts"]
    [listed] = [entry for entry in accounts if entry["id"] == account["account_id"]]
    assert listed["type"] == "investment"

    # Renaming and archiving go through the finance account.
    renamed = ok(
        client.patch(
            f"{fin}/investment-accounts/{account['account_id']}",
            json={"name": "Zerodha Kite", "provider": "Zerodha Broking", "archived": True},
            headers=ada,
        )
    )
    assert (renamed["name"], renamed["provider"], renamed["archived"]) == (
        "Zerodha Kite",
        "Zerodha Broking",
        True,
    )
    assert balances(client, fin, ada).keys() >= {"Zerodha Kite"}


def test_an_existing_investment_account_can_be_adopted_with_its_history(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    existing = add_account(client, fin, ada, name="Groww", type="investment", opening_balance=0)
    ok(
        client.post(
            f"{fin}/transfers",
            json={
                "from_account_id": bank["id"],
                "to_account_id": existing["id"],
                "amount": 50_000_00,
                "occurred_on": "2025-01-05",
                "description": "Move to Groww",
            },
            headers=ada,
        ),
        201,
    )
    adopted = ok(
        client.post(
            f"{fin}/investment-accounts",
            json={"account_id": existing["id"], "kind": "mutual_fund", "provider": "Groww"},
            headers=ada,
        ),
        201,
    )
    assert adopted["account_id"] == existing["id"]
    assert adopted["name"] == "Groww"
    # Money moved in earlier is the account's cash until it buys something.
    assert adopted["ledger_balance"] == adopted["cash"] == 50_000_00

    again = client.post(
        f"{fin}/investment-accounts",
        json={"account_id": existing["id"], "kind": "mutual_fund"},
        headers=ada,
    )
    assert again.status_code == 409
    not_investment = client.post(
        f"{fin}/investment-accounts", json={"account_id": bank["id"], "kind": "other"}, headers=ada
    )
    assert not_investment.status_code == 422


def test_investment_account_validation(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    card = add_account(client, fin, ada, name="Card", type="credit_card", opening_balance=0)
    both = client.post(
        f"{fin}/investment-accounts",
        json={"kind": "other", "name": "X", "account_id": bank["id"]},
        headers=ada,
    )
    assert both.status_code == 422
    liability = client.post(
        f"{fin}/investment-accounts",
        json={"kind": "other", "name": "X", "linked_account_id": card["id"]},
        headers=ada,
    )
    assert liability.status_code == 422
    other_currency = client.post(
        f"{fin}/investment-accounts",
        json={"kind": "other", "name": "IBKR", "currency": "USD", "linked_account_id": bank["id"]},
        headers=ada,
    )
    assert other_currency.status_code == 422


# Mutual funds and SIPs


def test_a_funded_purchase_moves_money_without_counting_it_as_spending(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    account = add_investment_account(client, fin, ada, name="Kuvera", kind="mutual_fund")
    fund = add_holding(
        client,
        fin,
        ada,
        account["account_id"],
        kind="mutual_fund",
        name="Parag Parikh Flexi Cap Fund - Direct Growth",
        symbol="122639",
        exchange="",
        isin="INF879O01027",
        issuer="PPFAS Mutual Fund",
        category="Flexi cap",
        folio="12345678",
    )
    buy = record(
        client,
        fin,
        ada,
        type="buy",
        holding_id=fund["id"],
        trade_date="2025-03-10",
        amount=10_000_00,
        quantity="218.92",
        settlement="account",
        cash_account_id=bank["id"],
    )
    assert buy["plan"] == "lump_sum"
    assert buy["unit_price"] == "45.678787"

    # The bank paid; the investment account received and spent it on the fund.
    transfer = ledger(client, fin, ada, buy["cash_transaction_id"])
    assert (transfer["type"], transfer["amount"]) == ("transfer", 10_000_00)
    assert (transfer["account_id"], transfer["to_account_id"]) == (
        bank["id"],
        account["account_id"],
    )
    assert balances(client, fin, ada)["HDFC Savings"] == 10 * LAKH - 10_000_00
    view = investment_account(client, fin, ada, account["account_id"])
    assert view["ledger_balance"] == 10_000_00
    assert view["cash"] == 0
    # A purchase is never spending.
    assert summary(client, fin, ada, "2025-03")["expenses"] == 0

    held = holding(client, fin, ada, fund["id"])
    assert held["quantity"] == "218.92"
    assert held["cost"] == 10_000_00
    assert held["average_cost"] == "45.678787"
    assert held["market_value"] is None
    assert held["value"] == 10_000_00
    assert held["freshness"] == "missing"

    # A NAV update values it; a later NAV on the same date replaces the earlier one.
    nav = ok(
        client.post(
            f"{fin}/holdings/{fund['id']}/prices",
            json={"price_date": "2025-12-30", "price": "50"},
            headers=ada,
        )
    )
    ok(
        client.post(
            f"{fin}/holdings/{fund['id']}/prices",
            json={"price_date": "2025-12-30", "price": "52.1234"},
            headers=ada,
        )
    )
    prices = ok(client.get(f"{fin}/holdings/{fund['id']}/prices", headers=ada))["prices"]
    assert [entry["price"] for entry in prices] == ["52.1234"]
    assert prices[0]["id"] == nav["id"]
    held = holding(client, fin, ada, fund["id"])
    # 218.92 x 52.1234 = 11,410.85…
    assert held["market_value"] == 11_410_85
    assert held["unrealized_gain"] == 1_410_85
    assert held["freshness"] == "current"
    assert holding(client, fin, ada, fund["id"], today="2026-01-15")["freshness"] == "stale"


def test_sip_plans_are_expectations_until_an_installment_is_recorded(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    account = add_investment_account(client, fin, ada, name="Coin", kind="mutual_fund")
    fund = add_holding(
        client, fin, ada, account["account_id"], kind="mutual_fund", name="Nifty 50 Index Fund"
    )
    plan = ok(
        client.post(
            f"{fin}/sip-plans",
            json={
                "holding_id": fund["id"],
                "amount": 5_000_00,
                "next_due_date": "2025-01-05",
                "funding_account_id": bank["id"],
            },
            headers=ada,
        ),
        201,
    )
    assert plan["next_due_date"] == "2025-01-05"
    assert (plan["installments"], plan["invested"]) == (0, 0)
    # Scheduling invests nothing.
    assert holding(client, fin, ada, fund["id"])["quantity"] == "0"
    assert balances(client, fin, ada)["HDFC Savings"] == 10 * LAKH

    first = ok(
        client.post(
            f"{fin}/sip-plans/{plan['id']}/installments",
            json={"trade_date": "2025-01-06", "quantity": "20.5"},
            headers=ada,
        ),
        201,
    )
    assert (first["plan"], first["sip_due_date"], first["amount"]) == (
        "sip",
        "2025-01-05",
        5_000_00,
    )
    assert first["settlement"] == "account"
    assert balances(client, fin, ada)["HDFC Savings"] == 10 * LAKH - 5_000_00

    plans = ok(client.get(f"{fin}/sip-plans", params={"today": TODAY}, headers=ada))["plans"]
    assert plans[0]["next_due_date"] == "2025-02-05"
    assert (plans[0]["installments"], plans[0]["invested"]) == (1, 5_000_00)

    duplicate = client.post(
        f"{fin}/sip-plans/{plan['id']}/installments",
        json={"trade_date": "2025-01-07", "quantity": "20", "due_date": "2025-01-05"},
        headers=ada,
    )
    assert duplicate.status_code == 409

    # Paused SIPs expect nothing; resuming starts from the next date on or after today.
    paused = ok(
        client.patch(f"{fin}/sip-plans/{plan['id']}", json={"state": "paused"}, headers=ada)
    )
    assert paused["next_due_date"] is None


def test_redemptions_realize_fifo_gains_and_return_cash(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    account = add_investment_account(client, fin, ada, name="Kuvera", kind="mutual_fund")
    fund = add_holding(client, fin, ada, account["account_id"], kind="mutual_fund", name="Fund")
    for day, units, cost in (("2025-01-10", "100", 1_000_00), ("2025-02-10", "100", 1_500_00)):
        record(
            client,
            fin,
            ada,
            type="buy",
            holding_id=fund["id"],
            trade_date=day,
            amount=cost,
            quantity=units,
            settlement="account",
            cash_account_id=bank["id"],
        )
    sale = record(
        client,
        fin,
        ada,
        type="sell",
        holding_id=fund["id"],
        trade_date="2025-06-01",
        amount=2_400_00,
        quantity="150",
        settlement="account",
        cash_account_id=bank["id"],
    )
    held = holding(client, fin, ada, fund["id"])
    assert held["quantity"] == "50"
    # FIFO: 100 units at ₹10 and 50 at ₹15 cost ₹1,750; ₹2,400 received.
    assert held["realized_gain"] == 650_00
    assert held["cost"] == 750_00
    assert balances(client, fin, ada)["HDFC Savings"] == 10 * LAKH - 2_500_00 + 2_400_00
    assert investment_account(client, fin, ada, account["account_id"])["cash"] == 0
    # A sale's proceeds are not income.
    assert summary(client, fin, ada, "2025-06")["income"] == 0
    assert ledger(client, fin, ada, sale["cash_transaction_id"])["to_account_id"] == bank["id"]


# Stocks


@pytest.fixture
def broker(client: TestClient, ada: Headers, fin: str) -> Json:
    account = add_investment_account(client, fin, ada)
    # ₹1,00,000 of cash at the broker, moved in from outside (an opening balance).
    ok(
        client.patch(
            f"{fin}/accounts/{account['account_id']}",
            json={"opening_balance": LAKH},
            headers=ada,
        )
    )
    return account


def test_stock_trades_use_the_brokers_cash_and_fifo(
    client: TestClient, ada: Headers, fin: str, broker: Json
) -> None:
    stock = add_holding(client, fin, ada, broker["account_id"])
    assert stock["exchange"] == "NSE"
    record(
        client,
        fin,
        ada,
        type="buy",
        holding_id=stock["id"],
        trade_date="2025-01-02",
        amount=15_000_00,
        quantity="10",
        fees=20_00,
    )
    record(
        client,
        fin,
        ada,
        type="buy",
        holding_id=stock["id"],
        trade_date="2025-02-02",
        amount=17_000_00,
        quantity="10",
    )
    record(
        client,
        fin,
        ada,
        type="sell",
        holding_id=stock["id"],
        trade_date="2025-03-02",
        amount=24_000_00,
        quantity="12",
        fees=15_00,
    )

    held = holding(client, fin, ada, stock["id"])
    assert held["quantity"] == "8"
    # 10 at ₹1,500 and 2 at ₹1,700 cost ₹18,400 against ₹24,000.
    assert held["realized_gain"] == 5_600_00
    assert held["cost"] == 13_600_00
    assert held["average_cost"] == "1700"
    assert held["fees"] == 35_00

    # Cash: 1,00,000 - 15,000 - 17,000 + 24,000, minus ₹35 of charges paid from it.
    account = investment_account(client, fin, ada, broker["account_id"])
    assert account["cash"] == LAKH - 15_000_00 - 17_000_00 + 24_000_00 - 35_00
    # Charges are spending; trades are not.
    assert summary(client, fin, ada, "2025-01")["expenses"] == 20_00
    assert summary(client, fin, ada, "2025-03")["expenses"] == 15_00

    oversold = client.post(
        f"{fin}/investment-transactions",
        json={
            "type": "sell",
            "holding_id": stock["id"],
            "trade_date": "2025-03-03",
            "amount": 1_00,
            "quantity": "9",
        },
        headers=ada,
    )
    assert oversold.status_code == 422
    assert "more units than were held" in oversold.json()["detail"]
    # Selling before the units were bought is overselling too.
    early = client.post(
        f"{fin}/investment-transactions",
        json={
            "type": "sell",
            "holding_id": stock["id"],
            "trade_date": "2025-01-01",
            "amount": 1_00,
            "quantity": "1",
        },
        headers=ada,
    )
    assert early.status_code == 422


def test_a_purchase_later_sales_depend_on_cant_be_deleted(
    client: TestClient, ada: Headers, fin: str, broker: Json
) -> None:
    stock = add_holding(client, fin, ada, broker["account_id"])
    buy = record(
        client,
        fin,
        ada,
        type="buy",
        holding_id=stock["id"],
        trade_date="2025-01-02",
        amount=1_000_00,
        quantity="1",
    )
    sale = record(
        client,
        fin,
        ada,
        type="sell",
        holding_id=stock["id"],
        trade_date="2025-01-03",
        amount=1_100_00,
        quantity="1",
    )
    blocked = client.delete(f"{fin}/investment-transactions/{buy['id']}", headers=ada)
    assert blocked.status_code == 409
    ok(client.delete(f"{fin}/investment-transactions/{sale['id']}", headers=ada), 204)
    ok(client.delete(f"{fin}/investment-transactions/{buy['id']}", headers=ada), 204)
    assert holding(client, fin, ada, stock["id"])["quantity"] == "0"
    # Without transactions, the holding itself can go.
    ok(client.delete(f"{fin}/holdings/{stock['id']}", headers=ada), 204)


def test_dividends_are_investment_income(
    client: TestClient, ada: Headers, fin: str, bank: Json, broker: Json
) -> None:
    stock = add_holding(client, fin, ada, broker["account_id"])
    record(
        client,
        fin,
        ada,
        type="buy",
        holding_id=stock["id"],
        trade_date="2025-01-02",
        amount=10_000_00,
        quantity="10",
    )
    dividend = record(
        client,
        fin,
        ada,
        type="dividend",
        holding_id=stock["id"],
        trade_date="2025-06-15",
        amount=180_00,
        settlement="account",
        cash_account_id=bank["id"],
    )
    income = ledger(client, fin, ada, dividend["cash_transaction_id"])
    assert (income["type"], income["account_id"]) == ("income", bank["id"])
    assert category_name(client, fin, ada, income["category_id"]) == "Dividends"
    assert summary(client, fin, ada, "2025-06")["income"] == 180_00
    assert holding(client, fin, ada, stock["id"])["dividends"] == 180_00

    fee = record(
        client,
        fin,
        ada,
        type="fee",
        account_id=broker["account_id"],
        trade_date="2025-07-01",
        amount=300_00,
    )
    expense = ledger(client, fin, ada, fee["cash_transaction_id"])
    assert category_name(client, fin, ada, expense["category_id"]) == "Fees and charges"

    bad = client.post(
        f"{fin}/investment-transactions",
        json={
            "type": "dividend",
            "holding_id": stock["id"],
            "trade_date": "2025-06-15",
            "amount": 1_00,
            "settlement": "none",
        },
        headers=ada,
    )
    assert bad.status_code == 422


def test_ledger_rows_recording_investments_are_protected(
    client: TestClient, ada: Headers, fin: str, bank: Json, broker: Json
) -> None:
    stock = add_holding(client, fin, ada, broker["account_id"])
    buy = record(
        client,
        fin,
        ada,
        type="buy",
        holding_id=stock["id"],
        trade_date="2025-01-02",
        amount=5_000_00,
        quantity="5",
        settlement="account",
        cash_account_id=bank["id"],
        fees=10_00,
    )
    blocked = client.delete(f"{fin}/transactions/{buy['cash_transaction_id']}", headers=ada)
    assert blocked.status_code == 409
    assert "investment" in blocked.json()["detail"]

    ok(
        client.delete(
            f"{fin}/investment-transactions/{buy['id']}",
            params={"delete_ledger": True},
            headers=ada,
        ),
        204,
    )
    assert balances(client, fin, ada)["HDFC Savings"] == 10 * LAKH
    for ledger_id in (buy["cash_transaction_id"], buy["fee_transaction_id"]):
        assert client.get(f"{fin}/transactions/{ledger_id}", headers=ada).status_code == 404


def test_a_holding_bought_before_orbit_moves_no_cash(
    client: TestClient, ada: Headers, fin: str, broker: Json
) -> None:
    stock = add_holding(client, fin, ada, broker["account_id"])
    opening = record(
        client,
        fin,
        ada,
        type="buy",
        holding_id=stock["id"],
        trade_date="2020-05-01",
        amount=50_000_00,
        quantity="40",
        settlement="none",
    )
    assert opening["cash_transaction_id"] is None
    assert investment_account(client, fin, ada, broker["account_id"])["cash"] == LAKH
    with_fees = client.post(
        f"{fin}/investment-transactions",
        json={
            "type": "buy",
            "holding_id": stock["id"],
            "trade_date": "2020-05-01",
            "amount": 1_00,
            "quantity": "1",
            "settlement": "none",
            "fees": 1_00,
        },
        headers=ada,
    )
    assert with_fees.status_code == 422


def test_duplicate_holdings_are_rejected(
    client: TestClient, ada: Headers, fin: str, broker: Json
) -> None:
    add_holding(client, fin, ada, broker["account_id"], isin="INE009A01021")
    same_isin = client.post(
        f"{fin}/holdings",
        json={
            "account_id": broker["account_id"],
            "kind": "stock",
            "name": "Infosys Ltd",
            "isin": "ine009a01021",
        },
        headers=ada,
    )
    assert same_isin.status_code == 409
    # Another folio of the same scheme is a separate holding.
    fund = {
        "account_id": broker["account_id"],
        "kind": "mutual_fund",
        "name": "Fund A",
        "isin": "INF879O01027",
        "folio": "1",
    }
    ok(client.post(f"{fin}/holdings", json=fund, headers=ada), 201)
    ok(client.post(f"{fin}/holdings", json={**fund, "folio": "2"}, headers=ada), 201)
    bad_isin = client.post(
        f"{fin}/holdings",
        json={"account_id": broker["account_id"], "kind": "stock", "name": "X", "isin": "123"},
        headers=ada,
    )
    assert bad_isin.status_code == 422


@pytest.mark.parametrize("quantity", [1.5, "1.0000001", "-1", "0", "1e3"])
def test_quantities_must_be_exact_positive_decimal_strings(
    client: TestClient, ada: Headers, fin: str, broker: Json, quantity: object
) -> None:
    stock = add_holding(client, fin, ada, broker["account_id"])
    response = client.post(
        f"{fin}/investment-transactions",
        json={
            "type": "buy",
            "holding_id": stock["id"],
            "trade_date": "2025-01-02",
            "amount": 1_000_00,
            "quantity": quantity,
        },
        headers=ada,
    )
    assert response.status_code == 422


# Deposits


def test_a_fixed_deposit_from_open_to_maturity(
    client: TestClient, ada: Headers, fin: str, bank: Json, migrated_settings: Settings
) -> None:
    account = add_investment_account(client, fin, ada, name="SBI deposits", kind="deposit")
    deposit = ok(
        client.post(
            f"{fin}/deposits",
            json={
                "account_id": account["account_id"],
                "kind": "fixed",
                "name": "SBI FD",
                "institution": "SBI",
                "interest_rate_bps": 700,
                "compounding": "quarterly",
                "start_date": "2029-01-01",
                "maturity_date": "2030-01-01",
                "amount": LAKH,
                "cash_account_id": bank["id"],
                "reminder": {"days_before": 7, "timezone": "Asia/Kolkata"},
            },
            headers=ada,
        ),
        201,
    )
    # Valued as of the real date, before it starts: nothing deposited yet.
    assert deposit["principal"] == 0
    deposit = ok(
        client.get(f"{fin}/deposits/{deposit['id']}", params={"today": "2029-01-01"}, headers=ada)
    )
    assert deposit["principal"] == LAKH
    assert deposit["projected_maturity_amount"] == 1_07_185_90
    assert deposit["projected_interest"] == 7_185_90
    assert balances(client, fin, ada)["HDFC Savings"] == 9 * LAKH

    # Its maturity reminder is managed by the deposit.
    reminders = ok(client.get(f"{fin.removesuffix('/finance')}/reminders", headers=ada))
    [reminder] = reminders["reminders"]
    assert reminder["commitment"] == {"kind": "deposit", "id": deposit["id"]}
    assert reminder["title"] == "SBI FD matures 1 Jan 2030"
    assert reminder["start_date"] == "2029-12-25"
    assert reminder["description"] == "About INR 107185.90 at maturity"
    edit = client.patch(
        f"{fin.removesuffix('/finance')}/reminders/{reminder['id']}",
        json={"title": "x"},
        headers=ada,
    )
    assert edit.status_code == 409

    halfway = ok(
        client.get(f"{fin}/deposits/{deposit['id']}", params={"today": "2029-07-01"}, headers=ada)
    )
    assert halfway["value_source"] == "estimate"
    assert halfway["freshness"] == "estimated"
    assert LAKH < halfway["value"] < 1_07_185_90

    closed = ok(
        client.post(
            f"{fin}/deposits/{deposit['id']}/close",
            json={"closed_on": "2030-01-01", "amount": 1_07_100_00, "cash_account_id": bank["id"]},
            headers=ada,
        )
    )
    assert closed["status"] == "matured"
    closed = ok(
        client.get(f"{fin}/deposits/{deposit['id']}", params={"today": "2030-01-02"}, headers=ada)
    )
    assert closed["value"] == 0
    assert closed["principal"] == 0
    assert closed["interest_received"] == 7_100_00
    assert balances(client, fin, ada)["HDFC Savings"] == 9 * LAKH + 1_07_100_00
    # The interest is income in the month it was paid; the principal coming back is not.
    assert summary(client, fin, ada, "2030-01")["income"] == 7_100_00
    # Nothing left to remind about.
    reminders = ok(client.get(f"{fin.removesuffix('/finance')}/reminders", headers=ada))
    assert reminders["reminders"] == []
    assert query(migrated_settings.sqlite_path, "SELECT count(*) FROM reminders") == [(0,)]

    # Undoing the closure restores the principal and the reminder state.
    reopened = ok(
        client.post(
            f"{fin}/deposits/{deposit['id']}/reopen",
            params={"delete_ledger": True},
            headers=ada,
        )
    )
    assert reopened["status"] == "active"
    reopened = ok(
        client.get(f"{fin}/deposits/{deposit['id']}", params={"today": "2030-01-02"}, headers=ada)
    )
    assert reopened["principal"] == LAKH
    assert balances(client, fin, ada)["HDFC Savings"] == 9 * LAKH


def test_early_closure_with_a_penalty_and_manual_values(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    account = add_investment_account(client, fin, ada, name="Deposits", kind="deposit")
    deposit = ok(
        client.post(
            f"{fin}/deposits",
            json={
                "account_id": account["account_id"],
                "kind": "fixed",
                "name": "FD",
                "interest_rate_bps": 650,
                "start_date": "2025-01-01",
                "maturity_date": "2027-01-01",
                "amount": LAKH,
                "cash_account_id": bank["id"],
                "stated_maturity_amount": 1_13_700_00,
            },
            headers=ada,
        ),
        201,
    )
    valued = ok(
        client.put(
            f"{fin}/deposits/{deposit['id']}/value",
            json={"value": 1_03_000_00, "valued_on": "2025-06-30"},
            headers=ada,
        )
    )
    assert valued["value_source"] == "manual"
    assert valued["value"] == 1_03_000_00
    assert valued["stated_maturity_amount"] == 1_13_700_00

    closed = ok(
        client.post(
            f"{fin}/deposits/{deposit['id']}/close",
            json={"closed_on": "2025-07-01", "amount": 99_500_00, "cash_account_id": bank["id"]},
            headers=ada,
        )
    )
    assert closed["status"] == "closed"
    # ₹500 short of the principal: no income, and the shortfall stays as lost principal.
    assert closed["interest_received"] == 0
    assert closed["principal"] == 500_00
    assert closed["value"] == 0
    again = client.post(
        f"{fin}/deposits/{deposit['id']}/close",
        json={"closed_on": "2025-07-02", "amount": 1, "cash_account_id": bank["id"]},
        headers=ada,
    )
    assert again.status_code == 409


def test_recurring_deposit_installments_are_recorded_one_by_one(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    account = add_investment_account(client, fin, ada, name="RDs", kind="deposit")
    deposit = ok(
        client.post(
            f"{fin}/deposits",
            json={
                "account_id": account["account_id"],
                "kind": "recurring",
                "name": "RD",
                "interest_rate_bps": 0,
                "compounding": "simple",
                "start_date": "2025-01-10",
                "maturity_date": "2025-07-10",
                "amount": 2_000_00,
                "cash_account_id": bank["id"],
            },
            headers=ada,
        ),
        201,
    )
    assert deposit["installment_amount"] == 2_000_00
    assert deposit["projected_contributions"] == 12_000_00
    assert deposit["principal"] == 2_000_00
    ok(
        client.post(
            f"{fin}/deposits/{deposit['id']}/contributions",
            json={"trade_date": "2025-02-10", "amount": 2_000_00, "cash_account_id": bank["id"]},
            headers=ada,
        ),
        201,
    )
    view = ok(client.get(f"{fin}/deposits/{deposit['id']}", params={"today": TODAY}, headers=ada))
    assert view["principal"] == 4_000_00
    assert balances(client, fin, ada)["HDFC Savings"] == 10 * LAKH - 4_000_00
    too_much = client.post(
        f"{fin}/investment-transactions",
        json={
            "type": "withdrawal",
            "deposit_id": deposit["id"],
            "trade_date": "2025-03-01",
            "amount": 5_000_00,
        },
        headers=ada,
    )
    assert too_much.status_code == 422


# Portfolio


def test_the_portfolio_summarizes_value_gains_income_and_allocation(
    client: TestClient, ada: Headers, fin: str, bank: Json, broker: Json
) -> None:
    stock = add_holding(client, fin, ada, broker["account_id"])
    fund = add_holding(
        client,
        fin,
        ada,
        broker["account_id"],
        kind="mutual_fund",
        name="Fund",
        symbol="",
        category="Large cap",
    )
    record(
        client,
        fin,
        ada,
        type="buy",
        holding_id=stock["id"],
        trade_date="2025-01-02",
        amount=20_000_00,
        quantity="20",
    )
    record(
        client,
        fin,
        ada,
        type="sell",
        holding_id=stock["id"],
        trade_date="2025-04-02",
        amount=12_000_00,
        quantity="10",
    )
    record(
        client,
        fin,
        ada,
        type="buy",
        holding_id=fund["id"],
        trade_date="2025-01-02",
        amount=10_000_00,
        quantity="100",
        fees=50_00,
    )
    record(
        client,
        fin,
        ada,
        type="dividend",
        holding_id=stock["id"],
        trade_date="2025-05-02",
        amount=100_00,
    )
    for target, price in ((stock, "1100"), (fund, "120")):
        ok(
            client.post(
                f"{fin}/holdings/{target['id']}/prices",
                json={"price_date": "2025-12-31", "price": price},
                headers=ada,
            )
        )

    report = ok(client.get(f"{fin}/portfolio", params={"today": TODAY}, headers=ada))
    assert report["invested"] == 10_000_00 + 10_000_00
    assert report["current_value"] == 11_000_00 + 12_000_00
    assert report["unrealized_gain"] == 3_000_00
    assert report["realized_gain"] == 2_000_00
    assert report["income"] == 100_00
    assert report["fees"] == 50_00
    assert report["total_return"] == 3_000_00 + 2_000_00 + 100_00 - 50_00
    # Over everything ever invested (₹30,000).
    assert report["return_percent"] == "16.83"
    assert report["cash"] == LAKH - 20_000_00 + 12_000_00 - 10_000_00 - 50_00 + 100_00
    assert [entry["key"] for entry in report["allocation"]] == ["cash", "mutual_fund", "stock"]
    assert {entry["label"] for entry in report["categories"]} == {"Large cap", "Stocks"}
    assert (report["missing_prices"], report["stale_prices"]) == (0, 0)

    # A date range limits flows, not values.
    q1 = ok(
        client.get(
            f"{fin}/portfolio",
            params={"today": TODAY, "date_from": "2025-01-01", "date_to": "2025-03-31"},
            headers=ada,
        )
    )
    assert (q1["realized_gain"], q1["income"], q1["fees"]) == (0, 0, 50_00)
    assert q1["current_value"] == report["current_value"]

    activity = ok(client.get(f"{fin}/investment-transactions", params={"limit": 2}, headers=ada))
    assert activity["total"] == 4
    assert [entry["type"] for entry in activity["transactions"]] == ["dividend", "sell"]


# Isolation


def test_investments_are_isolated_between_workspaces(
    client: TestClient, ada: Headers, grace: Headers, fin: str, broker: Json
) -> None:
    stock = add_holding(client, fin, ada, broker["account_id"])
    # Another user's workspace is not found at all.
    assert client.get(f"{fin}/holdings", headers=grace).status_code == 404
    assert client.get(f"{fin}/portfolio", headers=grace).status_code == 404

    theirs = finance_url(client, grace)
    assert client.get(f"{theirs}/holdings/{stock['id']}", headers=grace).status_code == 404
    assert ok(client.get(f"{theirs}/holdings", headers=grace))["holdings"] == []
    # Referencing ada's account or holding from grace's workspace is a validation error.
    foreign_account = client.post(
        f"{theirs}/holdings",
        json={"account_id": broker["account_id"], "kind": "stock", "name": "X"},
        headers=grace,
    )
    assert foreign_account.status_code == 422
    foreign_holding = client.post(
        f"{theirs}/investment-transactions",
        json={
            "type": "buy",
            "holding_id": stock["id"],
            "trade_date": "2025-01-02",
            "amount": 1_00,
            "quantity": "1",
        },
        headers=grace,
    )
    assert foreign_holding.status_code == 422
    adopt = client.post(
        f"{theirs}/investment-accounts",
        json={"account_id": broker["account_id"], "kind": "other"},
        headers=grace,
    )
    assert adopt.status_code == 422
    assert client.get(f"{theirs}/investment-transactions", headers=grace).json()["total"] == 0


def test_settlement_accounts_must_share_the_currency(
    client: TestClient, ada: Headers, fin: str, bank: Json
) -> None:
    usd = add_investment_account(client, fin, ada, name="IBKR", currency="USD")
    stock = add_holding(
        client, fin, ada, usd["account_id"], name="Apple", symbol="AAPL", exchange="NASDAQ"
    )
    assert stock["currency"] == "USD"
    response = client.post(
        f"{fin}/investment-transactions",
        json={
            "type": "buy",
            "holding_id": stock["id"],
            "trade_date": "2025-01-02",
            "amount": 1_000_00,
            "quantity": "5",
            "settlement": "account",
            "cash_account_id": bank["id"],
        },
        headers=ada,
    )
    assert response.status_code == 422
    assert "USD" in response.json()["detail"]
    assert uuid.UUID(stock["id"])


# Price feeds (the seam for future providers; none is called yet)


def test_quotes_from_a_feed_are_stored_with_their_source(
    client: TestClient,
    ada: Headers,
    fin: str,
    broker: Json,
    migrated_settings: Settings,
) -> None:
    stock = add_holding(client, fin, ada, broker["account_id"])
    workspace_id = uuid.UUID(fin.split("/")[-2])
    foreign = uuid.uuid4()

    async def run() -> int:
        database = await open_database(migrated_settings)
        try:
            async with database.session() as session:
                service = build_investment_service(session)
                return await service.record_prices(
                    workspace_id,
                    [
                        Quote(
                            uuid.UUID(stock["id"]), date(2025, 12, 31), 1_700_000_000, "provider"
                        ),
                        Quote(foreign, date(2025, 12, 31), 1, "provider"),
                    ],
                )
        finally:
            await database.dispose()

    assert asyncio.run(run()) == 1
    prices = ok(client.get(f"{fin}/holdings/{stock['id']}/prices", headers=ada))["prices"]
    assert [(entry["price"], entry["source"]) for entry in prices] == [("1700", "provider")]
