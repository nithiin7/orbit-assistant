"""Reminders, reminder occurrences, notifications, and the user's time zone.

`tasks` gains a unique `(id, workspace_id)` key, the target of the composite foreign key that
keeps a reminder in its task's workspace. `users` gains an optional IANA `timezone`.

Like the other tables, the new ones have Row Level Security enabled with no policies on
PostgreSQL, so Supabase's Data API roles cannot reach them; the API enforces access itself.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("reminders", "reminder_occurrences", "notifications")


def upgrade() -> None:
    # Batch mode rebuilds the tables on SQLite, which can't add constraints in place.
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("timezone", sa.String(length=64), nullable=True))
        batch.create_check_constraint(
            op.f("ck_users_timezone_length"), "length(timezone) BETWEEN 1 AND 64"
        )
    with op.batch_alter_table("tasks") as batch:
        batch.create_unique_constraint(op.f("uq_tasks_id"), ["id", "workspace_id"])

    op.create_table(
        "reminders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("time_of_day", sa.Time(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("recurrence", sa.JSON(), nullable=True),
        sa.Column("last_occurrence_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_outcome", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(title) BETWEEN 1 AND 200", name=op.f("ck_reminders_title_length")
        ),
        sa.CheckConstraint(
            "length(description) <= 2000", name=op.f("ck_reminders_description_length")
        ),
        sa.CheckConstraint(
            "length(timezone) BETWEEN 1 AND 64", name=op.f("ck_reminders_timezone_length")
        ),
        sa.CheckConstraint(
            "last_outcome IN ('delivered', 'cancelled', 'failed')",
            name=op.f("ck_reminders_last_outcome"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_reminders_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name=op.f("fk_reminders_task_id_tasks"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reminders")),
    )
    op.create_index(
        "ix_reminders_workspace_created_at", "reminders", ["workspace_id", "created_at"]
    )
    op.create_index("ix_reminders_task_id", "reminders", ["task_id"])

    op.create_table(
        "reminder_occurrences",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reminder_id", sa.Uuid(), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claim_token", sa.Uuid(), nullable=True),
        sa.Column("claimed_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'delivered', 'cancelled', 'failed')",
            name=op.f("ck_reminder_occurrences_status"),
        ),
        sa.CheckConstraint("attempts >= 0", name=op.f("ck_reminder_occurrences_attempts")),
        sa.CheckConstraint(
            "(status = 'processing' AND claim_token IS NOT NULL AND claimed_until IS NOT NULL)"
            " OR (status <> 'processing' AND claim_token IS NULL AND claimed_until IS NULL)",
            name=op.f("ck_reminder_occurrences_claim_matches_status"),
        ),
        sa.CheckConstraint(
            "(status IN ('delivered', 'cancelled', 'failed') AND finished_at IS NOT NULL)"
            " OR (status IN ('pending', 'processing') AND finished_at IS NULL)",
            name=op.f("ck_reminder_occurrences_finished_at_matches_status"),
        ),
        sa.CheckConstraint(
            "length(last_error) <= 100", name=op.f("ck_reminder_occurrences_last_error_length")
        ),
        sa.ForeignKeyConstraint(
            ["reminder_id"],
            ["reminders.id"],
            name=op.f("fk_reminder_occurrences_reminder_id_reminders"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reminder_occurrences")),
        sa.UniqueConstraint(
            "reminder_id", "scheduled_for", name="uq_reminder_occurrences_reminder_time"
        ),
    )
    op.create_index(
        "ix_reminder_occurrences_status_available_at",
        "reminder_occurrences",
        ["status", "available_at"],
    )
    op.create_index(
        "ix_reminder_occurrences_reminder_status", "reminder_occurrences", ["reminder_id", "status"]
    )

    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("reminder_id", sa.Uuid(), nullable=True),
        sa.Column("occurrence_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "length(title) BETWEEN 1 AND 200", name=op.f("ck_notifications_title_length")
        ),
        sa.CheckConstraint("length(body) <= 2000", name=op.f("ck_notifications_body_length")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_notifications_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_notifications_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reminder_id"],
            ["reminders.id"],
            name=op.f("fk_notifications_reminder_id_reminders"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["occurrence_id"],
            ["reminder_occurrences.id"],
            name=op.f("fk_notifications_occurrence_id_reminder_occurrences"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
        sa.UniqueConstraint("occurrence_id", "user_id", name="uq_notifications_occurrence_user"),
    )
    op.create_index("ix_notifications_user_created_at", "notifications", ["user_id", "created_at"])
    op.create_index("ix_notifications_user_read_at", "notifications", ["user_id", "read_at"])
    op.create_index(op.f("ix_notifications_workspace_id"), "notifications", ["workspace_id"])
    op.create_index(op.f("ix_notifications_reminder_id"), "notifications", ["reminder_id"])

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_table("reminder_occurrences")
    op.drop_table("reminders")
    with op.batch_alter_table("tasks") as batch:
        batch.drop_constraint(op.f("uq_tasks_id"), type_="unique")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint(op.f("ck_users_timezone_length"), type_="check")
        batch.drop_column("timezone")
