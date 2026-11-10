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
TaskSort = Literal["due_date", "priority", "created_at", "completed_at"]
TaskListColor = Literal["blue", "green", "amber", "rose", "violet", "teal", "orange", "slate"]

# A workspace's lists are few and meant to be scanned at a glance.
MAX_TASK_LISTS = 50


@dataclass(frozen=True, slots=True)
class TaskList:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    color: TaskListColor
    # Lists are shown in this order: oldest first.
    position: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class TaskListOverview:
    task_list: TaskList
    # Open tasks on the list.
    open: int


@dataclass(frozen=True, slots=True)
class TaskListChanges:
    name: Change[str] = UNSET
    color: Change[TaskListColor] = UNSET


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
    # When the task is planned to be worked on: a time block on the calendar, separate from the
    # due date. Both set or both unset; the end is after the start.
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    # The list the task is on, if any.
    list_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class TaskSchedule:
    start: datetime
    end: datetime


@dataclass(frozen=True, slots=True)
class TaskDraft:
    """The fields of a new task."""

    title: str
    description: str = ""
    priority: TaskPriority = "none"
    due_date: date | None = None
    schedule: TaskSchedule | None = None
    list_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class TaskChanges:
    """A partial update. `UNSET` leaves a field as it is; `due_date=None` clears the date and
    `schedule=None` unschedules the task, and `list_id=None` takes it off its list."""

    title: Change[str] = UNSET
    description: Change[str] = UNSET
    priority: Change[TaskPriority] = UNSET
    due_date: Change[date | None] = UNSET
    schedule: Change[TaskSchedule | None] = UNSET
    list_id: Change[uuid.UUID | None] = UNSET


@dataclass(frozen=True, slots=True)
class TaskQuery:
    status: TaskStatus | None = None
    # Empty means any priority.
    priorities: frozenset[TaskPriority] = frozenset()
    # Case-insensitive substring of the title or description.
    search: str | None = None
    # `True`: only tasks with a scheduled time; `False`: only tasks without one.
    scheduled: bool | None = None
    # Inclusive bounds on the due date; either set leaves out tasks without one.
    due_from: date | None = None
    due_to: date | None = None
    # Only tasks on this list. `UNSET` means any list or none; `None` means tasks on no list.
    list_id: Change[uuid.UUID | None] = UNSET
    sort: TaskSort = "created_at"
    # `None` uses the sort's natural order: earliest due date, highest priority, newest first,
    # or most recently completed first.
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


class InvalidTaskScheduleError(ValueError):
    """A scheduled time block that ends before it starts or is too long."""


class TaskListNotFoundError(Exception):
    """The task list does not exist in this workspace."""


class TaskListNameTakenError(Exception):
    """Another list in the workspace has the same name, ignoring case and spacing."""


class TooManyTaskListsError(Exception):
    """The workspace already has `MAX_TASK_LISTS` lists."""
