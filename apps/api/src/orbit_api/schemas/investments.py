"""Investment models: investment accounts, holdings and prices, investment transactions, SIP
plans, deposits, and the portfolio summary.

Money is integer minor units and must be a JSON integer, like the rest of finance. **Unit
quantities and per-unit prices are decimal strings** (`"12.345"`, `"45.6789"`) with up to six
decimal places, never JSON numbers, so nothing is rounded through floating point.
"""

import re
import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    Strict,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.commitments import ReminderSettingsRequest, ReminderSettingsResponse
from orbit_api.schemas.common import Name, single_line
from orbit_api.schemas.finance import Amount, Notes, TransactionDate
from orbit_api.services.commitments.schedule import Frequency
from orbit_api.services.finance.money import DEFAULT_CURRENCY, MAX_AMOUNT, Currency
from orbit_api.services.investments.deposits import Compounding
from orbit_api.services.investments.models import (
    BuyPlan,
    DepositChanges,
    DepositClosure,
    DepositDraft,
    DepositKind,
    DepositStatus,
    DepositView,
    Freshness,
    HoldingChanges,
    HoldingDraft,
    HoldingKind,
    HoldingView,
    InvestmentAccountChanges,
    InvestmentAccountDraft,
    InvestmentAccountKind,
    InvestmentAccountView,
    InvestmentTransaction,
    InvestmentTransactionDraft,
    InvestmentTransactionQuery,
    InvestmentTransactionType,
    PortfolioSummary,
    Price,
    PriceSource,
    Settlement,
    SipPlanChanges,
    SipPlanDraft,
    SipPlanView,
    SipState,
    Slice,
    ValueSource,
)
from orbit_api.services.investments.quantities import (
    MAX_PRICE,
    MAX_QUANTITY,
    format_price,
    format_quantity,
    parse_price,
    parse_quantity,
    unit_price,
)
from orbit_api.utils.changes import UNSET

PAGE_MAX_SIZE = 200

ShortText = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=100), AfterValidator(single_line)
]
Code = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=40), AfterValidator(single_line)
]
Exchange = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_upper=True, max_length=20),
    AfterValidator(single_line),
]


def _isin(value: str) -> str:
    value = value.upper()
    if value and not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", value):
        raise ValueError("must be a 12-character ISIN, such as INE009A01021")
    return value


# Empty, or an ISIN: two letters, nine letters or digits, and a check digit.
Isin = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=12), AfterValidator(_isin)
]
HoldingName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    AfterValidator(single_line),
]
RateBps = Annotated[
    int,
    Strict(),
    Field(ge=0, le=10_000, description="Annual interest rate in basis points: 7.1% is 710."),
]
Charges = Annotated[int, Strict(), Field(ge=0, le=MAX_AMOUNT, description="Minor units.")]
Value = Annotated[int, Strict(), Field(ge=0, le=MAX_AMOUNT, description="Minor units.")]


def _quantity(value: str) -> str:
    scaled = parse_quantity(value)
    if not 0 < scaled <= MAX_QUANTITY:
        raise ValueError("must be more than 0 and at most 100 billion units")
    return value


def _price(value: str) -> str:
    scaled = parse_price(value)
    if not 0 < scaled <= MAX_PRICE:
        raise ValueError("must be more than 0 and at most 1 billion")
    return value


Quantity = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=24),
    AfterValidator(_quantity),
    Field(description="Units as a decimal string with up to 6 decimals, such as `12.345`."),
]
UnitPrice = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=24),
    AfterValidator(_price),
    Field(
        description="Per-unit price in the currency's major unit, as a decimal string with up "
        "to 6 decimals, such as `45.6789`."
    ),
]


def _require_fields(model: BaseModel, required: tuple[str, ...]) -> None:
    if not model.model_fields_set:
        raise ValueError("include at least one field to change")
    for name in required:
        if name in model.model_fields_set and getattr(model, name) is None:
            raise ValueError(f"{name} cannot be null")


def _change(model: BaseModel, name: str) -> Any:
    """A partial-update field: `UNSET` unless the client sent it."""
    return getattr(model, name) if name in model.model_fields_set else UNSET


