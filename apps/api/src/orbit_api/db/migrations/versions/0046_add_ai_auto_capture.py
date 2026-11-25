"""Let a person have simple items added without approving each one.

`ai_settings` gains `auto_capture` (off for everyone), added with plain `ADD COLUMN`; the table is
not rebuilt.

Revision ID: 0046
Revises: 0045
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0046"
down_revision: str | None = "0045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ai_settings",
        sa.Column("auto_capture", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    with op.batch_alter_table("ai_settings", schema=None) as batch_op:
        batch_op.drop_column("auto_capture")
