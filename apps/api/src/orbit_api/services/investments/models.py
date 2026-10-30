"""Investment types: investment accounts, holdings (mutual funds, stocks, ETFs) with their prices,
investment transactions, SIP plans, fixed and recurring deposits, and other assets with their
valuations.

Money is integer minor units; unit quantities and per-unit prices are scaled integers (see
`quantities.py`). Dates are calendar dates in the user's own time zone.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Final, Literal

# A deposit's maturity reminder uses the same settings as a commitment's payment reminders.
from orbit_api.services.commitments.models import ReminderSettings
from orbit_api.services.commitments.schedule import Frequency
from orbit_api.services.finance.models import Account
from orbit_api.services.finance.money import Currency
from orbit_api.services.investments.deposits import Compounding
from orbit_api.utils.changes import UNSET, Change

InvestmentAccountKind = Literal["mutual_fund", "brokerage", "deposit", "other"]
HoldingKind = Literal["mutual_fund", "stock", "etf"]

# - `buy`, `sell`: units of a holding, for `amount` (cost, or gross proceeds).
# - `dividend`: a holding's dividend or distribution; income in the ledger.
# - `interest`: interest received, on a deposit or the account's cash; income in the ledger.
# - `fee`: charges; an expense in the ledger.
# - `deposit`, `withdrawal`: money put into or taken out of a fixed or recurring deposit.
InvestmentTransactionType = Literal[
    "buy", "sell", "dividend", "interest", "fee", "deposit", "withdrawal"
]
TRADE_TYPES: Final = frozenset({"buy", "sell"})
FLOW_TYPES: Final = frozenset({"deposit", "withdrawal"})
LEDGER_TYPES: Final = frozenset({"dividend", "interest", "fee"})

# Where the money of a buy, sell, deposit, or withdrawal came from or went to:
# - `investment_account`: the investment account's own cash (money already moved in);
# - `account`: another account; Orbit records the transfer to or from it in the ledger;
# - `none`: outside Orbit, such as a holding bought before it was tracked (buys and deposits
#   only). No cash moves in the ledger.
# Dividends, interest, and fees always use the investment account or another account, because
# they are recorded as income or expenses.
Settlement = Literal["investment_account", "account", "none"]
BuyPlan = Literal["lump_sum", "sip"]

# Where a price or valuation came from. Only `manual` is produced today; the rest are reserved
# for future price providers and statement imports, so adding them needs no schema change.
PriceSource = Literal["manual", "import", "provider"]
AssetValuationSource = Literal["manual", "purchase", "import", "provider"]

DepositKind = Literal["fixed", "recurring"]
# Stored. A deposit past maturity but still active shows as awaiting payout in the web app.
DepositStatus = Literal["active", "matured", "closed"]
SipState = Literal["active", "paused", "cancelled"]
AssetCategory = Literal["gold", "cash", "property", "vehicle", "other"]

# How current a value is:
# - `current`: from the ledger, or a price or valuation recent enough;
# - `stale`: a price or valuation older than its threshold;
# - `missing`: no price or valuation; counted at cost (or purchase cost) instead;
# - `estimated`: computed from assumptions (a deposit's accrued interest).
Freshness = Literal["current", "stale", "missing", "estimated"]
# How a value was arrived at.
ValueSource = Literal["ledger", "market", "manual", "estimate", "cost"]

# A market price older than this is stale; so is a manual valuation older than a year.
PRICE_STALE_DAYS: Final = 7
VALUATION_STALE_DAYS: Final = 365


# Investment accounts


@dataclass(frozen=True, slots=True)
class InvestmentProfile:
    """What makes a finance account of type `investment` an investment account. Its name,
    currency, notes, and archive state are the finance account's own."""

    account_id: uuid.UUID
    workspace_id: uuid.UUID
    currency: Currency
    kind: InvestmentAccountKind
    provider: str
    # The bank account money usually comes from and returns to; offered first in forms.
    linked_account_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class InvestmentAccountView:
    profile: InvestmentProfile
    account: Account
    # The finance account's ledger balance: money moved in, plus income, minus fees and money
    # moved out. Includes what was spent on holdings and deposits.
    ledger_balance: int
    # Uninvested cash: the ledger balance minus purchases and deposits, plus sale proceeds and
    # withdrawals, all settled through the account.
    cash: int
    holdings_value: int
    deposits_value: int

    @property
    def value(self) -> int:
        return self.cash + self.holdings_value + self.deposits_value