def _settlement_check(settlement: Settlement, cash_account_id: uuid.UUID | None) -> None:
    if settlement == "account" and cash_account_id is None:
        raise ValueError("settlement `account` needs cash_account_id")
    if settlement != "account" and cash_account_id is not None:
        raise ValueError("cash_account_id is only for settlement `account`")


# Investment accounts


class InvestmentAccountResponse(BaseModel):
    account_id: uuid.UUID = Field(description="The finance account (type `investment`).")
    workspace_id: uuid.UUID
    name: str
    currency: Currency
    kind: InvestmentAccountKind
    provider: str
    linked_account_id: uuid.UUID | None = Field(
        description="The account money usually comes from and returns to."
    )
    notes: str
    archived: bool
    ledger_balance: int = Field(
        description="The finance account's balance: money moved in, plus income, minus fees "
        "and money moved out. Includes what was spent on holdings and deposits."
    )
    cash: int = Field(description="Uninvested cash: the ledger balance net of positions.")
    holdings_value: int
    deposits_value: int
    value: int = Field(description="`cash + holdings_value + deposits_value`.")
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, view: InvestmentAccountView) -> "InvestmentAccountResponse":
        return cls(
            account_id=view.account.id,
            workspace_id=view.account.workspace_id,
            name=view.account.name,
            currency=view.account.currency,
            kind=view.profile.kind,
            provider=view.profile.provider,
            linked_account_id=view.profile.linked_account_id,
            notes=view.account.notes,
            archived=view.account.archived_at is not None,
            ledger_balance=view.ledger_balance,
            cash=view.cash,
            holdings_value=view.holdings_value,
            deposits_value=view.deposits_value,
            value=view.value,
            created_at=view.profile.created_at,
            updated_at=view.profile.updated_at,
        )


class InvestmentAccountListResponse(BaseModel):
    accounts: list[InvestmentAccountResponse]


class CreateInvestmentAccountRequest(BaseModel):
    """Track investments in an account: give `account_id` to use an existing finance account of
    type `investment` (its history carries over), or `name` and `currency` for a new one."""

    model_config = ConfigDict(extra="forbid")

    kind: InvestmentAccountKind
    provider: ShortText = Field(default="", description="The platform, broker, or bank.")
    linked_account_id: uuid.UUID | None = None
    account_id: uuid.UUID | None = None
    name: Name | None = None
    currency: Currency = DEFAULT_CURRENCY
    notes: Notes = ""

    @model_validator(mode="after")
    def _check(self) -> Self:
        if (self.account_id is None) == (self.name is None):
            raise ValueError("give either account_id (an existing account) or name (a new one)")
        return self

    def to_draft(self) -> InvestmentAccountDraft:
        return InvestmentAccountDraft(
            kind=self.kind,
            provider=self.provider,
            linked_account_id=self.linked_account_id,
            account_id=self.account_id,
            name=self.name,
            currency=self.currency if self.account_id is None else None,
            notes=self.notes,
        )


