"""Bank statement imports: each import's batch, the rows it brought in, and category rules.

No statement file is stored. A row keeps only a fingerprint (a hash of its date, amount,
direction, and description) so the same statement line is never imported twice.
"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class FinanceImportBatchModel(Base):
    """One confirmed import into one account, so it can be undone as a whole."""

    __tablename__ = "finance_import_batches"
    __table_args__ = (Index("ix_finance_import_batches_workspace", "workspace_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("finance_accounts.id", ondelete="CASCADE")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class FinanceImportRowModel(Base):
    """A statement line that was imported. Deleting its transaction keeps the fingerprint, so
    the line isn't brought back by the next import of an overlapping statement."""

    __tablename__ = "finance_import_rows"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "account_id", "fingerprint", name="uq_finance_import_rows_fingerprint"
        ),
        Index("ix_finance_import_rows_batch", "batch_id"),
        Index("ix_finance_import_rows_transaction", "transaction_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("finance_accounts.id", ondelete="CASCADE")
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("finance_import_batches.id", ondelete="CASCADE")
    )
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("finance_transactions.id", ondelete="SET NULL")
    )
    fingerprint: Mapped[str] = mapped_column(String(64))


class FinanceCategoryRuleModel(Base):
    """A merchant's category, learned from what the person chose when importing."""

    __tablename__ = "finance_category_rules"
    __table_args__ = (
        UniqueConstraint("workspace_id", "merchant_key", name="uq_finance_category_rules_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    merchant_key: Mapped[str] = mapped_column(String(100))
    category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("finance_categories.id", ondelete="CASCADE")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
