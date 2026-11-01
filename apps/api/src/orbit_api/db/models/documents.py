"""Documents: folders, categories, documents (the logical record and its metadata), file
versions, tags, renewal history, and links to records in other modules.

Every table carries `workspace_id`, and every relationship is a composite foreign key on
`(id, workspace_id)`, so the database itself refuses a folder, category, version, or link that
crosses workspaces. File bytes are never stored here: a version names a blob in the attachment
store by a server-generated ID.
"""

import uuid
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now

# A link names exactly one record: (column, referenced table, constraint suffix).
LINK_TARGETS: tuple[tuple[str, str, str], ...] = (
    ("note_id", "notes", "note"),
    ("task_id", "tasks", "task"),
    ("calendar_event_id", "calendar_events", "event"),
    ("finance_transaction_id", "finance_transactions", "transaction"),
    ("finance_loan_id", "finance_loans", "loan"),
    ("finance_recurring_payment_id", "finance_recurring_payments", "recurring_payment"),
    ("finance_deposit_id", "finance_deposits", "deposit"),
    ("finance_holding_id", "finance_holdings", "holding"),
    ("finance_asset_id", "finance_assets", "asset"),
)
ONE_LINK_TARGET = (
    " + ".join(f"(CASE WHEN {column} IS NULL THEN 0 ELSE 1 END)" for column, _, _ in LINK_TARGETS)
    + " = 1"
)


