"""Documents and the personal vault.

- `document_folders`: a workspace's folder tree for documents.
- `document_categories`: reusable categories (defaults are created by the service).
- `documents`: the logical document and its metadata, with or without a file.
- `document_versions`: each stored file, numbered; the highest is current.
- `document_tags`: free-text tags per document.
- `document_renewals`: renewal history (dates before and after).
- `document_links`: links to a note, task, calendar event, or finance record.
- `finance_holdings` gains a unique index on `(id, workspace_id)`, the target of holding links.
- `reminders` gains an optional, unique link to a document (its expiry and renewal alerts).

On PostgreSQL every new table has Row Level Security enabled with no policies, like the others;
the API enforces access itself.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-01
"""

import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = (
    "document_folders",
    "document_categories",
    "documents",
    "document_versions",
    "document_tags",
    "document_renewals",
    "document_links",
)
LINK_TARGETS = (
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
DOCUMENT_MANAGER = (
    "document_id IS NULL OR (finance_loan_id IS NULL AND finance_recurring_payment_id IS NULL"
    " AND finance_deposit_id IS NULL AND calendar_event_alert_id IS NULL"
    " AND habit_reminder_id IS NULL)"
)


def _timestamp(name: str, *, nullable: bool = False) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _id() -> sa.Column[uuid.UUID]:
    return sa.Column("id", sa.Uuid(), nullable=False)


def _workspace() -> sa.Column[uuid.UUID]:
    return sa.Column("workspace_id", sa.Uuid(), nullable=False)


def _workspace_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["workspace_id"],
        ["workspaces.id"],
        name=op.f(f"fk_{table}_workspace_id_workspaces"),
        ondelete="CASCADE",
    )


def _document_fk(name: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["document_id", "workspace_id"],
        ["documents.id", "documents.workspace_id"],
        name=name,
        ondelete="CASCADE",
    )


def _check(table: str, name: str, condition: str) -> sa.CheckConstraint:
    return sa.CheckConstraint(condition, name=op.f(f"ck_{table}_{name}"))


