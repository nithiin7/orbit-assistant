"""Calendar and events.

- `tasks` gains an optional scheduled time block (`scheduled_start`, `scheduled_end`), separate
  from its due date. Existing tasks stay unscheduled.
- `calendar_categories`: a workspace's event categories (name, palette color, visibility).
- `calendar_events`: events and recurring series. Times are stored as local wall-clock times in
  the event's IANA time zone, plus UTC bounds derived from them for range queries; recurrence is
  a versioned JSON rule, never expanded into rows.
- `calendar_event_exceptions`: skipped or changed occurrences, one per original start.
- `calendar_event_alerts`: per-event alerts, each managing one reminder.
- `calendar_event_notes`, `calendar_event_tasks`: links to existing notes and tasks.
- `calendar_preferences`: each user's calendar settings.
- `reminders` gains an optional, unique link to an event alert.

Every relationship is a composite foreign key on `(id, workspace_id)`. On PostgreSQL every new
table has Row Level Security enabled with no policies, like the others; the API enforces access
itself.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-31
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = (
    "calendar_categories",
    "calendar_events",
    "calendar_event_exceptions",
    "calendar_event_alerts",
    "calendar_event_notes",
    "calendar_event_tasks",
    "calendar_preferences",
)
CATEGORY_COLORS = "('blue', 'green', 'amber', 'rose', 'violet', 'teal', 'orange', 'slate')"
EVENT_STATUSES = "('confirmed', 'cancelled')"
TASK_SCHEDULE = (
    "(scheduled_start IS NULL AND scheduled_end IS NULL)"
    " OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL"
    " AND scheduled_end > scheduled_start)"
)
ONE_MANAGER = (
    "calendar_event_alert_id IS NULL OR (finance_loan_id IS NULL"
    " AND finance_recurring_payment_id IS NULL AND finance_deposit_id IS NULL)"
)


def _timestamp(name: str, *, nullable: bool = False) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _local(name: str, *, nullable: bool = False) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=False), nullable=nullable)


def _workspace_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["workspace_id"],
        ["workspaces.id"],
        name=op.f(f"fk_{table}_workspace_id_workspaces"),
        ondelete="CASCADE",
    )


def _event_fk(name: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["event_id", "workspace_id"],
        ["calendar_events.id", "calendar_events.workspace_id"],
        name=name,
        ondelete="CASCADE",
    )


def _category_fk(name: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["category_id", "workspace_id"],
        ["calendar_categories.id", "calendar_categories.workspace_id"],
        name=name,
    )


def upgrade() -> None:
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.add_column(sa.Column("scheduled_start", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("scheduled_end", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_check_constraint(op.f("ck_tasks_schedule"), TASK_SCHEDULE)
        batch_op.create_index(
            "ix_tasks_workspace_scheduled_start", ["workspace_id", "scheduled_start"], unique=False
        )

    op.create_table(
        "calendar_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("normalized_name", sa.String(length=50), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("is_visible", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 50", name=op.f("ck_calendar_categories_name_length")
        ),
        sa.CheckConstraint(
            f"color IN {CATEGORY_COLORS}", name=op.f("ck_calendar_categories_color")
        ),
        _workspace_fk("calendar_categories"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_categories")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_calendar_categories_id")),
        sa.UniqueConstraint(
            "workspace_id", "normalized_name", name=op.f("uq_calendar_categories_workspace_id")
        ),
    )

    op.create_table(
        "calendar_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("location", sa.String(length=200), nullable=False),
        sa.Column("all_day", sa.Boolean(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        _local("start_local"),
        _local("end_local"),
        _timestamp("start_at"),
        _timestamp("end_at"),
        _timestamp("until_at", nullable=True),
        sa.Column("recurrence", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("series_id", sa.Uuid(), nullable=True),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.CheckConstraint(
            "length(title) BETWEEN 1 AND 200", name=op.f("ck_calendar_events_title_length")
        ),
        sa.CheckConstraint(
            "length(description) <= 5000", name=op.f("ck_calendar_events_description_length")
        ),
        sa.CheckConstraint(
            "length(location) <= 200", name=op.f("ck_calendar_events_location_length")
        ),
        sa.CheckConstraint(
            "length(timezone) BETWEEN 1 AND 64", name=op.f("ck_calendar_events_timezone_length")
        ),
        sa.CheckConstraint(f"status IN {EVENT_STATUSES}", name=op.f("ck_calendar_events_status")),
        sa.CheckConstraint(
            "end_local >= start_local", name=op.f("ck_calendar_events_end_after_start")
        ),
        _workspace_fk("calendar_events"),
        _category_fk("fk_calendar_events_category"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_events")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_calendar_events_id")),
    )
    op.create_index(
        "ix_calendar_events_workspace_start_at", "calendar_events", ["workspace_id", "start_at"]
    )
    op.create_index(
        "ix_calendar_events_workspace_until_at", "calendar_events", ["workspace_id", "until_at"]
    )

    op.create_table(
        "calendar_event_exceptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        _local("original_start"),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        _local("start_local", nullable=True),
        _local("end_local", nullable=True),
        _timestamp("start_at", nullable=True),
        _timestamp("end_at", nullable=True),
        sa.Column("status", sa.String(length=16), nullable=True),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.CheckConstraint(
            "kind IN ('skipped', 'modified')", name=op.f("ck_calendar_event_exceptions_kind")
        ),
        sa.CheckConstraint(
            f"status IS NULL OR status IN {EVENT_STATUSES}",
            name=op.f("ck_calendar_event_exceptions_status"),
        ),
        sa.CheckConstraint(
            "title IS NULL OR length(title) BETWEEN 1 AND 200",
            name=op.f("ck_calendar_event_exceptions_title_length"),
        ),
        sa.CheckConstraint(
            "description IS NULL OR length(description) <= 5000",
            name=op.f("ck_calendar_event_exceptions_description_length"),
        ),
        sa.CheckConstraint(
            "location IS NULL OR length(location) <= 200",
            name=op.f("ck_calendar_event_exceptions_location_length"),
        ),
        sa.CheckConstraint(
            "(start_local IS NULL AND end_local IS NULL)"
            " OR (start_local IS NOT NULL AND end_local IS NOT NULL AND end_local >= start_local)",
            name=op.f("ck_calendar_event_exceptions_times"),
        ),
        _workspace_fk("calendar_event_exceptions"),
        _event_fk("fk_calendar_event_exceptions_event"),
        _category_fk("fk_calendar_event_exceptions_category"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_event_exceptions")),
        sa.UniqueConstraint(
            "event_id", "original_start", name=op.f("uq_calendar_event_exceptions_event_id")
        ),
    )
    op.create_index(
        "ix_calendar_event_exceptions_workspace_start_at",
        "calendar_event_exceptions",
        ["workspace_id", "start_at"],
    )

    op.create_table(
        "calendar_event_alerts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("minutes_before", sa.Integer(), nullable=False),
        _timestamp("created_at"),
        sa.CheckConstraint(
            "minutes_before BETWEEN 0 AND 40320",
            name=op.f("ck_calendar_event_alerts_minutes_before"),
        ),
        _workspace_fk("calendar_event_alerts"),
        _event_fk("fk_calendar_event_alerts_event"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_event_alerts")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_calendar_event_alerts_id")),
        sa.UniqueConstraint(
            "event_id", "minutes_before", name=op.f("uq_calendar_event_alerts_event_id")
        ),
    )

    op.create_table(
        "calendar_event_notes",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("note_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        _timestamp("created_at"),
        _workspace_fk("calendar_event_notes"),
        _event_fk("fk_calendar_event_notes_event"),
        sa.ForeignKeyConstraint(
            ["note_id", "workspace_id"],
            ["notes.id", "notes.workspace_id"],
            name="fk_calendar_event_notes_note",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("event_id", "note_id", name=op.f("pk_calendar_event_notes")),
    )
    op.create_index("ix_calendar_event_notes_note_id", "calendar_event_notes", ["note_id"])

    op.create_table(
        "calendar_event_tasks",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        _timestamp("created_at"),
        _workspace_fk("calendar_event_tasks"),
        _event_fk("fk_calendar_event_tasks_event"),
        sa.ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_calendar_event_tasks_task",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("event_id", "task_id", name=op.f("pk_calendar_event_tasks")),
    )
    op.create_index("ix_calendar_event_tasks_task_id", "calendar_event_tasks", ["task_id"])

    op.create_table(
        "calendar_preferences",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("default_view", sa.String(length=16), nullable=False),
        sa.Column("week_start", sa.SmallInteger(), nullable=True),
        sa.Column("working_hours_start", sa.Time(), nullable=False),
        sa.Column("working_hours_end", sa.Time(), nullable=False),
        sa.Column("show_completed_tasks", sa.Boolean(), nullable=False),
        sa.Column("show_unscheduled_tasks", sa.Boolean(), nullable=False),
        sa.Column("show_due_tasks", sa.Boolean(), nullable=False),
        _timestamp("updated_at"),
        sa.CheckConstraint(
            "default_view IN ('month', 'week', 'day', 'agenda')",
            name=op.f("ck_calendar_preferences_default_view"),
        ),
        sa.CheckConstraint(
            "week_start IS NULL OR week_start BETWEEN 0 AND 6",
            name=op.f("ck_calendar_preferences_week_start"),
        ),
        sa.CheckConstraint(
            "working_hours_end > working_hours_start",
            name=op.f("ck_calendar_preferences_working_hours"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_calendar_preferences_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_calendar_preferences")),
    )

    with op.batch_alter_table("reminders", schema=None) as batch_op:
        batch_op.add_column(sa.Column("calendar_event_alert_id", sa.Uuid(), nullable=True))
        batch_op.create_unique_constraint(
            "uq_reminders_calendar_event_alert_id", ["calendar_event_alert_id"]
        )
        batch_op.create_foreign_key(
            "fk_reminders_calendar_event_alert",
            "calendar_event_alerts",
            ["calendar_event_alert_id", "workspace_id"],
            ["id", "workspace_id"],
            ondelete="CASCADE",
        )
        batch_op.create_check_constraint(op.f("ck_reminders_one_manager"), ONE_MANAGER)

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    # Alert reminders can't survive without their link; their notifications stay.
    op.execute("DELETE FROM reminders WHERE calendar_event_alert_id IS NOT NULL")
    with op.batch_alter_table("reminders", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_reminders_one_manager"), type_="check")
        batch_op.drop_constraint("fk_reminders_calendar_event_alert", type_="foreignkey")
        batch_op.drop_constraint("uq_reminders_calendar_event_alert_id", type_="unique")
        batch_op.drop_column("calendar_event_alert_id")

    op.drop_table("calendar_preferences")
    op.drop_index("ix_calendar_event_tasks_task_id", table_name="calendar_event_tasks")
    op.drop_table("calendar_event_tasks")
    op.drop_index("ix_calendar_event_notes_note_id", table_name="calendar_event_notes")
    op.drop_table("calendar_event_notes")
    op.drop_table("calendar_event_alerts")
    op.drop_index(
        "ix_calendar_event_exceptions_workspace_start_at", table_name="calendar_event_exceptions"
    )
    op.drop_table("calendar_event_exceptions")
    op.drop_index("ix_calendar_events_workspace_until_at", table_name="calendar_events")
    op.drop_index("ix_calendar_events_workspace_start_at", table_name="calendar_events")
    op.drop_table("calendar_events")
    op.drop_table("calendar_categories")

    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_index("ix_tasks_workspace_scheduled_start")
        batch_op.drop_constraint(op.f("ck_tasks_schedule"), type_="check")
        batch_op.drop_column("scheduled_end")
        batch_op.drop_column("scheduled_start")