@dataclass(frozen=True, slots=True)
class InvestmentAccountDraft:
    kind: InvestmentAccountKind
    provider: str = ""
    linked_account_id: uuid.UUID | None = None
    # Adopt this existing `investment` finance account; otherwise create one from the fields
    # below.
    account_id: uuid.UUID | None = None
    name: str | None = None
    currency: Currency | None = None
    notes: str = ""


@dataclass(frozen=True, slots=True)
class InvestmentAccountChanges:
    name: Change[str] = UNSET
    kind: Change[InvestmentAccountKind] = UNSET
    provider: Change[str] = UNSET
    linked_account_id: Change[uuid.UUID | None] = UNSET
    notes: Change[str] = UNSET
    archived: Change[bool] = UNSET


# Holdings


@dataclass(frozen=True, slots=True)
class Holding:
    id: uuid.UUID
    workspace_id: uuid.UUID
    account_id: uuid.UUID
    currency: Currency
    kind: HoldingKind
    name: str
    # A ticker for stocks and ETFs, or a scheme code for mutual funds.
    symbol: str
    exchange: str
    isin: str
    # The AMC or fund house for mutual funds; the issuer otherwise.
    issuer: str
    # The scheme category, such as "Flexi cap"; free text.
    category: str
    folio: str
    notes: str
    created_at: datetime
    updated_at: datetime

    @property
    def identity(self) -> str:
        """What makes two holdings in one account the same: the ISIN, else the symbol and
        exchange, else the name; with the folio, since one scheme can sit in several folios."""
        if self.isin:
            key = f"isin:{self.isin}"
        elif self.symbol:
            key = f"symbol:{self.symbol}@{self.exchange}"
        else:
            key = f"name:{self.name}"
        return f"{self.kind}|{key}|{self.folio}".casefold()


@dataclass(frozen=True, slots=True)
class HoldingDraft:
    account_id: uuid.UUID
    kind: HoldingKind
    name: str
    symbol: str = ""
    exchange: str = ""
    isin: str = ""
    issuer: str = ""
    category: str = ""
    folio: str = ""
    notes: str = ""


@dataclass(frozen=True, slots=True)
class HoldingChanges:
    name: Change[str] = UNSET
    symbol: Change[str] = UNSET
    exchange: Change[str] = UNSET
    isin: Change[str] = UNSET
    issuer: Change[str] = UNSET
    category: Change[str] = UNSET
    folio: Change[str] = UNSET
    notes: Change[str] = UNSET


@dataclass(frozen=True, slots=True)
class Price:
    id: uuid.UUID
    workspace_id: uuid.UUID
    holding_id: uuid.UUID
    price_date: date
    # Scaled major units per unit (see `quantities.py`).
    price: int
    source: PriceSource
    created_at: datetime


@dataclass(frozen=True, slots=True)
class HoldingView:
    holding: Holding
    # Scaled units held, and what they cost (FIFO).
    quantity: int
    cost: int
    # Cost per unit held (scaled price); `None` when nothing is held.
    average_cost: int | None
    # Everything ever paid for buys.
    bought: int
    price: Price | None
    # `quantity * price`; `None` without a price.
    market_value: int | None
    realized: int
    dividends: int
    fees: int
    freshness: Freshness

    @property
    def value(self) -> int:
        """The market value, or cost when no price is known (and `freshness` is `missing`)."""
        return self.cost if self.market_value is None else self.market_value

    @property
    def unrealized(self) -> int | None:
        return None if self.market_value is None else self.market_value - self.cost


# Investment transactions


