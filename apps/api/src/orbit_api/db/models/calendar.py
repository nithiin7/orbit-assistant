"""The calendar: categories, events and recurring series, their exceptions and alerts, links to
notes and tasks, and each user's calendar preferences.

Event times are stored twice: as naive local wall-clock times in the event's IANA time zone (the
source of truth, so a recurring 09:00 meeting stays at 09:00 across daylight-saving changes), and
as UTC instants derived from them for range queries. Every relationship is a composite foreign
key on `(id, workspace_id)`, so rows can't link across workspaces.
"""

import uuid
from datetime import datetime, time
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now

CATEGORY_COLORS = "('blue', 'green', 'amber', 'rose', 'violet', 'teal', 'orange', 'slate')"
EVENT_STATUSES = "('confirmed', 'cancelled')"


def _event_fk(name: str) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        ["event_id", "workspace_id"],
        ["calendar_events.id", "calendar_events.workspace_id"],
        ondelete="CASCADE",
        name=name,
    )


def _category_fk(name: str) -> ForeignKeyConstraint:
    # No ON DELETE action: deleting a category clears it from events first (a composite SET NULL
    # would clear the workspace too, and SQLite can't limit it to one column).
    return ForeignKeyConstraint(
        ["category_id", "workspace_id"],
        ["calendar_categories.id", "calendar_categories.workspace_id"],
        name=name,
    )


