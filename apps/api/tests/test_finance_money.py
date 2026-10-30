"""Pure finance helpers: money text, month arithmetic, balance totals, and CSV export."""

import csv
import io
import uuid
from datetime import UTC, date, datetime

import pytest

from orbit_api.services.finance.export import CSV_HEADER, transactions_csv
from orbit_api.services.finance.models import Account, AccountType, AccountView, Transaction
from orbit_api.services.finance.money import (
    CURRENCIES,
    CURRENCY_EXPONENTS,
    Currency,
    add_months,
    month_bounds,
    to_decimal_string,
)
from orbit_api.services.finance.service import balance_totals

WORKSPACE = uuid.uuid4()
NOW = datetime(2026, 2, 1, tzinfo=UTC)


@pytest.mark.parametrize(
    ("amount", "currency", "text"),
    [
        (0, "INR", "0.00"),
        (5, "INR", "0.05"),
        (123_450, "INR", "1234.50"),
        (-123_450, "INR", "-1234.50"),
        (-5, "INR", "-0.05"),
        (10**13, "INR", "100000000000.00"),
        (1_250, "JPY", "1250"),
        (-1_250, "JPY", "-1250"),
    ],
)
def test_to_decimal_string(amount: int, currency: Currency, text: str) -> None:
    assert to_decimal_string(amount, currency) == text


def test_every_currency_has_an_exponent() -> None:
    assert set(CURRENCIES) == set(CURRENCY_EXPONENTS)


@pytest.mark.parametrize(
    ("day", "bounds"),
    [
        (date(2026, 1, 15), (date(2026, 1, 1), date(2026, 1, 31))),
        (date(2026, 2, 1), (date(2026, 2, 1), date(2026, 2, 28))),
        (date(2028, 2, 29), (date(2028, 2, 1), date(2028, 2, 29))),
        (date(2026, 12, 31), (date(2026, 12, 1), date(2026, 12, 31))),
    ],
)
def test_month_bounds(day: date, bounds: tuple[date, date]) -> None:
    assert month_bounds(day) == bounds


def test_add_months_crosses_years() -> None:
    assert add_months(date(2026, 1, 1), -1) == date(2025, 12, 1)
    assert add_months(date(2026, 11, 1), 2) == date(2027, 1, 1)
    assert add_months(date(2026, 3, 1), -26) == date(2024, 1, 1)


def account(name: str, account_type: AccountType, currency: Currency = "INR") -> Account:
    return Account(
        id=uuid.uuid4(),
        workspace_id=WORKSPACE,
        name=name,
        type=account_type,
        currency=currency,
        opening_balance=0,
        notes="",
        archived_at=None,
        created_at=NOW,
        updated_at=NOW,
    )


def test_balance_totals_separate_assets_liabilities_and_currencies() -> None:
    views = [
        AccountView(account("Bank", "bank"), 500_000),
        AccountView(account("Overdrawn", "bank"), -20_000),
        AccountView(account("Broker", "investment"), 100_000),
        AccountView(account("Card", "credit_card"), -75_000),
        AccountView(account("Overpaid card", "credit_card"), 1_000),
        AccountView(account("Chase", "bank", "USD"), 9_999),
    ]

    totals = balance_totals(views)

    assert [(t.currency, t.assets, t.liabilities) for t in totals] == [
        ("INR", 580_000, 74_000),
        ("USD", 9_999, 0),
    ]


def test_transactions_csv_names_accounts_and_neutralizes_formulas() -> None:
    bank = account("Bank", "bank")
    transaction = Transaction(
        id=uuid.uuid4(),
        workspace_id=WORKSPACE,
        type="expense",
        amount=99,
        currency="INR",
        occurred_on=date(2026, 2, 1),
        description="@SUM(A1)",
        category_id=None,
        account_id=bank.id,
        to_account_id=None,
        notes="-2+3",
        created_at=NOW,
        updated_at=NOW,
    )

    rows = list(csv.reader(io.StringIO(transactions_csv([transaction], [bank], []))))

    assert rows == [
        list(CSV_HEADER),
        ["2026-02-01", "expense", "'@SUM(A1)", "", "Bank", "", "0.99", "INR", "'-2+3",
         str(transaction.id)],
    ]  # fmt: skip
