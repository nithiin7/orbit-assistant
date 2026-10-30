"""Loans, installments, recurring payments, and their settled occurrences. Every query is filtered
by workspace, so callers cannot reach other workspaces' rows."""

import uuid
from collections.abc import Callable
from datetime import date, datetime
from typing import Any, cast

from sqlalchemy import case, delete, exists, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    FinanceLoanInstallmentModel,
    FinanceLoanModel,
    FinanceRecurringOccurrenceModel,
    FinanceRecurringPaymentModel,
)
from orbit_api.db.models.commitments import ReminderColumns
from orbit_api.repositories.finance import (
    SqlFinanceAccountRepository,
    SqlFinanceCategoryRepository,
    SqlFinanceTransactionRepository,
)
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.commitments.models import (
    Installment,
    InstallmentState,
    Loan,
    LoanNotFoundError,
    LoanStatus,
    LoanType,
    RecurringKind,
    RecurringPayment,
    RecurringPaymentNotFoundError,
    RecurringState,
    ReminderSettings,
    SettledOccurrence,
    SettledState,
)
from orbit_api.services.commitments.schedule import EmiFrequency, Frequency, InterestMethod
from orbit_api.services.commitments.service import CommitmentService
from orbit_api.services.finance.money import Currency
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.transactions import ConflictError

_Loan = FinanceLoanModel
_Installment = FinanceLoanInstallmentModel
_Recurring = FinanceRecurringPaymentModel
_Settled = FinanceRecurringOccurrenceModel


def reminder_of(model: ReminderColumns) -> ReminderSettings | None:
    # A CHECK constraint sets all three together or none.
    if (
        model.reminder_days_before is None
        or model.reminder_time is None
        or model.reminder_timezone is None
    ):
        return None
    return ReminderSettings(
        days_before=model.reminder_days_before,
        time_of_day=model.reminder_time,
        timezone=model.reminder_timezone,
    )


def reminder_columns(settings: ReminderSettings | None) -> dict[str, Any]:
    return {
        "reminder_days_before": settings.days_before if settings else None,
        "reminder_time": settings.time_of_day if settings else None,
        "reminder_timezone": settings.timezone if settings else None,
    }


# The tables' CHECK constraints limit the enumerated columns to these values.


