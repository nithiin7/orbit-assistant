"""Habits and routines.

- `habit_categories`: a workspace's habit categories (name, palette color, icon).
- `habits`: habits (boolean, numeric, or duration), with dates, a time zone, and a status.
- `habit_schedule_versions`: each habit's schedules, each effective from a date, never rewritten.
- `habit_pauses`: date ranges a habit was paused or archived.
- `habit_logs`: one entry per habit and local date, with the target that applied.
- `habit_tasks`, `habit_notes`: links to existing tasks and notes.
- `routines`, `routine_steps`: routines and their ordered steps.
- `routine_sessions`, `routine_session_steps`: runs of a routine, with copies of its steps; at
  most one active session per routine.
- `habit_reminders`: reminder times for a habit or routine, each managing one reminder.
- `reminders` gains an optional, unique link to a habit reminder time.
- `calendar_preferences` gains `show_habits` (on for existing rows).

On PostgreSQL every new table has Row Level Security enabled with no policies, like the others;
the API enforces access itself.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-01
"""

import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = (
    "habit_categories",
    "habits",
    "habit_schedule_versions",
    "habit_pauses",
    "habit_logs",
    "habit_tasks",
    "habit_notes",
    "routines",
    "routine_steps",
    "routine_sessions",
    "routine_session_steps",
    "habit_reminders",
)
COLORS = "('blue', 'green', 'amber', 'rose', 'violet', 'teal', 'orange', 'slate')"
STATUSES = "('active', 'paused', 'archived')"
ACTIVE_SESSION = "status = 'active'"
HABIT_MANAGER = (
    "habit_reminder_id IS NULL OR (finance_loan_id IS NULL AND finance_recurring_payment_id IS NULL"
    " AND finance_deposit_id IS NULL AND calendar_event_alert_id IS NULL)"
)


def _timestamp(name: str, *, nullable: bool = False) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _id() -> sa.Column[uuid.UUID]:
    return sa.Column("id", sa.Uuid(), nullable=False)


def _workspace() -> sa.Column[uuid.UUID]:
    return sa.Column("workspace_id", sa.Uuid(), nullable=False)


def _workspace_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["workspace_id"],
        ["workspaces.id"],
        name=op.f(f"fk_{table}_workspace_id_workspaces"),
        ondelete="CASCADE",
    )


def _composite_fk(column: str, table: str, name: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column, "workspace_id"],
        [f"{table}.id", f"{table}.workspace_id"],
        name=name,
        ondelete="CASCADE",
    )


def _category_fk(name: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["category_id", "workspace_id"],
        ["habit_categories.id", "habit_categories.workspace_id"],
        name=name,
    )


def _clearing_fk(table: str, column: str, target: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column], [f"{target}.id"], name=op.f(f"fk_{table}_{column}_{target}"), ondelete="SET NULL"
    )


def _check(table: str, name: str, condition: str) -> sa.CheckConstraint:
    return sa.CheckConstraint(condition, name=op.f(f"ck_{table}_{name}"))


