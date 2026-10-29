"""Shopping lists and items.

Like `tasks`, both tables have Row Level Security enabled with no policies on PostgreSQL, so
Supabase's Data API roles cannot reach them; the API enforces access itself.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("shopping_lists", "shopping_items")


def upgrade() -> None:
    op.create_table(
        "shopping_lists",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name=op.f("ck_shopping_lists_name_length")
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_shopping_lists_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shopping_lists")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_shopping_lists_id")),
    )
    op.create_index(op.f("ix_shopping_lists_workspace_id"), "shopping_lists", ["workspace_id"])
    # At most one default list per workspace.
    op.create_index(
        "uq_shopping_lists_default_workspace",
        "shopping_lists",
        ["workspace_id"],
        unique=True,
        sqlite_where=sa.text("is_default"),
        postgresql_where=sa.text("is_default"),
    )

    op.create_table(
        "shopping_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("list_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("quantity", sa.String(length=50), nullable=True),
        sa.Column("url", sa.String(length=2048), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("purchased_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 200", name=op.f("ck_shopping_items_name_length")
        ),
        sa.CheckConstraint(
            "length(quantity) <= 50", name=op.f("ck_shopping_items_quantity_length")
        ),
        sa.CheckConstraint("length(url) <= 2048", name=op.f("ck_shopping_items_url_length")),
        sa.CheckConstraint("length(notes) <= 2000", name=op.f("ck_shopping_items_notes_length")),
        sa.CheckConstraint(
            "status IN ('needed', 'purchased')", name=op.f("ck_shopping_items_status")
        ),
        sa.CheckConstraint(
            "(status = 'purchased' AND purchased_at IS NOT NULL)"
            " OR (status = 'needed' AND purchased_at IS NULL)",
            name=op.f("ck_shopping_items_purchased_at_matches_status"),
        ),
        sa.ForeignKeyConstraint(
            ["list_id", "workspace_id"],
            ["shopping_lists.id", "shopping_lists.workspace_id"],
            name=op.f("fk_shopping_items_list_id_shopping_lists"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shopping_items")),
    )
    op.create_index(
        "ix_shopping_items_workspace_list", "shopping_items", ["workspace_id", "list_id"]
    )

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_shopping_items_workspace_list", table_name="shopping_items")
    op.drop_table("shopping_items")
    op.drop_index("uq_shopping_lists_default_workspace", table_name="shopping_lists")
    op.drop_index(op.f("ix_shopping_lists_workspace_id"), table_name="shopping_lists")
    op.drop_table("shopping_lists")
