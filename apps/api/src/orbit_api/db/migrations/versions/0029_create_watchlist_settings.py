"""Watchlist settings.

TMDB lookup moves from a server-wide key (`ORBIT_TMDB_API_KEY`) to a key each workspace saves
in Settings → Watchlist:

- `watchlist_settings`: per workspace, whether lookup is on and the TMDB API key, encrypted with
  the server's secret key (the one AI provider keys use). Lookup can only be on with a key.
- `workspaces.watchlist_lookup_enabled` (from 0028) is dropped: without a key it can't take
  effect, so no workspace loses anything.

On PostgreSQL the new table has Row Level Security enabled with no policies, like the others;
the API enforces access itself.

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "watchlist_settings",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("lookup_enabled", sa.Boolean(), nullable=False),
        sa.Column("tmdb_api_key", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "NOT lookup_enabled OR tmdb_api_key IS NOT NULL",
            name=op.f("ck_watchlist_settings_lookup_needs_key"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_watchlist_settings_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("workspace_id", name=op.f("pk_watchlist_settings")),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE watchlist_settings ENABLE ROW LEVEL SECURITY")

    with op.batch_alter_table("workspaces", schema=None) as batch_op:
        batch_op.drop_column("watchlist_lookup_enabled")


def downgrade() -> None:
    with op.batch_alter_table("workspaces", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "watchlist_lookup_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )
    op.drop_table("watchlist_settings")