def upgrade() -> None:
    op.create_table(
        "document_folders",
        _id(),
        _workspace(),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        _check("document_folders", "name_length", "length(name) BETWEEN 1 AND 100"),
        _check("document_folders", "not_own_parent", "parent_id IS NULL OR parent_id <> id"),
        _workspace_fk("document_folders"),
        sa.ForeignKeyConstraint(
            ["parent_id", "workspace_id"],
            ["document_folders.id", "document_folders.workspace_id"],
            name="fk_document_folders_parent",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_document_folders")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_document_folders_id")),
    )
    op.create_index(
        "ix_document_folders_workspace_parent",
        "document_folders",
        ["workspace_id", "parent_id"],
    )

    op.create_table(
        "document_categories",
        _id(),
        _workspace(),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("normalized_name", sa.String(length=50), nullable=False),
        sa.Column("icon", sa.String(length=32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        _check("document_categories", "name_length", "length(name) BETWEEN 1 AND 50"),
        _workspace_fk("document_categories"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_document_categories")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_document_categories_id")),
        sa.UniqueConstraint("workspace_id", "normalized_name", name="uq_document_categories_name"),
    )

    op.create_table(
        "documents",
        _id(),
        _workspace(),
        sa.Column("folder_id", sa.Uuid(), nullable=True),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("reference_number", sa.String(length=100), nullable=True),
        sa.Column("issuing_authority", sa.String(length=200), nullable=True),
        sa.Column("provider", sa.String(length=200), nullable=True),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("renewal_date", sa.Date(), nullable=True),
        sa.Column("review_date", sa.Date(), nullable=True),
        sa.Column("amount", sa.BigInteger(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("custom_fields", sa.JSON(), nullable=False),
        sa.Column("is_favorite", sa.Boolean(), nullable=False),
        _timestamp("archived_at", nullable=True),
        _timestamp("trashed_at", nullable=True),
        sa.Column("reminder_days", sa.JSON(), nullable=False),
        sa.Column("reminder_time", sa.Time(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("current_version_id", sa.Uuid(), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("file_extension", sa.String(length=16), nullable=True),
        sa.Column("file_content_type", sa.String(length=100), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        _timestamp("file_uploaded_at", nullable=True),
        sa.Column("version_count", sa.Integer(), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        _timestamp("last_opened_at", nullable=True),
        _check("documents", "title_length", "length(title) BETWEEN 1 AND 200"),
        _check("documents", "description_length", "length(description) <= 2000"),
        _check("documents", "notes_length", "length(notes) <= 10000"),
        _check("documents", "amount_currency", "amount IS NULL OR currency IS NOT NULL"),
        _check("documents", "amount_range", "amount IS NULL OR amount >= 0"),
        _check("documents", "version_count", "version_count >= 0"),
        _check(
            "documents",
            "file_matches_version",
            "(current_version_id IS NULL) = (file_size IS NULL)",
        ),
        _workspace_fk("documents"),
        sa.ForeignKeyConstraint(
            ["folder_id", "workspace_id"],
            ["document_folders.id", "document_folders.workspace_id"],
            name="fk_documents_folder",
        ),
        sa.ForeignKeyConstraint(
            ["category_id", "workspace_id"],
            ["document_categories.id", "document_categories.workspace_id"],
            name="fk_documents_category",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_documents")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_documents_id")),
    )
    for name, columns in (
        ("ix_documents_workspace_updated_at", ["workspace_id", "updated_at"]),
        ("ix_documents_workspace_folder", ["workspace_id", "folder_id"]),
        ("ix_documents_workspace_category", ["workspace_id", "category_id"]),
        ("ix_documents_workspace_expiry", ["workspace_id", "expiry_date"]),
        ("ix_documents_workspace_renewal", ["workspace_id", "renewal_date"]),
    ):
        op.create_index(name, "documents", columns)

    op.create_table(
        "document_versions",
        _id(),
        _workspace(),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("blob_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("extension", sa.String(length=16), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=False),
        sa.Column("restored_from", sa.Integer(), nullable=True),
        _timestamp("uploaded_at"),
        _check("document_versions", "number_positive", "number >= 1"),
        _check("document_versions", "size_range", "size_bytes >= 0"),
        _check("document_versions", "sha256_length", "length(sha256) = 64"),
        _check("document_versions", "note_length", "length(note) <= 500"),
        _workspace_fk("document_versions"),
        _document_fk("fk_document_versions_document"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_document_versions")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_document_versions_id")),
        sa.UniqueConstraint("document_id", "number", name=op.f("uq_document_versions_document_id")),
    )
    op.create_index("ix_document_versions_blob_id", "document_versions", ["blob_id"])

    op.create_table(
        "document_tags",
        sa.Column("document_id", sa.Uuid(), nullable=False),
        _workspace(),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("normalized_name", sa.String(length=50), nullable=False),
        _check("document_tags", "name_length", "length(name) BETWEEN 1 AND 50"),
        _workspace_fk("document_tags"),
        _document_fk("fk_document_tags_document"),
        sa.PrimaryKeyConstraint("document_id", "normalized_name", name=op.f("pk_document_tags")),
    )
    op.create_index(
        "ix_document_tags_workspace_name", "document_tags", ["workspace_id", "normalized_name"]
    )

    op.create_table(
        "document_renewals",
        _id(),
        _workspace(),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("previous_issue_date", sa.Date(), nullable=True),
        sa.Column("previous_expiry_date", sa.Date(), nullable=True),
        sa.Column("previous_renewal_date", sa.Date(), nullable=True),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("renewal_date", sa.Date(), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=False),
        _timestamp("renewed_at"),
        _check("document_renewals", "note_length", "length(note) <= 500"),
        _workspace_fk("document_renewals"),
        _document_fk("fk_document_renewals_document"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_document_renewals")),
    )
    op.create_index("ix_document_renewals_document_id", "document_renewals", ["document_id"])

    # Holdings are keyed by (id, workspace_id, currency); links need (id, workspace_id).
    op.create_index(
        "uq_finance_holdings_id_workspace",
        "finance_holdings",
        ["id", "workspace_id"],
        unique=True,
    )

    op.create_table(
        "document_links",
        _id(),
        _workspace(),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        *(sa.Column(column, sa.Uuid(), nullable=True) for column, _, _ in LINK_TARGETS),
        _timestamp("created_at"),
        _check("document_links", "one_target", ONE_LINK_TARGET),
        _workspace_fk("document_links"),
        _document_fk("fk_document_links_document"),
        *(
            sa.ForeignKeyConstraint(
                [column, "workspace_id"],
                [f"{table}.id", f"{table}.workspace_id"],
                name=f"fk_document_links_{suffix}",
                ondelete="CASCADE",
            )
            for column, table, suffix in LINK_TARGETS
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_document_links")),
        *(
            sa.UniqueConstraint(column, "document_id", name=f"uq_document_links_{suffix}")
            for column, _, suffix in LINK_TARGETS
        ),
    )
    op.create_index("ix_document_links_document_id", "document_links", ["document_id"])

    with op.batch_alter_table("reminders", schema=None) as batch_op:
        batch_op.add_column(sa.Column("document_id", sa.Uuid(), nullable=True))
        batch_op.create_unique_constraint("uq_reminders_document_id", ["document_id"])
        batch_op.create_foreign_key(
            "fk_reminders_document",
            "documents",
            ["document_id", "workspace_id"],
            ["id", "workspace_id"],
            ondelete="CASCADE",
        )
        batch_op.create_check_constraint(
            op.f("ck_reminders_one_document_manager"), DOCUMENT_MANAGER
        )

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    # Document reminders can't survive without their link; their notifications stay.
    op.execute("DELETE FROM reminders WHERE document_id IS NOT NULL")
    with op.batch_alter_table("reminders", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_reminders_one_document_manager"), type_="check")
        batch_op.drop_constraint("fk_reminders_document", type_="foreignkey")
        batch_op.drop_constraint("uq_reminders_document_id", type_="unique")
        batch_op.drop_column("document_id")

    op.drop_index("ix_document_links_document_id", table_name="document_links")
    op.drop_table("document_links")
    op.drop_index("uq_finance_holdings_id_workspace", table_name="finance_holdings")
    op.drop_index("ix_document_renewals_document_id", table_name="document_renewals")
    op.drop_table("document_renewals")
    op.drop_index("ix_document_tags_workspace_name", table_name="document_tags")
    op.drop_table("document_tags")
    op.drop_index("ix_document_versions_blob_id", table_name="document_versions")
    op.drop_table("document_versions")
    for name in (
        "ix_documents_workspace_renewal",
        "ix_documents_workspace_expiry",
        "ix_documents_workspace_category",
        "ix_documents_workspace_folder",
        "ix_documents_workspace_updated_at",
    ):
        op.drop_index(name, table_name="documents")
    op.drop_table("documents")
    op.drop_table("document_categories")
    op.drop_index("ix_document_folders_workspace_parent", table_name="document_folders")
    op.drop_table("document_folders")