class UpdateInvestmentAccountRequest(BaseModel):
    """`null` clears `linked_account_id`. `archived` archives or restores the finance account."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    kind: InvestmentAccountKind | None = None
    provider: ShortText | None = None
    linked_account_id: uuid.UUID | None = None
    notes: Notes | None = None
    archived: bool | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        _require_fields(self, ("name", "kind", "provider", "notes", "archived"))
        return self

    def to_changes(self) -> InvestmentAccountChanges:
        return InvestmentAccountChanges(
            name=_change(self, "name"),
            kind=_change(self, "kind"),
            provider=_change(self, "provider"),
            linked_account_id=_change(self, "linked_account_id"),
            notes=_change(self, "notes"),
            archived=_change(self, "archived"),
        )


# Holdings and prices


class PriceResponse(BaseModel):
    id: uuid.UUID
    holding_id: uuid.UUID
    price_date: date
    price: str = Field(description="Per-unit price in the major unit, as a decimal string.")
    source: PriceSource = Field(description="`manual` today; others are reserved for imports.")
    created_at: datetime

    @classmethod
    def of(cls, price: Price) -> "PriceResponse":
        return cls(
            id=price.id,
            holding_id=price.holding_id,
            price_date=price.price_date,
            price=format_price(price.price),
            source=price.source,
            created_at=price.created_at,
        )


class HoldingResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    account_id: uuid.UUID
    currency: Currency
    kind: HoldingKind
    name: str
    symbol: str = Field(description="A ticker, or a mutual fund's scheme code.")
    exchange: str
    isin: str
    issuer: str = Field(description="The AMC or fund house for mutual funds.")
    category: str = Field(description="The scheme category, such as Flexi cap.")
    folio: str
    notes: str
    quantity: str = Field(description="Units held, from the transactions (FIFO).")
    cost: int = Field(description="Cost basis of the units held (FIFO), excluding fees.")
    average_cost: str | None = Field(description="`cost / quantity` per unit; `null` if none.")
    invested_total: int = Field(description="Everything ever paid for buys.")
    price: PriceResponse | None = Field(description="The latest price on or before today.")
    market_value: int | None = Field(description="`quantity * price`; `null` without a price.")
    value: int = Field(description="`market_value`, or `cost` when there is no price.")
    unrealized_gain: int | None
    realized_gain: int
    dividends: int
    fees: int
    freshness: Freshness = Field(
        description="`current`; `stale` when the price is over 7 days old; `missing` without a "
        "price (valued at cost)."
    )
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, view: HoldingView) -> "HoldingResponse":
        holding = view.holding
        return cls(
            id=holding.id,
            workspace_id=holding.workspace_id,
            account_id=holding.account_id,
            currency=holding.currency,
            kind=holding.kind,
            name=holding.name,
            symbol=holding.symbol,
            exchange=holding.exchange,
            isin=holding.isin,
            issuer=holding.issuer,
            category=holding.category,
            folio=holding.folio,
            notes=holding.notes,
            quantity=format_quantity(view.quantity),
            cost=view.cost,
            average_cost=format_price(view.average_cost) if view.average_cost is not None else None,
            invested_total=view.bought,
            price=PriceResponse.of(view.price) if view.price else None,
            market_value=view.market_value,
            value=view.value,
            unrealized_gain=view.unrealized,
            realized_gain=view.realized,
            dividends=view.dividends,
            fees=view.fees,
            freshness=view.freshness,
            created_at=holding.created_at,
            updated_at=holding.updated_at,
        )


class HoldingListResponse(BaseModel):
    holdings: list[HoldingResponse] = Field(description="By name.")


class CreateHoldingRequest(BaseModel):
    """Add a mutual fund, stock, or ETF to an investment account. Units come from its buys; one
    bought before Orbit is recorded as a buy with settlement `none`."""

    model_config = ConfigDict(extra="forbid")

    account_id: uuid.UUID
    kind: HoldingKind
    name: HoldingName
    symbol: Code = ""
    exchange: Exchange = ""
    isin: Isin = ""
    issuer: ShortText = ""
    category: ShortText = ""
    folio: Code = ""
    notes: Notes = ""

    def to_draft(self) -> HoldingDraft:
        return HoldingDraft(
            account_id=self.account_id,
            kind=self.kind,
            name=self.name,
            symbol=self.symbol,
            exchange=self.exchange,
            isin=self.isin,
            issuer=self.issuer,
            category=self.category,
            folio=self.folio,
            notes=self.notes,
        )


class UpdateHoldingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: HoldingName | None = None
    symbol: Code | None = None
    exchange: Exchange | None = None
    isin: Isin | None = None
    issuer: ShortText | None = None
    category: ShortText | None = None
    folio: Code | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        _require_fields(self, tuple(type(self).model_fields))
        return self

    def to_changes(self) -> HoldingChanges:
        return HoldingChanges(**{name: _change(self, name) for name in type(self).model_fields})


class RecordPriceRequest(BaseModel):
    """Record a price (NAV or market price) by hand. A price already on that date is replaced."""

    model_config = ConfigDict(extra="forbid")

    price_date: TransactionDate
    price: UnitPrice


class PriceListResponse(BaseModel):
    prices: list[PriceResponse] = Field(description="Newest first.")


# Transactions


class InvestmentTransactionResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    account_id: uuid.UUID
    currency: Currency
    type: InvestmentTransactionType
    trade_date: date
    amount: int = Field(
        description="Buy: cost. Sell: gross proceeds. Dividend, interest: income. Fee: the "
        "charge. Deposit, withdrawal: the money moved."
    )
    fees: int = Field(description="Charges on a buy or sale, recorded as a ledger expense.")
    holding_id: uuid.UUID | None
    deposit_id: uuid.UUID | None
    sip_plan_id: uuid.UUID | None
    sip_due_date: date | None
    quantity: str | None
    unit_price: str | None = Field(description="`amount / quantity` for buys and sales.")
    plan: BuyPlan | None
    settlement: Settlement
    cash_account_id: uuid.UUID | None
    cash_transaction_id: uuid.UUID | None = Field(
        description="The ledger transaction recording its cash: a transfer, income, or expense."
    )
    fee_transaction_id: uuid.UUID | None
    notes: str
    created_at: datetime

    @classmethod
    def of(cls, entry: InvestmentTransaction) -> "InvestmentTransactionResponse":
        return cls(
            id=entry.id,
            workspace_id=entry.workspace_id,
            account_id=entry.account_id,
            currency=entry.currency,
            type=entry.type,
            trade_date=entry.trade_date,
            amount=entry.amount,
            fees=entry.fees,
            holding_id=entry.holding_id,
            deposit_id=entry.deposit_id,
            sip_plan_id=entry.sip_plan_id,
            sip_due_date=entry.sip_due_date,
            quantity=format_quantity(entry.quantity) if entry.quantity else None,
            unit_price=format_price(unit_price(entry.amount, entry.quantity, entry.currency))
            if entry.quantity
            else None,
            plan=entry.plan,
            settlement=entry.settlement,
            cash_account_id=entry.cash_account_id,
            cash_transaction_id=entry.cash_transaction_id,
            fee_transaction_id=entry.fee_transaction_id,
            notes=entry.notes,
            created_at=entry.created_at,
        )


class InvestmentTransactionListResponse(BaseModel):
    transactions: list[InvestmentTransactionResponse] = Field(description="Newest first.")
    total: int


class InvestmentTransactionParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: uuid.UUID | None = None
    holding_id: uuid.UUID | None = None
    deposit_id: uuid.UUID | None = None
    type: list[InvestmentTransactionType] = Field(
        default_factory=list[InvestmentTransactionType],
        description="Repeat to match any of several types. Omit for all.",
    )
    date_from: TransactionDate | None = None
    date_to: TransactionDate | None = None
    limit: int = Field(default=50, ge=1, le=PAGE_MAX_SIZE)
    offset: int = Field(default=0, ge=0)

    def to_query(self) -> InvestmentTransactionQuery:
        return InvestmentTransactionQuery(
            account_id=self.account_id,
            holding_id=self.holding_id,
            deposit_id=self.deposit_id,
            types=frozenset(self.type),
            date_from=self.date_from,
            date_to=self.date_to,
            limit=self.limit,
            offset=self.offset,
        )


class RecordInvestmentTransactionRequest(BaseModel):
    """Record a buy, sale, dividend, interest, fee, or deposit flow.

    `settlement` says where the money is: `investment_account` (its own cash), `account` (another
    account, `cash_account_id`; Orbit records the transfer, income, or expense there), or `none`
    (buys and deposits only: from outside Orbit, such as a holding bought before it was tracked).
    Dividends and interest are income; fees and `fees` on trades are expenses; buys and sales
    are never income or spending.
    """

    model_config = ConfigDict(extra="forbid")

    type: InvestmentTransactionType
    trade_date: TransactionDate
    amount: Amount
    settlement: Settlement = "investment_account"
    cash_account_id: uuid.UUID | None = None
    holding_id: uuid.UUID | None = None
    deposit_id: uuid.UUID | None = None
    account_id: uuid.UUID | None = Field(
        default=None,
        description="The investment account, for interest or fees not tied to a holding or "
        "deposit.",
    )
    quantity: Quantity | None = None
    fees: Charges = 0
    plan: BuyPlan | None = Field(default=None, description="Buys only; defaults to `lump_sum`.")
    sip_plan_id: uuid.UUID | None = Field(
        default=None, description="Records this buy as an installment of that SIP."
    )
    sip_due_date: TransactionDate | None = Field(
        default=None, description="The SIP date it settles; defaults to the next unrecorded one."
    )
    notes: Notes = ""

    @model_validator(mode="after")
    def _check(self) -> Self:
        _settlement_check(self.settlement, self.cash_account_id)
        return self

    def to_draft(self) -> InvestmentTransactionDraft:
        return InvestmentTransactionDraft(
            type=self.type,
            trade_date=self.trade_date,
            amount=self.amount,
            settlement=self.settlement,
            cash_account_id=self.cash_account_id,
            holding_id=self.holding_id,
            deposit_id=self.deposit_id,
            account_id=self.account_id,
            quantity=parse_quantity(self.quantity) if self.quantity else None,
            fees=self.fees,
            plan=self.plan,
            sip_plan_id=self.sip_plan_id,
            sip_due_date=self.sip_due_date,
            notes=self.notes,
        )


class DeleteInvestmentTransactionParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    delete_ledger: bool = Field(
        default=False,
        description="Also delete the ledger transactions it recorded. Otherwise they stay as "
        "ordinary transfers, income, or expenses.",
    )


# SIP plans


class SipPlanResponse(BaseModel):
    id: uuid.UUID
    holding_id: uuid.UUID
    currency: Currency
    amount: int
    frequency: Frequency
    end_date: date | None
    funding_account_id: uuid.UUID | None
    state: SipState
    notes: str
    next_due_date: date | None = Field(
        description="The first due date with no buy recorded; before today means overdue. "
        "Scheduled SIPs are not investments until a buy is recorded."
    )
    installments: int = Field(description="Buys recorded against this SIP.")
    invested: int
    last_bought_on: date | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, view: SipPlanView) -> "SipPlanResponse":
        plan = view.plan
        return cls(
            id=plan.id,
            holding_id=plan.holding_id,
            currency=plan.currency,
            amount=plan.amount,
            frequency=plan.frequency,
            end_date=plan.end_date,
            funding_account_id=plan.funding_account_id,
            state=plan.state,
            notes=plan.notes,
            next_due_date=view.next_due_date,
            installments=view.installments,
            invested=view.invested,
            last_bought_on=view.last_bought_on,
            created_at=plan.created_at,
            updated_at=plan.updated_at,
        )


class SipPlanListResponse(BaseModel):
    plans: list[SipPlanResponse]


class CreateSipPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    holding_id: uuid.UUID
    amount: Amount
    frequency: Frequency = "monthly"
    next_due_date: TransactionDate
    end_date: TransactionDate | None = None
    funding_account_id: uuid.UUID | None = None
    notes: Notes = ""

    def to_draft(self) -> SipPlanDraft:
        return SipPlanDraft(
            holding_id=self.holding_id,
            amount=self.amount,
            frequency=self.frequency,
            next_due_date=self.next_due_date,
            end_date=self.end_date,
            funding_account_id=self.funding_account_id,
            notes=self.notes,
        )


class UpdateSipPlanRequest(BaseModel):
    """`state` pauses, cancels, or resumes (`active`) the SIP. `null` clears `end_date` or
    `funding_account_id`."""

    model_config = ConfigDict(extra="forbid")

    amount: Amount | None = None
    frequency: Frequency | None = None
    next_due_date: TransactionDate | None = None
    end_date: TransactionDate | None = None
    funding_account_id: uuid.UUID | None = None
    state: SipState | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        _require_fields(self, ("amount", "frequency", "next_due_date", "state", "notes"))
        return self

    def to_changes(self) -> SipPlanChanges:
        return SipPlanChanges(**{name: _change(self, name) for name in type(self).model_fields})


class RecordSipInstallmentRequest(BaseModel):
    """Record one SIP installment as a buy. Amount defaults to the SIP's; the funding account,
    when the SIP has one, settles it."""

    model_config = ConfigDict(extra="forbid")

    trade_date: TransactionDate
    quantity: Quantity
    amount: Amount | None = None
    due_date: TransactionDate | None = Field(
        default=None, description="The SIP date it settles; defaults to the next unrecorded one."
    )
    settlement: Settlement | None = Field(
        default=None,
        description="Defaults to `account` with the SIP's funding account, else "
        "`investment_account`.",
    )
    cash_account_id: uuid.UUID | None = None
    fees: Charges = 0
    notes: Notes = ""


# Deposits


class DepositResponse(BaseModel):
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
    installment_amount: int | None = Field(description="A recurring deposit's installment.")
    stated_maturity_amount: int | None = Field(
        description="The maturity amount the bank stated, if entered."
    )
    status: DepositStatus = Field(
        description="`active`; `matured` (closed on or after maturity); `closed` (early)."
    )
    closed_on: date | None
    principal: int = Field(description="Money deposited minus principal withdrawn.")
    interest_received: int
    estimated_value: int = Field(
        description="Accrued value estimated from the rate and compounding. An estimate, not a "
        "guarantee."
    )
    value: int
    valued_on: date
    value_source: ValueSource = Field(
        description="`estimate`, `manual` (entered by hand), or `ledger` once closed."
    )
    freshness: Freshness
    manual_value: int | None
    manual_valued_on: date | None
    projected_maturity_amount: int = Field(
        description="Estimated from the terms; a recurring deposit assumes every installment is "
        "paid on time."
    )
    projected_interest: int
    projected_contributions: int
    reminder: ReminderSettingsResponse | None
    notes: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, view: DepositView) -> "DepositResponse":
        deposit = view.deposit
        return cls(
            id=deposit.id,
            workspace_id=deposit.workspace_id,
            account_id=deposit.account_id,
            currency=deposit.currency,
            kind=deposit.kind,
            name=deposit.name,
            institution=deposit.institution,
            interest_rate_bps=deposit.interest_rate_bps,
            compounding=deposit.compounding,
            start_date=deposit.start_date,
            maturity_date=deposit.maturity_date,
            installment_amount=deposit.installment_amount,
            stated_maturity_amount=deposit.stated_maturity_amount,
            status=deposit.status,
            closed_on=deposit.closed_on,
            principal=view.principal,
            interest_received=view.interest_received,
            estimated_value=view.estimated_value,
            value=view.value,
            valued_on=view.valued_on,
            value_source=view.source,
            freshness=view.freshness,
            manual_value=deposit.manual_value,
            manual_valued_on=deposit.manual_valued_on,
            projected_maturity_amount=view.projected_maturity_amount,
            projected_interest=view.projected_interest,
            projected_contributions=view.projected_contributions,
            reminder=ReminderSettingsResponse.of(deposit.reminder),
            notes=deposit.notes,
            created_at=deposit.created_at,
            updated_at=deposit.updated_at,
        )


class DepositListResponse(BaseModel):
    deposits: list[DepositResponse] = Field(description="Active first, then by maturity date.")


class CreateDepositRequest(BaseModel):
    """Open a fixed deposit (`amount`: the principal) or a recurring deposit (`amount`: the
    monthly installment). The first deposit is recorded on `start_date`, settled as given."""

    model_config = ConfigDict(extra="forbid")

    account_id: uuid.UUID
    kind: DepositKind
    name: Name
    institution: ShortText = ""
    interest_rate_bps: RateBps
    compounding: Compounding = "quarterly"
    start_date: TransactionDate
    maturity_date: TransactionDate
    amount: Amount
    settlement: Settlement = "account"
    cash_account_id: uuid.UUID | None = None
    stated_maturity_amount: Amount | None = None
    notes: Notes = ""
    reminder: ReminderSettingsRequest | None = Field(
        default=None, description="Remind before the maturity date."
    )

    @model_validator(mode="after")
    def _check(self) -> Self:
        _settlement_check(self.settlement, self.cash_account_id)
        if self.maturity_date <= self.start_date:
            raise ValueError("maturity_date must be after start_date")
        return self

    def to_draft(self, default_timezone: str | None) -> DepositDraft:
        return DepositDraft(
            account_id=self.account_id,
            kind=self.kind,
            name=self.name,
            interest_rate_bps=self.interest_rate_bps,
            compounding=self.compounding,
            start_date=self.start_date,
            maturity_date=self.maturity_date,
            amount=self.amount,
            settlement=self.settlement,
            cash_account_id=self.cash_account_id,
            institution=self.institution,
            stated_maturity_amount=self.stated_maturity_amount,
            notes=self.notes,
            reminder=self.reminder.to_settings(default_timezone) if self.reminder else None,
        )


class UpdateDepositRequest(BaseModel):
    """`null` clears `stated_maturity_amount` or `reminder`."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    institution: ShortText | None = None
    interest_rate_bps: RateBps | None = None
    compounding: Compounding | None = None
    maturity_date: TransactionDate | None = None
    installment_amount: Amount | None = None
    stated_maturity_amount: Amount | None = None
    notes: Notes | None = None
    reminder: ReminderSettingsRequest | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        _require_fields(
            self,
            (
                "name",
                "institution",
                "interest_rate_bps",
                "compounding",
                "maturity_date",
                "installment_amount",
                "notes",
            ),
        )
        return self

    def to_changes(self, default_timezone: str | None) -> DepositChanges:
        provided = self.model_fields_set
        fields = {
            name: _change(self, name) for name in type(self).model_fields if name != "reminder"
        }
        reminder = (
            (self.reminder.to_settings(default_timezone) if self.reminder else None)
            if "reminder" in provided
            else UNSET
        )
        return DepositChanges(**fields, reminder=reminder)


