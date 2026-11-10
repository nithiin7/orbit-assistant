"""Bookmarks ("Saved" in the app).

- `bookmark_collections`: a workspace's named, colored groups of bookmarks, with names unique
  per workspace regardless of case and spacing.
- `bookmarks`: saved URLs (pages, videos, reels) with a title, a note on what they're for, a
  kind, a read-later status, tags, a pin, and how often they've been opened. A bookmark is in at
  most one collection, through a composite foreign key on `(collection_id, workspace_id)` with no
  ON DELETE action: deleting a collection clears it from its bookmarks first.

Only new tables; no existing table is rebuilt or changed. On PostgreSQL the new tables have Row
Level Security enabled with no policies, like the others; the API enforces access itself.

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLLECTION_COLORS = "('blue', 'green', 'amber', 'rose', 'violet', 'teal', 'orange', 'slate')"


def upgrade() -> None:
    op.create_table(
        "bookmark_collections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("normalized_name", sa.String(length=50), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 50", name=op.f("ck_bookmark_collections_name_length")
        ),
        sa.CheckConstraint(
            f"color IN {COLLECTION_COLORS}", name=op.f("ck_bookmark_collections_color")
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_bookmark_collections_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bookmark_collections")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_bookmark_collections_id")),
        sa.UniqueConstraint(
            "workspace_id", "normalized_name", name=op.f("uq_bookmark_collections_workspace_id")
        ),
    )
    op.create_table(
        "bookmarks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("collection_id", sa.Uuid(), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("pinned", sa.Boolean(), nullable=False),
        sa.Column("open_count", sa.Integer(), nullable=False),
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('link', 'article', 'video', 'reel', 'repo', 'tool')",
            name=op.f("ck_bookmarks_kind"),
        ),
        sa.CheckConstraint(
            "status IN ('reference', 'later', 'done')", name=op.f("ck_bookmarks_status")
        ),
        sa.CheckConstraint("length(url) BETWEEN 1 AND 2048", name=op.f("ck_bookmarks_url_length")),
        sa.CheckConstraint(
            "length(title) BETWEEN 1 AND 200", name=op.f("ck_bookmarks_title_length")
        ),
        sa.CheckConstraint("length(note) <= 1000", name=op.f("ck_bookmarks_note_length")),
        sa.CheckConstraint("open_count >= 0", name=op.f("ck_bookmarks_open_count_positive")),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_bookmarks_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["collection_id", "workspace_id"],
            ["bookmark_collections.id", "bookmark_collections.workspace_id"],
            name="fk_bookmarks_collection",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bookmarks")),
    )
    op.create_index(
        "ix_bookmarks_workspace_collection", "bookmarks", ["workspace_id", "collection_id"]
    )
    op.create_index("ix_bookmarks_workspace_created", "bookmarks", ["workspace_id", "created_at"])

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE bookmark_collections ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_bookmarks_workspace_created", table_name="bookmarks")
    op.drop_index("ix_bookmarks_workspace_collection", table_name="bookmarks")
    op.drop_table("bookmarks")
    op.drop_table("bookmark_collections")
