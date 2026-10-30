"""Financial commitment models: loans and EMI schedules, subscriptions and bills, payments, the
upcoming-payments view, and the dashboard summary.

Amounts are integers in the currency's minor unit, like the rest of finance, and must be JSON
integers. Interest rates are integer basis points: 8.5% a year is `850`.
"""

import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    Strict,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import Name, TimeZoneName, single_line
from orbit_api.schemas.finance import Amount, Notes, TransactionDate
from orbit_api.services.commitments.models import (
    CommitmentKind,
    CommitmentSummary,
    Installment,
    InstallmentChanges,
    InstallmentPayment,
    InstallmentState,
    LoanChanges,
    LoanDraft,
    LoanStatus,
    LoanType,
    LoanView,
    PaymentItem,
    PaymentStatus,
    RecurringChanges,
    RecurringDraft,
    RecurringKind,
    RecurringPaymentRecord,
    RecurringState,
    RecurringStatus,
    RecurringView,
    ReminderSettings,
    Reschedule,
    SettledOccurrence,
    SettledState,
    Total,
    payment_status,
)
from orbit_api.services.commitments.schedule import (
    MAX_INSTALLMENTS,
    EmiFrequency,
    Frequency,
    InterestMethod,
)
from orbit_api.services.finance.money import DEFAULT_CURRENCY, MAX_AMOUNT, Currency
from orbit_api.utils.changes import UNSET

DEFAULT_REMINDER_TIME = time(9, 0)
PAYMENT_RANGE_MAX_DAYS = 400

# Text such as a lender or provider name; may be empty.
Counterparty = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=100),
    AfterValidator(single_line),
]
RateBps = Annotated[
    int,
    Strict(),
    Field(ge=0, le=10_000, description="Annual interest rate in basis points: 8.5% is 850."),
]
Tenure = Annotated[
    int, Strict(), Field(ge=1, le=MAX_INSTALLMENTS * 12, description="The loan's term in months.")
]
# Principal or interest of one installment, which may be zero.
Component = Annotated[int, Strict(), Field(ge=0, le=MAX_AMOUNT)]


def _whole_minutes(value: time) -> time:
    if value.second or value.microsecond or value.tzinfo is not None:
        raise ValueError("must be a whole minute without a time zone offset, such as 09:00")
    return value


ReminderTime = Annotated[time, AfterValidator(_whole_minutes)]


def _require_fields(model: BaseModel, required: tuple[str, ...]) -> None:
    if not model.model_fields_set:
        raise ValueError("include at least one field to change")
    for name in required:
        if name in model.model_fields_set and getattr(model, name) is None:
            raise ValueError(f"{name} cannot be null")


# Reminders


class ReminderSettingsRequest(BaseModel):
    """Remind about each payment `days_before` its due date, at `time_of_day`."""

    model_config = ConfigDict(extra="forbid")

    days_before: int = Field(ge=0, le=30, description="0 reminds on the due date itself.")
    time_of_day: ReminderTime = DEFAULT_REMINDER_TIME
    timezone: TimeZoneName | None = Field(
        default=None, description="Defaults to your time zone preference, else UTC."
    )

    def to_settings(self, default_timezone: str | None) -> ReminderSettings:
        return ReminderSettings(
            days_before=self.days_before,
            time_of_day=self.time_of_day,
            timezone=self.timezone or default_timezone or "UTC",
        )


class ReminderSettingsResponse(BaseModel):
    days_before: int
    time_of_day: time
    timezone: str

    @classmethod
    def of(cls, settings: ReminderSettings | None) -> "ReminderSettingsResponse | None":
        if settings is None:
            return None
        return cls(
            days_before=settings.days_before,
            time_of_day=settings.time_of_day,
            timezone=settings.timezone,
        )


def _reminder(
    request: ReminderSettingsRequest | None, default_timezone: str | None
) -> ReminderSettings | None:
    return request.to_settings(default_timezone) if request else None


