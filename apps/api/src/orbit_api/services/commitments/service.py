"""Financial commitments: loans and their EMI schedules, subscriptions, recurring bills, the
unified view of upcoming payments, and the reminders that announce them.

Accounting, decided deliberately and built on the Phase 1 ledger rather than beside it:

- **A loan is a `loan` liability account** created with it. Its outstanding principal is that
  account's balance, derived from the ledger like every balance and never stored.
- **Paying an EMI records two ordinary transactions**: a `transfer` of the principal from the
  paying account into the loan account (which reduces the liability and is never spending), and
  an `expense` of the interest in the built-in "Loan interest" category. The EMI as a whole is
  never an expense, so nothing is counted twice.
- **Scheduled installments, renewals, and bills are expectations**, not money: they appear in
  reports only once a payment is recorded and its transaction exists. A payment marked paid
  "manually" (without a transaction) is history, not spending.
- **One transaction pays at most one thing**, enforced by unique foreign keys and checked here
  first for a helpful message. The ledger refuses to delete a transaction that records a payment.

Every write, including the transactions it creates and the reminder it moves, commits once, so
a payment is either recorded completely or not at all. Every method takes a `workspace_id` that
the caller has already authorized; repositories filter every query by it, and referenced
accounts, categories, and transactions are looked up in that workspace too.
"""

import uuid
from collections.abc import Callable, Iterable, Iterator
from dataclasses import replace
from datetime import date, datetime, timedelta
from itertools import islice
from typing import Protocol
from zoneinfo import ZoneInfo

from orbit_api.services.commitments.models import (
    CommitmentKind,
    CommitmentSummary,
    Installment,
    InstallmentChanges,
    InstallmentNotFoundError,
    InstallmentPayment,
    InstallmentState,
    InvalidCommitmentError,
    Loan,
    LoanChanges,
    LoanDraft,
    LoanNotFoundError,
    LoanView,
    OccurrenceNotFoundError,
    PaymentConflictError,
    PaymentItem,
    PaymentQuery,
    RecurringChanges,
    RecurringDraft,
    RecurringKind,
    RecurringPayment,
    RecurringPaymentNotFoundError,
    RecurringPaymentRecord,
    RecurringStatus,
    RecurringView,
    ReminderSettings,
    Reschedule,
    SettledOccurrence,
    Total,
    payment_status,
)
from orbit_api.services.commitments.schedule import (
    LoanTerms,
    ScheduleError,
    amortize,
    annual_equivalent,
    due_dates,
    flat_interest_split,
    flat_interest_total,
    installment_count,
    installments_until_repaid,
    monthly_equivalent,
    standard_emi,
)
from orbit_api.services.finance.categories import LOAN_INTEREST_KEY
from orbit_api.services.finance.models import (
    AccountDraft,
    AccountNotFoundError,
    AccountView,
    InvalidTransactionError,
    Transaction,
    TransactionDraft,
    TransactionNotFoundError,
)
from orbit_api.services.finance.money import Currency, month_bounds, to_decimal_string
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.reminders.managed import ReminderStore, ReminderTarget, point_reminder
from orbit_api.services.reminders.models import CommitmentLink, Reminder
from orbit_api.services.reminders.recurrence import Schedule, local_to_utc
from orbit_api.services.reminders.service import OccurrenceScheduler
from orbit_api.services.transactions import ConflictError
from orbit_api.services.transactions import Transaction as UnitOfWork
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now

# How many overdue occurrences of one subscription or bill the upcoming view lists: the most
# recent ones. A schedule nobody has recorded payments against for years stays readable.
MAX_OVERDUE_PER_COMMITMENT = 60
# How far ahead a reminder looks for the next payment to announce.
_REMINDER_SEARCH_LIMIT = 1000
UPCOMING_BILLS_DAYS = 30


class LoanRepository(Protocol):
    async def add(self, loan: Loan) -> None: ...

    async def get(self, workspace_id: uuid.UUID, loan_id: uuid.UUID) -> Loan | None:
        """The loan, only if it belongs to `workspace_id`."""
        ...

    async def list(self, workspace_id: uuid.UUID) -> list[Loan]:
        """Every loan in the workspace: active first, then closed, then archived, each by
        name."""
        ...

    async def save(self, loan: Loan) -> None: ...


class InstallmentRepository(Protocol):
    async def add(self, installment: Installment) -> None: ...

    async def get(
        self, workspace_id: uuid.UUID, loan_id: uuid.UUID, installment_id: uuid.UUID
    ) -> Installment | None: ...

    async def for_loan(self, workspace_id: uuid.UUID, loan_id: uuid.UUID) -> list[Installment]:
        """The loan's installments by due date, then sequence."""
        ...

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[Installment]:
        """Every installment in the workspace, by due date."""
        ...

    async def find(
        self,
        workspace_id: uuid.UUID,
        date_from: date,
        date_to: date,
        scheduled_before: date | None,
    ) -> list[Installment]:
        """Installments due in the inclusive range, plus scheduled ones due before
        `scheduled_before` when given, by due date."""
        ...

    async def save(self, installment: Installment, *, expected_state: InstallmentState) -> bool:
        """Store the installment's fields only if its stored state is still `expected_state`;
        report whether it was. Two requests settling one installment can't both succeed."""
        ...

    async def delete_scheduled(self, workspace_id: uuid.UUID, loan_id: uuid.UUID) -> None: ...


class RecurringRepository(Protocol):
    async def add(self, payment: RecurringPayment) -> None: ...

    async def get(
        self, workspace_id: uuid.UUID, payment_id: uuid.UUID
    ) -> RecurringPayment | None: ...

    async def list(
        self, workspace_id: uuid.UUID, kind: RecurringKind | None = None
    ) -> list[RecurringPayment]:
        """Active first, then paused, then cancelled, each by name."""
        ...

    async def save(self, payment: RecurringPayment) -> None: ...


class SettledRepository(Protocol):
    async def add(self, occurrence: SettledOccurrence) -> None:
        """Raises `ConflictError` if the occurrence is settled already or its transaction pays
        something else."""
        ...

    async def get(
        self, workspace_id: uuid.UUID, payment_id: uuid.UUID, occurrence_id: uuid.UUID
    ) -> SettledOccurrence | None: ...

    async def for_payment(
        self, workspace_id: uuid.UUID, payment_id: uuid.UUID
    ) -> list[SettledOccurrence]:
        """Newest due date first."""
        ...

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[SettledOccurrence]: ...

    async def delete(self, workspace_id: uuid.UUID, occurrence_id: uuid.UUID) -> None: ...