class DepositContributionRequest(BaseModel):
    """Record money put into the deposit: a recurring deposit's installment or a top-up."""

    model_config = ConfigDict(extra="forbid")

    trade_date: TransactionDate
    amount: Amount
    settlement: Settlement = "account"
    cash_account_id: uuid.UUID | None = None
    notes: Notes = ""

    @model_validator(mode="after")
    def _check(self) -> Self:
        _settlement_check(self.settlement, self.cash_account_id)
        return self


class DepositValueRequest(BaseModel):
    """Set the deposit's value by hand (it replaces the estimate), or `value: null` to clear."""

    model_config = ConfigDict(extra="forbid")

    value: Value | None
    valued_on: TransactionDate | None = None


class CloseDepositRequest(BaseModel):
    """Close at maturity or early. `amount` is everything received: above the principal is
    interest income; below it, a loss."""

    model_config = ConfigDict(extra="forbid")

    closed_on: TransactionDate
    amount: Value
    settlement: Literal["investment_account", "account"] = "account"
    cash_account_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        _settlement_check(self.settlement, self.cash_account_id)
        return self

    def to_closure(self) -> DepositClosure:
        return DepositClosure(
            closed_on=self.closed_on,
            amount=self.amount,
            settlement=self.settlement,
            cash_account_id=self.cash_account_id,
        )


