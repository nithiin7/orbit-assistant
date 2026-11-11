"""Daily activity targets on the fitness profile.

`fitness_profiles` gains `steps_target`, `active_target_s`, and `sleep_target_s`, all empty for
existing rows (the web then shows default goals). Added with plain `ADD COLUMN`; no table is
rebuilt. The API validates their ranges.

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("fitness_profiles", sa.Column("steps_target", sa.Integer(), nullable=True))
    op.add_column("fitness_profiles", sa.Column("active_target_s", sa.Integer(), nullable=True))
    op.add_column("fitness_profiles", sa.Column("sleep_target_s", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("fitness_profiles", schema=None) as batch_op:
        batch_op.drop_column("sleep_target_s")
        batch_op.drop_column("active_target_s")
        batch_op.drop_column("steps_target")
