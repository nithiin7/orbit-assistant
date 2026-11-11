"""Achievements and the XP store, per person.

- `achievement_unlocks`: which achievements a user unlocked, when, and the XP they earned.
- `reward_purchases`: store items a user bought with XP, at the price paid.
- `reward_equips`: the owned item a user wears in each slot (frame, banner, title, confetti).

Only new tables; no existing table is rebuilt or changed. On PostgreSQL the new tables have Row
Level Security enabled with no policies, like the others; the API enforces access itself.

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "achievement_unlocks",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("achievement_key", sa.String(length=64), nullable=False),
        sa.Column("xp", sa.Integer(), nullable=False),
        sa.Column("unlocked_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("xp >= 0", name=op.f("ck_achievement_unlocks_xp")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_achievement_unlocks_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "achievement_key", name=op.f("pk_achievement_unlocks")),
    )
    op.create_table(
        "reward_purchases",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("item_key", sa.String(length=64), nullable=False),
        sa.Column("cost", sa.Integer(), nullable=False),
        sa.Column("purchased_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("cost >= 0", name=op.f("ck_reward_purchases_cost")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_reward_purchases_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "item_key", name=op.f("pk_reward_purchases")),
    )
    op.create_table(
        "reward_equips",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("slot", sa.String(length=16), nullable=False),
        sa.Column("item_key", sa.String(length=64), nullable=False),
        sa.Column("equipped_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "slot IN ('frame', 'banner', 'title', 'confetti')",
            name=op.f("ck_reward_equips_slot"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "item_key"],
            ["reward_purchases.user_id", "reward_purchases.item_key"],
            name="fk_reward_equips_purchase",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_reward_equips_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "slot", name=op.f("pk_reward_equips")),
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE achievement_unlocks ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE reward_purchases ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE reward_equips ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("reward_equips")
    op.drop_table("reward_purchases")
    op.drop_table("achievement_unlocks")