# Loans


class InstallmentResponse(BaseModel):
    id: uuid.UUID
    loan_id: uuid.UUID
    sequence: int = Field(description="The installment's number within the loan's tenure.")
    due_date: date
    amount: int = Field(description="`principal` plus `interest`.")
    principal: int = Field(description="Repays the loan: a transfer, never spending.")
    interest: int = Field(description="The cost of borrowing: an expense.")
    balance_after: int = Field(
        description="Principal still owed after this installment: projected from the ledger "
        "while scheduled, as recorded once paid."
    )
    state: InstallmentState
    status: PaymentStatus = Field(description="`state` as of `today`: upcoming, due, or overdue.")
    paid_on: date | None
    principal_transaction_id: uuid.UUID | None
    interest_transaction_id: uuid.UUID | None
    adjusted: bool = Field(description="Edited by hand rather than generated.")
    updated_at: datetime

    @classmethod
    def of(cls, installment: Installment, today: date) -> "InstallmentResponse":
        return cls(
            id=installment.id,
            loan_id=installment.loan_id,
            sequence=installment.sequence,
            due_date=installment.due_date,
            amount=installment.amount,
            principal=installment.principal,
            interest=installment.interest,
            balance_after=installment.balance_after,
            state=installment.state,
            status=payment_status(installment.state, installment.due_date, today),
            paid_on=installment.paid_on,
            principal_transaction_id=installment.principal_transaction_id,
            interest_transaction_id=installment.interest_transaction_id,
            adjusted=installment.adjusted,
            updated_at=installment.updated_at,
        )


class LoanResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    account_id: uuid.UUID = Field(
        description="The loan's liability account. Its balance is the outstanding principal."
    )
    payment_account_id: uuid.UUID | None = Field(
        description="The account EMIs are usually paid from."
    )
    name: str
    lender: str
    loan_type: LoanType
    currency: Currency
    principal: int = Field(description="The amount originally borrowed.")
    outstanding_principal: int = Field(
        description="What the loan account's balance says is still owed, derived from the "
        "ledger. Never stored."
    )
    repaid_principal: int = Field(description="`principal` minus `outstanding_principal`.")
    interest_rate_bps: int
    interest_method: InterestMethod
    start_date: date
    tenure_months: int
    emi_amount: int
    emi_frequency: EmiFrequency
    first_payment_date: date
    next_payment_date: date | None = Field(description="The earliest scheduled installment.")
    next_payment_amount: int | None
    paid_installments: int
    total_installments: int = Field(
        description="Installments Orbit tracks: those still ahead when the loan was added, "
        "plus any added by rescheduling."
    )
    remaining_interest: int = Field(description="Interest on the scheduled installments.")
    notes: str
    status: LoanStatus
    reminder: ReminderSettingsResponse | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, view: LoanView) -> "LoanResponse":
        loan = view.loan
        upcoming = view.next_installment
        return cls(
            id=loan.id,
            workspace_id=loan.workspace_id,
            account_id=loan.account_id,
            payment_account_id=loan.payment_account_id,
            name=loan.name,
            lender=loan.lender,
            loan_type=loan.loan_type,
            currency=loan.currency,
            principal=loan.principal,
            outstanding_principal=view.outstanding,
            repaid_principal=loan.principal - view.outstanding,
            interest_rate_bps=loan.interest_rate_bps,
            interest_method=loan.interest_method,
            start_date=loan.start_date,
            tenure_months=loan.tenure_months,
            emi_amount=loan.emi_amount,
            emi_frequency=loan.emi_frequency,
            first_payment_date=loan.first_payment_date,
            next_payment_date=upcoming.due_date if upcoming else None,
            next_payment_amount=upcoming.amount if upcoming else None,
            paid_installments=view.paid_installments,
            total_installments=view.total_installments,
            remaining_interest=view.remaining_interest,
            notes=loan.notes,
            status=loan.status,
            reminder=ReminderSettingsResponse.of(loan.reminder),
            created_at=loan.created_at,
            updated_at=loan.updated_at,
        )