class CalendarCategoryModel(Base):
    """A workspace's event category: a name, a color from a fixed palette, and visibility."""

    __tablename__ = "calendar_categories"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 50", name="name_length"),
        CheckConstraint(f"color IN {CATEGORY_COLORS}", name="color"),
        UniqueConstraint("id", "workspace_id"),
        UniqueConstraint("workspace_id", "normalized_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(50))
    # Whitespace collapsed and case-folded, so "Work" and "work" are one category.
    normalized_name: Mapped[str] = mapped_column(String(50))
    color: Mapped[str] = mapped_column(String(16))
    is_visible: Mapped[bool]
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class CalendarEventModel(Base):
    """An event, or a recurring series (`recurrence` set). Deleting the workspace deletes it."""

    __tablename__ = "calendar_events"
    __table_args__ = (
        CheckConstraint("length(title) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("length(description) <= 5000", name="description_length"),
        CheckConstraint("length(location) <= 200", name="location_length"),
        CheckConstraint("length(timezone) BETWEEN 1 AND 64", name="timezone_length"),
        CheckConstraint(f"status IN {EVENT_STATUSES}", name="status"),
        CheckConstraint("end_local >= start_local", name="end_after_start"),
        UniqueConstraint("id", "workspace_id"),
        _category_fk("fk_calendar_events_category"),
        # Range queries: series that start before a window's end and end after its start.
        Index("ix_calendar_events_workspace_start_at", "workspace_id", "start_at"),
        Index("ix_calendar_events_workspace_until_at", "workspace_id", "until_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    category_id: Mapped[uuid.UUID | None]
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    location: Mapped[str] = mapped_column(String(200))
    all_day: Mapped[bool]
    timezone: Mapped[str] = mapped_column(String(64))
    # Local wall-clock times in `timezone`, without an offset.
    start_local: Mapped[datetime] = mapped_column(DateTime(timezone=False))
    end_local: Mapped[datetime] = mapped_column(DateTime(timezone=False))
    # Derived: the first occurrence in UTC, and the end of the last (`NULL` when the series
    # never ends).
    start_at: Mapped[datetime] = mapped_column(UTCDateTime)
    end_at: Mapped[datetime] = mapped_column(UTCDateTime)
    until_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    recurrence: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16))
    # The series a "this and following" edit split this one from. Not a foreign key: the
    # original may be deleted later.
    series_id: Mapped[uuid.UUID | None]
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class CalendarEventExceptionModel(Base):
    """One occurrence of a series, skipped or changed, stored under its original start."""

    __tablename__ = "calendar_event_exceptions"
    __table_args__ = (
        CheckConstraint("kind IN ('skipped', 'modified')", name="kind"),
        CheckConstraint(f"status IS NULL OR status IN {EVENT_STATUSES}", name="status"),
        CheckConstraint("title IS NULL OR length(title) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint(
            "description IS NULL OR length(description) <= 5000", name="description_length"
        ),
        CheckConstraint("location IS NULL OR length(location) <= 200", name="location_length"),
        CheckConstraint(
            "(start_local IS NULL AND end_local IS NULL)"
            " OR (start_local IS NOT NULL AND end_local IS NOT NULL AND end_local >= start_local)",
            name="times",
        ),
        # One exception per occurrence, so an occurrence can't be duplicated.
        UniqueConstraint("event_id", "original_start"),
        _event_fk("fk_calendar_event_exceptions_event"),
        _category_fk("fk_calendar_event_exceptions_category"),
        # Occurrences moved into a range from outside it.
        Index("ix_calendar_event_exceptions_workspace_start_at", "workspace_id", "start_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    event_id: Mapped[uuid.UUID]
    original_start: Mapped[datetime] = mapped_column(DateTime(timezone=False))
    kind: Mapped[str] = mapped_column(String(16))
    # Overrides; `NULL` follows the series.
    title: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(200))
    category_id: Mapped[uuid.UUID | None]
    start_local: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    end_local: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    # Derived from the occurrence's (possibly moved) times, for range queries.
    start_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    end_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    status: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class CalendarEventAlertModel(Base):
    """An alert: notify this many minutes before each occurrence. It manages one reminder
    (`reminders.calendar_event_alert_id`), which is deleted with it."""

    __tablename__ = "calendar_event_alerts"
    __table_args__ = (
        CheckConstraint("minutes_before BETWEEN 0 AND 40320", name="minutes_before"),
        UniqueConstraint("id", "workspace_id"),
        UniqueConstraint("event_id", "minutes_before"),
        _event_fk("fk_calendar_event_alerts_event"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    event_id: Mapped[uuid.UUID]
    minutes_before: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class CalendarEventNoteModel(Base):
    """A note linked to an event, such as its meeting notes. Deleting either removes the link."""

    __tablename__ = "calendar_event_notes"
    __table_args__ = (
        _event_fk("fk_calendar_event_notes_event"),
        ForeignKeyConstraint(
            ["note_id", "workspace_id"],
            ["notes.id", "notes.workspace_id"],
            ondelete="CASCADE",
            name="fk_calendar_event_notes_note",
        ),
        Index("ix_calendar_event_notes_note_id", "note_id"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    note_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class CalendarEventTaskModel(Base):
    """A task linked to an event. Deleting either removes the link."""

    __tablename__ = "calendar_event_tasks"
    __table_args__ = (
        _event_fk("fk_calendar_event_tasks_event"),
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            ondelete="CASCADE",
            name="fk_calendar_event_tasks_task",
        ),
        Index("ix_calendar_event_tasks_task_id", "task_id"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    task_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class CalendarPreferencesModel(Base):
    """A user's calendar settings. Per user, not per workspace: they describe how the user likes
    to see time, not workspace data."""

    __tablename__ = "calendar_preferences"
    __table_args__ = (
        CheckConstraint("default_view IN ('month', 'week', 'day', 'agenda')", name="default_view"),
        CheckConstraint("week_start IS NULL OR week_start BETWEEN 0 AND 6", name="week_start"),
        CheckConstraint("working_hours_end > working_hours_start", name="working_hours"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    default_view: Mapped[str] = mapped_column(String(16))
    week_start: Mapped[int | None] = mapped_column(SmallInteger)
    working_hours_start: Mapped[time] = mapped_column(Time)
    working_hours_end: Mapped[time] = mapped_column(Time)
    show_completed_tasks: Mapped[bool]
    show_unscheduled_tasks: Mapped[bool]
    show_due_tasks: Mapped[bool]
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