@dataclass(frozen=True, slots=True)
class InvestmentTransaction:
    id: uuid.UUID
    workspace_id: uuid.UUID
    account_id: uuid.UUID
    currency: Currency
    type: InvestmentTransactionType
    trade_date: date
    # Minor units, always positive: cost, gross proceeds, income, fee, or the deposit's money.
    amount: int
    # Charges on a buy or sale, recorded as a separate ledger expense.
    fees: int
    holding_id: uuid.UUID | None
    deposit_id: uuid.UUID | None
    sip_plan_id: uuid.UUID | None
    # The SIP due date this buy settles; unique per plan.
    sip_due_date: date | None
    # Scaled units; buys and sells only.
    quantity: int | None
    # Buys only.
    plan: BuyPlan | None
    settlement: Settlement
    # The account money came from or went to when `settlement` is `account`; the investment
    # account itself for income and fees settled there.
    cash_account_id: uuid.UUID | None
    # The ledger rows Orbit recorded for it: a transfer, income, or expense; and the fees.
    cash_transaction_id: uuid.UUID | None
    fee_transaction_id: uuid.UUID | None
    notes: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class InvestmentTransactionDraft:
    type: InvestmentTransactionType
    trade_date: date
    amount: int
    settlement: Settlement
    holding_id: uuid.UUID | None = None
    deposit_id: uuid.UUID | None = None
    sip_plan_id: uuid.UUID | None = None
    sip_due_date: date | None = None
    quantity: int | None = None
    fees: int = 0
    plan: BuyPlan | None = None
    # Required when `settlement` is `account`.
    cash_account_id: uuid.UUID | None = None
    notes: str = ""
    # For income and fees: the investment account itself; set by the service.
    account_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class InvestmentTransactionQuery:
    account_id: uuid.UUID | None = None
    holding_id: uuid.UUID | None = None
    deposit_id: uuid.UUID | None = None
    types: frozenset[InvestmentTransactionType] = frozenset()
    date_from: date | None = None
    date_to: date | None = None
    limit: int = 50
    offset: int = 0


@dataclass(frozen=True, slots=True)
class InvestmentTransactionPage:
    transactions: list[InvestmentTransaction]
    total: int


# SIP plans


@dataclass(frozen=True, slots=True)
class SipPlan:
    """A systematic investment plan: an *expected* buy of `amount` on each due date. Nothing is
    invested until a buy is recorded against it."""

    id: uuid.UUID
    workspace_id: uuid.UUID
    holding_id: uuid.UUID
    currency: Currency
    amount: int
    frequency: Frequency
    # The first due date the schedule counts from; moved when resumed or rescheduled.
    anchor_date: date
    end_date: date | None
    funding_account_id: uuid.UUID | None
    state: SipState
    notes: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class SipPlanView:
    plan: SipPlan
    # The next due date on or after today with no buy recorded for it; `None` when finished,
    # paused, or cancelled.
    next_due_date: date | None
    installments: int
    invested: int
    last_bought_on: date | None


@dataclass(frozen=True, slots=True)
class SipPlanDraft:
    holding_id: uuid.UUID
    amount: int
    frequency: Frequency
    next_due_date: date
    end_date: date | None = None
    funding_account_id: uuid.UUID | None = None
    notes: str = ""


@dataclass(frozen=True, slots=True)
class SipPlanChanges:
    amount: Change[int] = UNSET
    frequency: Change[Frequency] = UNSET
    next_due_date: Change[date] = UNSET
    end_date: Change[date | None] = UNSET
    funding_account_id: Change[uuid.UUID | None] = UNSET
    state: Change[SipState] = UNSET
    notes: Change[str] = UNSET


# Deposits


@dataclass(frozen=True, slots=True)
class Deposit:
    id: uuid.UUID
    workspace_id: uuid.UUID
    account_id: uuid.UUID
    currency: Currency
    kind: DepositKind
    name: str
    institution: str
    interest_rate_bps: int
    compounding: Compounding
    start_date: date
    maturity_date: date
    # A recurring deposit's monthly installment.
    installment_amount: int | None
    # The maturity amount the bank stated, if the user entered it.
    stated_maturity_amount: int | None
    status: DepositStatus
    closed_on: date | None
    # The latest value the user entered by hand, overriding the estimate from that date.
    manual_value: int | None
    manual_valued_on: date | None
    reminder: ReminderSettings | None
    notes: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class DepositView:
    deposit: Deposit
    # Money deposited minus principal withdrawn, as recorded.
    principal: int
    interest_received: int
    # Accrued value estimated from the contributions and the rate.
    estimated_value: int
    value: int
    valued_on: date
    source: ValueSource
    freshness: Freshness
    # Projected from the terms (a recurring deposit assumes every installment is paid).
    projected_maturity_amount: int
    projected_interest: int
    projected_contributions: int


@dataclass(frozen=True, slots=True)
class DepositDraft:
    account_id: uuid.UUID
    kind: DepositKind
    name: str
    interest_rate_bps: int
    compounding: Compounding
    start_date: date
    maturity_date: date
    # A fixed deposit's principal, or a recurring deposit's monthly installment. A fixed
    # deposit's principal is recorded as its first `deposit` transaction.
    amount: int
    settlement: Settlement
    cash_account_id: uuid.UUID | None = None
    institution: str = ""
    stated_maturity_amount: int | None = None
    notes: str = ""
    reminder: ReminderSettings | None = None


