"""Bank statement import models. Amounts are integers in the account currency's minor unit."""

import uuid
from datetime import date
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from orbit_api.schemas.finance import Amount, Description, TransactionDate
from orbit_api.services.commitments.models import CommitmentKind
from orbit_api.services.finance.models import TransactionType
from orbit_api.services.statements.columns import ColumnMap
from orbit_api.services.statements.matching import ImportAction, Proposal, ProposalReason
from orbit_api.services.statements.parsing import DateOrder, Direction
from orbit_api.services.statements.readers import StatementSource
from orbit_api.services.statements.service import (
    MAX_IMPORT_ROWS,
    ImportResult,
    ImportRow,
    PreviewOptions,
    PreviewStatus,
    SettleTarget,
    StatementPreview,
    UndoResult,
)

Fingerprint = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Column = Annotated[int, Field(ge=0, le=200)]


class StatementPreviewParams(BaseModel):
    """Leave the columns out to find them from the header row. To map them by hand, send
    `header_row`, `date_column`, `description_column`, and either `amount_column` or both
    `withdrawal_column` and `deposit_column`."""

    model_config = ConfigDict(extra="forbid")

    account_id: uuid.UUID
    today: date = Field(description="The person's local date, to tell overdue bills apart.")
    date_order: DateOrder | None = Field(
        default=None, description="Day first (`dmy`) or month first (`mdy`) for numeric dates."
    )
    header_row: Annotated[int, Field(ge=0)] | None = None
    date_column: Column | None = None
    description_column: Column | None = None
    withdrawal_column: Column | None = None
    deposit_column: Column | None = None
    amount_column: Column | None = None
    direction_column: Column | None = None
    balance_column: Column | None = None

    def to_options(self, password: str | None) -> PreviewOptions:
        if self.header_row is None or self.date_column is None or self.description_column is None:
            return PreviewOptions(password=password, date_order=self.date_order)
        return PreviewOptions(
            password=password,
            columns=ColumnMap(
                date=self.date_column,
                description=self.description_column,
                withdrawal=self.withdrawal_column,
                deposit=self.deposit_column,
                amount=self.amount_column,
                direction=self.direction_column,
                balance=self.balance_column,
            ),
            header_row=self.header_row,
            date_order=self.date_order,
        )


class StatementColumnsResponse(BaseModel):
    date: int
    description: int
    withdrawal: int | None
    deposit: int | None
    amount: int | None
    direction: int | None
    balance: int | None

    @classmethod
    def of(cls, columns: ColumnMap) -> Self:
        return cls(
            date=columns.date,
            description=columns.description,
            withdrawal=columns.withdrawal,
            deposit=columns.deposit,
            amount=columns.amount,
            direction=columns.direction,
            balance=columns.balance,
        )


class StatementPaymentMatchResponse(BaseModel):
    kind: CommitmentKind
    commitment_id: uuid.UUID
    occurrence_id: uuid.UUID | None
    due_date: date
    name: str


class StatementRowResponse(BaseModel):
    fingerprint: str
    line: int = Field(description="The row's position below the header, from 1.")
    occurred_on: date
    description: str
    amount: int
    direction: Direction
    balance: int | None
    action: ImportAction = Field(description="What Orbit suggests doing with the row.")
    reason: ProposalReason
    type: TransactionType
    category_id: uuid.UUID | None
    payment: StatementPaymentMatchResponse | None
    duplicate_of: uuid.UUID | None

    @classmethod
    def of(cls, proposal: Proposal) -> Self:
        row = proposal.row
        payment = proposal.payment
        return cls(
            fingerprint=row.fingerprint,
            line=row.line,
            occurred_on=row.occurred_on,
            description=row.description,
            amount=row.amount,
            direction=row.direction,
            balance=row.balance,
            action=proposal.action,
            reason=proposal.reason,
            type=proposal.type,
            category_id=proposal.category_id,
            payment=StatementPaymentMatchResponse(
                kind=payment.kind,
                commitment_id=payment.commitment_id,
                occurrence_id=payment.occurrence_id,
                due_date=payment.due_date,
                name=payment.name,
            )
            if payment
            else None,
            duplicate_of=proposal.duplicate_of,
        )


class StatementPreviewResponse(BaseModel):
    status: PreviewStatus = Field(
        description="`ready` with rows to review; `needs_mapping` when the columns or the date "
        "order must be chosen; `password_required` or `wrong_password` for a locked PDF."
    )
    source: StatementSource | None
    headers: list[str]
    header_row: int | None
    columns: StatementColumnsResponse | None
    needs_date_order: bool
    rows: list[StatementRowResponse]

    @classmethod
    def of(cls, preview: StatementPreview) -> Self:
        return cls(
            status=preview.status,
            source=preview.source,
            headers=list(preview.headers),
            header_row=preview.header_row,
            columns=StatementColumnsResponse.of(preview.columns) if preview.columns else None,
            needs_date_order=preview.needs_date_order,
            rows=[StatementRowResponse.of(proposal) for proposal in preview.proposals],
        )


class StatementSettleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: CommitmentKind
    commitment_id: uuid.UUID
    occurrence_id: uuid.UUID | None = None
    due_date: date


class ImportStatementRowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fingerprint: Fingerprint
    occurred_on: TransactionDate
    description: Description
    amount: Amount
    direction: Direction
    action: Literal["create", "settle", "transfer"]
    type: TransactionType = "expense"
    category_id: uuid.UUID | None = None
    to_account_id: uuid.UUID | None = None
    settle: StatementSettleRequest | None = None

    def to_row(self) -> ImportRow:
        settle = self.settle
        return ImportRow(
            fingerprint=self.fingerprint,
            occurred_on=self.occurred_on,
            description=self.description,
            amount=self.amount,
            direction=self.direction,
            action=self.action,
            type=self.type,
            category_id=self.category_id,
            to_account_id=self.to_account_id,
            settle=SettleTarget(
                settle.kind, settle.commitment_id, settle.occurrence_id, settle.due_date
            )
            if settle
            else None,
        )


class ImportStatementRequest(BaseModel):
    """The rows the person confirmed after reviewing a preview. Leave skipped rows out."""

    model_config = ConfigDict(extra="forbid")

    account_id: uuid.UUID
    today: date
    rows: Annotated[
        list[ImportStatementRowRequest], Field(min_length=1, max_length=MAX_IMPORT_ROWS)
    ]

    @model_validator(mode="after")
    def _distinct(self) -> Self:
        if len({row.fingerprint for row in self.rows}) != len(self.rows):
            raise ValueError("Each statement row can be imported once.")
        return self


class ImportStatementResponse(BaseModel):
    batch_id: uuid.UUID
    created: int
    settled: int
    already_imported: int

    @classmethod
    def of(cls, result: ImportResult) -> Self:
        return cls(
            batch_id=result.batch_id,
            created=result.created,
            settled=result.settled,
            already_imported=result.already_imported,
        )


class UndoStatementImportResponse(BaseModel):
    removed: int
    kept: int = Field(description="Transactions kept because a payment or goal now uses them.")

    @classmethod
    def of(cls, result: UndoResult) -> Self:
        return cls(removed=result.removed, kept=result.kept)
