"""What to do with each statement row, before the person reviews it.

In order: a row imported before is skipped; a row the ledger already has (typed in by hand, or an
auto-debit SIP) is skipped as a likely duplicate; a payment already recorded against a bill or EMI
is skipped; an open bill or EMI of the same amount is settled; anything else becomes a new
transaction, categorized by the person's rules. Each ledger entry and payment matches one row.
"""

import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final, Literal

from orbit_api.services.commitments.models import CommitmentKind, PaymentItem
from orbit_api.services.finance.models import Category, Transaction, TransactionType
from orbit_api.services.finance.money import Currency
from orbit_api.services.statements.parsing import Direction, StatementRow, merchant_key

ImportAction = Literal["create", "skip", "settle", "transfer"]
ProposalReason = Literal[
    "new",
    "already_imported",
    "possible_duplicate",
    "recorded_payment",
    "payment_due",
    "balance_mismatch",
    "unreadable_amount",
]

LEDGER_WINDOW: Final = timedelta(days=3)
PAYMENT_WINDOW: Final = timedelta(days=5)


@dataclass(frozen=True, slots=True)
class PaymentMatch:
    kind: CommitmentKind
    commitment_id: uuid.UUID
    # The loan installment; `None` for a bill's or subscription's occurrence.
    occurrence_id: uuid.UUID | None
    due_date: date
    name: str


@dataclass(frozen=True, slots=True)
class Proposal:
    row: StatementRow
    action: ImportAction
    reason: ProposalReason
    type: TransactionType
    category_id: uuid.UUID | None
    payment: PaymentMatch | None = None
    # The ledger entry this row seems to repeat.
    duplicate_of: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class MatchContext:
    account_id: uuid.UUID
    currency: Currency
    # Fingerprints imported before, with the transaction each created, if it still exists.
    known: dict[str, uuid.UUID | None]
    ledger: list[Transaction]
    payments: list[PaymentItem]
    # Merchant key to category.
    rules: dict[str, uuid.UUID]
    categories: list[Category]


def _moves(transaction: Transaction, account_id: uuid.UUID, direction: Direction) -> bool:
    """Whether the ledger entry moved money the same way through this account."""
    if transaction.type == "transfer":
        side = transaction.account_id if direction == "out" else transaction.to_account_id
        return side == account_id
    if transaction.account_id != account_id:
        return False
    return (transaction.type == "expense") == (direction == "out")


def _within(day: date, other: date, window: timedelta) -> bool:
    return abs(day - other) <= window


def _categorized(
    row: StatementRow, context: MatchContext, categories: dict[uuid.UUID, Category]
) -> tuple[TransactionType, uuid.UUID | None]:
    category = categories.get(context.rules.get(merchant_key(row.description), uuid.UUID(int=0)))
    if row.direction == "out":
        usable = category is not None and category.type == "expense"
        return "expense", category.id if category and usable else None
    if category is None:
        return "income", None
    # Money back from a merchant filed under spending is a refund, not income.
    return ("refund" if category.type == "expense" else "income"), category.id


def propose(rows: list[StatementRow], context: MatchContext) -> list[Proposal]:
    categories = {category.id: category for category in context.categories}
    used_ledger: set[uuid.UUID] = {tx for tx in context.known.values() if tx is not None}
    used_payments: set[tuple[uuid.UUID, date]] = set()
    proposals: list[Proposal] = []

    for row in rows:
        kind, category_id = _categorized(row, context, categories)
        if row.issue is not None:
            proposals.append(Proposal(row, "skip", row.issue, kind, category_id))
            continue
        if row.fingerprint in context.known:
            proposals.append(Proposal(row, "skip", "already_imported", kind, category_id))
            continue

        duplicate = min(
            (
                tx
                for tx in context.ledger
                if tx.id not in used_ledger
                and tx.amount == row.amount
                and tx.currency == context.currency
                and _within(tx.occurred_on, row.occurred_on, LEDGER_WINDOW)
                and _moves(tx, context.account_id, row.direction)
            ),
            key=lambda tx: abs(tx.occurred_on - row.occurred_on),
            default=None,
        )
        if duplicate is not None:
            used_ledger.add(duplicate.id)
            proposals.append(
                Proposal(
                    row,
                    "skip",
                    "possible_duplicate",
                    kind,
                    category_id,
                    duplicate_of=duplicate.id,
                )
            )
            continue

        payment = _payment_for(row, context, used_payments) if row.direction == "out" else None
        if payment is not None:
            used_payments.add((payment.commitment_id, payment.due_date))
            match = PaymentMatch(
                payment.kind,
                payment.commitment_id,
                payment.occurrence_id,
                payment.due_date,
                payment.name,
            )
            if payment.status == "paid":
                proposals.append(
                    Proposal(row, "skip", "recorded_payment", kind, category_id, match)
                )
            else:
                proposals.append(Proposal(row, "settle", "payment_due", kind, category_id, match))
            continue

        proposals.append(Proposal(row, "create", "new", kind, category_id))
    return proposals


def _payment_for(
    row: StatementRow, context: MatchContext, used: set[tuple[uuid.UUID, date]]
) -> PaymentItem | None:
    """A bill or EMI this payment settles, or one already recorded as paid around that day."""

    def fits(item: PaymentItem) -> bool:
        if (item.commitment_id, item.due_date) in used or item.currency != context.currency:
            return False
        if item.amount != row.amount:
            return False
        if item.status == "paid":
            return item.paid_on is not None and _within(
                item.paid_on, row.occurred_on, LEDGER_WINDOW
            )
        return item.status != "skipped" and _within(item.due_date, row.occurred_on, PAYMENT_WINDOW)

    candidates = [item for item in context.payments if fits(item)]
    return min(
        candidates,
        key=lambda item: (item.status != "paid", abs(item.due_date - row.occurred_on)),
        default=None,
    )
