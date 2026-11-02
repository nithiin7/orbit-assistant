"""Dashboard preferences: layout density and hidden amounts.

Adds `density` (`comfortable` or `compact`) and `hide_amounts` to `dashboard_layouts`. Existing
layouts get the defaults: comfortable, amounts shown. The table already has Row Level Security
enabled on PostgreSQL (revision 0006).

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DENSITY = "density IN ('comfortable', 'compact')"


def upgrade() -> None:
    with op.batch_alter_table("dashboard_layouts", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("density", sa.String(length=16), nullable=False, server_default="comfortable")
        )
        batch_op.add_column(
            sa.Column("hide_amounts", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.create_check_constraint(op.f("ck_dashboard_layouts_density"), DENSITY)
    # The defaults only fill existing rows; the application always sets both columns.
    with op.batch_alter_table("dashboard_layouts", schema=None) as batch_op:
        batch_op.alter_column("density", server_default=None)
        batch_op.alter_column("hide_amounts", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("dashboard_layouts", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_dashboard_layouts_density"), type_="check")
        batch_op.drop_column("hide_amounts")
        batch_op.drop_column("density")
