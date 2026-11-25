"""Money between you and the people in your life.

- An entry says who owes whom and how much: `they_owe` (you paid or lent), `i_owe` (they did),
  and repayments `they_paid` and `i_paid`. Balances are worked out from entries, never stored,
  one per person and currency (currencies are never mixed); positive while they owe you.
- A share can be split from one of your Finance expenses (`they_owe` with `transaction_id`).
  The expense stays whole in Finance; the shares linked to it can't add up to more than it.
- A repayment can be recorded in Finance at the same time, in the same commit: a refund in the
  expense's category when they pay you back, so your spending comes down to your own share, or
  an expense when you pay them back. Loans with no expense behind them stay in People only.
- Deleting an entry leaves its Finance transaction alone; deleting the transaction keeps the
  entry and clears the link.

Every method takes a `workspace_id` that the caller has already authorized.
"""

import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime
from typing import Protocol

from orbit_api.services.finance.models import (
    AccountNotFoundError,
    Transaction,
    TransactionDraft,
    TransactionNotFoundError,
)
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.people.models import (
    LEDGER_SIGNS,
    Balance,
    Ledger,
    LedgerChanges,
    LedgerDraft,
    LedgerEntry,
    LedgerEntryNotFoundError,
    LedgerError,
    LinkedTransaction,
    Person,
    PersonNotFoundError,
)
from orbit_api.services.transactions import Transaction as UnitOfWork
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now


class LedgerStore(Protocol):
    async def all(self, workspace_id: uuid.UUID) -> list[LedgerEntry]:
        """Every entry in the workspace, newest first, with its linked transaction."""
        ...

    async def get(
        self, workspace_id: uuid.UUID, person_id: uuid.UUID, entry_id: uuid.UUID
    ) -> LedgerEntry | None:
        """The entry, only if it is this person's in `workspace_id`."""
        ...

    async def add(self, entry: LedgerEntry) -> None: ...

    async def save(self, entry: LedgerEntry) -> None: ...

    async def delete(
        self, workspace_id: uuid.UUID, person_id: uuid.UUID, entry_id: uuid.UUID
    ) -> bool: ...

    async def shared(
        self, workspace_id: uuid.UUID, transaction_id: uuid.UUID, *, excluding: uuid.UUID | None
    ) -> int:
        """The total of the shares split from a transaction, leaving out one entry."""
        ...


class PersonLookup(Protocol):
    async def get(self, workspace_id: uuid.UUID, person_id: uuid.UUID) -> Person | None: ...


def balances(entries: list[LedgerEntry]) -> list[Balance]:
    """Each person's non-zero balance per currency, by person and then currency."""
    totals: dict[tuple[uuid.UUID, str], int] = {}
    currencies: dict[tuple[uuid.UUID, str], LedgerEntry] = {}
    for entry in entries:
        key = (entry.person_id, entry.currency)
        totals[key] = totals.get(key, 0) + LEDGER_SIGNS[entry.kind] * entry.amount
        currencies[key] = entry
    return [
        Balance(person_id=person_id, currency=currencies[(person_id, code)].currency, amount=total)
        for (person_id, code), total in sorted(totals.items(), key=lambda item: str(item[0]))
        if total != 0
    ]


def _linked(transaction: Transaction) -> LinkedTransaction:
    return LinkedTransaction(
        id=transaction.id,
        type=transaction.type,
        description=transaction.description,
        amount=transaction.amount,
        occurred_on=transaction.occurred_on,
        account_id=transaction.account_id,
        category_id=transaction.category_id,
    )


