"""Finance models: accounts, categories, transactions, and reports.

Every amount is an integer in the currency's minor unit (paise for INR: ₹1,234.50 is 123450).
Request amounts must be JSON integers; `12.5` and `"1250"` are rejected rather than rounded.
"""

import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    Strict,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import Name, SearchText, multi_line, single_line
from orbit_api.services.finance.models import (
    AccountChanges,
    AccountClass,
    AccountDraft,
    AccountType,
    AccountView,
    BalanceTotals,
    CashFlow,
    Category,
    CategorySpending,
    CategoryType,
    MonthlyCashFlow,
    Transaction,
    TransactionChanges,
    TransactionDraft,
    TransactionQuery,
    TransactionSort,
    TransactionType,
)
from orbit_api.services.finance.money import DEFAULT_CURRENCY, MAX_AMOUNT, Currency
from orbit_api.utils.changes import UNSET
from orbit_api.utils.sorting import SortOrder

DESCRIPTION_MAX_LENGTH = 200
NOTES_MAX_LENGTH = 2000
PAGE_MAX_SIZE = 200
TREND_MAX_MONTHS = 24
EARLIEST_YEAR = 1900
LATEST_YEAR = 2200

Amount = Annotated[
    int,
    Strict(),
    Field(gt=0, le=MAX_AMOUNT, description="Minor units, always positive: ₹12.50 is 1250."),
]
SignedAmount = Annotated[
    int,
    Strict(),
    Field(
        ge=-MAX_AMOUNT,
        le=MAX_AMOUNT,
        description="Minor units. Positive is money held, negative is money owed: a credit card "
        "with ₹500 outstanding is -50000.",
    ),
]
Description = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=DESCRIPTION_MAX_LENGTH),
    AfterValidator(single_line),
]
Notes = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=NOTES_MAX_LENGTH),
    AfterValidator(multi_line),
]


def _plausible_date(value: date) -> date:
    if not EARLIEST_YEAR <= value.year <= LATEST_YEAR:
        raise ValueError(f"must be between the years {EARLIEST_YEAR} and {LATEST_YEAR}")
    return value


TransactionDate = Annotated[date, AfterValidator(_plausible_date)]


def _first_of_month(value: str) -> str:
    year = int(value[:4])
    if not EARLIEST_YEAR <= year <= LATEST_YEAR:
        raise ValueError(f"must be between the years {EARLIEST_YEAR} and {LATEST_YEAR}")
    return value


# A calendar month as `YYYY-MM`.
Month = Annotated[
    str,
    StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    AfterValidator(_first_of_month),
]


def parse_month(value: str | None) -> date:
    """The first day of a `YYYY-MM` month, or of the current month in UTC."""
    if value is None:
        return datetime.now(UTC).date().replace(day=1)
    return date(int(value[:4]), int(value[5:7]), 1)


def format_month(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def _check_range(date_from: date | None, date_to: date | None) -> None:
    if date_from is not None and date_to is not None and date_from > date_to:
        raise ValueError("date_from must be on or before date_to")


# Accounts


class AccountResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    type: AccountType
    account_class: AccountClass = Field(
        description="`liability` for credit cards, whose balance is negative while money is "
        "owed; `asset` for everything else. Investment accounts hold what was moved into them, "
        "not market value."
    )
    currency: Currency
    opening_balance: int = Field(description="Minor units, signed like `balance`.")
    balance: int = Field(
        description="The opening balance plus every recorded transaction, in minor units. "
        "Positive is money held, negative is money owed."
    )
    notes: str
    archived: bool = Field(description="Archived accounts take no new transactions.")
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, view: AccountView) -> "AccountResponse":
        account = view.account
        return cls(
            id=account.id,
            workspace_id=account.workspace_id,
            name=account.name,
            type=account.type,
            account_class=account.account_class,
            currency=account.currency,
            opening_balance=account.opening_balance,
            balance=view.balance,
            notes=account.notes,
            archived=account.archived_at is not None,
            archived_at=account.archived_at,
            created_at=account.created_at,
            updated_at=account.updated_at,
        )


class BalanceTotalsResponse(BaseModel):
    currency: Currency
    assets: int = Field(description="The sum of asset accounts' balances, in minor units.")
    liabilities: int = Field(
        description="What credit cards owe, as a positive amount in minor units."
    )

    @classmethod
    def of(cls, totals: BalanceTotals) -> "BalanceTotalsResponse":
        return cls(currency=totals.currency, assets=totals.assets, liabilities=totals.liabilities)


class AccountListResponse(BaseModel):
    accounts: list[AccountResponse] = Field(
        description="Active accounts first, then archived ones, each by name."
    )
    totals: list[BalanceTotalsResponse] = Field(
        description="Balances per currency, including archived accounts. Currencies are never "
        "added together."
    )


class CreateAccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    type: AccountType
    currency: Currency = DEFAULT_CURRENCY
    opening_balance: SignedAmount = 0
    notes: Notes = ""

    def to_draft(self) -> AccountDraft:
        return AccountDraft(
            name=self.name,
            type=self.type,
            currency=self.currency,
            opening_balance=self.opening_balance,
            notes=self.notes,
        )


class UpdateAccountRequest(BaseModel):
    """Change some of an account's fields. Its type and currency are fixed; archiving has its
    own endpoints."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    opening_balance: SignedAmount | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> AccountChanges:
        return AccountChanges(
            name=self.name if self.name is not None else UNSET,
            opening_balance=self.opening_balance if self.opening_balance is not None else UNSET,
            notes=self.notes if self.notes is not None else UNSET,
        )


# Categories


class CategoryResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    type: CategoryType
    is_default: bool = Field(
        description="A built-in category, which can be renamed but not deleted."
    )
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, category: Category) -> "CategoryResponse":
        return cls(
            id=category.id,
            workspace_id=category.workspace_id,
            name=category.name,
            type=category.type,
            is_default=category.is_default,
            created_at=category.created_at,
            updated_at=category.updated_at,
        )


class CategoryListResponse(BaseModel):
    categories: list[CategoryResponse] = Field(
        description="Income categories first, then expense categories, each by name."
    )


class CreateCategoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    type: CategoryType


class RenameCategoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name


# Transactions


class TransactionResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    type: TransactionType
    amount: int = Field(description="Minor units, always positive; `type` gives the direction.")
    currency: Currency = Field(description="The account's currency.")
    occurred_on: date = Field(description="A calendar date in the user's time zone.")
    description: str
    category_id: uuid.UUID | None
    account_id: uuid.UUID = Field(
        description="Where income and refunds went in, expenses came out, or a transfer started."
    )
    to_account_id: uuid.UUID | None = Field(description="A transfer's destination.")
    notes: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, transaction: Transaction) -> "TransactionResponse":
        return cls(
            id=transaction.id,
            workspace_id=transaction.workspace_id,
            type=transaction.type,
            amount=transaction.amount,
            currency=transaction.currency,
            occurred_on=transaction.occurred_on,
            description=transaction.description,
            category_id=transaction.category_id,
            account_id=transaction.account_id,
            to_account_id=transaction.to_account_id,
            notes=transaction.notes,
            created_at=transaction.created_at,
            updated_at=transaction.updated_at,
        )


class TransactionListResponse(BaseModel):
    transactions: list[TransactionResponse]
    total: int = Field(description="Transactions matching the filters, across all pages.")


class DateRangeParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date_from: TransactionDate | None = Field(default=None, description="Inclusive.")
    date_to: TransactionDate | None = Field(default=None, description="Inclusive.")

    @model_validator(mode="after")
    def _check_dates(self) -> Self:
        _check_range(self.date_from, self.date_to)
        return self


class TransactionListParams(DateRangeParams):
    """Filters, sorting, and paging for transaction history."""

    type: list[TransactionType] = Field(
        default_factory=list[TransactionType],
        description="Repeat to match any of several types. Omit for all.",
    )
    account_id: uuid.UUID | None = Field(
        default=None, description="Transactions on this account, either side of a transfer."
    )
    category_id: uuid.UUID | None = None
    q: SearchText = Field(
        default=None, description="Case-insensitive text to find in descriptions and notes."
    )
    sort: TransactionSort = "date"
    order: SortOrder | None = Field(
        default=None, description="Defaults to newest first, or largest first."
    )
    limit: int = Field(default=50, ge=1, le=PAGE_MAX_SIZE)
    offset: int = Field(default=0, ge=0)

    def to_query(self) -> TransactionQuery:
        return TransactionQuery(
            types=frozenset(self.type),
            account_id=self.account_id,
            category_id=self.category_id,
            date_from=self.date_from,
            date_to=self.date_to,
            search=self.q,
            sort=self.sort,
            order=self.order,
            limit=self.limit,
            offset=self.offset,
        )


class CreateTransactionRequest(BaseModel):
    """Record income, an expense, a refund, or a transfer. A transfer needs `to_account_id` and
    has no category; the others have no `to_account_id`. The currency is the account's."""

    model_config = ConfigDict(extra="forbid")

    type: TransactionType
    amount: Amount
    occurred_on: TransactionDate
    description: Description
    account_id: uuid.UUID
    to_account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    notes: Notes = ""

    def to_draft(self) -> TransactionDraft:
        return TransactionDraft(
            type=self.type,
            amount=self.amount,
            occurred_on=self.occurred_on,
            description=self.description,
            account_id=self.account_id,
            to_account_id=self.to_account_id,
            category_id=self.category_id,
            notes=self.notes,
        )


