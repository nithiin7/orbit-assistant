"""Link previews for bookmarks (opt-in).

- `bookmarks` gains `preview_description` and `previewed_at`, both empty for existing rows.
  Added with plain `ADD COLUMN`; no table is rebuilt.
- `bookmark_previews`: the preview image and site icon fetched for a bookmark, each a file in the
  attachment store named by the row's `id`. Deleting a bookmark deletes its rows.
- `bookmark_settings`: whether a workspace fetches previews. No row means off, so existing
  workspaces start with previews off.

On PostgreSQL the new tables have Row Level Security enabled with no policies, like the others;
the API enforces access itself.

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("bookmarks", sa.Column("preview_description", sa.Text(), nullable=True))
    op.add_column("bookmarks", sa.Column("previewed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "bookmark_previews",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("bookmark_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=8), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('image', 'icon')", name=op.f("ck_bookmark_previews_role")),
        sa.CheckConstraint(
            "content_type IN ('image/jpeg', 'image/png', 'image/gif', 'image/webp',"
            " 'image/x-icon')",
            name=op.f("ck_bookmark_previews_content_type"),
        ),
        sa.ForeignKeyConstraint(
            ["bookmark_id"],
            ["bookmarks.id"],
            name=op.f("fk_bookmark_previews_bookmark_id_bookmarks"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_bookmark_previews_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bookmark_previews")),
        sa.UniqueConstraint("bookmark_id", "role", name=op.f("uq_bookmark_previews_bookmark_id")),
    )
    op.create_table(
        "bookmark_settings",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("previews_enabled", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_bookmark_settings_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("workspace_id", name=op.f("pk_bookmark_settings")),
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE bookmark_previews ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE bookmark_settings ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("bookmark_settings")
    op.drop_table("bookmark_previews")
    with op.batch_alter_table("bookmarks", schema=None) as batch_op:
        batch_op.drop_column("previewed_at")
        batch_op.drop_column("preview_description")