class PaymentLinks(Protocol):
    async def is_linked(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> bool:
        """Whether an installment or a settled occurrence already points at the transaction."""
        ...


def _project(installments: list[Installment], outstanding: int) -> list[Installment]:
    """Installments with each scheduled one's `balance_after` projected from the outstanding
    principal the ledger reports today. Settled ones keep what was recorded."""
    balance = max(outstanding, 0)
    projected: list[Installment] = []
    for installment in sorted(installments, key=lambda entry: (entry.due_date, entry.sequence)):
        if installment.state == "scheduled":
            balance = max(balance - installment.principal, 0)
            installment = replace(installment, balance_after=balance)
        projected.append(installment)
    return projected


def _outstanding(view: AccountView | None) -> int:
    # A loan account's balance is negative while money is owed.
    return -view.balance if view else 0


def _short_date(day: date) -> str:
    return f"{day.day} {day:%b %Y}"


class CommitmentService:
    def __init__(
        self,
        loans: LoanRepository,
        installments: InstallmentRepository,
        recurring: RecurringRepository,
        settled: SettledRepository,
        links: PaymentLinks,
        finance: FinanceService,
        reminders: ReminderStore,
        scheduler: OccurrenceScheduler,
        unit_of_work: UnitOfWork,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._loans = loans
        self._installments = installments
        self._recurring = recurring
        self._settled = settled
        self._links = links
        self._finance = finance
        self._reminders = reminders
        self._scheduler = scheduler
        self._unit_of_work = unit_of_work
        self._clock = clock

    # Loans

    async def loans(self, workspace_id: uuid.UUID) -> list[LoanView]:
        loans = await self._loans.list(workspace_id)
        accounts = {view.account.id: view for view in await self._finance.accounts(workspace_id)}
        by_loan: dict[uuid.UUID, list[Installment]] = {}
        for installment in await self._installments.for_workspace(workspace_id):
            by_loan.setdefault(installment.loan_id, []).append(installment)
        return [
            _loan_view(loan, _outstanding(accounts.get(loan.account_id)), by_loan.get(loan.id, []))
            for loan in loans
        ]

    async def loan(self, workspace_id: uuid.UUID, loan_id: uuid.UUID) -> LoanView:
        loan = await self._get_loan(workspace_id, loan_id)
        return _loan_view(
            loan,
            await self._loan_outstanding(loan),
            await self._installments.for_loan(workspace_id, loan_id),
        )

    async def installments(self, workspace_id: uuid.UUID, loan_id: uuid.UUID) -> list[Installment]:
        """The loan's EMI schedule, with scheduled balances projected from the ledger."""
        loan = await self._get_loan(workspace_id, loan_id)
        return _project(
            await self._installments.for_loan(workspace_id, loan_id),
            await self._loan_outstanding(loan),
        )

    async def create_loan(self, workspace_id: uuid.UUID, draft: LoanDraft) -> LoanView:
        """Create the loan, its `loan` account (opening balance: the outstanding principal,
        owed), and the remaining installments, in one transaction."""
        if draft.payment_account_id is not None:
            await self._payment_account(workspace_id, draft.payment_account_id, draft.currency)
        outstanding = (
            draft.principal if draft.outstanding_principal is None else draft.outstanding_principal
        )
        if outstanding > draft.principal:
            raise InvalidCommitmentError(
                "The outstanding principal can't be more than the amount borrowed."
            )
        first_due = draft.first_payment_date
        next_due = draft.next_payment_date or first_due
        if draft.start_date > first_due:
            raise InvalidCommitmentError("The first payment can't be before the loan starts.")
        if next_due < first_due:
            raise InvalidCommitmentError("The next payment can't be before the first payment.")
        try:
            total = installment_count(draft.tenure_months, draft.emi_frequency)
            # Installments of the tenure that fell due before the next one: repaid before Orbit.
            elapsed = sum(
                1
                for due in islice(due_dates(first_due, draft.emi_frequency), total)
                if due < next_due
            )
            remaining = total - elapsed
            if remaining < 1:
                raise InvalidCommitmentError(
                    "The next payment is after the last installment of the tenure."
                )
            emi = draft.emi_amount or standard_emi(
                draft.principal,
                draft.interest_rate_bps,
                draft.emi_frequency,
                total,
                draft.interest_method,
                draft.tenure_months,
            )
            planned = amortize(
                LoanTerms(
                    outstanding=outstanding,
                    rate_bps=draft.interest_rate_bps,
                    method=draft.interest_method,
                    frequency=draft.emi_frequency,
                    emi=emi,
                    first_due=next_due,
                    count=remaining,
                    flat_interest=flat_interest_split(
                        flat_interest_total(
                            draft.principal, draft.interest_rate_bps, draft.tenure_months
                        ),
                        total,
                    )
                    if draft.interest_method == "flat"
                    else (),
                    first_sequence=elapsed + 1,
                )
            )
        except ScheduleError as error:
            raise InvalidCommitmentError(error.message) from None

        now = self._clock()
        account = await self._finance.create_account(
            workspace_id,
            AccountDraft(
                name=draft.name,
                type="loan",
                currency=draft.currency,
                opening_balance=-outstanding,
                notes="",
            ),
            commit=False,
        )
        loan = Loan(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            account_id=account.account.id,
            payment_account_id=draft.payment_account_id,
            name=draft.name,
            lender=draft.lender,
            loan_type=draft.loan_type,
            currency=draft.currency,
            principal=draft.principal,
            interest_rate_bps=draft.interest_rate_bps,
            interest_method=draft.interest_method,
            start_date=draft.start_date,
            tenure_months=draft.tenure_months,
            emi_amount=emi,
            emi_frequency=draft.emi_frequency,
            first_payment_date=first_due,
            notes=draft.notes,
            status="active",
            reminder=draft.reminder,
            created_at=now,
            updated_at=now,
        )
        await self._loans.add(loan)
        for entry in planned:
            await self._installments.add(
                Installment(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    loan_id=loan.id,
                    sequence=entry.sequence,
                    due_date=entry.due_date,
                    principal=entry.principal,
                    interest=entry.interest,
                    balance_after=entry.balance_after,
                    state="scheduled",
                    paid_on=None,
                    principal_transaction_id=None,
                    interest_transaction_id=None,
                    adjusted=False,
                    created_at=now,
                    updated_at=now,
                )
            )
        await self._sync_reminder(workspace_id, CommitmentLink("loan", loan.id), now)
        await self._unit_of_work.commit()
        return await self.loan(workspace_id, loan.id)

    async def update_loan(
        self, workspace_id: uuid.UUID, loan_id: uuid.UUID, changes: LoanChanges
    ) -> LoanView:
        loan = await self._get_loan(workspace_id, loan_id)
        if changes.payment_account_id is not UNSET and changes.payment_account_id is not None:
            await self._payment_account(workspace_id, changes.payment_account_id, loan.currency)
        updated = replace(
            loan,
            name=loan.name if changes.name is UNSET else changes.name,
            lender=loan.lender if changes.lender is UNSET else changes.lender,
            loan_type=loan.loan_type if changes.loan_type is UNSET else changes.loan_type,
            payment_account_id=loan.payment_account_id
            if changes.payment_account_id is UNSET
            else changes.payment_account_id,
            notes=loan.notes if changes.notes is UNSET else changes.notes,
            status=loan.status if changes.status is UNSET else changes.status,
            reminder=loan.reminder if changes.reminder is UNSET else changes.reminder,
        )
        if updated != loan:
            now = self._clock()
            await self._loans.save(replace(updated, updated_at=now))
            await self._sync_reminder(workspace_id, CommitmentLink("loan", loan.id), now)
            await self._unit_of_work.commit()
        return await self.loan(workspace_id, loan_id)

    async def reschedule(
        self, workspace_id: uuid.UUID, loan_id: uuid.UUID, request: Reschedule
    ) -> LoanView:
        """Replace the unpaid installments with a schedule that repays what the ledger says is
        still owed. Paid and skipped installments are history and stay."""
        loan = await self._get_loan(workspace_id, loan_id)
        installments = await self._installments.for_loan(workspace_id, loan_id)
        scheduled = [entry for entry in installments if entry.state == "scheduled"]
        if not scheduled:
            raise InvalidCommitmentError("Nothing is left to reschedule on this loan.")
        outstanding = await self._loan_outstanding(loan)
        if outstanding <= 0:
            raise InvalidCommitmentError("Nothing is owed on this loan any more. Close it instead.")
        rate = (
            loan.interest_rate_bps
            if request.interest_rate_bps is None
            else request.interest_rate_bps
        )
        first_due = request.next_payment_date or scheduled[0].due_date
        try:
            count = len(scheduled)
            if request.emi_amount is not None and loan.interest_method == "reducing":
                # A new EMI keeps the rate and changes how long repayment takes.
                count = installments_until_repaid(
                    outstanding, rate, loan.emi_frequency, request.emi_amount
                )
            months = count * _months(loan)
            emi_flat = flat_interest_split(flat_interest_total(outstanding, rate, months), count)
            emi = request.emi_amount or standard_emi(
                outstanding, rate, loan.emi_frequency, count, loan.interest_method, months
            )
            planned = amortize(
                LoanTerms(
                    outstanding=outstanding,
                    rate_bps=rate,
                    method=loan.interest_method,
                    frequency=loan.emi_frequency,
                    emi=emi,
                    first_due=first_due,
                    count=count,
                    flat_interest=emi_flat if loan.interest_method == "flat" else (),
                    first_sequence=max(
                        (entry.sequence for entry in installments if entry.state != "scheduled"),
                        default=0,
                    )
                    + 1,
                )
            )
        except ScheduleError as error:
            raise InvalidCommitmentError(error.message) from None

        now = self._clock()
        await self._installments.delete_scheduled(workspace_id, loan_id)
        for entry in planned:
            await self._installments.add(
                Installment(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    loan_id=loan_id,
                    sequence=entry.sequence,
                    due_date=entry.due_date,
                    principal=entry.principal,
                    interest=entry.interest,
                    balance_after=entry.balance_after,
                    state="scheduled",
                    paid_on=None,
                    principal_transaction_id=None,
                    interest_transaction_id=None,
                    adjusted=False,
                    created_at=now,
                    updated_at=now,
                )
            )
        await self._loans.save(
            replace(loan, interest_rate_bps=rate, emi_amount=emi, updated_at=now)
        )
        await self._sync_reminder(workspace_id, CommitmentLink("loan", loan_id), now)
        await self._commit_or_conflict()
        return await self.loan(workspace_id, loan_id)

    async def adjust_installment(
        self,
        workspace_id: uuid.UUID,
        loan_id: uuid.UUID,
        installment_id: uuid.UUID,
        changes: InstallmentChanges,
    ) -> Installment:
        """Change a scheduled installment's date or split by hand, for a lender who doesn't
        follow the generated schedule exactly."""
        loan = await self._get_loan(workspace_id, loan_id)
        installment = await self._get_installment(workspace_id, loan_id, installment_id)
        if installment.state != "scheduled":
            raise PaymentConflictError(
                "Only scheduled installments can be adjusted. Undo the payment first."
            )
        updated = replace(
            installment,
            due_date=installment.due_date if changes.due_date is UNSET else changes.due_date,
            principal=installment.principal if changes.principal is UNSET else changes.principal,
            interest=installment.interest if changes.interest is UNSET else changes.interest,
        )
        if updated.principal + updated.interest <= 0:
            raise InvalidCommitmentError("An installment must have an amount.")
        if updated != installment:
            now = self._clock()
            await self._save_installment(
                replace(updated, adjusted=True, updated_at=now), expected="scheduled"
            )
            await self._sync_reminder(workspace_id, CommitmentLink("loan", loan.id), now)
            await self._commit_or_conflict()
        return await self._projected(workspace_id, loan, installment_id)

    async def pay_installment(
        self,
        workspace_id: uuid.UUID,
        loan_id: uuid.UUID,
        installment_id: uuid.UUID,
        payment: InstallmentPayment,
    ) -> Installment:
        """Record an installment as paid: create its principal transfer and interest expense, or
        link transactions already recorded. Atomic, and never twice."""
        loan = await self._get_loan(workspace_id, loan_id)
        installment = await self._get_installment(workspace_id, loan_id, installment_id)
        _require_scheduled(installment)
        linking = (
            payment.principal_transaction_id is not None
            or payment.interest_transaction_id is not None
        )
        if linking == (payment.from_account_id is not None):
            raise InvalidCommitmentError(
                "Choose the account the EMI was paid from, or link the transactions that "
                "recorded it."
            )

        principal_tx: Transaction | None = None
        interest_tx: Transaction | None = None
        if payment.from_account_id is not None:
            if payment.from_account_id == loan.account_id:
                raise InvalidCommitmentError("Pay the EMI from another account.")
            principal = installment.principal if payment.principal is None else payment.principal
            interest = installment.interest if payment.interest is None else payment.interest
            if principal + interest <= 0:
                raise InvalidCommitmentError("Enter what was paid.")
            category_id = await self._loan_interest_category(workspace_id) if interest else None
            try:
                if principal:
                    principal_tx = await self._finance.create(
                        workspace_id,
                        TransactionDraft(
                            type="transfer",
                            amount=principal,
                            occurred_on=payment.paid_on,
                            description=f"{loan.name} EMI principal",
                            account_id=payment.from_account_id,
                            to_account_id=loan.account_id,
                        ),
                        commit=False,
                    )
                if interest:
                    interest_tx = await self._finance.create(
                        workspace_id,
                        TransactionDraft(
                            type="expense",
                            amount=interest,
                            occurred_on=payment.paid_on,
                            description=f"{loan.name} EMI interest",
                            account_id=payment.from_account_id,
                            category_id=category_id,
                        ),
                        commit=False,
                    )
            except InvalidTransactionError as error:
                await self._unit_of_work.rollback()
                raise InvalidCommitmentError(error.message) from None
        else:
            if payment.principal is not None or payment.interest is not None:
                raise InvalidCommitmentError(
                    "Linked transactions already say what was paid; leave the amounts out."
                )
            if payment.principal_transaction_id == payment.interest_transaction_id:
                raise InvalidCommitmentError("Link two different transactions.")
            if payment.principal_transaction_id is not None:
                principal_tx = await self._unlinked(workspace_id, payment.principal_transaction_id)
                if principal_tx.type != "transfer" or principal_tx.to_account_id != loan.account_id:
                    raise InvalidCommitmentError(
                        "The principal must be a transfer into the loan's account."
                    )
            if payment.interest_transaction_id is not None:
                interest_tx = await self._unlinked(workspace_id, payment.interest_transaction_id)
                if interest_tx.type != "expense" or interest_tx.currency != loan.currency:
                    raise InvalidCommitmentError(
                        f"The interest must be an expense in {loan.currency}."
                    )

        now = self._clock()
        # Read after the writes: the ledger now includes this principal payment.
        outstanding = await self._loan_outstanding(loan)
        await self._save_installment(
            replace(
                installment,
                state="paid",
                paid_on=payment.paid_on,
                principal=principal_tx.amount if principal_tx else 0,
                interest=interest_tx.amount if interest_tx else 0,
                balance_after=min(max(outstanding, 0), 10**13),
                principal_transaction_id=principal_tx.id if principal_tx else None,
                interest_transaction_id=interest_tx.id if interest_tx else None,
                updated_at=now,
            ),
            expected="scheduled",
        )
        await self._sync_reminder(workspace_id, CommitmentLink("loan", loan.id), now)
        await self._commit_or_conflict()
        return await self._projected(workspace_id, loan, installment_id)

    async def skip_installment(
        self, workspace_id: uuid.UUID, loan_id: uuid.UUID, installment_id: uuid.UUID
    ) -> Installment:
        """Mark an installment as not paid on purpose (a moratorium or payment holiday). The
        principal stays owed, so later projected balances are higher."""
        loan = await self._get_loan(workspace_id, loan_id)
        installment = await self._get_installment(workspace_id, loan_id, installment_id)
        _require_scheduled(installment)
        now = self._clock()
        await self._save_installment(
            replace(installment, state="skipped", updated_at=now), expected="scheduled"
        )
        await self._sync_reminder(workspace_id, CommitmentLink("loan", loan.id), now)
        await self._commit_or_conflict()
        return await self._projected(workspace_id, loan, installment_id)

    async def undo_installment(
        self,
        workspace_id: uuid.UUID,
        loan_id: uuid.UUID,
        installment_id: uuid.UUID,
        *,
        delete_transactions: bool,
    ) -> Installment:
        """Return a paid or skipped installment to scheduled. Its transactions are unlinked, and
        deleted too when asked, which also restores the outstanding principal."""
        loan = await self._get_loan(workspace_id, loan_id)
        installment = await self._get_installment(workspace_id, loan_id, installment_id)
        if installment.state == "scheduled":
            raise PaymentConflictError("This installment isn't paid or skipped.")
        now = self._clock()
        await self._save_installment(
            replace(
                installment,
                state="scheduled",
                paid_on=None,
                principal_transaction_id=None,
                interest_transaction_id=None,
                updated_at=now,
            ),
            expected=installment.state,
        )
        if delete_transactions:
            for transaction_id in (
                installment.principal_transaction_id,
                installment.interest_transaction_id,
            ):
                if transaction_id is not None:
                    await self._finance.delete(workspace_id, transaction_id, commit=False)
        await self._sync_reminder(workspace_id, CommitmentLink("loan", loan.id), now)
        await self._commit_or_conflict()
        return await self._projected(workspace_id, loan, installment_id)

    # Subscriptions and bills

    async def recurring_payments(
        self, workspace_id: uuid.UUID, kind: RecurringKind | None, today: date
    ) -> list[RecurringView]:
        payments = await self._recurring.list(workspace_id, kind)
        settled = _group(await self._settled.for_workspace(workspace_id))
        return [_recurring_view(entry, settled.get(entry.id, []), today) for entry in payments]

    async def recurring_payment(
        self, workspace_id: uuid.UUID, payment_id: uuid.UUID, today: date
    ) -> RecurringView:
        payment = await self._get_recurring(workspace_id, payment_id)
        return _recurring_view(
            payment, await self._settled.for_payment(workspace_id, payment_id), today
        )

    async def history(
        self, workspace_id: uuid.UUID, payment_id: uuid.UUID
    ) -> list[SettledOccurrence]:
        """Paid and skipped occurrences, newest first: the renewal or payment history."""
        await self._get_recurring(workspace_id, payment_id)
        return await self._settled.for_payment(workspace_id, payment_id)

    async def create_recurring(
        self, workspace_id: uuid.UUID, draft: RecurringDraft, today: date
    ) -> RecurringView:
        await self._check_recurring_refs(
            workspace_id, draft.category_id, draft.account_id, draft.currency
        )
        if draft.start_date > draft.next_due_date:
            raise InvalidCommitmentError("The start date can't be after the next due date.")
        if draft.end_date is not None and draft.end_date < draft.next_due_date:
            raise InvalidCommitmentError("The end date can't be before the next due date.")
        now = self._clock()
        payment = RecurringPayment(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            kind=draft.kind,
            name=draft.name,
            provider=draft.provider,
            category_id=draft.category_id,
            account_id=draft.account_id,
            amount=draft.amount,
            currency=draft.currency,
            amount_varies=draft.amount_varies,
            frequency=draft.frequency,
            start_date=draft.start_date,
            anchor_date=draft.next_due_date,
            end_date=draft.end_date,
            trial_ends_on=draft.trial_ends_on,
            auto_renew=draft.auto_renew,
            state="active",
            notes=draft.notes,
            reminder=draft.reminder,
            created_at=now,
            updated_at=now,
        )
        await self._recurring.add(payment)
        await self._sync_reminder(
            workspace_id, CommitmentLink("recurring_payment", payment.id), now
        )
        await self._unit_of_work.commit()
        return await self.recurring_payment(workspace_id, payment.id, today)

    async def update_recurring(
        self,
        workspace_id: uuid.UUID,
        payment_id: uuid.UUID,
        changes: RecurringChanges,
        today: date,
    ) -> RecurringView:
        """Change a subscription or bill. Its settled history keeps its dates and amounts.
        Changing the frequency or next due date, or resuming it, restarts the schedule from the
        new next due date (by default the first date on or after today)."""
        payment = await self._get_recurring(workspace_id, payment_id)
        settled = await self._settled.for_payment(workspace_id, payment_id)
        category_id = payment.category_id if changes.category_id is UNSET else changes.category_id
        account_id = payment.account_id if changes.account_id is UNSET else changes.account_id
        if category_id != payment.category_id or account_id != payment.account_id:
            await self._check_recurring_refs(
                workspace_id,
                category_id if category_id != payment.category_id else None,
                account_id if account_id != payment.account_id else None,
                payment.currency,
            )
        updated = replace(
            payment,
            name=payment.name if changes.name is UNSET else changes.name,
            provider=payment.provider if changes.provider is UNSET else changes.provider,
            category_id=category_id,
            account_id=account_id,
            amount=payment.amount if changes.amount is UNSET else changes.amount,
            amount_varies=payment.amount_varies
            if changes.amount_varies is UNSET
            else changes.amount_varies,
            frequency=payment.frequency if changes.frequency is UNSET else changes.frequency,
            start_date=payment.start_date if changes.start_date is UNSET else changes.start_date,
            end_date=payment.end_date if changes.end_date is UNSET else changes.end_date,
            trial_ends_on=payment.trial_ends_on
            if changes.trial_ends_on is UNSET
            else changes.trial_ends_on,
            auto_renew=payment.auto_renew if changes.auto_renew is UNSET else changes.auto_renew,
            state=payment.state if changes.state is UNSET else changes.state,
            notes=payment.notes if changes.notes is UNSET else changes.notes,
            reminder=payment.reminder if changes.reminder is UNSET else changes.reminder,
        )
        resumed = payment.state != "active" and updated.state == "active"
        if changes.next_due_date is not UNSET:
            updated = replace(updated, anchor_date=changes.next_due_date)
        elif updated.frequency != payment.frequency or resumed:
            # Keep the cadence's day, from the first date not already past.
            settled_dates = {entry.due_date for entry in settled}
            start = (
                today
                if resumed
                else (_next_unsettled(payment, settled_dates, payment.anchor_date) or today)
            )
            anchor = next(due_dates(payment.anchor_date, payment.frequency, start=start))
            updated = replace(updated, anchor_date=anchor)
        if updated.start_date > updated.anchor_date:
            raise InvalidCommitmentError("The start date can't be after the next due date.")
        if updated.end_date is not None and updated.end_date < updated.anchor_date:
            raise InvalidCommitmentError("The end date can't be before the next due date.")
        if updated != payment:
            now = self._clock()
            await self._recurring.save(replace(updated, updated_at=now))
            await self._sync_reminder(
                workspace_id, CommitmentLink("recurring_payment", payment_id), now
            )
            await self._unit_of_work.commit()
        return await self.recurring_payment(workspace_id, payment_id, today)

    async def record_payment(
        self,
        workspace_id: uuid.UUID,
        payment_id: uuid.UUID,
        record: RecurringPaymentRecord,
        today: date,
    ) -> SettledOccurrence:
        """Record one occurrence as paid, creating or linking its expense (or neither, when
        marked paid manually). Each occurrence can be settled once."""
        payment = await self._get_recurring(workspace_id, payment_id)
        if payment.state != "active":
            raise PaymentConflictError("This is paused or cancelled. Resume it to record payments.")
        await self._require_open_due_date(workspace_id, payment, record.due_date)

        transaction: Transaction | None = None
        amount = record.amount or payment.amount
        match record.mode:
            case "create":
                account_id = record.account_id or payment.account_id
                if account_id is None:
                    raise InvalidCommitmentError("Choose the account it was paid from.")
                try:
                    transaction = await self._finance.create(
                        workspace_id,
                        TransactionDraft(
                            type="expense",
                            amount=amount,
                            occurred_on=record.paid_on,
                            description=payment.name,
                            account_id=account_id,
                            category_id=payment.category_id,
                        ),
                        commit=False,
                    )
                except InvalidTransactionError as error:
                    await self._unit_of_work.rollback()
                    raise InvalidCommitmentError(error.message) from None
                if transaction.currency != payment.currency:
                    await self._unit_of_work.rollback()
                    raise InvalidCommitmentError(f"Pay it from an account in {payment.currency}.")
            case "link":
                if record.transaction_id is None:
                    raise InvalidCommitmentError("Choose the transaction that paid it.")
                transaction = await self._unlinked(workspace_id, record.transaction_id)
                if transaction.type != "expense" or transaction.currency != payment.currency:
                    raise InvalidCommitmentError(f"Link an expense in {payment.currency}.")
                amount = transaction.amount
            case "manual":
                pass

        occurrence = SettledOccurrence(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            recurring_payment_id=payment_id,
            due_date=record.due_date,
            state="paid",
            amount=amount,
            paid_on=record.paid_on,
            transaction_id=transaction.id if transaction else None,
            created_at=self._clock(),
        )
        await self._add_settled(occurrence)
        await self._sync_reminder(
            workspace_id, CommitmentLink("recurring_payment", payment_id), occurrence.created_at
        )
        await self._commit_or_conflict()
        return occurrence

    async def skip_occurrence(
        self, workspace_id: uuid.UUID, payment_id: uuid.UUID, due_date: date
    ) -> SettledOccurrence:
        """Settle an occurrence without paying it: a skipped month or a waived bill."""
        payment = await self._get_recurring(workspace_id, payment_id)
        await self._require_open_due_date(workspace_id, payment, due_date)
        occurrence = SettledOccurrence(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            recurring_payment_id=payment_id,
            due_date=due_date,
            state="skipped",
            amount=None,
            paid_on=None,
            transaction_id=None,
            created_at=self._clock(),
        )
        await self._add_settled(occurrence)
        await self._sync_reminder(
            workspace_id, CommitmentLink("recurring_payment", payment_id), occurrence.created_at
        )
        await self._commit_or_conflict()
        return occurrence

    async def undo_occurrence(
        self,
        workspace_id: uuid.UUID,
        payment_id: uuid.UUID,
        occurrence_id: uuid.UUID,
        *,
        delete_transaction: bool,
    ) -> None:
        """Make a settled occurrence expected again. Its transaction is unlinked, and deleted
        too when asked."""
        await self._get_recurring(workspace_id, payment_id)
        occurrence = await self._settled.get(workspace_id, payment_id, occurrence_id)
        if occurrence is None:
            raise OccurrenceNotFoundError
        await self._settled.delete(workspace_id, occurrence_id)
        if delete_transaction and occurrence.transaction_id is not None:
            await self._finance.delete(workspace_id, occurrence.transaction_id, commit=False)
        await self._sync_reminder(
            workspace_id, CommitmentLink("recurring_payment", payment_id), self._clock()
        )
        await self._commit_or_conflict()

    # Upcoming payments and the dashboard

    async def payments(self, workspace_id: uuid.UUID, query: PaymentQuery) -> list[PaymentItem]:
        """Expected and settled payments of every commitment, by due date: those due in the
        range, and (with `include_overdue`) unsettled ones that fell due before it."""
        items: list[PaymentItem] = []
        if not query.kinds or "loan" in query.kinds:
            items += await self._loan_items(workspace_id, query)
        if not query.kinds or query.kinds & {"subscription", "bill"}:
            items += await self._recurring_items(workspace_id, query)
        if query.statuses:
            items = [item for item in items if item.status in query.statuses]
        return sorted(items, key=lambda item: (item.due_date, item.name, str(item.commitment_id)))

    async def summary(
        self, workspace_id: uuid.UUID, currency: Currency, today: date
    ) -> CommitmentSummary:
        """Commitment totals in one currency. Different currencies are never added together."""
        loans = [
            view
            for view in await self.loans(workspace_id)
            if view.loan.currency == currency and view.loan.status == "active"
        ]
        subscriptions = [
            view
            for view in await self.recurring_payments(workspace_id, "subscription", today)
            if view.payment.currency == currency and view.status == "active"
        ]
        _, month_end = month_bounds(today)
        horizon = today + timedelta(days=UPCOMING_BILLS_DAYS)
        items = [
            item
            for item in await self.payments(
                workspace_id,
                PaymentQuery(today=today, date_from=today, date_to=max(month_end, horizon)),
            )
            if item.currency == currency
        ]
        unsettled = [item for item in items if item.status in ("upcoming", "due")]
        return CommitmentSummary(
            currency=currency,
            loans_outstanding=sum(max(view.outstanding, 0) for view in loans),
            active_loans=len(loans),
            monthly_emi=sum(
                monthly_equivalent(view.loan.emi_amount, view.loan.emi_frequency) for view in loans
            ),
            monthly_subscriptions=sum(view.monthly_cost for view in subscriptions),
            annual_subscriptions=sum(view.annual_cost for view in subscriptions),
            active_subscriptions=len(subscriptions),
            upcoming_bills=_total(
                item for item in unsettled if item.kind == "bill" and item.due_date <= horizon
            ),
            due_this_month=_total(item for item in unsettled if item.due_date <= month_end),
            overdue=_total(item for item in items if item.status == "overdue"),
        )

    # Reminders

    async def after_delivery(self, reminder: Reminder, now: datetime) -> None:
        """Point a commitment's reminder at its next payment once it has fired. Called by the
        reminder worker inside its delivery transaction, which commits."""
        # A deposit's maturity reminder fires once; nothing follows it.
        if reminder.commitment is not None and reminder.commitment.kind != "deposit":
            await self._sync_reminder(reminder.workspace_id, reminder.commitment, now)

    async def _sync_reminder(
        self, workspace_id: uuid.UUID, link: CommitmentLink, now: datetime
    ) -> None:
        """Keep the commitment's one reminder announcing its next unsettled payment whose
        reminder time is still ahead; delete it when there's nothing to announce (reminders off,
        the commitment paused, closed, or finished). Idempotent."""
        settings, label, targets = await self._reminder_targets(workspace_id, link, now)
        reminder: ReminderTarget | None = None
        if settings is not None:
            zone = ZoneInfo(settings.timezone)
            for due, amount, estimated, currency in islice(targets, _REMINDER_SEARCH_LIMIT):
                start = due - timedelta(days=settings.days_before)
                if local_to_utc(start, settings.time_of_day, zone) > now:
                    prefix = "About " if estimated else ""
                    reminder = ReminderTarget(
                        schedule=Schedule(
                            start_date=start,
                            time_of_day=settings.time_of_day,
                            timezone=settings.timezone,
                        ),
                        title=f"{label} due {_short_date(due)}",
                        description=f"{prefix}{currency} {to_decimal_string(amount, currency)}",
                    )
                    break
        await point_reminder(self._reminders, self._scheduler, workspace_id, link, reminder, now)

    async def _reminder_targets(
        self, workspace_id: uuid.UUID, link: CommitmentLink, now: datetime
    ) -> tuple[ReminderSettings | None, str, Iterator[tuple[date, int, bool, Currency]]]:
        """The commitment's reminder settings, its label, and its unsettled payments in order."""
        if link.kind == "loan":
            loan = await self._loans.get(workspace_id, link.id)
            if loan is None or loan.status != "active":
                return None, "", iter(())
            scheduled: list[tuple[date, int, bool, Currency]] = [
                (entry.due_date, entry.amount, False, loan.currency)
                for entry in await self._installments.for_loan(workspace_id, loan.id)
                if entry.state == "scheduled"
            ]
            return loan.reminder, f"{loan.name} EMI", iter(sorted(scheduled))
        payment = await self._recurring.get(workspace_id, link.id)
        if payment is None or payment.state != "active":
            return None, "", iter(())
        settled = {
            entry.due_date for entry in await self._settled.for_payment(workspace_id, payment.id)
        }
        # Earlier due dates' reminder times are certainly past, in any time zone.
        start = max(payment.anchor_date, now.date() - timedelta(days=1))
        label = f"{payment.name} renewal" if payment.kind == "subscription" else payment.name
        return (
            payment.reminder,
            label,
            (
                (due, payment.amount, payment.amount_varies, payment.currency)
                for due in due_dates(
                    payment.anchor_date, payment.frequency, start=start, end=payment.end_date
                )
                if due not in settled
            ),
        )

    # Helpers

    async def _loan_items(self, workspace_id: uuid.UUID, query: PaymentQuery) -> list[PaymentItem]:
        loans = {loan.id: loan for loan in await self._loans.list(workspace_id)}
        found = await self._installments.find(
            workspace_id,
            query.date_from,
            query.date_to,
            query.today if query.include_overdue else None,
        )
        items: list[PaymentItem] = []
        for installment in found:
            loan = loans.get(installment.loan_id)
            # Closed and archived loans expect nothing more; their history still shows.
            if loan is None or (installment.state == "scheduled" and loan.status != "active"):
                continue
            items.append(
                PaymentItem(
                    kind="loan",
                    commitment_id=loan.id,
                    occurrence_id=installment.id,
                    name=loan.name,
                    counterparty=loan.lender,
                    amount=installment.amount,
                    estimated=False,
                    currency=loan.currency,
                    due_date=installment.due_date,
                    status=payment_status(installment.state, installment.due_date, query.today),
                    account_id=loan.payment_account_id,
                    paid_on=installment.paid_on,
                    transaction_ids=tuple(
                        transaction_id
                        for transaction_id in (
                            installment.principal_transaction_id,
                            installment.interest_transaction_id,
                        )
                        if transaction_id is not None
                    ),
                    principal=installment.principal,
                    interest=installment.interest,
                )
            )
        return items

    async def _recurring_items(
        self, workspace_id: uuid.UUID, query: PaymentQuery
    ) -> list[PaymentItem]:
        settled = _group(await self._settled.for_workspace(workspace_id))
        items: list[PaymentItem] = []
        for payment in await self._recurring.list(workspace_id):
            if query.kinds and payment.kind not in query.kinds:
                continue
            history = settled.get(payment.id, [])
            for occurrence in history:
                if query.date_from <= occurrence.due_date <= query.date_to:
                    items.append(_settled_item(payment, occurrence, query.today))
            if payment.state != "active":
                continue
            settled_dates = {entry.due_date for entry in history}
            start = query.date_from
            overdue: list[date] = []
            if query.include_overdue and payment.anchor_date < query.date_from:
                end = min(query.date_from, query.today) - timedelta(days=1)
                if payment.end_date is not None:
                    end = min(end, payment.end_date)
                overdue = [
                    due
                    for due in due_dates(payment.anchor_date, payment.frequency, end=end)
                    if due not in settled_dates
                ][-MAX_OVERDUE_PER_COMMITMENT:]
            end = (
                query.date_to if payment.end_date is None else min(query.date_to, payment.end_date)
            )
            in_range = [
                due
                for due in due_dates(payment.anchor_date, payment.frequency, start=start, end=end)
                if due not in settled_dates
            ]
            for due in [*overdue, *in_range]:
                items.append(_expected_item(payment, due, query.today))
        return items

    async def _get_loan(self, workspace_id: uuid.UUID, loan_id: uuid.UUID) -> Loan:
        loan = await self._loans.get(workspace_id, loan_id)
        if loan is None:
            raise LoanNotFoundError
        return loan

    async def _get_installment(
        self, workspace_id: uuid.UUID, loan_id: uuid.UUID, installment_id: uuid.UUID
    ) -> Installment:
        installment = await self._installments.get(workspace_id, loan_id, installment_id)
        if installment is None:
            raise InstallmentNotFoundError
        return installment

    async def _projected(
        self, workspace_id: uuid.UUID, loan: Loan, installment_id: uuid.UUID
    ) -> Installment:
        for installment in _project(
            await self._installments.for_loan(workspace_id, loan.id),
            await self._loan_outstanding(loan),
        ):
            if installment.id == installment_id:
                return installment
        raise InstallmentNotFoundError

    async def _get_recurring(
        self, workspace_id: uuid.UUID, payment_id: uuid.UUID
    ) -> RecurringPayment:
        payment = await self._recurring.get(workspace_id, payment_id)
        if payment is None:
            raise RecurringPaymentNotFoundError
        return payment

    async def _loan_outstanding(self, loan: Loan) -> int:
        try:
            return _outstanding(await self._finance.account(loan.workspace_id, loan.account_id))
        except AccountNotFoundError:
            return 0

    async def _loan_interest_category(self, workspace_id: uuid.UUID) -> uuid.UUID | None:
        # Reading the categories seeds the built-in ones, "Loan interest" among them.
        for category in await self._finance.categories(workspace_id):
            if category.key == LOAN_INTEREST_KEY:
                return category.id
        return None

    async def _payment_account(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID, currency: Currency
    ) -> None:
        try:
            view = await self._finance.account(workspace_id, account_id)
        except AccountNotFoundError:
            raise InvalidCommitmentError("That account doesn't exist in this workspace.") from None
        account = view.account
        if account.type == "loan":
            raise InvalidCommitmentError("Payments can't come from a loan account.")
        if account.archived_at is not None:
            raise InvalidCommitmentError(f"“{account.name}” is archived. Restore it first.")
        if account.currency != currency:
            raise InvalidCommitmentError(f"Choose an account in {currency}.")

    async def _check_recurring_refs(
        self,
        workspace_id: uuid.UUID,
        category_id: uuid.UUID | None,
        account_id: uuid.UUID | None,
        currency: Currency,
    ) -> None:
        if account_id is not None:
            await self._payment_account(workspace_id, account_id, currency)
        if category_id is not None:
            categories = {entry.id: entry for entry in await self._finance.categories(workspace_id)}
            category = categories.get(category_id)
            if category is None:
                raise InvalidCommitmentError("That category doesn't exist in this workspace.")
            if category.type != "expense":
                raise InvalidCommitmentError("Choose an expense category.")

    async def _unlinked(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> Transaction:
        try:
            transaction = await self._finance.get(workspace_id, transaction_id)
        except TransactionNotFoundError:
            raise InvalidCommitmentError(
                "That transaction doesn't exist in this workspace."
            ) from None
        if await self._links.is_linked(workspace_id, transaction_id):
            raise PaymentConflictError("That transaction already records another payment.")
        return transaction

    async def _require_open_due_date(
        self, workspace_id: uuid.UUID, payment: RecurringPayment, due: date
    ) -> None:
        scheduled = next(
            due_dates(payment.anchor_date, payment.frequency, start=due, end=due), None
        )
        if scheduled is None or (payment.end_date is not None and due > payment.end_date):
            raise InvalidCommitmentError("That date isn't on this schedule.")
        for entry in await self._settled.for_payment(workspace_id, payment.id):
            if entry.due_date == due:
                raise PaymentConflictError(_already_settled(entry))

    async def _add_settled(self, occurrence: SettledOccurrence) -> None:
        try:
            await self._settled.add(occurrence)
        except ConflictError:
            await self._unit_of_work.rollback()
            raise PaymentConflictError(
                "That payment was already recorded, or its transaction pays something else."
            ) from None

    async def _save_installment(self, installment: Installment, expected: InstallmentState) -> None:
        try:
            saved = await self._installments.save(installment, expected_state=expected)
        except ConflictError:
            saved = False
        if not saved:
            await self._unit_of_work.rollback()
            raise PaymentConflictError(
                "This installment changed in the meantime, or its transaction pays something "
                "else. Refresh and try again."
            )

    async def _commit_or_conflict(self) -> None:
        try:
            await self._unit_of_work.commit()
        except ConflictError:
            raise PaymentConflictError(
                "Something changed in the meantime. Refresh and try again."
            ) from None


def _months(loan: Loan) -> int:
    return {"monthly": 1, "quarterly": 3, "half_yearly": 6, "yearly": 12}[loan.emi_frequency]


def _require_scheduled(installment: Installment) -> None:
    if installment.state == "paid":
        raise PaymentConflictError("This installment is already paid.")
    if installment.state == "skipped":
        raise PaymentConflictError("This installment was skipped. Undo that first.")


def _already_settled(entry: SettledOccurrence) -> str:
    if entry.state == "paid":
        return "That payment is already recorded."
    return "That payment was skipped. Undo that first."


def _group(occurrences: Iterable[SettledOccurrence]) -> dict[uuid.UUID, list[SettledOccurrence]]:
    grouped: dict[uuid.UUID, list[SettledOccurrence]] = {}
    for entry in occurrences:
        grouped.setdefault(entry.recurring_payment_id, []).append(entry)
    return grouped


def _total(items: Iterable[PaymentItem]) -> Total:
    chosen = list(items)
    return Total(count=len(chosen), amount=sum(item.amount for item in chosen))


def _loan_view(loan: Loan, outstanding: int, installments: list[Installment]) -> LoanView:
    scheduled = sorted(
        (entry for entry in installments if entry.state == "scheduled"),
        key=lambda entry: (entry.due_date, entry.sequence),
    )
    return LoanView(
        loan=loan,
        outstanding=outstanding,
        next_installment=scheduled[0] if scheduled else None,
        paid_installments=sum(1 for entry in installments if entry.state == "paid"),
        total_installments=len(installments),
        remaining_interest=sum(entry.interest for entry in scheduled),
    )


def _next_unsettled(payment: RecurringPayment, settled: set[date], start: date) -> date | None:
    for due in islice(
        due_dates(payment.anchor_date, payment.frequency, start=start, end=payment.end_date),
        _REMINDER_SEARCH_LIMIT,
    ):
        if due not in settled:
            return due
    return None


def _recurring_view(
    payment: RecurringPayment, settled: list[SettledOccurrence], today: date
) -> RecurringView:
    status: RecurringStatus = payment.state
    if payment.state == "active" and payment.end_date is not None and payment.end_date < today:
        status = "expired"
    settled_dates = {entry.due_date for entry in settled}
    next_due = (
        _next_unsettled(payment, settled_dates, payment.anchor_date)
        if payment.state == "active"
        else None
    )
    overdue = 0
    if payment.state == "active":
        end = today - timedelta(days=1)
        if payment.end_date is not None:
            end = min(end, payment.end_date)
        overdue = sum(
            1
            for due in due_dates(payment.anchor_date, payment.frequency, end=end)
            if due not in settled_dates
        )
    paid = [entry.paid_on for entry in settled if entry.paid_on is not None]
    return RecurringView(
        payment=payment,
        status=status,
        next_due_date=next_due,
        overdue=overdue,
        monthly_cost=monthly_equivalent(payment.amount, payment.frequency),
        annual_cost=annual_equivalent(payment.amount, payment.frequency),
        last_paid_on=max(paid) if paid else None,
    )


def _kind_of(payment: RecurringPayment) -> CommitmentKind:
    return payment.kind


def _settled_item(
    payment: RecurringPayment, occurrence: SettledOccurrence, today: date
) -> PaymentItem:
    return PaymentItem(
        kind=_kind_of(payment),
        commitment_id=payment.id,
        occurrence_id=occurrence.id,
        name=payment.name,
        counterparty=payment.provider,
        amount=occurrence.amount if occurrence.amount is not None else payment.amount,
        estimated=False,
        currency=payment.currency,
        due_date=occurrence.due_date,
        status=payment_status(occurrence.state, occurrence.due_date, today),
        account_id=payment.account_id,
        paid_on=occurrence.paid_on,
        transaction_ids=(occurrence.transaction_id,) if occurrence.transaction_id else (),
    )


def _expected_item(payment: RecurringPayment, due: date, today: date) -> PaymentItem:
    return PaymentItem(
        kind=_kind_of(payment),
        commitment_id=payment.id,
        occurrence_id=None,
        name=payment.name,
        counterparty=payment.provider,
        amount=payment.amount,
        estimated=payment.amount_varies,
        currency=payment.currency,
        due_date=due,
        status=payment_status(None, due, today),
        account_id=payment.account_id,
        paid_on=None,
        transaction_ids=(),
    )
