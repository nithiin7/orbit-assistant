"""Statement imports: fingerprints of imported rows, import batches, and category rules. Every
query is filtered by workspace, so callers cannot reach other workspaces' rows."""

import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Final

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    FinanceCategoryRuleModel,
    FinanceImportBatchModel,
    FinanceImportRowModel,
    FinanceTransactionModel,
)
from orbit_api.repositories.commitments import build_commitment_service
from orbit_api.repositories.finance import (
    SqlFinanceAccountRepository,
    SqlFinanceCategoryRepository,
    SqlFinanceTransactionRepository,
)
from orbit_api.repositories.integrations import FlushTransaction
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.statements.service import StatementImportService, UndoResult
from orbit_api.utils.clock import utc_now

# Well under SQLite's limit on bound parameters per statement.
_CHUNK: Final = 500

_Row = FinanceImportRowModel


class SqlStatementStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def known(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID, fingerprints: list[str]
    ) -> dict[str, uuid.UUID | None]:
        found: dict[str, uuid.UUID | None] = {}
        for start in range(0, len(fingerprints), _CHUNK):
            rows = await self._session.execute(
                select(_Row.fingerprint, _Row.transaction_id).where(
                    _Row.workspace_id == workspace_id,
                    _Row.account_id == account_id,
                    _Row.fingerprint.in_(fingerprints[start : start + _CHUNK]),
                )
            )
            for fingerprint, transaction_id in rows.all():
                found[fingerprint] = transaction_id
        return found

    async def rules(self, workspace_id: uuid.UUID) -> dict[str, uuid.UUID]:
        rows = await self._session.execute(
            select(
                FinanceCategoryRuleModel.merchant_key, FinanceCategoryRuleModel.category_id
            ).where(FinanceCategoryRuleModel.workspace_id == workspace_id)
        )
        return {row.merchant_key: row.category_id for row in rows.all()}

    async def set_rule(
        self, workspace_id: uuid.UUID, key: str, category_id: uuid.UUID, now: datetime
    ) -> None:
        rule = await self._session.scalar(
            select(FinanceCategoryRuleModel).where(
                FinanceCategoryRuleModel.workspace_id == workspace_id,
                FinanceCategoryRuleModel.merchant_key == key,
            )
        )
        if rule is None:
            self._session.add(
                FinanceCategoryRuleModel(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    merchant_key=key,
                    category_id=category_id,
                    created_at=now,
                    updated_at=now,
                )
            )
        elif rule.category_id != category_id:
            rule.category_id = category_id
            rule.updated_at = now
        await flush(self._session)

    async def add_batch(
        self, workspace_id: uuid.UUID, batch_id: uuid.UUID, account_id: uuid.UUID, now: datetime
    ) -> None:
        self._session.add(
            FinanceImportBatchModel(
                id=batch_id, workspace_id=workspace_id, account_id=account_id, created_at=now
            )
        )
        await flush(self._session)

    async def add_row(
        self,
        workspace_id: uuid.UUID,
        account_id: uuid.UUID,
        batch_id: uuid.UUID,
        fingerprint: str,
        transaction_id: uuid.UUID | None,
    ) -> None:
        self._session.add(
            _Row(
                id=uuid.uuid4(),
                workspace_id=workspace_id,
                account_id=account_id,
                batch_id=batch_id,
                fingerprint=fingerprint,
                transaction_id=transaction_id,
            )
        )
        await flush(self._session)

    async def batch_exists(self, workspace_id: uuid.UUID, batch_id: uuid.UUID) -> bool:
        found = await self._session.scalar(
            select(FinanceImportBatchModel.id).where(
                FinanceImportBatchModel.id == batch_id,
                FinanceImportBatchModel.workspace_id == workspace_id,
            )
        )
        return found is not None

    async def undo_batch(self, workspace_id: uuid.UUID, batch_id: uuid.UUID) -> UndoResult:
        rows = (
            await self._session.execute(
                select(_Row.id, _Row.transaction_id).where(
                    _Row.batch_id == batch_id, _Row.workspace_id == workspace_id
                )
            )
        ).all()
        removed = kept = 0
        for row_id, transaction_id in rows:
            if transaction_id is not None and not await self._delete_transaction(
                workspace_id, transaction_id
            ):
                kept += 1
                continue
            await self._session.execute(delete(_Row).where(_Row.id == row_id))
            removed += transaction_id is not None
        remaining = await self._session.scalar(
            select(func.count()).select_from(_Row).where(_Row.batch_id == batch_id)
        )
        if not remaining:
            await self._session.execute(
                delete(FinanceImportBatchModel).where(FinanceImportBatchModel.id == batch_id)
            )
        await flush(self._session)
        return UndoResult(removed=removed, kept=kept)

    async def _delete_transaction(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> bool:
        """Delete the transaction unless a foreign key (a payment, a goal contribution) refuses.
        A savepoint keeps a refusal from undoing the rest of the import's removal."""
        try:
            async with self._session.begin_nested():
                await self._session.execute(
                    update(_Row)
                    .where(_Row.transaction_id == transaction_id)
                    .values(transaction_id=None)
                )
                await self._session.execute(
                    delete(FinanceTransactionModel).where(
                        FinanceTransactionModel.id == transaction_id,
                        FinanceTransactionModel.workspace_id == workspace_id,
                    )
                )
        except IntegrityError:
            return False
        return True


def build_statement_service(
    session: AsyncSession, clock: Callable[[], datetime] = utc_now
) -> StatementImportService:
    """Statement imports whose ledger and payment writes only flush, so each import commits
    once, all or nothing."""
    deferred = FlushTransaction(session)
    finance = FinanceService(
        SqlFinanceAccountRepository(session),
        SqlFinanceCategoryRepository(session),
        SqlFinanceTransactionRepository(session),
        deferred,
        clock,
    )
    return StatementImportService(
        SqlStatementStore(session),
        finance,
        build_commitment_service(session, clock, unit_of_work=deferred),
        SqlTransaction(session),
        clock,
    )