class LoanListResponse(BaseModel):
    loans: list[LoanResponse] = Field(
        description="Active first, then closed, then archived, each by name."
    )


class LoanDetailResponse(BaseModel):
    loan: LoanResponse
    installments: list[InstallmentResponse] = Field(description="By due date.")


class CreateLoanRequest(BaseModel):
    """Track a loan. Orbit creates a `loan` account for it whose opening balance is the
    outstanding principal (owed), and generates the installments still ahead."""

    model_config = ConfigDict(extra="forbid")

    name: Name
    lender: Counterparty = ""
    loan_type: LoanType
    currency: Currency = DEFAULT_CURRENCY
    principal: Amount = Field(description="The amount originally borrowed.")
    outstanding_principal: Amount | None = Field(
        default=None,
        description="For a loan already being repaid: what is still owed. Defaults to `principal`.",
    )
    interest_rate_bps: RateBps
    interest_method: InterestMethod = Field(
        default="reducing",
        description="`reducing`: interest on the outstanding balance (most loans). `flat`: "
        "interest on the original principal for the whole tenure.",
    )
    start_date: TransactionDate
    tenure_months: Tenure
    emi_frequency: EmiFrequency = "monthly"
    first_payment_date: TransactionDate
    next_payment_date: TransactionDate | None = Field(
        default=None,
        description="For a loan already being repaid: the next installment's date. Defaults to "
        "`first_payment_date`.",
    )
    emi_amount: Amount | None = Field(
        default=None, description="The lender's EMI. Defaults to the standard EMI for the terms."
    )
    payment_account_id: uuid.UUID | None = None
    notes: Notes = ""
    reminder: ReminderSettingsRequest | None = None

    def to_draft(self, default_timezone: str | None) -> LoanDraft:
        return LoanDraft(
            name=self.name,
            lender=self.lender,
            loan_type=self.loan_type,
            currency=self.currency,
            principal=self.principal,
            outstanding_principal=self.outstanding_principal,
            interest_rate_bps=self.interest_rate_bps,
            interest_method=self.interest_method,
            start_date=self.start_date,
            tenure_months=self.tenure_months,
            emi_frequency=self.emi_frequency,
            first_payment_date=self.first_payment_date,
            next_payment_date=self.next_payment_date,
            emi_amount=self.emi_amount,
            payment_account_id=self.payment_account_id,
            notes=self.notes,
            reminder=_reminder(self.reminder, default_timezone),
        )


