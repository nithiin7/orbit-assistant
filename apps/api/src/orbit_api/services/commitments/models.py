"""Financial commitment types: loans with their EMI schedules, and recurring payments
(subscriptions and bills) with their settled occurrences.

Amounts are integers in the currency's minor unit, like everywhere in finance. Dates are
calendar dates in the user's own time zone.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Literal

from orbit_api.services.commitments.schedule import EmiFrequency, Frequency, InterestMethod
from orbit_api.services.finance.money import Currency
from orbit_api.utils.changes import UNSET, Change

LoanType = Literal["personal", "vehicle", "home", "education", "other"]
LoanStatus = Literal["active", "closed", "archived"]
# Stored: `scheduled` until the installment is paid or deliberately skipped.
InstallmentState = Literal["scheduled", "paid", "skipped"]

RecurringKind = Literal["subscription", "bill"]
# Stored. `expired` is derived (see `RecurringView.status`).
RecurringState = Literal["active", "paused", "cancelled"]
RecurringStatus = Literal["active", "paused", "cancelled", "expired"]
# A settled occurrence; unsettled ones are computed from the schedule and never stored.
SettledState = Literal["paid", "skipped"]

# What a payment occurrence looks like on a given day: settled ones keep their state; unsettled
# ones are `overdue` before today, `due` today, and `upcoming` after.
PaymentStatus = Literal["upcoming", "due", "overdue", "paid", "skipped"]
CommitmentKind = Literal["loan", "subscription", "bill"]


def payment_status(
    state: InstallmentState | SettledState | None, due: date, today: date
) -> PaymentStatus:
    if state == "paid" or state == "skipped":
        return state
    if due < today:
        return "overdue"
    return "due" if due == today else "upcoming"


@dataclass(frozen=True, slots=True)
class ReminderSettings:
    """When to remind about each payment: `days_before` its due date at `time_of_day` in
    `timezone`."""

    days_before: int
    time_of_day: time
    timezone: str


# Loans


@dataclass(frozen=True, slots=True)
class Loan:
    id: uuid.UUID
    workspace_id: uuid.UUID
    # The `loan` liability account whose (derived) balance is the outstanding principal. Orbit
    # creates it with the loan.
    account_id: uuid.UUID
    # The account EMIs are usually paid from, offered first when recording a payment.
    payment_account_id: uuid.UUID | None
    name: str
    lender: str
    loan_type: LoanType
    currency: Currency
    # The amount originally borrowed.
    principal: int
    interest_rate_bps: int
    interest_method: InterestMethod
    start_date: date
    tenure_months: int
    emi_amount: int
    emi_frequency: EmiFrequency
    first_payment_date: date
    notes: str
    status: LoanStatus
    reminder: ReminderSettings | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class Installment:
    id: uuid.UUID
    workspace_id: uuid.UUID
    loan_id: uuid.UUID
    sequence: int
    due_date: date
    principal: int
    interest: int
    # The principal owed after this installment: projected while scheduled, actual once paid.
    balance_after: int
    state: InstallmentState
    paid_on: date | None
    principal_transaction_id: uuid.UUID | None
    interest_transaction_id: uuid.UUID | None
    # Edited by hand rather than generated.
    adjusted: bool
    created_at: datetime
    updated_at: datetime

    @property
    def amount(self) -> int:
        return self.principal + self.interest


@dataclass(frozen=True, slots=True)
class LoanView:
    loan: Loan
    # What the loan account's balance says is still owed: never stored, always from the ledger.
    outstanding: int
    next_installment: Installment | None
    paid_installments: int
    total_installments: int
    # Interest still scheduled (not yet paid) across the remaining installments.
    remaining_interest: int


@dataclass(frozen=True, slots=True)
class LoanDraft:
    name: str
    lender: str
    loan_type: LoanType
    currency: Currency
    principal: int
    interest_rate_bps: int
    interest_method: InterestMethod
    start_date: date
    tenure_months: int
    emi_frequency: EmiFrequency
    first_payment_date: date
    # `None`: the loan is new, so nothing is repaid yet.
    outstanding_principal: int | None = None
    # `None`: the first payment date. Later for a loan already being repaid.
    next_payment_date: date | None = None
    # `None`: the standard EMI for the terms.
    emi_amount: int | None = None
    payment_account_id: uuid.UUID | None = None
    notes: str = ""
    reminder: ReminderSettings | None = None


@dataclass(frozen=True, slots=True)
class LoanChanges:
    """A partial update of descriptive fields and status. Financial terms change through
    `RescheduleRequest`, which regenerates the remaining installments."""

    name: Change[str] = UNSET
    lender: Change[str] = UNSET
    loan_type: Change[LoanType] = UNSET
    payment_account_id: Change[uuid.UUID | None] = UNSET
    notes: Change[str] = UNSET
    status: Change[LoanStatus] = UNSET
    reminder: Change[ReminderSettings | None] = UNSET


@dataclass(frozen=True, slots=True)
class Reschedule:
    """Regenerate a loan's unpaid installments from its current outstanding principal, after a
    prepayment or a rate change. Omitted fields keep their current values; without a new EMI
    the number of remaining installments stays the same and the EMI is recomputed."""

    interest_rate_bps: int | None = None
    emi_amount: int | None = None
    next_payment_date: date | None = None


@dataclass(frozen=True, slots=True)
class InstallmentChanges:
    """A manual adjustment of a scheduled installment."""

    due_date: Change[date] = UNSET
    principal: Change[int] = UNSET
    interest: Change[int] = UNSET


@dataclass(frozen=True, slots=True)
class InstallmentPayment:
    """Record an installment as paid, either by creating its transactions from
    `from_account_id` or by linking transactions already recorded."""

    paid_on: date
    from_account_id: uuid.UUID | None = None
    # Create mode only: what was actually paid, defaulting to the scheduled split.
    principal: int | None = None
    interest: int | None = None
    # Link mode: a transfer into the loan account, and an expense.
    principal_transaction_id: uuid.UUID | None = None
    interest_transaction_id: uuid.UUID | None = None


# Recurring payments


@dataclass(frozen=True, slots=True)
class RecurringPayment:
    id: uuid.UUID
    workspace_id: uuid.UUID
    kind: RecurringKind
    name: str
    provider: str
    category_id: uuid.UUID | None
    # The account it's usually paid from, the default when recording a payment.
    account_id: uuid.UUID | None
    # The expected amount; an estimate when `amount_varies`.
    amount: int
    currency: Currency
    amount_varies: bool
    frequency: Frequency
    # When the subscription or bill began; informational.
    start_date: date
    # The first due date the schedule counts from. Moves when the schedule is changed or
    # resumed, never backwards over settled history.
    anchor_date: date
    end_date: date | None
    trial_ends_on: date | None
    auto_renew: bool
    state: RecurringState
    notes: str
    reminder: ReminderSettings | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class SettledOccurrence:
    id: uuid.UUID
    workspace_id: uuid.UUID
    recurring_payment_id: uuid.UUID
    due_date: date
    state: SettledState
    # What was paid; `None` for a skipped occurrence.
    amount: int | None
    paid_on: date | None
    transaction_id: uuid.UUID | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class RecurringView:
    payment: RecurringPayment
    status: RecurringStatus
    # The earliest unsettled due date, possibly overdue; `None` when nothing is expected.
    next_due_date: date | None
    overdue: int
    monthly_cost: int
    annual_cost: int
    last_paid_on: date | None


@dataclass(frozen=True, slots=True)
class RecurringDraft:
    kind: RecurringKind
    name: str
    amount: int
    currency: Currency
    frequency: Frequency
    start_date: date
    # The next date a payment is due; the schedule counts from here.
    next_due_date: date
    provider: str = ""
    category_id: uuid.UUID | None = None
    account_id: uuid.UUID | None = None
    amount_varies: bool = False
    end_date: date | None = None
    trial_ends_on: date | None = None
    auto_renew: bool = True
    notes: str = ""
    reminder: ReminderSettings | None = None


@dataclass(frozen=True, slots=True)
class RecurringChanges:
    """A partial update. Changing `frequency` or `next_due_date` restarts the schedule from the
    new next due date; settled history keeps its dates."""

    name: Change[str] = UNSET
    provider: Change[str] = UNSET
    category_id: Change[uuid.UUID | None] = UNSET
    account_id: Change[uuid.UUID | None] = UNSET
    amount: Change[int] = UNSET
    amount_varies: Change[bool] = UNSET
    frequency: Change[Frequency] = UNSET
    start_date: Change[date] = UNSET
    next_due_date: Change[date] = UNSET
    end_date: Change[date | None] = UNSET
    trial_ends_on: Change[date | None] = UNSET
    auto_renew: Change[bool] = UNSET
    state: Change[RecurringState] = UNSET
    notes: Change[str] = UNSET
    reminder: Change[ReminderSettings | None] = UNSET


@dataclass(frozen=True, slots=True)
class RecurringPaymentRecord:
    """Record one occurrence as paid. `mode` says where the money is accounted for:
    `create` records a new expense, `link` uses an expense already recorded, and `manual`
    marks it paid without a transaction (so it isn't counted as spending)."""

    due_date: date
    paid_on: date
    mode: Literal["create", "link", "manual"]
    amount: int | None = None
    account_id: uuid.UUID | None = None
    transaction_id: uuid.UUID | None = None


# The unified view


@dataclass(frozen=True, slots=True)
class PaymentItem:
    """One expected or settled payment of any commitment."""

    kind: CommitmentKind
    commitment_id: uuid.UUID
    # The installment or settled occurrence; `None` for an unsettled recurring occurrence,
    # which is computed rather than stored.
    occurrence_id: uuid.UUID | None
    name: str
    # The lender or provider.
    counterparty: str
    amount: int
    # True when the amount is an estimate: an unsettled bill whose amount varies.
    estimated: bool
    currency: Currency
    due_date: date
    status: PaymentStatus
    account_id: uuid.UUID | None
    paid_on: date | None
    transaction_ids: tuple[uuid.UUID, ...]
    # Loans only.
    principal: int | None = None
    interest: int | None = None


@dataclass(frozen=True, slots=True)
class PaymentQuery:
    today: date
    date_from: date
    date_to: date
    # Empty means every kind or status.
    kinds: frozenset[CommitmentKind] = frozenset()
    statuses: frozenset[PaymentStatus] = frozenset()
    # Also include unsettled payments that fell due before `date_from`.
    include_overdue: bool = True


@dataclass(frozen=True, slots=True)
class Total:
    count: int
    amount: int


@dataclass(frozen=True, slots=True)
class CommitmentSummary:
    """The dashboard's view of commitments in one currency."""

    currency: Currency
    loans_outstanding: int
    active_loans: int
    # Active loans' EMIs as a monthly average.
    monthly_emi: int
    monthly_subscriptions: int
    annual_subscriptions: int
    active_subscriptions: int
    # Unsettled bills due from today through the next 30 days.
    upcoming_bills: Total
    # Unsettled payments of any kind due from today to the end of the month.
    due_this_month: Total
    overdue: Total


# Errors


class LoanNotFoundError(Exception):
    """The loan does not exist in this workspace."""


class InstallmentNotFoundError(Exception):
    """The installment does not exist on this loan."""


class RecurringPaymentNotFoundError(Exception):
    """The subscription or bill does not exist in this workspace."""


class OccurrenceNotFoundError(Exception):
    """The settled occurrence does not exist on this subscription or bill."""


class InvalidCommitmentError(Exception):
    """The request breaks a rule. The message is written for the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class PaymentConflictError(Exception):
    """The payment was already recorded, or a transaction already pays something else. The
    message is written for the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