def upgrade() -> None:
    op.create_table(
        "habit_categories",
        _id(),
        _workspace(),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("normalized_name", sa.String(length=50), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("icon", sa.String(length=32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        _check("habit_categories", "name_length", "length(name) BETWEEN 1 AND 50"),
        _check("habit_categories", "color", f"color IN {COLORS}"),
        _workspace_fk("habit_categories"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_habit_categories")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_habit_categories_id")),
        sa.UniqueConstraint(
            "workspace_id", "normalized_name", name=op.f("uq_habit_categories_workspace_id")
        ),
    )

    op.create_table(
        "habits",
        _id(),
        _workspace(),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("icon", sa.String(length=32), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=False),
        sa.Column("target", sa.Float(), nullable=True),
        sa.Column("time_of_day", sa.Time(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        _check("habits", "name_length", "length(name) BETWEEN 1 AND 100"),
        _check("habits", "description_length", "length(description) <= 2000"),
        _check("habits", "unit_length", "length(unit) <= 20"),
        _check("habits", "timezone_length", "length(timezone) BETWEEN 1 AND 64"),
        _check("habits", "color", f"color IN {COLORS}"),
        _check("habits", "kind", "kind IN ('boolean', 'numeric', 'duration')"),
        _check("habits", "status", f"status IN {STATUSES}"),
        _check(
            "habits",
            "target",
            "(kind = 'boolean' AND target IS NULL) OR (kind <> 'boolean' AND target > 0)",
        ),
        _check("habits", "dates", "end_date IS NULL OR end_date >= start_date"),
        _workspace_fk("habits"),
        _category_fk("fk_habits_category"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_habits")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_habits_id")),
    )
    op.create_index("ix_habits_workspace_status", "habits", ["workspace_id", "status"])

    op.create_table(
        "habit_schedule_versions",
        _id(),
        _workspace(),
        sa.Column("habit_id", sa.Uuid(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("schedule", sa.JSON(), nullable=False),
        _timestamp("created_at"),
        _workspace_fk("habit_schedule_versions"),
        _composite_fk("habit_id", "habits", "fk_habit_schedule_versions_habit"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_habit_schedule_versions")),
        sa.UniqueConstraint(
            "habit_id", "effective_from", name=op.f("uq_habit_schedule_versions_habit_id")
        ),
    )

    op.create_table(
        "habit_pauses",
        _id(),
        _workspace(),
        sa.Column("habit_id", sa.Uuid(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        _check("habit_pauses", "dates", "end_date IS NULL OR end_date > start_date"),
        _workspace_fk("habit_pauses"),
        _composite_fk("habit_id", "habits", "fk_habit_pauses_habit"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_habit_pauses")),
    )
    op.create_index("ix_habit_pauses_habit_id", "habit_pauses", ["habit_id"])

    op.create_table(
        "habit_logs",
        _id(),
        _workspace(),
        sa.Column("habit_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("target", sa.Float(), nullable=False),
        sa.Column("skipped", sa.Boolean(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        _timestamp("logged_at"),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        _check("habit_logs", "value", "value >= 0"),
        _check("habit_logs", "target", "target > 0"),
        _check("habit_logs", "note_length", "length(note) <= 1000"),
        _workspace_fk("habit_logs"),
        _composite_fk("habit_id", "habits", "fk_habit_logs_habit"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_habit_logs")),
        sa.UniqueConstraint("habit_id", "day", name=op.f("uq_habit_logs_habit_id")),
    )
    op.create_index("ix_habit_logs_workspace_day", "habit_logs", ["workspace_id", "day"])

    for table, column, target, fk in (
        ("habit_tasks", "task_id", "tasks", "fk_habit_tasks_task"),
        ("habit_notes", "note_id", "notes", "fk_habit_notes_note"),
    ):
        op.create_table(
            table,
            sa.Column("habit_id", sa.Uuid(), nullable=False),
            sa.Column(column, sa.Uuid(), nullable=False),
            _workspace(),
            _timestamp("created_at"),
            _workspace_fk(table),
            _composite_fk("habit_id", "habits", f"fk_{table}_habit"),
            _composite_fk(column, target, fk),
            sa.PrimaryKeyConstraint("habit_id", column, name=op.f(f"pk_{table}")),
        )
        op.create_index(f"ix_{table}_{column}", table, [column])

    op.create_table(
        "routines",
        _id(),
        _workspace(),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("icon", sa.String(length=32), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("time_of_day", sa.Time(), nullable=True),
        sa.Column("weekdays", sa.JSON(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        _check("routines", "name_length", "length(name) BETWEEN 1 AND 100"),
        _check("routines", "description_length", "length(description) <= 2000"),
        _check("routines", "timezone_length", "length(timezone) BETWEEN 1 AND 64"),
        _check("routines", "color", f"color IN {COLORS}"),
        _check("routines", "status", f"status IN {STATUSES}"),
        _workspace_fk("routines"),
        _category_fk("fk_routines_category"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routines")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_routines_id")),
    )
    op.create_index("ix_routines_workspace_status", "routines", ["workspace_id", "status"])

    op.create_table(
        "routine_steps",
        _id(),
        _workspace(),
        sa.Column("routine_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("habit_id", sa.Uuid(), nullable=True),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("note_id", sa.Uuid(), nullable=True),
        _check("routine_steps", "name_length", "length(name) BETWEEN 1 AND 100"),
        _check("routine_steps", "description_length", "length(description) <= 1000"),
        _check(
            "routine_steps",
            "duration",
            "duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440",
        ),
        _workspace_fk("routine_steps"),
        _composite_fk("routine_id", "routines", "fk_routine_steps_routine"),
        _clearing_fk("routine_steps", "habit_id", "habits"),
        _clearing_fk("routine_steps", "task_id", "tasks"),
        _clearing_fk("routine_steps", "note_id", "notes"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routine_steps")),
    )
    op.create_index(
        "ix_routine_steps_routine_position", "routine_steps", ["routine_id", "position"]
    )

    op.create_table(
        "routine_sessions",
        _id(),
        _workspace(),
        sa.Column("routine_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("routine_name", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        _timestamp("started_at"),
        _timestamp("finished_at", nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("note_id", sa.Uuid(), nullable=True),
        _check("routine_sessions", "status", "status IN ('active', 'completed', 'abandoned')"),
        _check("routine_sessions", "notes_length", "length(notes) <= 5000"),
        _check(
            "routine_sessions",
            "finished_at_matches_status",
            "(status = 'active' AND finished_at IS NULL)"
            " OR (status <> 'active' AND finished_at IS NOT NULL)",
        ),
        _workspace_fk("routine_sessions"),
        _composite_fk("routine_id", "routines", "fk_routine_sessions_routine"),
        _clearing_fk("routine_sessions", "note_id", "notes"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routine_sessions")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_routine_sessions_id")),
    )
    op.create_index(
        "ix_routine_sessions_routine_started_at", "routine_sessions", ["routine_id", "started_at"]
    )
    op.create_index(
        "uq_routine_sessions_active",
        "routine_sessions",
        ["routine_id"],
        unique=True,
        sqlite_where=sa.text(ACTIVE_SESSION),
        postgresql_where=sa.text(ACTIVE_SESSION),
    )

    op.create_table(
        "routine_session_steps",
        _id(),
        _workspace(),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("habit_id", sa.Uuid(), nullable=True),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        _timestamp("completed_at", nullable=True),
        _check("routine_session_steps", "status", "status IN ('pending', 'completed', 'skipped')"),
        _workspace_fk("routine_session_steps"),
        _composite_fk("session_id", "routine_sessions", "fk_routine_session_steps_session"),
        _clearing_fk("routine_session_steps", "habit_id", "habits"),
        _clearing_fk("routine_session_steps", "task_id", "tasks"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routine_session_steps")),
    )
    op.create_index("ix_routine_session_steps_session_id", "routine_session_steps", ["session_id"])

    op.create_table(
        "habit_reminders",
        _id(),
        _workspace(),
        sa.Column("habit_id", sa.Uuid(), nullable=True),
        sa.Column("routine_id", sa.Uuid(), nullable=True),
        sa.Column("time_of_day", sa.Time(), nullable=False),
        sa.Column("weekdays", sa.JSON(), nullable=False),
        _timestamp("created_at"),
        _check("habit_reminders", "one_owner", "(habit_id IS NULL) <> (routine_id IS NULL)"),
        _workspace_fk("habit_reminders"),
        _composite_fk("habit_id", "habits", "fk_habit_reminders_habit"),
        _composite_fk("routine_id", "routines", "fk_habit_reminders_routine"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_habit_reminders")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_habit_reminders_id")),
        sa.UniqueConstraint("habit_id", "time_of_day", name=op.f("uq_habit_reminders_habit_id")),
        sa.UniqueConstraint(
            "routine_id", "time_of_day", name=op.f("uq_habit_reminders_routine_id")
        ),
    )

    with op.batch_alter_table("reminders", schema=None) as batch_op:
        batch_op.add_column(sa.Column("habit_reminder_id", sa.Uuid(), nullable=True))
        batch_op.create_unique_constraint("uq_reminders_habit_reminder_id", ["habit_reminder_id"])
        batch_op.create_foreign_key(
            "fk_reminders_habit_reminder",
            "habit_reminders",
            ["habit_reminder_id", "workspace_id"],
            ["id", "workspace_id"],
            ondelete="CASCADE",
        )
        batch_op.create_check_constraint(op.f("ck_reminders_one_habit_manager"), HABIT_MANAGER)

    with op.batch_alter_table("calendar_preferences", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("show_habits", sa.Boolean(), nullable=False, server_default=sa.true())
        )
    # The default only fills existing rows; the application always sets the column.
    with op.batch_alter_table("calendar_preferences", schema=None) as batch_op:
        batch_op.alter_column("show_habits", server_default=None)

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("calendar_preferences", schema=None) as batch_op:
        batch_op.drop_column("show_habits")

    # Habit reminders can't survive without their link; their notifications stay.
    op.execute("DELETE FROM reminders WHERE habit_reminder_id IS NOT NULL")
    with op.batch_alter_table("reminders", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_reminders_one_habit_manager"), type_="check")
        batch_op.drop_constraint("fk_reminders_habit_reminder", type_="foreignkey")
        batch_op.drop_constraint("uq_reminders_habit_reminder_id", type_="unique")
        batch_op.drop_column("habit_reminder_id")

    op.drop_table("habit_reminders")
    op.drop_index("ix_routine_session_steps_session_id", table_name="routine_session_steps")
    op.drop_table("routine_session_steps")
    op.drop_index("uq_routine_sessions_active", table_name="routine_sessions")
    op.drop_index("ix_routine_sessions_routine_started_at", table_name="routine_sessions")
    op.drop_table("routine_sessions")
    op.drop_index("ix_routine_steps_routine_position", table_name="routine_steps")
    op.drop_table("routine_steps")
    op.drop_index("ix_routines_workspace_status", table_name="routines")
    op.drop_table("routines")
    op.drop_index("ix_habit_notes_note_id", table_name="habit_notes")
    op.drop_table("habit_notes")
    op.drop_index("ix_habit_tasks_task_id", table_name="habit_tasks")
    op.drop_table("habit_tasks")
    op.drop_index("ix_habit_logs_workspace_day", table_name="habit_logs")
    op.drop_table("habit_logs")
    op.drop_index("ix_habit_pauses_habit_id", table_name="habit_pauses")
    op.drop_table("habit_pauses")
    op.drop_table("habit_schedule_versions")
    op.drop_index("ix_habits_workspace_status", table_name="habits")
    op.drop_table("habits")
    op.drop_table("habit_categories")
