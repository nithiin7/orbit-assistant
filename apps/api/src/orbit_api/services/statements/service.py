"""Importing a bank statement into an account: preview, then confirm, with undo.

The preview reads the file, finds its columns, checks its balances, and proposes what to do with
each row. Nothing is written until the person confirms the rows they reviewed; the import is then
one transaction, all or nothing. Statement files and passwords are never stored or logged.

Every method takes a `workspace_id` the caller has already authorized, and every lookup is
filtered by it.
"""

import asyncio
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Final, Literal, Protocol

from orbit_api.services.commitments.models import (
    CommitmentKind,
    Installment,
    InstallmentNotFoundError,
    InstallmentPayment,
    InvalidCommitmentError,
    LoanNotFoundError,
    OccurrenceNotFoundError,
    PaymentConflictError,
    PaymentItem,
    PaymentQuery,
    RecurringPaymentNotFoundError,
    RecurringPaymentRecord,
    SettledOccurrence,
)
from orbit_api.services.finance.models import (
    Account,
    InvalidTransactionError,
    Transaction,
    TransactionDraft,
    TransactionType,
)
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.statements.columns import ColumnMap, find_header
from orbit_api.services.statements.matching import (
    LEDGER_WINDOW,
    PAYMENT_WINDOW,
    MatchContext,
    Proposal,
    propose,
)
from orbit_api.services.statements.parsing import (
    DateOrder,
    Direction,
    merchant_key,
    parse_rows,
    with_fingerprints,
)
from orbit_api.services.statements.readers import (
    StatementPasswordRequiredError,
    StatementPasswordWrongError,
    StatementSource,
    StatementUnreadableError,
    read_statement,
)
from orbit_api.services.transactions import Transaction as UnitOfWork
from orbit_api.utils.clock import utc_now

MAX_IMPORT_ROWS: Final = 5_000

PreviewStatus = Literal["ready", "needs_mapping", "password_required", "wrong_password"]


