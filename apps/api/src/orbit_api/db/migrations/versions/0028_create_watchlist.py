"""Watchlist.

- `watch_items`: a workspace's movies and series, each wanted, being watched, watched, or
  dropped, with episode progress for series. A poster lives in the attachment store under
  `poster_blob_id`.
- `workspaces` gains `watchlist_lookup_enabled`: whether the workspace looks titles up at TMDB.
  Existing and new workspaces start with it off.

On PostgreSQL the new table has Row Level Security enabled with no policies, like the others;
the API enforces access itself.

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("workspaces", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "watchlist_lookup_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )
    # The database default stays: workspaces are also created by SQL outside the ORM.

    op.create_table(
        "watch_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("release_year", sa.Integer(), nullable=True),
        sa.Column("overview", sa.Text(), nullable=False),
        sa.Column("genres", sa.JSON(), nullable=False),
        sa.Column("runtime_minutes", sa.Integer(), nullable=True),
        sa.Column("season_episodes", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("progress_season", sa.Integer(), nullable=True),
        sa.Column("progress_episode", sa.Integer(), nullable=True),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("platform", sa.String(length=60), nullable=True),
        sa.Column("recommended_by", sa.String(length=100), nullable=True),
        sa.Column("source_id", sa.Integer(), nullable=True),
        sa.Column("poster_blob_id", sa.Uuid(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('movie', 'series')", name=op.f("ck_watch_items_kind")),
        sa.CheckConstraint(
            "status IN ('want', 'watching', 'watched', 'dropped')",
            name=op.f("ck_watch_items_status"),
        ),
        sa.CheckConstraint(
            "length(title) BETWEEN 1 AND 300", name=op.f("ck_watch_items_title_length")
        ),
        sa.CheckConstraint("length(overview) <= 4000", name=op.f("ck_watch_items_overview_length")),
        sa.CheckConstraint("length(notes) <= 2000", name=op.f("ck_watch_items_notes_length")),
        sa.CheckConstraint("length(platform) <= 60", name=op.f("ck_watch_items_platform_length")),
        sa.CheckConstraint(
            "length(recommended_by) <= 100", name=op.f("ck_watch_items_recommended_by_length")
        ),
        sa.CheckConstraint(
            "release_year BETWEEN 1870 AND 2200", name=op.f("ck_watch_items_release_year_range")
        ),
        sa.CheckConstraint(
            "runtime_minutes BETWEEN 1 AND 6000", name=op.f("ck_watch_items_runtime_range")
        ),
        sa.CheckConstraint("rating BETWEEN 1 AND 10", name=op.f("ck_watch_items_rating_range")),
        sa.CheckConstraint(
            "(progress_season IS NULL AND progress_episode IS NULL)"
            " OR (kind = 'series' AND progress_season >= 1 AND progress_episode >= 1)",
            name=op.f("ck_watch_items_progress_valid"),
        ),
        sa.CheckConstraint(
            "(status = 'watched') = (finished_at IS NOT NULL)",
            name=op.f("ck_watch_items_finished_at_matches_status"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_watch_items_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_watch_items")),
        sa.UniqueConstraint(
            "workspace_id", "kind", "source_id", name=op.f("uq_watch_items_workspace_id")
        ),
        sa.UniqueConstraint("poster_blob_id", name=op.f("uq_watch_items_poster_blob_id")),
    )
    op.create_index(
        "ix_watch_items_workspace_position", "watch_items", ["workspace_id", "position"]
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE watch_items ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_watch_items_workspace_position", table_name="watch_items")
    op.drop_table("watch_items")
    with op.batch_alter_table("workspaces", schema=None) as batch_op:
        batch_op.drop_column("watchlist_lookup_enabled")