class UpdateLoanRequest(BaseModel):
    """Change a loan's details or status. `payment_account_id: null` and `reminder: null`
    clear them. Rate and EMI changes go through `/reschedule`."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    lender: Counterparty | None = None
    loan_type: LoanType | None = None
    payment_account_id: uuid.UUID | None = None
    notes: Notes | None = None
    status: LoanStatus | None = Field(
        default=None,
        description="`closed` when repaid or foreclosed, `archived` to hide it. Either stops "
        "expecting its scheduled installments; `active` resumes them.",
    )
    reminder: ReminderSettingsRequest | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        _require_fields(self, ("name", "lender", "loan_type", "notes", "status"))
        return self

    def to_changes(self, default_timezone: str | None) -> LoanChanges:
        provided = self.model_fields_set
        return LoanChanges(
            name=self.name if self.name is not None else UNSET,
            lender=self.lender if self.lender is not None else UNSET,
            loan_type=self.loan_type if self.loan_type is not None else UNSET,
            payment_account_id=self.payment_account_id
            if "payment_account_id" in provided
            else UNSET,
            notes=self.notes if self.notes is not None else UNSET,
            status=self.status if self.status is not None else UNSET,
            reminder=_reminder(self.reminder, default_timezone)
            if "reminder" in provided
            else UNSET,
        )


class RescheduleLoanRequest(BaseModel):
    """Regenerate the unpaid installments from what is still owed, after a prepayment (a
    transfer into the loan account) or a rate change. Without `emi_amount` the number of
    installments stays the same and the EMI is recomputed; with it, the tenure changes."""

    model_config = ConfigDict(extra="forbid")

    interest_rate_bps: RateBps | None = None
    emi_amount: Amount | None = None
    next_payment_date: TransactionDate | None = None

    def to_request(self) -> Reschedule:
        return Reschedule(
            interest_rate_bps=self.interest_rate_bps,
            emi_amount=self.emi_amount,
            next_payment_date=self.next_payment_date,
        )


class UpdateInstallmentRequest(BaseModel):
    """Adjust a scheduled installment by hand."""

    model_config = ConfigDict(extra="forbid")

    due_date: TransactionDate | None = None
    principal: Component | None = None
    interest: Component | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        _require_fields(self, ("due_date", "principal", "interest"))
        return self

    def to_changes(self) -> InstallmentChanges:
        return InstallmentChanges(
            due_date=self.due_date if self.due_date is not None else UNSET,
            principal=self.principal if self.principal is not None else UNSET,
            interest=self.interest if self.interest is not None else UNSET,
        )


class PayInstallmentRequest(BaseModel):
    """Record an installment as paid. Either give `from_account_id`, and Orbit records the
    principal as a transfer into the loan account and the interest as a "Loan interest" expense,
    or link the transactions you already recorded."""

    model_config = ConfigDict(extra="forbid")

    paid_on: TransactionDate
    from_account_id: uuid.UUID | None = None
    principal: Component | None = Field(
        default=None, description="What was actually paid; defaults to the scheduled principal."
    )
    interest: Component | None = Field(
        default=None, description="What was actually paid; defaults to the scheduled interest."
    )
    principal_transaction_id: uuid.UUID | None = Field(
        default=None, description="A transfer into the loan account."
    )
    interest_transaction_id: uuid.UUID | None = Field(default=None, description="An expense.")

    def to_payment(self) -> InstallmentPayment:
        return InstallmentPayment(
            paid_on=self.paid_on,
            from_account_id=self.from_account_id,
            principal=self.principal,
            interest=self.interest,
            principal_transaction_id=self.principal_transaction_id,
            interest_transaction_id=self.interest_transaction_id,
        )


class UndoPaymentParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    delete_transactions: bool = Field(
        default=False,
        description="Also delete the transactions that recorded the payment. Otherwise they "
        "stay in the ledger, unlinked.",
    )


# Subscriptions and bills


class RecurringPaymentResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    kind: RecurringKind
    name: str
    provider: str
    category_id: uuid.UUID | None
    account_id: uuid.UUID | None = Field(description="The account it's usually paid from.")
    amount: int = Field(description="The expected amount; an estimate when `amount_varies`.")
    currency: Currency
    amount_varies: bool
    frequency: Frequency
    start_date: date
    next_due_date: date | None = Field(
        description="The earliest unsettled due date, possibly overdue; `null` when nothing is "
        "expected (paused, cancelled, or past its end date)."
    )
    end_date: date | None
    trial_ends_on: date | None
    auto_renew: bool
    status: RecurringStatus = Field(
        description="`active`, `paused`, `cancelled`, or `expired` (active, past its end date)."
    )
    overdue: int = Field(description="Unsettled occurrences due before today.")
    monthly_cost: int = Field(description="`amount` as a monthly average, rounded half up.")
    annual_cost: int
    last_paid_on: date | None
    notes: str
    reminder: ReminderSettingsResponse | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, view: RecurringView) -> "RecurringPaymentResponse":
        payment = view.payment
        return cls(
            id=payment.id,
            workspace_id=payment.workspace_id,
            kind=payment.kind,
            name=payment.name,
            provider=payment.provider,
            category_id=payment.category_id,
            account_id=payment.account_id,
            amount=payment.amount,
            currency=payment.currency,
            amount_varies=payment.amount_varies,
            frequency=payment.frequency,
            start_date=payment.start_date,
            next_due_date=view.next_due_date,
            end_date=payment.end_date,
            trial_ends_on=payment.trial_ends_on,
            auto_renew=payment.auto_renew,
            status=view.status,
            overdue=view.overdue,
            monthly_cost=view.monthly_cost,
            annual_cost=view.annual_cost,
            last_paid_on=view.last_paid_on,
            notes=payment.notes,
            reminder=ReminderSettingsResponse.of(payment.reminder),
            created_at=payment.created_at,
            updated_at=payment.updated_at,
        )


class RecurringPaymentListResponse(BaseModel):
    recurring_payments: list[RecurringPaymentResponse] = Field(
        description="Active first, then paused, then cancelled, each by name."
    )


class RecurringListParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: RecurringKind | None = None
    today: TransactionDate | None = Field(
        default=None,
        description="Your local date. Defaults to today in your time zone preference, else UTC.",
    )


class TodayParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    today: TransactionDate | None = Field(
        default=None,
        description="Your local date. Defaults to today in your time zone preference, else UTC.",
    )


class CreateRecurringPaymentRequest(BaseModel):
    """Track a subscription or a recurring bill. Its due dates repeat from `next_due_date`."""

    model_config = ConfigDict(extra="forbid")

    kind: RecurringKind
    name: Name
    provider: Counterparty = ""
    category_id: uuid.UUID | None = Field(default=None, description="An expense category.")
    account_id: uuid.UUID | None = None
    amount: Amount
    currency: Currency = DEFAULT_CURRENCY
    amount_varies: bool = Field(
        default=False, description="For bills like electricity: `amount` is an estimate."
    )
    frequency: Frequency
    start_date: TransactionDate | None = Field(
        default=None, description="When it began. Defaults to `next_due_date`."
    )
    next_due_date: TransactionDate
    end_date: TransactionDate | None = None
    trial_ends_on: TransactionDate | None = None
    auto_renew: bool = True
    notes: Notes = ""
    reminder: ReminderSettingsRequest | None = None

    def to_draft(self, default_timezone: str | None) -> RecurringDraft:
        return RecurringDraft(
            kind=self.kind,
            name=self.name,
            provider=self.provider,
            category_id=self.category_id,
            account_id=self.account_id,
            amount=self.amount,
            currency=self.currency,
            amount_varies=self.amount_varies,
            frequency=self.frequency,
            start_date=self.start_date or self.next_due_date,
            next_due_date=self.next_due_date,
            end_date=self.end_date,
            trial_ends_on=self.trial_ends_on,
            auto_renew=self.auto_renew,
            notes=self.notes,
            reminder=_reminder(self.reminder, default_timezone),
        )


class UpdateRecurringPaymentRequest(BaseModel):
    """Change some fields; `null` clears `category_id`, `account_id`, `end_date`,
    `trial_ends_on`, or `reminder`. `state` pauses (`paused`), cancels (`cancelled`), or resumes
    (`active`) it; history is always kept. Changing `frequency` or `next_due_date`, or resuming,
    restarts the schedule."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    provider: Counterparty | None = None
    category_id: uuid.UUID | None = None
    account_id: uuid.UUID | None = None
    amount: Amount | None = None
    amount_varies: bool | None = None
    frequency: Frequency | None = None
    start_date: TransactionDate | None = None
    next_due_date: TransactionDate | None = None
    end_date: TransactionDate | None = None
    trial_ends_on: TransactionDate | None = None
    auto_renew: bool | None = None
    state: RecurringState | None = None
    notes: Notes | None = None
    reminder: ReminderSettingsRequest | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        _require_fields(
            self,
            (
                "name",
                "provider",
                "amount",
                "amount_varies",
                "frequency",
                "start_date",
                "next_due_date",
                "auto_renew",
                "state",
                "notes",
            ),
        )
        return self

    def to_changes(self, default_timezone: str | None) -> RecurringChanges:
        provided = self.model_fields_set
        return RecurringChanges(
            name=self.name if self.name is not None else UNSET,
            provider=self.provider if self.provider is not None else UNSET,
            category_id=self.category_id if "category_id" in provided else UNSET,
            account_id=self.account_id if "account_id" in provided else UNSET,
            amount=self.amount if self.amount is not None else UNSET,
            amount_varies=self.amount_varies if self.amount_varies is not None else UNSET,
            frequency=self.frequency if self.frequency is not None else UNSET,
            start_date=self.start_date if self.start_date is not None else UNSET,
            next_due_date=self.next_due_date if self.next_due_date is not None else UNSET,
            end_date=self.end_date if "end_date" in provided else UNSET,
            trial_ends_on=self.trial_ends_on if "trial_ends_on" in provided else UNSET,
            auto_renew=self.auto_renew if self.auto_renew is not None else UNSET,
            state=self.state if self.state is not None else UNSET,
            notes=self.notes if self.notes is not None else UNSET,
            reminder=_reminder(self.reminder, default_timezone)
            if "reminder" in provided
            else UNSET,
        )