class InvalidImportError(Exception):
    """The import breaks a rule. `message` is written for the person."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ImportNotFoundError(Exception):
    """No such import in this workspace."""


@dataclass(frozen=True, slots=True)
class PreviewOptions:
    password: str | None = None
    # A mapping the person chose, with the row its header is on; `None` finds it automatically.
    columns: ColumnMap | None = None
    header_row: int | None = None
    date_order: DateOrder | None = None


@dataclass(frozen=True, slots=True)
class StatementPreview:
    status: PreviewStatus
    source: StatementSource | None = None
    # The cells of the header row (or the widest row near the top when none was recognized).
    headers: tuple[str, ...] = ()
    header_row: int | None = None
    columns: ColumnMap | None = None
    needs_date_order: bool = False
    proposals: tuple[Proposal, ...] = ()


@dataclass(frozen=True, slots=True)
class SettleTarget:
    kind: CommitmentKind
    commitment_id: uuid.UUID
    occurrence_id: uuid.UUID | None
    due_date: date


@dataclass(frozen=True, slots=True)
class ImportRow:
    """A row the person confirmed. Skipped rows are left out."""

    fingerprint: str
    occurred_on: date
    description: str
    amount: int
    direction: Direction
    action: Literal["create", "settle", "transfer"]
    type: TransactionType = "expense"
    category_id: uuid.UUID | None = None
    to_account_id: uuid.UUID | None = None
    settle: SettleTarget | None = None


@dataclass(frozen=True, slots=True)
class ImportResult:
    batch_id: uuid.UUID
    created: int
    settled: int
    # Rows that were already imported, from an earlier import or a repeated request.
    already_imported: int


@dataclass(frozen=True, slots=True)
class UndoResult:
    removed: int
    # Transactions kept because something else now depends on them, such as a payment.
    kept: int


class StatementStore(Protocol):
    async def known(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID, fingerprints: list[str]
    ) -> dict[str, uuid.UUID | None]:
        """The fingerprints imported before, with the transaction each still has, if any."""
        ...

    async def rules(self, workspace_id: uuid.UUID) -> dict[str, uuid.UUID]: ...

    async def set_rule(
        self, workspace_id: uuid.UUID, key: str, category_id: uuid.UUID, now: datetime
    ) -> None: ...

    async def add_batch(
        self, workspace_id: uuid.UUID, batch_id: uuid.UUID, account_id: uuid.UUID, now: datetime
    ) -> None: ...

    async def add_row(
        self,
        workspace_id: uuid.UUID,
        account_id: uuid.UUID,
        batch_id: uuid.UUID,
        fingerprint: str,
        transaction_id: uuid.UUID | None,
    ) -> None: ...

    async def batch_exists(self, workspace_id: uuid.UUID, batch_id: uuid.UUID) -> bool: ...

    async def undo_batch(self, workspace_id: uuid.UUID, batch_id: uuid.UUID) -> UndoResult:
        """Delete the batch's transactions that nothing else depends on, and forget their rows.
        The batch goes too once none of its rows are left."""
        ...


class CommitmentPayments(Protocol):
    async def payments(self, workspace_id: uuid.UUID, query: PaymentQuery) -> list[PaymentItem]: ...

    async def record_payment(
        self,
        workspace_id: uuid.UUID,
        payment_id: uuid.UUID,
        record: RecurringPaymentRecord,
        today: date,
    ) -> SettledOccurrence: ...

    async def pay_installment(
        self,
        workspace_id: uuid.UUID,
        loan_id: uuid.UUID,
        installment_id: uuid.UUID,
        payment: InstallmentPayment,
    ) -> Installment: ...


class StatementImportService:
    def __init__(
        self,
        store: StatementStore,
        finance: FinanceService,
        commitments: CommitmentPayments,
        unit_of_work: UnitOfWork,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        """`finance` and `commitments` must defer their commits (flush only), so that an import
        commits once, here."""
        self._store = store
        self._finance = finance
        self._commitments = commitments
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def preview(
        self,
        workspace_id: uuid.UUID,
        account_id: uuid.UUID,
        data: bytes,
        options: PreviewOptions,
        today: date,
    ) -> StatementPreview:
        account = await self._open_account(workspace_id, account_id)
        try:
            table = await asyncio.to_thread(read_statement, data, options.password)
        except StatementPasswordRequiredError:
            return StatementPreview("password_required")
        except StatementPasswordWrongError:
            return StatementPreview("wrong_password")
        except StatementUnreadableError as error:
            raise InvalidImportError(error.message) from None

        if options.columns is not None and options.header_row is not None:
            header_row, columns = options.header_row, options.columns
            if header_row >= len(table.rows):
                raise InvalidImportError("That header row isn't in this statement.")
        else:
            found = find_header(table.rows)
            if found is None:
                widest = max(range(min(len(table.rows), 40)), key=lambda i: len(table.rows[i]))
                return StatementPreview(
                    "needs_mapping",
                    table.source,
                    tuple(table.rows[widest]),
                    header_row=widest,
                )
            header_row, columns = found.row, found.columns
        headers = tuple(table.rows[header_row])
        _check_columns(columns, len(headers))

        parsed = parse_rows(
            table.rows[header_row + 1 :],
            columns,
            account.currency,
            table.source,
            options.date_order,
        )
        if parsed.needs_date_order:
            return StatementPreview(
                "needs_mapping", table.source, headers, header_row, columns, needs_date_order=True
            )
        if not parsed.rows:
            raise InvalidImportError("Orbit found no transactions in this statement.")
        if len(parsed.rows) > MAX_IMPORT_ROWS:
            raise InvalidImportError(
                f"Import at most {MAX_IMPORT_ROWS:,} transactions at a time. Choose a shorter "
                "period."
            )

        rows = with_fingerprints(parsed.rows, str(account_id))
        first = min(row.occurred_on for row in rows)
        last = max(row.occurred_on for row in rows)
        ledger, _, categories = await self._finance.export(
            workspace_id, first - LEDGER_WINDOW, last + LEDGER_WINDOW
        )
        payments = await self._commitments.payments(
            workspace_id,
            PaymentQuery(
                today=today,
                date_from=first - PAYMENT_WINDOW - timedelta(days=31),
                date_to=last + PAYMENT_WINDOW,
            ),
        )
        context = MatchContext(
            account_id=account_id,
            currency=account.currency,
            known=await self._store.known(
                workspace_id, account_id, [row.fingerprint for row in rows]
            ),
            ledger=ledger,
            payments=payments,
            rules=await self._store.rules(workspace_id),
            categories=categories,
        )
        return StatementPreview(
            "ready",
            table.source,
            headers,
            header_row,
            columns,
            proposals=tuple(propose(rows, context)),
        )

    async def import_rows(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID, rows: list[ImportRow], today: date
    ) -> ImportResult:
        account = await self._open_account(workspace_id, account_id)
        if len({row.fingerprint for row in rows}) != len(rows):
            raise InvalidImportError("Each statement row can be imported once.")
        known = await self._store.known(workspace_id, account_id, [row.fingerprint for row in rows])
        now = self._clock()
        batch_id = uuid.uuid4()
        await self._store.add_batch(workspace_id, batch_id, account_id, now)
        created = settled = 0
        try:
            for row in rows:
                if row.fingerprint in known:
                    continue
                transaction_id = await self._apply(workspace_id, account, row, today, now)
                await self._store.add_row(
                    workspace_id, account_id, batch_id, row.fingerprint, transaction_id
                )
                if row.action == "settle":
                    settled += 1
                else:
                    created += 1
        except InvalidImportError:
            await self._unit_of_work.rollback()
            raise
        await self._unit_of_work.commit()
        return ImportResult(
            batch_id, created, settled, already_imported=len(rows) - created - settled
        )

    async def undo(self, workspace_id: uuid.UUID, batch_id: uuid.UUID) -> UndoResult:
        if not await self._store.batch_exists(workspace_id, batch_id):
            raise ImportNotFoundError
        result = await self._store.undo_batch(workspace_id, batch_id)
        await self._unit_of_work.commit()
        return result

    async def _open_account(self, workspace_id: uuid.UUID, account_id: uuid.UUID) -> Account:
        account = (await self._finance.account(workspace_id, account_id)).account
        if account.archived_at is not None:
            raise InvalidImportError(f"“{account.name}” is archived. Restore it to import.")
        return account

    async def _apply(
        self,
        workspace_id: uuid.UUID,
        account: Account,
        row: ImportRow,
        today: date,
        now: datetime,
    ) -> uuid.UUID | None:
        if row.action == "settle":
            return await self._settle(workspace_id, account, row, today)
        if row.action == "transfer":
            if row.to_account_id is None:
                raise InvalidImportError("Choose the other account for each transfer.")
            source, destination = (
                (account.id, row.to_account_id)
                if row.direction == "out"
                else (row.to_account_id, account.id)
            )
            draft = TransactionDraft(
                type="transfer",
                amount=row.amount,
                occurred_on=row.occurred_on,
                description=row.description,
                account_id=source,
                to_account_id=destination,
            )
        else:
            allowed: tuple[TransactionType, ...] = (
                ("expense",) if row.direction == "out" else ("income", "refund")
            )
            if row.type not in allowed:
                raise InvalidImportError("Money out is spending; money in is income or a refund.")
            draft = TransactionDraft(
                type=row.type,
                amount=row.amount,
                occurred_on=row.occurred_on,
                description=row.description,
                account_id=account.id,
                category_id=row.category_id,
            )
        transaction = await self._create(workspace_id, draft)
        key = merchant_key(row.description)
        if row.category_id is not None and key:
            await self._store.set_rule(workspace_id, key, row.category_id, now)
        return transaction.id

    async def _create(self, workspace_id: uuid.UUID, draft: TransactionDraft) -> Transaction:
        try:
            return await self._finance.create(workspace_id, draft, commit=False)
        except InvalidTransactionError as error:
            raise InvalidImportError(error.message) from None

    async def _settle(
        self, workspace_id: uuid.UUID, account: Account, row: ImportRow, today: date
    ) -> uuid.UUID | None:
        target = row.settle
        if target is None or row.direction != "out":
            raise InvalidImportError("Only money paid out can settle a bill or EMI.")
        try:
            if target.kind == "loan":
                if target.occurrence_id is None:
                    raise InvalidImportError("Choose the EMI this payment settles.")
                await self._commitments.pay_installment(
                    workspace_id,
                    target.commitment_id,
                    target.occurrence_id,
                    InstallmentPayment(paid_on=row.occurred_on, from_account_id=account.id),
                )
                return None
            occurrence = await self._commitments.record_payment(
                workspace_id,
                target.commitment_id,
                RecurringPaymentRecord(
                    due_date=target.due_date,
                    paid_on=row.occurred_on,
                    mode="create",
                    amount=row.amount,
                    account_id=account.id,
                ),
                today,
            )
        except (InvalidCommitmentError, PaymentConflictError) as error:
            raise InvalidImportError(error.message) from None
        except (
            LoanNotFoundError,
            InstallmentNotFoundError,
            RecurringPaymentNotFoundError,
            OccurrenceNotFoundError,
        ):
            raise InvalidImportError(
                "A bill or EMI in this import no longer exists. Preview the statement again."
            ) from None
        return occurrence.transaction_id


def _check_columns(columns: ColumnMap, width: int) -> None:
    positions = [
        position
        for position in (
            columns.date,
            columns.description,
            columns.withdrawal,
            columns.deposit,
            columns.amount,
            columns.direction,
            columns.balance,
        )
        if position is not None
    ]
    if not columns.is_complete:
        raise InvalidImportError(
            "Choose the amount column, or both the withdrawal and deposit columns."
        )
    if any(position < 0 or position >= width for position in positions):
        raise InvalidImportError("A chosen column isn't in this statement.")
    if len(set(positions)) != len(positions):
        raise InvalidImportError("Choose a different column for each field.")