class DocumentFolderModel(Base):
    """A folder of documents, optionally inside another folder of the same workspace.

    Deleting a folder deletes its subfolders (cascade) but never its documents:
    `documents.folder_id` has no `ON DELETE` action, so the service moves them first.
    """

    __tablename__ = "document_folders"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("parent_id IS NULL OR parent_id <> id", name="not_own_parent"),
        UniqueConstraint("id", "workspace_id"),
        ForeignKeyConstraint(
            ["parent_id", "workspace_id"],
            ["document_folders.id", "document_folders.workspace_id"],
            name="fk_document_folders_parent",
            ondelete="CASCADE",
        ),
        Index("ix_document_folders_workspace_parent", "workspace_id", "parent_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    parent_id: Mapped[uuid.UUID | None] = mapped_column()
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class DocumentCategoryModel(Base):
    """A reusable category. Names are unique per workspace once normalized (trimmed,
    single-spaced, case-folded). Deleting one leaves its documents unclassified."""

    __tablename__ = "document_categories"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 50", name="name_length"),
        UniqueConstraint("id", "workspace_id"),
        UniqueConstraint("workspace_id", "normalized_name", name="uq_document_categories_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(50))
    normalized_name: Mapped[str] = mapped_column(String(50))
    icon: Mapped[str] = mapped_column(String(32))
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class DocumentModel(Base):
    """A document: the logical record, which exists with or without a file.

    The `file_*` columns copy the current version's file details so lists can show, sort, and
    filter by them without a join; the service updates them with every version change.
    `reference_number` is sensitive: it is returned only with a single document, never in lists.
    """

    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint("length(title) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("length(description) <= 2000", name="description_length"),
        CheckConstraint("length(notes) <= 10000", name="notes_length"),
        CheckConstraint("amount IS NULL OR currency IS NOT NULL", name="amount_currency"),
        CheckConstraint("amount IS NULL OR amount >= 0", name="amount_range"),
        CheckConstraint("version_count >= 0", name="version_count"),
        CheckConstraint(
            "(current_version_id IS NULL) = (file_size IS NULL)", name="file_matches_version"
        ),
        UniqueConstraint("id", "workspace_id"),
        ForeignKeyConstraint(
            ["folder_id", "workspace_id"],
            ["document_folders.id", "document_folders.workspace_id"],
            name="fk_documents_folder",
        ),
        ForeignKeyConstraint(
            ["category_id", "workspace_id"],
            ["document_categories.id", "document_categories.workspace_id"],
            name="fk_documents_category",
        ),
        Index("ix_documents_workspace_updated_at", "workspace_id", "updated_at"),
        Index("ix_documents_workspace_folder", "workspace_id", "folder_id"),
        Index("ix_documents_workspace_category", "workspace_id", "category_id"),
        Index("ix_documents_workspace_expiry", "workspace_id", "expiry_date"),
        Index("ix_documents_workspace_renewal", "workspace_id", "renewal_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    folder_id: Mapped[uuid.UUID | None] = mapped_column()
    category_id: Mapped[uuid.UUID | None] = mapped_column()
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    reference_number: Mapped[str | None] = mapped_column(String(100))
    issuing_authority: Mapped[str | None] = mapped_column(String(200))
    provider: Mapped[str | None] = mapped_column(String(200))
    issue_date: Mapped[date | None] = mapped_column(Date)
    effective_date: Mapped[date | None] = mapped_column(Date)
    expiry_date: Mapped[date | None] = mapped_column(Date)
    renewal_date: Mapped[date | None] = mapped_column(Date)
    review_date: Mapped[date | None] = mapped_column(Date)
    amount: Mapped[int | None] = mapped_column(BigInteger)
    currency: Mapped[str | None] = mapped_column(String(3))
    notes: Mapped[str] = mapped_column(Text)
    # A list of `{"label": …, "value": …}` pairs for details the fixed fields don't cover.
    custom_fields: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    is_favorite: Mapped[bool] = mapped_column(Boolean)
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    trashed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # Days before each tracked date to remind (0 is the day itself), at `reminder_time` in
    # `timezone`.
    reminder_days: Mapped[list[int]] = mapped_column(JSON)
    reminder_time: Mapped[time] = mapped_column(Time)
    timezone: Mapped[str] = mapped_column(String(64))
    current_version_id: Mapped[uuid.UUID | None] = mapped_column()
    file_name: Mapped[str | None] = mapped_column(String(255))
    file_extension: Mapped[str | None] = mapped_column(String(16))
    file_content_type: Mapped[str | None] = mapped_column(String(100))
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    file_uploaded_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    version_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    last_opened_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class DocumentVersionModel(Base):
    """One stored file of a document. Versions are numbered from 1 and never renumbered; the
    highest is current. Restoring an earlier version adds a new version that reuses its blob,
    so the bytes aren't copied."""

    __tablename__ = "document_versions"
    __table_args__ = (
        CheckConstraint("number >= 1", name="number_positive"),
        CheckConstraint("size_bytes >= 0", name="size_range"),
        CheckConstraint("length(sha256) = 64", name="sha256_length"),
        CheckConstraint("length(note) <= 500", name="note_length"),
        UniqueConstraint("id", "workspace_id"),
        UniqueConstraint("document_id", "number"),
        ForeignKeyConstraint(
            ["document_id", "workspace_id"],
            ["documents.id", "documents.workspace_id"],
            name="fk_document_versions_document",
            ondelete="CASCADE",
        ),
        Index("ix_document_versions_blob_id", "blob_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    document_id: Mapped[uuid.UUID] = mapped_column()
    number: Mapped[int] = mapped_column(Integer)
    blob_id: Mapped[uuid.UUID] = mapped_column()
    filename: Mapped[str] = mapped_column(String(255))
    extension: Mapped[str] = mapped_column(String(16))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    note: Mapped[str] = mapped_column(String(500))
    # The version this one restored, if it was a restore.
    restored_from: Mapped[int | None] = mapped_column(Integer)
    uploaded_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class DocumentTagModel(Base):
    """A tag on a document. Tags are free text, unique per document once normalized."""

    __tablename__ = "document_tags"
    __table_args__ = (
        PrimaryKeyConstraint("document_id", "normalized_name"),
        CheckConstraint("length(name) BETWEEN 1 AND 50", name="name_length"),
        ForeignKeyConstraint(
            ["document_id", "workspace_id"],
            ["documents.id", "documents.workspace_id"],
            name="fk_document_tags_document",
            ondelete="CASCADE",
        ),
        Index("ix_document_tags_workspace_name", "workspace_id", "normalized_name"),
    )

    document_id: Mapped[uuid.UUID] = mapped_column()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(50))
    normalized_name: Mapped[str] = mapped_column(String(50))


class DocumentRenewalModel(Base):
    """A renewal: the dates before and after, so earlier expiry information is kept."""

    __tablename__ = "document_renewals"
    __table_args__ = (
        CheckConstraint("length(note) <= 500", name="note_length"),
        ForeignKeyConstraint(
            ["document_id", "workspace_id"],
            ["documents.id", "documents.workspace_id"],
            name="fk_document_renewals_document",
            ondelete="CASCADE",
        ),
        Index("ix_document_renewals_document_id", "document_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    document_id: Mapped[uuid.UUID] = mapped_column()
    previous_issue_date: Mapped[date | None] = mapped_column(Date)
    previous_expiry_date: Mapped[date | None] = mapped_column(Date)
    previous_renewal_date: Mapped[date | None] = mapped_column(Date)
    issue_date: Mapped[date | None] = mapped_column(Date)
    expiry_date: Mapped[date | None] = mapped_column(Date)
    renewal_date: Mapped[date | None] = mapped_column(Date)
    note: Mapped[str] = mapped_column(String(500))
    renewed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class DocumentLinkModel(Base):
    """A document linked to one record elsewhere in Orbit: a note, task, calendar event, or a
    finance transaction, loan, subscription or bill, deposit, holding, or asset.

    One nullable column per kind, each a composite foreign key that cascades, so a link never
    crosses workspaces and disappears with either side. Exactly one is set.
    """

    __tablename__ = "document_links"
    __table_args__ = (
        CheckConstraint(ONE_LINK_TARGET, name="one_target"),
        ForeignKeyConstraint(
            ["document_id", "workspace_id"],
            ["documents.id", "documents.workspace_id"],
            name="fk_document_links_document",
            ondelete="CASCADE",
        ),
        *(
            ForeignKeyConstraint(
                [column, "workspace_id"],
                [f"{table}.id", f"{table}.workspace_id"],
                name=f"fk_document_links_{suffix}",
                ondelete="CASCADE",
            )
            for column, table, suffix in LINK_TARGETS
        ),
        # One link per document and record; the leading column serves lookups by record.
        *(
            UniqueConstraint(column, "document_id", name=f"uq_document_links_{suffix}")
            for column, _, suffix in LINK_TARGETS
        ),
        Index("ix_document_links_document_id", "document_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    document_id: Mapped[uuid.UUID] = mapped_column()
    note_id: Mapped[uuid.UUID | None] = mapped_column()
    task_id: Mapped[uuid.UUID | None] = mapped_column()
    calendar_event_id: Mapped[uuid.UUID | None] = mapped_column()
    finance_transaction_id: Mapped[uuid.UUID | None] = mapped_column()
    finance_loan_id: Mapped[uuid.UUID | None] = mapped_column()
    finance_recurring_payment_id: Mapped[uuid.UUID | None] = mapped_column()
    finance_deposit_id: Mapped[uuid.UUID | None] = mapped_column()
    finance_holding_id: Mapped[uuid.UUID | None] = mapped_column()
    finance_asset_id: Mapped[uuid.UUID | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
