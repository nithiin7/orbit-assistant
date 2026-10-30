"""Task types."""

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from orbit_api.utils.changes import UNSET, Change
from orbit_api.utils.sorting import SortOrder

TaskStatus = Literal["open", "completed"]
# Ordered from lowest to highest.
TaskPriority = Literal["none", "low", "medium", "high"]
TaskSort = Literal["due_date", "priority", "created_at"]


@dataclass(frozen=True, slots=True)
class Task:
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    description: str
    status: TaskStatus
    priority: TaskPriority
    due_date: date | None
    # Set exactly when the task is completed.
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class TaskDraft:
    """The fields of a new task."""

    title: str
    description: str = ""
    priority: TaskPriority = "none"
    due_date: date | None = None


@dataclass(frozen=True, slots=True)
class TaskChanges:
    """A partial update. `UNSET` leaves a field as it is; `due_date=None` clears the date."""

    title: Change[str] = UNSET
    description: Change[str] = UNSET
    priority: Change[TaskPriority] = UNSET
    due_date: Change[date | None] = UNSET


@dataclass(frozen=True, slots=True)
class TaskQuery:
    status: TaskStatus | None = None
    # Empty means any priority.
    priorities: frozenset[TaskPriority] = frozenset()
    # Case-insensitive substring of the title or description.
    search: str | None = None
    sort: TaskSort = "created_at"
    # `None` uses the sort's natural order: earliest due date, highest priority, newest first.
    order: SortOrder | None = None
    limit: int = 100
    offset: int = 0


@dataclass(frozen=True, slots=True)
class TaskPage:
    tasks: list[Task]
    # All tasks matching the query, ignoring `limit` and `offset`.
    total: int


@dataclass(frozen=True, slots=True)
class TaskSummary:
    open: int
    completed: int
    # Open tasks due before `today`, and open tasks due on it.
    overdue: int
    due_today: int


class TaskNotFoundError(Exception):
    """The task does not exist in this workspace."""