class CreateTransferRequest(BaseModel):
    """Move money between two accounts in the same currency, such as paying a credit-card bill
    or putting money into an investment account. Never income or spending."""

    model_config = ConfigDict(extra="forbid")

    amount: Amount
    occurred_on: TransactionDate
    description: Description
    from_account_id: uuid.UUID
    to_account_id: uuid.UUID
    notes: Notes = ""

    def to_draft(self) -> TransactionDraft:
        return TransactionDraft(
            type="transfer",
            amount=self.amount,
            occurred_on=self.occurred_on,
            description=self.description,
            account_id=self.from_account_id,
            to_account_id=self.to_account_id,
            notes=self.notes,
        )


class UpdateTransactionRequest(BaseModel):
    """Correct some of a transaction's fields. Omitted fields keep their values;
    `category_id: null` and `to_account_id: null` clear them. The result must follow the same
    rules as a new transaction, so turning a transfer into an expense also clears
    `to_account_id`."""

    model_config = ConfigDict(extra="forbid")

    type: TransactionType | None = None
    amount: Amount | None = None
    occurred_on: TransactionDate | None = None
    description: Description | None = None
    account_id: uuid.UUID | None = None
    to_account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in ("type", "amount", "occurred_on", "description", "account_id", "notes"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> TransactionChanges:
        provided = self.model_fields_set
        return TransactionChanges(
            type=self.type if self.type is not None else UNSET,
            amount=self.amount if self.amount is not None else UNSET,
            occurred_on=self.occurred_on if self.occurred_on is not None else UNSET,
            description=self.description if self.description is not None else UNSET,
            account_id=self.account_id if self.account_id is not None else UNSET,
            to_account_id=self.to_account_id if "to_account_id" in provided else UNSET,
            category_id=self.category_id if "category_id" in provided else UNSET,
            notes=self.notes if self.notes is not None else UNSET,
        )


# Reports


class ReportParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: Month | None = Field(
        default=None,
        description="A calendar month as `YYYY-MM`, in the user's time zone. Defaults to the "
        "current month in UTC.",
    )
    currency: Currency = Field(
        default=DEFAULT_CURRENCY,
        description="Reports cover one currency; amounts in different currencies are never "
        "added together.",
    )


class TrendParams(ReportParams):
    months: int = Field(
        default=6, ge=1, le=TREND_MAX_MONTHS, description="How many months, ending with `month`."
    )


class CashFlowResponse(BaseModel):
    income: int
    expenses: int = Field(description="Spending before refunds.")
    refunds: int
    net_expenses: int = Field(description="`expenses` minus `refunds`.")
    net: int = Field(
        description="Net cash flow: `income` minus `net_expenses`. Negative when more was spent "
        "than earned. Transfers never count."
    )
    transactions: int = Field(description="Income, expense, and refund transactions counted.")

    @classmethod
    def fields_of(cls, cash_flow: CashFlow) -> dict[str, int]:
        return {
            "income": cash_flow.income,
            "expenses": cash_flow.expenses,
            "refunds": cash_flow.refunds,
            "net_expenses": cash_flow.net_expenses,
            "net": cash_flow.net,
            "transactions": cash_flow.transactions,
        }


class MonthlySummaryResponse(CashFlowResponse):
    month: str = Field(description="`YYYY-MM`.")
    currency: Currency

    @classmethod
    def of(cls, month: date, currency: Currency, cash_flow: CashFlow) -> "MonthlySummaryResponse":
        return cls(month=format_month(month), currency=currency, **cls.fields_of(cash_flow))


class MonthCashFlowResponse(CashFlowResponse):
    month: str = Field(description="`YYYY-MM`.")

    @classmethod
    def of(cls, entry: MonthlyCashFlow) -> "MonthCashFlowResponse":
        return cls(month=format_month(entry.month), **cls.fields_of(entry.cash_flow))


class TrendResponse(BaseModel):
    currency: Currency
    months: list[MonthCashFlowResponse] = Field(
        description="Oldest first, one per month, including months without transactions."
    )


class CategorySpendingResponse(BaseModel):
    category_id: uuid.UUID | None = Field(description="`null` for uncategorized spending.")
    expenses: int
    refunds: int
    net: int = Field(description="`expenses` minus `refunds`.")

    @classmethod
    def of(cls, entry: CategorySpending) -> "CategorySpendingResponse":
        return cls(
            category_id=entry.category_id,
            expenses=entry.expenses,
            refunds=entry.refunds,
            net=entry.net,
        )


class SpendingResponse(BaseModel):
    month: str = Field(description="`YYYY-MM`.")
    currency: Currency
    total: int = Field(description="Net spending across all categories.")
    categories: list[CategorySpendingResponse] = Field(
        description="Largest net spending first. Categories whose refunds cancel their spending "
        "are left out."
    )
