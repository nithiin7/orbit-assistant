"""Notes and knowledge management.

- `note_folders`: a folder tree per workspace (`parent_id`, cascading to subfolders).
- `notes`: notes, quick notes, and journal entries (one per day per workspace), with the editor
  document, derived plain text, pin, favorite, archive and trash state, and a revision counter
  for conflict detection. A folder can't be deleted while notes are in it.
- `note_tags` and `note_tag_assignments`: tags unique per workspace by normalized name.
- `note_links`: links between notes, derived from the source note's content.
- `note_task_links`: tasks linked to notes.
- `note_attachments`: attachment metadata; the files themselves live outside the database.

Every relationship is a composite foreign key on `(id, workspace_id)`, so rows can't link across
workspaces. On PostgreSQL every new table has Row Level Security enabled with no policies, like
the others; the API enforces access itself.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-31
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = (
    "note_folders",
    "note_tags",
    "notes",
    "note_attachments",
    "note_links",
    "note_tag_assignments",
    "note_task_links",
)


def _timestamp(name: str, *, nullable: bool = False) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _workspace_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["workspace_id"],
        ["workspaces.id"],
        name=op.f(f"fk_{table}_workspace_id_workspaces"),
        ondelete="CASCADE",
    )


def _note_fk(table: str, column: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column, "workspace_id"],
        ["notes.id", "notes.workspace_id"],
        name=f"fk_{table}_{column}_notes",
        ondelete="CASCADE",
    )


def upgrade() -> None:
    op.create_table(
        "note_folders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_note_folders_name_length")
        ),
        sa.CheckConstraint(
            "parent_id IS NULL OR parent_id <> id", name=op.f("ck_note_folders_not_own_parent")
        ),
        sa.ForeignKeyConstraint(
            ["parent_id", "workspace_id"],
            ["note_folders.id", "note_folders.workspace_id"],
            name="fk_note_folders_parent_id_note_folders",
            ondelete="CASCADE",
        ),
        _workspace_fk("note_folders"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_note_folders")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_note_folders_id")),
    )
    op.create_index(
        "ix_note_folders_workspace_parent", "note_folders", ["workspace_id", "parent_id"]
    )

    op.create_table(
        "note_tags",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("normalized_name", sa.String(length=50), nullable=False),
        _timestamp("created_at"),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 50", name=op.f("ck_note_tags_name_length")),
        _workspace_fk("note_tags"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_note_tags")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_note_tags_id")),
        sa.UniqueConstraint("workspace_id", "normalized_name", name="uq_note_tags_workspace_name"),
    )

    op.create_table(
        "notes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("folder_id", sa.Uuid(), nullable=True),
        sa.Column("note_type", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_format", sa.String(length=32), nullable=False),
        sa.Column("plain_text", sa.Text(), nullable=False),
        sa.Column("journal_date", sa.Date(), nullable=True),
        sa.Column("is_pinned", sa.Boolean(), nullable=False),
        sa.Column("is_favorite", sa.Boolean(), nullable=False),
        _timestamp("archived_at", nullable=True),
        _timestamp("trashed_at", nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        _timestamp("last_opened_at", nullable=True),
        sa.CheckConstraint(
            "(note_type = 'journal') = (journal_date IS NOT NULL)",
            name=op.f("ck_notes_journal_date_matches_type"),
        ),
        sa.CheckConstraint(
            "note_type IN ('note', 'quick', 'journal')", name=op.f("ck_notes_note_type")
        ),
        sa.CheckConstraint("length(content) <= 1000000", name=op.f("ck_notes_content_length")),
        sa.CheckConstraint("length(title) <= 200", name=op.f("ck_notes_title_length")),
        sa.CheckConstraint("revision >= 1", name=op.f("ck_notes_revision_positive")),
        sa.ForeignKeyConstraint(
            ["folder_id", "workspace_id"],
            ["note_folders.id", "note_folders.workspace_id"],
            name="fk_notes_folder_id_note_folders",
        ),
        _workspace_fk("notes"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notes")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_notes_id")),
        sa.UniqueConstraint("workspace_id", "journal_date", name="uq_notes_workspace_journal_date"),
    )
    op.create_index("ix_notes_workspace_folder", "notes", ["workspace_id", "folder_id"])
    op.create_index("ix_notes_workspace_updated_at", "notes", ["workspace_id", "updated_at"])

    op.create_table(
        "note_attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("note_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        _timestamp("created_at"),
        sa.CheckConstraint(
            "length(filename) BETWEEN 1 AND 255", name=op.f("ck_note_attachments_filename_length")
        ),
        sa.CheckConstraint("size_bytes >= 0", name=op.f("ck_note_attachments_size_not_negative")),
        _note_fk("note_attachments", "note_id"),
        _workspace_fk("note_attachments"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_note_attachments")),
    )
    op.create_index("ix_note_attachments_note_id", "note_attachments", ["note_id"])

    op.create_table(
        "note_links",
        sa.Column("source_note_id", sa.Uuid(), nullable=False),
        sa.Column("target_note_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.CheckConstraint("source_note_id <> target_note_id", name=op.f("ck_note_links_not_self")),
        _note_fk("note_links", "source_note_id"),
        _note_fk("note_links", "target_note_id"),
        sa.PrimaryKeyConstraint("source_note_id", "target_note_id", name=op.f("pk_note_links")),
    )
    op.create_index("ix_note_links_target_note_id", "note_links", ["target_note_id"])

    op.create_table(
        "note_tag_assignments",
        sa.Column("note_id", sa.Uuid(), nullable=False),
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        _note_fk("note_tag_assignments", "note_id"),
        sa.ForeignKeyConstraint(
            ["tag_id", "workspace_id"],
            ["note_tags.id", "note_tags.workspace_id"],
            name="fk_note_tag_assignments_tag_id_note_tags",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("note_id", "tag_id", name=op.f("pk_note_tag_assignments")),
    )
    op.create_index("ix_note_tag_assignments_tag_id", "note_tag_assignments", ["tag_id"])

    op.create_table(
        "note_task_links",
        sa.Column("note_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        _timestamp("created_at"),
        _note_fk("note_task_links", "note_id"),
        sa.ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_note_task_links_task_id_tasks",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("note_id", "task_id", name=op.f("pk_note_task_links")),
    )
    op.create_index("ix_note_task_links_task_id", "note_task_links", ["task_id"])

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_note_task_links_task_id", table_name="note_task_links")
    op.drop_table("note_task_links")
    op.drop_index("ix_note_tag_assignments_tag_id", table_name="note_tag_assignments")
    op.drop_table("note_tag_assignments")
    op.drop_index("ix_note_links_target_note_id", table_name="note_links")
    op.drop_table("note_links")
    op.drop_index("ix_note_attachments_note_id", table_name="note_attachments")
    op.drop_table("note_attachments")
    op.drop_index("ix_notes_workspace_updated_at", table_name="notes")
    op.drop_index("ix_notes_workspace_folder", table_name="notes")
    op.drop_table("notes")
    op.drop_table("note_tags")
    op.drop_index("ix_note_folders_workspace_parent", table_name="note_folders")
    op.drop_table("note_folders")
