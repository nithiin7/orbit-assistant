"""Tasks: the first workspace-owned product data."""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now

TASK_LIST_COLORS = "('blue', 'green', 'amber', 'rose', 'violet', 'teal', 'orange', 'slate')"


class TaskListModel(Base):
    """A named, colored list of tasks in one workspace, such as Work or Personal. A task is on at
    most one list. Deleting the workspace deletes its lists."""

    __tablename__ = "task_lists"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 50", name="name_length"),
        CheckConstraint(f"color IN {TASK_LIST_COLORS}", name="color"),
        # The target of `tasks`' composite foreign key, which keeps a task in the same workspace
        # as its list.
        UniqueConstraint("id", "workspace_id"),
        UniqueConstraint("workspace_id", "normalized_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(50))
    # Whitespace collapsed and case-folded, so "Work" and "work" are one list.
    normalized_name: Mapped[str] = mapped_column(String(50))
    color: Mapped[str] = mapped_column(String(16))
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class TaskModel(Base):
    """A task in one workspace. Deleting the workspace deletes its tasks.

    `priority` is stored as a rank (0 none, 1 low, 2 medium, 3 high) so that sorting by priority
    is a plain, indexable column order; the repository maps ranks to names.
    """

    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("length(title) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("length(description) <= 5000", name="description_length"),
        CheckConstraint("status IN ('open', 'completed')", name="status"),
        CheckConstraint("priority BETWEEN 0 AND 3", name="priority"),
        CheckConstraint(
            "(status = 'completed' AND completed_at IS NOT NULL)"
            " OR (status = 'open' AND completed_at IS NULL)",
            name="completed_at_matches_status",
        ),
        # The target of `reminders`' composite foreign key, which keeps a reminder in the same
        # workspace as its task.
        UniqueConstraint("id", "workspace_id"),
        # A scheduled time block (the calendar), separate from the due date.
        CheckConstraint(
            "(scheduled_start IS NULL AND scheduled_end IS NULL)"
            " OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL"
            " AND scheduled_end > scheduled_start)",
            name="schedule",
        ),
        Index("ix_tasks_workspace_scheduled_start", "workspace_id", "scheduled_start"),
        # Lists are always scoped to a workspace, usually filtered by status, and sorted by due
        # date or priority.
        Index("ix_tasks_workspace_status_due_date", "workspace_id", "status", "due_date"),
        Index("ix_tasks_workspace_status_priority", "workspace_id", "status", "priority"),
        # No ON DELETE action: deleting a list clears it from its tasks first (a composite SET
        # NULL would clear the workspace too, and SQLite can't limit it to one column).
        ForeignKeyConstraint(
            ["list_id", "workspace_id"],
            ["task_lists.id", "task_lists.workspace_id"],
            name="fk_tasks_list",
        ),
        Index("ix_tasks_workspace_list", "workspace_id", "list_id"),
        Index("ix_tasks_workspace_series", "workspace_id", "series_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    list_id: Mapped[uuid.UUID | None]
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16))
    priority: Mapped[int] = mapped_column(SmallInteger)
    due_date: Mapped[date | None] = mapped_column(Date)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    scheduled_start: Mapped[datetime | None] = mapped_column(UTCDateTime)
    scheduled_end: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # How the task repeats, on a series' current occurrence (`services/tasks/recurrence.py`).
    recurrence: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # Shared by a repeating task's occurrences. Not a reference to any row.
    series_id: Mapped[uuid.UUID | None]
    # The task's place in the workspace's own order ("My order"), set by dragging. The
    # repository puts new tasks last; positions may repeat, and creation time breaks ties.
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


# A focus session is a working block, not a whole day: at most four hours of focus.
MAX_FOCUS_SECONDS = 4 * 60 * 60


class FocusSessionModel(Base):
    """Time spent focusing on a task with the focus timer. Deleting the task, or its workspace,
    deletes its sessions.

    `focused_seconds` leaves out pauses, so it can be shorter than `ended_at - started_at`.
    `day` is the client's local date when the session started, which decides focus streaks.
    `completed` is set when the timer ran to the end rather than being stopped early.
    """

    __tablename__ = "focus_sessions"
    __table_args__ = (
        CheckConstraint(
            f"focused_seconds BETWEEN 1 AND {MAX_FOCUS_SECONDS}", name="focused_seconds_range"
        ),
        CheckConstraint("ended_at > started_at", name="ends_after_start"),
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_focus_sessions_task",
            ondelete="CASCADE",
        ),
        Index("ix_focus_sessions_workspace_task", "workspace_id", "task_id"),
        Index("ix_focus_sessions_workspace_day", "workspace_id", "day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    task_id: Mapped[uuid.UUID]
    started_at: Mapped[datetime] = mapped_column(UTCDateTime)
    ended_at: Mapped[datetime] = mapped_column(UTCDateTime)
    focused_seconds: Mapped[int] = mapped_column(Integer)
    day: Mapped[date] = mapped_column(Date)
    completed: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