class SettledOccurrenceResponse(BaseModel):
    id: uuid.UUID
    recurring_payment_id: uuid.UUID
    due_date: date
    state: SettledState
    amount: int | None = Field(description="What was paid; `null` when skipped.")
    paid_on: date | None
    transaction_id: uuid.UUID | None = Field(
        description="The expense that recorded it; `null` when skipped or marked paid without a "
        "transaction (not counted as spending)."
    )
    created_at: datetime

    @classmethod
    def of(cls, occurrence: SettledOccurrence) -> "SettledOccurrenceResponse":
        return cls(
            id=occurrence.id,
            recurring_payment_id=occurrence.recurring_payment_id,
            due_date=occurrence.due_date,
            state=occurrence.state,
            amount=occurrence.amount,
            paid_on=occurrence.paid_on,
            transaction_id=occurrence.transaction_id,
            created_at=occurrence.created_at,
        )


class SettledOccurrenceListResponse(BaseModel):
    occurrences: list[SettledOccurrenceResponse] = Field(description="Newest due date first.")


class RecordRecurringPaymentRequest(BaseModel):
    """Record one occurrence as paid. `create` records an expense from `account_id` (default:
    the usual account) in the subscription's or bill's category; `link` uses an expense already
    recorded (`transaction_id`); `manual` marks it paid without a transaction, so it isn't
    counted as spending."""

    model_config = ConfigDict(extra="forbid")

    due_date: TransactionDate = Field(description="The occurrence being paid.")
    paid_on: TransactionDate
    mode: Literal["create", "link", "manual"] = "create"
    amount: Amount | None = Field(
        default=None, description="What was paid; defaults to the expected amount."
    )
    account_id: uuid.UUID | None = None
    transaction_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _check_mode(self) -> Self:
        if self.mode != "link" and self.transaction_id is not None:
            raise ValueError("transaction_id is only for mode 'link'")
        if self.mode != "create" and self.account_id is not None:
            raise ValueError("account_id is only for mode 'create'")
        if self.mode == "link" and self.amount is not None:
            raise ValueError("a linked transaction already has its amount")
        return self

    def to_record(self) -> RecurringPaymentRecord:
        return RecurringPaymentRecord(
            due_date=self.due_date,
            paid_on=self.paid_on,
            mode=self.mode,
            amount=self.amount,
            account_id=self.account_id,
            transaction_id=self.transaction_id,
        )


class SkipOccurrenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    due_date: TransactionDate


class UndoOccurrenceParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    delete_transaction: bool = Field(
        default=False,
        description="Also delete the expense that recorded the payment. Otherwise it stays in "
        "the ledger, unlinked.",
    )


# Upcoming payments


class PaymentItemResponse(BaseModel):
    kind: CommitmentKind
    commitment_id: uuid.UUID = Field(description="The loan, subscription, or bill.")
    occurrence_id: uuid.UUID | None = Field(
        description="The installment, or the settled occurrence. `null` for a subscription or "
        "bill payment that is still expected."
    )
    name: str
    counterparty: str = Field(description="The lender or provider; may be empty.")
    amount: int
    estimated: bool = Field(description="True for an expected bill whose amount varies.")
    currency: Currency
    due_date: date
    status: PaymentStatus
    account_id: uuid.UUID | None
    paid_on: date | None
    transaction_ids: list[uuid.UUID]
    principal: int | None = Field(description="Loans only.")
    interest: int | None = Field(description="Loans only.")

    @classmethod
    def of(cls, item: PaymentItem) -> "PaymentItemResponse":
        return cls(
            kind=item.kind,
            commitment_id=item.commitment_id,
            occurrence_id=item.occurrence_id,
            name=item.name,
            counterparty=item.counterparty,
            amount=item.amount,
            estimated=item.estimated,
            currency=item.currency,
            due_date=item.due_date,
            status=item.status,
            account_id=item.account_id,
            paid_on=item.paid_on,
            transaction_ids=list(item.transaction_ids),
            principal=item.principal,
            interest=item.interest,
        )


class PaymentListParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    today: TransactionDate | None = Field(
        default=None,
        description="Your local date. Defaults to today in your time zone preference, else UTC.",
    )
    date_from: TransactionDate | None = Field(
        default=None, description="Inclusive. Defaults to 30 days before `today`."
    )
    date_to: TransactionDate | None = Field(
        default=None, description="Inclusive. Defaults to 30 days after `today`."
    )
    kind: list[CommitmentKind] = Field(
        default_factory=list[CommitmentKind], description="Repeat for several. Omit for all."
    )
    status: list[PaymentStatus] = Field(
        default_factory=list[PaymentStatus], description="Repeat for several. Omit for all."
    )
    include_overdue: bool = Field(
        default=True, description="Also list unsettled payments due before `date_from`."
    )


class PaymentListResponse(BaseModel):
    today: date
    date_from: date
    date_to: date
    payments: list[PaymentItemResponse] = Field(description="By due date.")


# Dashboard


class TotalResponse(BaseModel):
    count: int
    amount: int

    @classmethod
    def of(cls, total: Total) -> "TotalResponse":
        return cls(count=total.count, amount=total.amount)


class CommitmentSummaryParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: Currency = DEFAULT_CURRENCY
    today: TransactionDate | None = Field(
        default=None,
        description="Your local date. Defaults to today in your time zone preference, else UTC.",
    )


class CommitmentSummaryResponse(BaseModel):
    currency: Currency
    today: date
    loans_outstanding: int = Field(description="Outstanding principal on active loans.")
    active_loans: int
    monthly_emi: int = Field(description="Active loans' EMIs as a monthly average.")
    monthly_subscriptions: int
    annual_subscriptions: int
    active_subscriptions: int
    upcoming_bills: TotalResponse = Field(description="Expected bills due in the next 30 days.")
    due_this_month: TotalResponse = Field(
        description="Expected payments of any kind due from today to the end of the month."
    )
    overdue: TotalResponse

    @classmethod
    def of(cls, summary: CommitmentSummary, today: date) -> "CommitmentSummaryResponse":
        return cls(
            currency=summary.currency,
            today=today,
            loans_outstanding=summary.loans_outstanding,
            active_loans=summary.active_loans,
            monthly_emi=summary.monthly_emi,
            monthly_subscriptions=summary.monthly_subscriptions,
            annual_subscriptions=summary.annual_subscriptions,
            active_subscriptions=summary.active_subscriptions,
            upcoming_bills=TotalResponse.of(summary.upcoming_bills),
            due_this_month=TotalResponse.of(summary.due_this_month),
            overdue=TotalResponse.of(summary.overdue),
        )