# Portfolio


class SliceResponse(BaseModel):
    key: str
    label: str
    value: int

    @classmethod
    def of(cls, entry: Slice) -> "SliceResponse":
        return cls(key=entry.key, label=entry.label, value=entry.value)


class PortfolioResponse(BaseModel):
    currency: Currency
    date_from: date | None
    date_to: date | None
    invested: int = Field(description="Cost of what is held now: FIFO cost plus deposits.")
    current_value: int
    cash: int = Field(description="Uninvested cash in investment accounts.")
    unrealized_gain: int = Field(description="Market value minus cost, for priced holdings.")
    realized_gain: int = Field(description="FIFO gains on sales in the date range.")
    income: int = Field(description="Dividends and interest in the date range.")
    fees: int = Field(description="Charges in the date range.")
    total_return: int = Field(description="`unrealized + realized + income - fees`.")
    return_percent: str | None = Field(
        description="`total_return` over everything ever invested, as a percentage with two "
        "decimals. Simple, not annualized; for display only."
    )
    allocation: list[SliceResponse] = Field(description="By asset class, largest first.")
    categories: list[SliceResponse] = Field(description="By scheme category, largest first.")
    missing_prices: int
    stale_prices: int

    @classmethod
    def of(
        cls, summary: PortfolioSummary, date_from: date | None, date_to: date | None
    ) -> "PortfolioResponse":
        return cls(
            currency=summary.currency,
            date_from=date_from,
            date_to=date_to,
            invested=summary.invested,
            current_value=summary.current_value,
            cash=summary.cash,
            unrealized_gain=summary.unrealized,
            realized_gain=summary.realized,
            income=summary.income,
            fees=summary.fees,
            total_return=summary.total_return,
            return_percent=summary.return_percent,
            allocation=[SliceResponse.of(entry) for entry in summary.allocation],
            categories=[SliceResponse.of(entry) for entry in summary.categories],
            missing_prices=summary.missing_prices,
            stale_prices=summary.stale_prices,
        )


class PortfolioParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: Currency = DEFAULT_CURRENCY
    today: TransactionDate | None = None
    date_from: TransactionDate | None = None
    date_to: TransactionDate | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from must be on or before date_to")
        return self