def _to_loan(model: FinanceLoanModel) -> Loan:
    return Loan(
        id=model.id,
        workspace_id=model.workspace_id,
        account_id=model.account_id,
        payment_account_id=model.payment_account_id,
        name=model.name,
        lender=model.lender,
        loan_type=cast(LoanType, model.loan_type),
        currency=cast(Currency, model.currency),
        principal=model.principal,
        interest_rate_bps=model.interest_rate_bps,
        interest_method=cast(InterestMethod, model.interest_method),
        start_date=model.start_date,
        tenure_months=model.tenure_months,
        emi_amount=model.emi_amount,
        emi_frequency=cast(EmiFrequency, model.emi_frequency),
        first_payment_date=model.first_payment_date,
        notes=model.notes,
        status=cast(LoanStatus, model.status),
        reminder=reminder_of(model),
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _loan_fields(loan: Loan) -> dict[str, Any]:
    return {
        "payment_account_id": loan.payment_account_id,
        "name": loan.name,
        "lender": loan.lender,
        "loan_type": loan.loan_type,
        "interest_rate_bps": loan.interest_rate_bps,
        "emi_amount": loan.emi_amount,
        "notes": loan.notes,
        "status": loan.status,
        "updated_at": loan.updated_at,
        **reminder_columns(loan.reminder),
    }


def _to_installment(model: FinanceLoanInstallmentModel) -> Installment:
    return Installment(
        id=model.id,
        workspace_id=model.workspace_id,
        loan_id=model.loan_id,
        sequence=model.sequence,
        due_date=model.due_date,
        principal=model.principal,
        interest=model.interest,
        balance_after=model.balance_after,
        state=cast(InstallmentState, model.state),
        paid_on=model.paid_on,
        principal_transaction_id=model.principal_transaction_id,
        interest_transaction_id=model.interest_transaction_id,
        adjusted=model.adjusted,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _installment_fields(installment: Installment) -> dict[str, Any]:
    return {
        "due_date": installment.due_date,
        "principal": installment.principal,
        "interest": installment.interest,
        "balance_after": installment.balance_after,
        "state": installment.state,
        "paid_on": installment.paid_on,
        "principal_transaction_id": installment.principal_transaction_id,
        "interest_transaction_id": installment.interest_transaction_id,
        "adjusted": installment.adjusted,
        "updated_at": installment.updated_at,
    }


def _to_recurring(model: FinanceRecurringPaymentModel) -> RecurringPayment:
    return RecurringPayment(
        id=model.id,
        workspace_id=model.workspace_id,
        kind=cast(RecurringKind, model.kind),
        name=model.name,
        provider=model.provider,
        category_id=model.category_id,
        account_id=model.account_id,
        amount=model.amount,
        currency=cast(Currency, model.currency),
        amount_varies=model.amount_varies,
        frequency=cast(Frequency, model.frequency),
        start_date=model.start_date,
        anchor_date=model.anchor_date,
        end_date=model.end_date,
        trial_ends_on=model.trial_ends_on,
        auto_renew=model.auto_renew,
        state=cast(RecurringState, model.state),
        notes=model.notes,
        reminder=reminder_of(model),
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _recurring_fields(payment: RecurringPayment) -> dict[str, Any]:
    return {
        "name": payment.name,
        "provider": payment.provider,
        "category_id": payment.category_id,
        "account_id": payment.account_id,
        "amount": payment.amount,
        "amount_varies": payment.amount_varies,
        "frequency": payment.frequency,
        "start_date": payment.start_date,
        "anchor_date": payment.anchor_date,
        "end_date": payment.end_date,
        "trial_ends_on": payment.trial_ends_on,
        "auto_renew": payment.auto_renew,
        "state": payment.state,
        "notes": payment.notes,
        "updated_at": payment.updated_at,
        **reminder_columns(payment.reminder),
    }


def _to_settled(model: FinanceRecurringOccurrenceModel) -> SettledOccurrence:
    return SettledOccurrence(
        id=model.id,
        workspace_id=model.workspace_id,
        recurring_payment_id=model.recurring_payment_id,
        due_date=model.due_date,
        state=cast(SettledState, model.state),
        amount=model.amount,
        paid_on=model.paid_on,
        transaction_id=model.transaction_id,
        created_at=model.created_at,
    )


def _status_order(column: Any, values: tuple[str, ...]) -> Any:
    return case({value: index for index, value in enumerate(values)}, value=column)


class SqlLoanRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, loan: Loan) -> None:
        self._session.add(
            FinanceLoanModel(
                id=loan.id,
                workspace_id=loan.workspace_id,
                account_id=loan.account_id,
                currency=loan.currency,
                principal=loan.principal,
                interest_method=loan.interest_method,
                start_date=loan.start_date,
                tenure_months=loan.tenure_months,
                emi_frequency=loan.emi_frequency,
                first_payment_date=loan.first_payment_date,
                created_at=loan.created_at,
                **_loan_fields(loan),
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, loan_id: uuid.UUID) -> Loan | None:
        model = await self._get_model(workspace_id, loan_id)
        return _to_loan(model) if model else None

    async def list(self, workspace_id: uuid.UUID) -> list[Loan]:
        models = await self._session.scalars(
            select(_Loan)
            .where(_Loan.workspace_id == workspace_id)
            .order_by(
                _status_order(_Loan.status, ("active", "closed", "archived")), _Loan.name, _Loan.id
            )
        )
        return [_to_loan(model) for model in models]

    async def save(self, loan: Loan) -> None:
        model = await self._get_model(loan.workspace_id, loan.id)
        if model is None:
            raise LoanNotFoundError
        for name, value in _loan_fields(loan).items():
            setattr(model, name, value)
        await flush(self._session)

    async def _get_model(
        self, workspace_id: uuid.UUID, loan_id: uuid.UUID
    ) -> FinanceLoanModel | None:
        return await self._session.scalar(
            select(_Loan).where(_Loan.id == loan_id, _Loan.workspace_id == workspace_id)
        )


class SqlInstallmentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, installment: Installment) -> None:
        self._session.add(
            FinanceLoanInstallmentModel(
                id=installment.id,
                workspace_id=installment.workspace_id,
                loan_id=installment.loan_id,
                sequence=installment.sequence,
                created_at=installment.created_at,
                **_installment_fields(installment),
            )
        )
        await flush(self._session)

    async def get(
        self, workspace_id: uuid.UUID, loan_id: uuid.UUID, installment_id: uuid.UUID
    ) -> Installment | None:
        model = await self._session.scalar(
            select(_Installment).where(
                _Installment.id == installment_id,
                _Installment.loan_id == loan_id,
                _Installment.workspace_id == workspace_id,
            )
        )
        return _to_installment(model) if model else None

    async def for_loan(self, workspace_id: uuid.UUID, loan_id: uuid.UUID) -> list[Installment]:
        models = await self._session.scalars(
            select(_Installment)
            .where(_Installment.workspace_id == workspace_id, _Installment.loan_id == loan_id)
            .order_by(_Installment.due_date, _Installment.sequence)
        )
        return [_to_installment(model) for model in models]

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[Installment]:
        models = await self._session.scalars(
            select(_Installment)
            .where(_Installment.workspace_id == workspace_id)
            .order_by(_Installment.due_date, _Installment.sequence)
        )
        return [_to_installment(model) for model in models]

    async def find(
        self,
        workspace_id: uuid.UUID,
        date_from: date,
        date_to: date,
        scheduled_before: date | None,
    ) -> list[Installment]:
        in_range = _Installment.due_date.between(date_from, date_to)
        condition = in_range
        if scheduled_before is not None:
            condition = or_(
                in_range,
                (_Installment.state == "scheduled") & (_Installment.due_date < scheduled_before),
            )
        models = await self._session.scalars(
            select(_Installment)
            .where(_Installment.workspace_id == workspace_id, condition)
            .order_by(_Installment.due_date, _Installment.sequence)
        )
        return [_to_installment(model) for model in models]

    async def save(self, installment: Installment, *, expected_state: InstallmentState) -> bool:
        # A conditional update: if another request settled the installment first, nothing
        # matches and the caller reports a conflict.
        try:
            rows = await self._session.execute(
                update(_Installment)
                .where(
                    _Installment.id == installment.id,
                    _Installment.workspace_id == installment.workspace_id,
                    _Installment.state == expected_state,
                )
                .values(**_installment_fields(installment))
                .returning(_Installment.id)
            )
            return rows.first() is not None
        except IntegrityError as exc:
            # A transaction that already pays another installment.
            raise ConflictError from exc

    async def delete_scheduled(self, workspace_id: uuid.UUID, loan_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(_Installment).where(
                _Installment.workspace_id == workspace_id,
                _Installment.loan_id == loan_id,
                _Installment.state == "scheduled",
            )
        )


class SqlRecurringPaymentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, payment: RecurringPayment) -> None:
        self._session.add(
            FinanceRecurringPaymentModel(
                id=payment.id,
                workspace_id=payment.workspace_id,
                kind=payment.kind,
                currency=payment.currency,
                created_at=payment.created_at,
                **_recurring_fields(payment),
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, payment_id: uuid.UUID) -> RecurringPayment | None:
        model = await self._get_model(workspace_id, payment_id)
        return _to_recurring(model) if model else None

    async def list(
        self, workspace_id: uuid.UUID, kind: RecurringKind | None = None
    ) -> list[RecurringPayment]:
        statement = select(_Recurring).where(_Recurring.workspace_id == workspace_id)
        if kind is not None:
            statement = statement.where(_Recurring.kind == kind)
        models = await self._session.scalars(
            statement.order_by(
                _status_order(_Recurring.state, ("active", "paused", "cancelled")),
                _Recurring.name,
                _Recurring.id,
            )
        )
        return [_to_recurring(model) for model in models]

    async def save(self, payment: RecurringPayment) -> None:
        model = await self._get_model(payment.workspace_id, payment.id)
        if model is None:
            raise RecurringPaymentNotFoundError
        for name, value in _recurring_fields(payment).items():
            setattr(model, name, value)
        await flush(self._session)

    async def _get_model(
        self, workspace_id: uuid.UUID, payment_id: uuid.UUID
    ) -> FinanceRecurringPaymentModel | None:
        return await self._session.scalar(
            select(_Recurring).where(
                _Recurring.id == payment_id, _Recurring.workspace_id == workspace_id
            )
        )


class SqlSettledOccurrenceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, occurrence: SettledOccurrence) -> None:
        self._session.add(
            FinanceRecurringOccurrenceModel(
                id=occurrence.id,
                workspace_id=occurrence.workspace_id,
                recurring_payment_id=occurrence.recurring_payment_id,
                due_date=occurrence.due_date,
                state=occurrence.state,
                amount=occurrence.amount,
                paid_on=occurrence.paid_on,
                transaction_id=occurrence.transaction_id,
                created_at=occurrence.created_at,
            )
        )
        await flush(self._session)

    async def get(
        self, workspace_id: uuid.UUID, payment_id: uuid.UUID, occurrence_id: uuid.UUID
    ) -> SettledOccurrence | None:
        model = await self._session.scalar(
            select(_Settled).where(
                _Settled.id == occurrence_id,
                _Settled.recurring_payment_id == payment_id,
                _Settled.workspace_id == workspace_id,
            )
        )
        return _to_settled(model) if model else None

    async def for_payment(
        self, workspace_id: uuid.UUID, payment_id: uuid.UUID
    ) -> list[SettledOccurrence]:
        models = await self._session.scalars(
            select(_Settled)
            .where(
                _Settled.workspace_id == workspace_id, _Settled.recurring_payment_id == payment_id
            )
            .order_by(_Settled.due_date.desc())
        )
        return [_to_settled(model) for model in models]

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[SettledOccurrence]:
        models = await self._session.scalars(
            select(_Settled)
            .where(_Settled.workspace_id == workspace_id)
            .order_by(_Settled.due_date.desc())
        )
        return [_to_settled(model) for model in models]

    async def delete(self, workspace_id: uuid.UUID, occurrence_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(_Settled).where(
                _Settled.id == occurrence_id, _Settled.workspace_id == workspace_id
            )
        )
        await flush(self._session)


class SqlPaymentLinks:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def is_linked(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> bool:
        installment = exists().where(
            _Installment.workspace_id == workspace_id,
            or_(
                _Installment.principal_transaction_id == transaction_id,
                _Installment.interest_transaction_id == transaction_id,
            ),
        )
        occurrence = exists().where(
            _Settled.workspace_id == workspace_id, _Settled.transaction_id == transaction_id
        )
        return bool(await self._session.scalar(select(or_(installment, occurrence))))


def build_commitment_service(
    session: AsyncSession, clock: Callable[[], datetime] | None = None
) -> CommitmentService:
    """A commitment service whose ledger writes, reminder changes, and records all share
    `session`'s transaction. Used by the API per request and by the reminder worker inside each
    delivery transaction."""
    unit_of_work = SqlTransaction(session)
    timing = {"clock": clock} if clock else {}
    finance = FinanceService(
        SqlFinanceAccountRepository(session),
        SqlFinanceCategoryRepository(session),
        SqlFinanceTransactionRepository(session),
        unit_of_work,
        **timing,
    )
    return CommitmentService(
        SqlLoanRepository(session),
        SqlInstallmentRepository(session),
        SqlRecurringPaymentRepository(session),
        SqlSettledOccurrenceRepository(session),
        SqlPaymentLinks(session),
        finance,
        SqlReminderRepository(session),
        SqlOccurrenceRepository(session),
        unit_of_work,
        **timing,
    )
