"""Financial account, category, and transaction types.

Amounts are integers in the currency's minor unit (see `money.py`). Balances are signed from the
owner's point of view: positive is money held, negative is money owed. A credit card with ₹500
outstanding has a balance of -50000.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Final, Literal

from orbit_api.services.finance.money import Currency
from orbit_api.utils.changes import UNSET, Change
from orbit_api.utils.sorting import SortOrder

# `loan` accounts are created with a loan (`services.commitments`) and hold its outstanding
# principal; they can't be created on their own, so `ManualAccountType` leaves them out.
AccountType = Literal[
    "bank", "savings", "cash", "wallet", "credit_card", "investment", "loan", "other"
]
ManualAccountType = Literal[
    "bank", "savings", "cash", "wallet", "credit_card", "investment", "other"
]
# Whether an account's balance is something owned or something owed. Investment accounts are
# assets, valued at what was moved into them, not at market value: Orbit tracks no holdings.
AccountClass = Literal["asset", "liability"]
ACCOUNT_CLASSES: Final[dict[AccountType, AccountClass]] = {
    "bank": "asset",
    "savings": "asset",
    "cash": "asset",
    "wallet": "asset",
    "credit_card": "liability",
    "investment": "asset",
    "loan": "liability",
    "other": "asset",
}

# - `income`: money earned, into `account_id`.
# - `expense`: money spent, out of `account_id`. A credit-card purchase is an expense when made.
# - `refund`: money returned for an earlier expense, into `account_id`. It reduces spending in
#   its (expense) category rather than counting as income.
# - `transfer`: money moved from `account_id` to `to_account_id`, such as paying a credit-card
#   bill or putting money into an investment account. Never income or spending.
TransactionType = Literal["income", "expense", "refund", "transfer"]
CategoryType = Literal["income", "expense"]
TransactionSort = Literal["date", "amount"]


@dataclass(frozen=True, slots=True)
class Account:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    type: AccountType
    # Fixed when the account is created; every transaction on it uses the same currency.
    currency: Currency
    # The balance before the first recorded transaction, signed like every balance.
    opening_balance: int
    notes: str
    # Archived accounts keep their history but take no new transactions.
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @property
    def account_class(self) -> AccountClass:
        return ACCOUNT_CLASSES[self.type]


@dataclass(frozen=True, slots=True)
class AccountView:
    account: Account
    # `opening_balance` plus every recorded transaction on the account. Derived, never stored.
    balance: int


@dataclass(frozen=True, slots=True)
class BalanceTotals:
    """Account balances in one currency, split into what is owned and what is owed."""

    currency: Currency
    # The sum of asset accounts' balances.
    assets: int
    # What liability accounts owe, as a positive amount (a card overpaid shows as negative).
    liabilities: int


@dataclass(frozen=True, slots=True)
class AccountDraft:
    name: str
    type: AccountType
    currency: Currency
    opening_balance: int = 0
    notes: str = ""


@dataclass(frozen=True, slots=True)
class AccountChanges:
    """A partial update. Type and currency can't change once an account exists."""

    name: Change[str] = UNSET
    opening_balance: Change[int] = UNSET
    notes: Change[str] = UNSET


@dataclass(frozen=True, slots=True)
class Category:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    type: CategoryType
    # Identifies a built-in category (see `categories.py`); `None` for the user's own.
    key: str | None
    created_at: datetime
    updated_at: datetime

    @property
    def is_default(self) -> bool:
        return self.key is not None


@dataclass(frozen=True, slots=True)
class Transaction:
    id: uuid.UUID
    workspace_id: uuid.UUID
    type: TransactionType
    # Always positive; `type` says which way the money moved.
    amount: int
    # The account's currency, copied so that every row states its own.
    currency: Currency
    # A calendar date in the user's own time zone, without a time.
    occurred_on: date
    description: str
    # Income takes an income category; expenses and refunds an expense category; transfers none.
    category_id: uuid.UUID | None
    account_id: uuid.UUID
    # Set exactly for transfers: where the money went.
    to_account_id: uuid.UUID | None
    notes: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class TransactionDraft:
    type: TransactionType
    amount: int
    occurred_on: date
    description: str
    account_id: uuid.UUID
    to_account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    notes: str = ""


@dataclass(frozen=True, slots=True)
class TransactionChanges:
    """A partial update. `UNSET` leaves a field as it is; `None` clears the category or the
    destination account."""

    type: Change[TransactionType] = UNSET
    amount: Change[int] = UNSET
    occurred_on: Change[date] = UNSET
    description: Change[str] = UNSET
    account_id: Change[uuid.UUID] = UNSET
    to_account_id: Change[uuid.UUID | None] = UNSET
    category_id: Change[uuid.UUID | None] = UNSET
    notes: Change[str] = UNSET


@dataclass(frozen=True, slots=True)
class TransactionQuery:
    # Empty means every type.
    types: frozenset[TransactionType] = frozenset()
    # Transactions on this account, on either side of a transfer.
    account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    # Inclusive calendar dates.
    date_from: date | None = None
    date_to: date | None = None
    # Case-insensitive substring of the description or notes.
    search: str | None = None
    sort: TransactionSort = "date"
    # `None` uses the sort's natural order: newest first, or largest first.
    order: SortOrder | None = None
    limit: int = 50
    offset: int = 0


@dataclass(frozen=True, slots=True)
class TransactionPage:
    transactions: list[Transaction]
    # All transactions matching the query, ignoring `limit` and `offset`.
    total: int


@dataclass(frozen=True, slots=True)
class CashFlow:
    """Income and spending in one currency over a date range. Transfers are excluded."""

    income: int
    # Gross spending, before refunds.
    expenses: int
    refunds: int
    # Income, expense, and refund transactions counted.
    transactions: int

    @property
    def net_expenses(self) -> int:
        return self.expenses - self.refunds

    @property
    def net(self) -> int:
        """Net cash flow: what was left over (or overspent). The month's savings."""
        return self.income - self.net_expenses


@dataclass(frozen=True, slots=True)
class MonthlyCashFlow:
    month: date
    cash_flow: CashFlow


@dataclass(frozen=True, slots=True)
class CategorySpending:
    # `None` for expenses and refunds without a category.
    category_id: uuid.UUID | None
    expenses: int
    refunds: int

    @property
    def net(self) -> int:
        return self.expenses - self.refunds


class AccountNotFoundError(Exception):
    """The account does not exist in this workspace."""


class CategoryNotFoundError(Exception):
    """The category does not exist in this workspace."""


class TransactionNotFoundError(Exception):
    """The transaction does not exist in this workspace."""


class TransactionInUseError(Exception):
    """The transaction records a loan, subscription, or bill payment, so deleting it would
    rewrite that payment's history. Undo the payment first."""


class InvalidTransactionError(Exception):
    """The transaction breaks a rule, such as a transfer to the same account. The message is
    written for the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class CategoryConflictError(Exception):
    """The category can't be changed this way. The message is written for the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