class PeopleLedgerService:
    def __init__(
        self,
        entries: LedgerStore,
        people: PersonLookup,
        finance: FinanceService,
        unit_of_work: UnitOfWork,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._entries = entries
        self._people = people
        self._finance = finance
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def ledger(self, workspace_id: uuid.UUID) -> Ledger:
        entries = await self._entries.all(workspace_id)
        return Ledger(entries=entries, balances=balances(entries))

    async def add(
        self, workspace_id: uuid.UUID, person_id: uuid.UUID, draft: LedgerDraft
    ) -> LedgerEntry:
        """Record an entry, and its Finance repayment when asked. Raises `LedgerError` for a
        link or record that doesn't fit, and Finance's errors for a bad account or category."""
        if await self._people.get(workspace_id, person_id) is None:
            raise PersonNotFoundError
        linked = None
        if draft.transaction_id is not None:
            linked = await self._split_from(workspace_id, draft, excluding=None)
        if draft.record is not None:
            linked = await self._record(workspace_id, draft)
        now = self._clock()
        entry = LedgerEntry(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            person_id=person_id,
            kind=draft.kind,
            amount=draft.amount,
            currency=draft.currency,
            occurred_on=draft.occurred_on,
            description=draft.description,
            transaction=linked,
            created_at=now,
            updated_at=now,
        )
        await self._entries.add(entry)
        # One commit for the entry and the Finance transaction recorded with it.
        await self._unit_of_work.commit()
        return entry

    async def update(
        self,
        workspace_id: uuid.UUID,
        person_id: uuid.UUID,
        entry_id: uuid.UUID,
        changes: LedgerChanges,
    ) -> LedgerEntry:
        entry = await self._get(workspace_id, person_id, entry_id)
        amount = entry.amount if changes.amount is UNSET else changes.amount
        if amount != entry.amount and entry.transaction is not None:
            if entry.kind != "they_owe":
                raise LedgerError(
                    "This repayment is recorded in Finance. Delete it and record it again to"
                    " change the amount."
                )
            await self._check_shares(
                workspace_id, entry.transaction.id, entry.transaction.amount, amount, entry.id
            )
        updated = replace(
            entry,
            amount=amount,
            occurred_on=entry.occurred_on if changes.occurred_on is UNSET else changes.occurred_on,
            description=entry.description if changes.description is UNSET else changes.description,
        )
        if updated == entry:
            return entry
        updated = replace(updated, updated_at=self._clock())
        await self._entries.save(updated)
        await self._unit_of_work.commit()
        return updated

    async def delete(
        self, workspace_id: uuid.UUID, person_id: uuid.UUID, entry_id: uuid.UUID
    ) -> None:
        """Delete the entry. A Finance transaction recorded with it stays."""
        if not await self._entries.delete(workspace_id, person_id, entry_id):
            raise LedgerEntryNotFoundError
        await self._unit_of_work.commit()

    async def _get(
        self, workspace_id: uuid.UUID, person_id: uuid.UUID, entry_id: uuid.UUID
    ) -> LedgerEntry:
        entry = await self._entries.get(workspace_id, person_id, entry_id)
        if entry is None:
            raise LedgerEntryNotFoundError
        return entry

    async def _split_from(
        self, workspace_id: uuid.UUID, draft: LedgerDraft, *, excluding: uuid.UUID | None
    ) -> LinkedTransaction:
        if draft.record is not None:
            raise LedgerError("Link an expense or record a repayment, not both.")
        if draft.kind != "they_owe" or draft.transaction_id is None:
            raise LedgerError("Only a share someone owes you can be split from an expense.")
        try:
            transaction = await self._finance.get(workspace_id, draft.transaction_id)
        except TransactionNotFoundError:
            raise LedgerError("That transaction doesn't exist in this workspace.") from None
        if transaction.type != "expense":
            raise LedgerError("Shares can only be split from an expense.")
        if transaction.currency != draft.currency:
            raise LedgerError(f"Use the expense's currency, {transaction.currency}.")
        await self._check_shares(
            workspace_id, transaction.id, transaction.amount, draft.amount, excluding
        )
        return _linked(transaction)

    async def _check_shares(
        self,
        workspace_id: uuid.UUID,
        transaction_id: uuid.UUID,
        total: int,
        amount: int,
        excluding: uuid.UUID | None,
    ) -> None:
        others = await self._entries.shared(workspace_id, transaction_id, excluding=excluding)
        if others + amount > total:
            raise LedgerError("The shares add up to more than the expense.")

    async def _record(self, workspace_id: uuid.UUID, draft: LedgerDraft) -> LinkedTransaction:
        record = draft.record
        if record is None or draft.kind not in ("they_paid", "i_paid"):
            raise LedgerError("Only a repayment can be recorded in Finance.")
        try:
            view = await self._finance.account(workspace_id, record.account_id)
            if view.account.currency != draft.currency:
                raise LedgerError(f"Use the account's currency, {view.account.currency}.")
            transaction = await self._finance.create(
                workspace_id,
                TransactionDraft(
                    # They paid you back: a refund, so your spending is your share. You paid
                    # them back: an expense, your share of what they covered.
                    type="refund" if draft.kind == "they_paid" else "expense",
                    amount=draft.amount,
                    occurred_on=draft.occurred_on,
                    description=draft.description,
                    account_id=record.account_id,
                    category_id=record.category_id,
                ),
                commit=False,
            )
        except AccountNotFoundError:
            raise LedgerError("That account doesn't exist in this workspace.") from None
        return _linked(transaction)
