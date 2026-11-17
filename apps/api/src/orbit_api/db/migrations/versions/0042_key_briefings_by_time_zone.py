"""One briefing per time zone.

- `daily_briefings`: the unique key `(workspace_id, user_id, briefing_date)` gains `timezone`,
  so a briefing asked for in a second time zone on the same local date is its own briefing.
  On SQLite batch mode rebuilds `daily_briefings` (copy every row, drop, rename); nothing
  references it, and every existing row stays unique under the wider key.

Revision ID: 0042
Revises: 0041
Create Date: 2026-11-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0042"
down_revision: str | None = "0041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NAME = "uq_daily_briefings_workspace_id"


def upgrade() -> None:
    with op.batch_alter_table("daily_briefings", schema=None) as batch_op:
        batch_op.drop_constraint(op.f(_NAME), type_="unique")
        batch_op.create_unique_constraint(
            op.f(_NAME), ["workspace_id", "user_id", "briefing_date", "timezone"]
        )


def downgrade() -> None:
    # Keep the most recently prepared briefing of each date, so the narrower key holds.
    op.execute(
        "DELETE FROM daily_briefings WHERE id IN ("
        " SELECT b.id FROM daily_briefings AS b"
        " JOIN daily_briefings AS newer"
        "   ON newer.workspace_id = b.workspace_id AND newer.user_id = b.user_id"
        "  AND newer.briefing_date = b.briefing_date AND newer.id <> b.id"
        "  AND (newer.generated_at > b.generated_at"
        "       OR (newer.generated_at = b.generated_at AND newer.id > b.id)))"
    )
    with op.batch_alter_table("daily_briefings", schema=None) as batch_op:
        batch_op.drop_constraint(op.f(_NAME), type_="unique")
        batch_op.create_unique_constraint(op.f(_NAME), ["workspace_id", "user_id", "briefing_date"])