@dataclass(frozen=True, slots=True)
class DepositChanges:
    name: Change[str] = UNSET
    institution: Change[str] = UNSET
    interest_rate_bps: Change[int] = UNSET
    compounding: Change[Compounding] = UNSET
    maturity_date: Change[date] = UNSET
    installment_amount: Change[int | None] = UNSET
    stated_maturity_amount: Change[int | None] = UNSET
    notes: Change[str] = UNSET
    reminder: Change[ReminderSettings | None] = UNSET


@dataclass(frozen=True, slots=True)
class DepositClosure:
    """Close a deposit at maturity or early. `amount` is everything received; what exceeds the
    principal still held is interest income, and a shortfall is a realized loss."""

    closed_on: date
    amount: int
    settlement: Settlement
    cash_account_id: uuid.UUID | None = None


# Other assets


@dataclass(frozen=True, slots=True)
class Asset:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    category: AssetCategory
    currency: Currency
    purchase_date: date | None
    purchase_cost: int | None
    # A related account, such as the loan that financed a vehicle. When it is an asset
    # account (bank, cash, investment, …), the asset is what that balance already counts.
    linked_account_id: uuid.UUID | None
    include_in_net_worth: bool
    notes: str
    # Sold or disposed of: kept for history, no longer counted.
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class AssetValuation:
    id: uuid.UUID
    workspace_id: uuid.UUID
    asset_id: uuid.UUID
    valued_on: date
    value: int
    source: AssetValuationSource
    notes: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class AssetView:
    asset: Asset
    latest: AssetValuation | None
    # The latest valuation, else the purchase cost, else 0.
    value: int
    valued_on: date | None
    freshness: Freshness
    counted: bool
    # Why it isn't counted in net worth, when it isn't.
    excluded_reason: str | None


@dataclass(frozen=True, slots=True)
class AssetDraft:
    name: str
    category: AssetCategory
    currency: Currency
    purchase_date: date | None = None
    purchase_cost: int | None = None
    current_value: int | None = None
    valued_on: date | None = None
    linked_account_id: uuid.UUID | None = None
    include_in_net_worth: bool = True
    notes: str = ""


@dataclass(frozen=True, slots=True)
class AssetChanges:
    name: Change[str] = UNSET
    category: Change[AssetCategory] = UNSET
    purchase_date: Change[date | None] = UNSET
    purchase_cost: Change[int | None] = UNSET
    linked_account_id: Change[uuid.UUID | None] = UNSET
    include_in_net_worth: Change[bool] = UNSET
    notes: Change[str] = UNSET
    archived: Change[bool] = UNSET


# Portfolio


@dataclass(frozen=True, slots=True)
class Slice:
    key: str
    label: str
    value: int


@dataclass(frozen=True, slots=True)
class PortfolioSummary:
    """One currency's investments: values today, and flows in the requested date range."""

    currency: Currency
    # Cost of what is held now: open holdings' FIFO cost plus deposits' principal.
    invested: int
    # Holdings at market (or cost when unpriced), deposits at estimated or manual value.
    current_value: int
    cash: int
    unrealized: int
    # In the date range.
    realized: int
    income: int
    fees: int
    # `unrealized + realized + income - fees`.
    total_return: int
    return_percent: str | None
    # By asset class (mutual funds, stocks, ETFs, deposits, cash) and by scheme category.
    allocation: list[Slice]
    categories: list[Slice]
    missing_prices: int
    stale_prices: int


# Errors


class InvestmentAccountNotFoundError(Exception):
    """The investment account does not exist in this workspace."""


class HoldingNotFoundError(Exception):
    """The holding does not exist in this workspace."""


class InvestmentTransactionNotFoundError(Exception):
    """The investment transaction does not exist in this workspace."""


class SipPlanNotFoundError(Exception):
    """The SIP plan does not exist in this workspace."""


class DepositNotFoundError(Exception):
    """The deposit does not exist in this workspace."""


class AssetNotFoundError(Exception):
    """The asset does not exist in this workspace."""


class PriceNotFoundError(Exception):
    """The price does not exist on this holding."""


class ValuationNotFoundError(Exception):
    """The valuation does not exist on this asset."""


class InvalidInvestmentError(Exception):
    """The request breaks a rule. The message is written for the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class InvestmentConflictError(Exception):
    """The request conflicts with existing data (a duplicate, or history that depends on it).
    The message is written for the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
