"""Habits and routines: categories, habits with their schedule versions, pauses, and daily log,
links to tasks and notes, routines with ordered steps, routine sessions with copies of their
steps, and reminder times.

Schedules are stored as versions (`habit_schedule_versions`), never rewritten, so past days keep
the schedule that applied to them. Log entries are keyed by local date, one per habit and day.
Relationships inside the module are composite foreign keys on `(id, workspace_id)`, so rows can't
link across workspaces. A routine step's optional links to a habit, task, or note are plain
foreign keys that clear when the item is deleted; the service checks they're in the workspace.
"""

import uuid
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now

COLORS = "('blue', 'green', 'amber', 'rose', 'violet', 'teal', 'orange', 'slate')"
STATUSES = "('active', 'paused', 'archived')"
ACTIVE_SESSION = "status = 'active'"


def _habit_fk(name: str) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        ["habit_id", "workspace_id"],
        ["habits.id", "habits.workspace_id"],
        ondelete="CASCADE",
        name=name,
    )


def _routine_fk(name: str) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        ["routine_id", "workspace_id"],
        ["routines.id", "routines.workspace_id"],
        ondelete="CASCADE",
        name=name,
    )


def _category_fk(name: str) -> ForeignKeyConstraint:
    # No ON DELETE action: deleting a category clears it from habits and routines first (a
    # composite SET NULL would clear the workspace too).
    return ForeignKeyConstraint(
        ["category_id", "workspace_id"],
        ["habit_categories.id", "habit_categories.workspace_id"],
        name=name,
    )


