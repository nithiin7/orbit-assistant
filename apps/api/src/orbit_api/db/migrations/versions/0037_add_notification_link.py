"""A link on each notification.

`notifications` gains a nullable `link`: the in-app page opening the notification goes to.
Existing rows keep `NULL`. Added with plain `ADD COLUMN`; no table is rebuilt.

Revision ID: 0037
Revises: 0036
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("link", sa.String(length=500), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("notifications", schema=None) as batch_op:
        batch_op.drop_column("link")