class HabitCategoryModel(Base):
    __tablename__ = "habit_categories"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 50", name="name_length"),
        CheckConstraint(f"color IN {COLORS}", name="color"),
        UniqueConstraint("id", "workspace_id"),
        UniqueConstraint("workspace_id", "normalized_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(50))
    normalized_name: Mapped[str] = mapped_column(String(50))
    color: Mapped[str] = mapped_column(String(16))
    icon: Mapped[str] = mapped_column(String(32))
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class HabitModel(Base):
    """A habit. Its schedule lives in `habit_schedule_versions`."""

    __tablename__ = "habits"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(description) <= 2000", name="description_length"),
        CheckConstraint("length(unit) <= 20", name="unit_length"),
        CheckConstraint("length(timezone) BETWEEN 1 AND 64", name="timezone_length"),
        CheckConstraint(f"color IN {COLORS}", name="color"),
        CheckConstraint("kind IN ('boolean', 'numeric', 'duration')", name="kind"),
        CheckConstraint(f"status IN {STATUSES}", name="status"),
        CheckConstraint(
            "(kind = 'boolean' AND target IS NULL) OR (kind <> 'boolean' AND target > 0)",
            name="target",
        ),
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="dates"),
        UniqueConstraint("id", "workspace_id"),
        _category_fk("fk_habits_category"),
        Index("ix_habits_workspace_status", "workspace_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    category_id: Mapped[uuid.UUID | None]
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    icon: Mapped[str] = mapped_column(String(32))
    color: Mapped[str] = mapped_column(String(16))
    kind: Mapped[str] = mapped_column(String(16))
    unit: Mapped[str] = mapped_column(String(20))
    target: Mapped[float | None] = mapped_column(Float)
    time_of_day: Mapped[time | None] = mapped_column(Time)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    timezone: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class HabitScheduleVersionModel(Base):
    """The schedule in effect from `effective_from` until the next version's first day."""

    __tablename__ = "habit_schedule_versions"
    __table_args__ = (
        UniqueConstraint("habit_id", "effective_from"),
        _habit_fk("fk_habit_schedule_versions_habit"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    habit_id: Mapped[uuid.UUID]
    effective_from: Mapped[date] = mapped_column(Date)
    schedule: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class HabitPauseModel(Base):
    """Days `[start_date, end_date)` the habit was paused or archived; open while it still is."""

    __tablename__ = "habit_pauses"
    __table_args__ = (
        CheckConstraint("end_date IS NULL OR end_date > start_date", name="dates"),
        _habit_fk("fk_habit_pauses_habit"),
        Index("ix_habit_pauses_habit_id", "habit_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    habit_id: Mapped[uuid.UUID]
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)


class HabitLogModel(Base):
    """What was recorded for a habit on one local date: one row per habit and day."""

    __tablename__ = "habit_logs"
    __table_args__ = (
        CheckConstraint("value >= 0", name="value"),
        CheckConstraint("target > 0", name="target"),
        CheckConstraint("length(note) <= 1000", name="note_length"),
        UniqueConstraint("habit_id", "day"),
        _habit_fk("fk_habit_logs_habit"),
        Index("ix_habit_logs_workspace_day", "workspace_id", "day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    habit_id: Mapped[uuid.UUID]
    day: Mapped[date] = mapped_column(Date)
    value: Mapped[float] = mapped_column(Float)
    target: Mapped[float] = mapped_column(Float)
    skipped: Mapped[bool]
    note: Mapped[str] = mapped_column(Text)
    logged_at: Mapped[datetime] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class HabitTaskModel(Base):
    """A task related to a habit. Deleting either removes the link."""

    __tablename__ = "habit_tasks"
    __table_args__ = (
        _habit_fk("fk_habit_tasks_habit"),
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            ondelete="CASCADE",
            name="fk_habit_tasks_task",
        ),
        Index("ix_habit_tasks_task_id", "task_id"),
    )

    habit_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    task_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class HabitNoteModel(Base):
    """A note linked to a habit, such as a reflection. Deleting either removes the link."""

    __tablename__ = "habit_notes"
    __table_args__ = (
        _habit_fk("fk_habit_notes_habit"),
        ForeignKeyConstraint(
            ["note_id", "workspace_id"],
            ["notes.id", "notes.workspace_id"],
            ondelete="CASCADE",
            name="fk_habit_notes_note",
        ),
        Index("ix_habit_notes_note_id", "note_id"),
    )

    habit_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    note_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class RoutineModel(Base):
    __tablename__ = "routines"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(description) <= 2000", name="description_length"),
        CheckConstraint("length(timezone) BETWEEN 1 AND 64", name="timezone_length"),
        CheckConstraint(f"color IN {COLORS}", name="color"),
        CheckConstraint(f"status IN {STATUSES}", name="status"),
        UniqueConstraint("id", "workspace_id"),
        _category_fk("fk_routines_category"),
        Index("ix_routines_workspace_status", "workspace_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    category_id: Mapped[uuid.UUID | None]
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    icon: Mapped[str] = mapped_column(String(32))
    color: Mapped[str] = mapped_column(String(16))
    time_of_day: Mapped[time | None] = mapped_column(Time)
    # Weekday names in order; empty means every day.
    weekdays: Mapped[list[str]] = mapped_column(JSON)
    timezone: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class RoutineStepModel(Base):
    __tablename__ = "routine_steps"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(description) <= 1000", name="description_length"),
        CheckConstraint(
            "duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440", name="duration"
        ),
        _routine_fk("fk_routine_steps_routine"),
        Index("ix_routine_steps_routine_position", "routine_id", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    routine_id: Mapped[uuid.UUID]
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    habit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("habits.id", ondelete="SET NULL"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    note_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("notes.id", ondelete="SET NULL"))


class RoutineSessionModel(Base):
    """One run of a routine. At most one is active per routine (a partial unique index)."""

    __tablename__ = "routine_sessions"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'completed', 'abandoned')", name="status"),
        CheckConstraint("length(notes) <= 5000", name="notes_length"),
        CheckConstraint(
            "(status = 'active' AND finished_at IS NULL)"
            " OR (status <> 'active' AND finished_at IS NOT NULL)",
            name="finished_at_matches_status",
        ),
        UniqueConstraint("id", "workspace_id"),
        _routine_fk("fk_routine_sessions_routine"),
        Index("ix_routine_sessions_routine_started_at", "routine_id", "started_at"),
        Index(
            "uq_routine_sessions_active",
            "routine_id",
            unique=True,
            sqlite_where=text(ACTIVE_SESSION),
            postgresql_where=text(ACTIVE_SESSION),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    routine_id: Mapped[uuid.UUID]
    day: Mapped[date] = mapped_column(Date)
    routine_name: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(16))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    notes: Mapped[str] = mapped_column(Text)
    note_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("notes.id", ondelete="SET NULL"))


class RoutineSessionStepModel(Base):
    """A copy of a step taken when its session started, and what happened to it."""

    __tablename__ = "routine_session_steps"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'completed', 'skipped')", name="status"),
        ForeignKeyConstraint(
            ["session_id", "workspace_id"],
            ["routine_sessions.id", "routine_sessions.workspace_id"],
            ondelete="CASCADE",
            name="fk_routine_session_steps_session",
        ),
        Index("ix_routine_session_steps_session_id", "session_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    session_id: Mapped[uuid.UUID]
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(100))
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    habit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("habits.id", ondelete="SET NULL"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(16))
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class HabitReminderModel(Base):
    """A reminder time for a habit or a routine. It manages one reminder
    (`reminders.habit_reminder_id`), deleted with it."""

    __tablename__ = "habit_reminders"
    __table_args__ = (
        CheckConstraint("(habit_id IS NULL) <> (routine_id IS NULL)", name="one_owner"),
        UniqueConstraint("id", "workspace_id"),
        UniqueConstraint("habit_id", "time_of_day"),
        UniqueConstraint("routine_id", "time_of_day"),
        _habit_fk("fk_habit_reminders_habit"),
        _routine_fk("fk_habit_reminders_routine"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    habit_id: Mapped[uuid.UUID | None]
    routine_id: Mapped[uuid.UUID | None]
    time_of_day: Mapped[time] = mapped_column(Time)
    weekdays: Mapped[list[str]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
