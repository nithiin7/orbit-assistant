"""Tasks: to-dos inside a workspace, with a priority, an optional due date, and completion.

Every method takes a `workspace_id` that the caller has already authorized (the `WorkspaceDep`
API dependency does this), and repositories filter every query by it. A task ID alone never
reaches a task: one in another workspace is indistinguishable from one that doesn't exist.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from enum import Enum, auto
from typing import Final, Literal, Protocol

from orbit_api.services.transactions import Transaction

TaskStatus = Literal["open", "completed"]
# Ordered from lowest to highest.
TaskPriority = Literal["none", "low", "medium", "high"]
TaskSort = Literal["due_date", "priority", "created_at"]
SortOrder = Literal["asc", "desc"]


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


class _Unset(Enum):
    UNSET = auto()


UNSET: Final = _Unset.UNSET

type Change[T] = T | Literal[_Unset.UNSET]


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


class TaskRepository(Protocol):
    async def add(self, task: Task) -> None: ...

    async def get(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task | None:
        """The task, only if it belongs to `workspace_id`."""
        ...

    async def find(self, workspace_id: uuid.UUID, query: TaskQuery) -> TaskPage: ...

    async def save(self, task: Task) -> None:
        """Store an existing task's fields. Matches on both its ID and workspace."""
        ...

    async def delete(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> bool:
        """Delete the task if it belongs to `workspace_id`; report whether it did."""
        ...

    async def summarize(self, workspace_id: uuid.UUID, today: date) -> TaskSummary: ...


def _utc_now() -> datetime:
    return datetime.now(UTC)


class TaskService:
    def __init__(
        self,
        tasks: TaskRepository,
        transaction: Transaction,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._tasks = tasks
        self._transaction = transaction
        self._clock = clock

    async def create(self, workspace_id: uuid.UUID, draft: TaskDraft) -> Task:
        now = self._clock()
        task = Task(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            title=draft.title,
            description=draft.description,
            status="open",
            priority=draft.priority,
            due_date=draft.due_date,
            completed_at=None,
            created_at=now,
            updated_at=now,
        )
        await self._tasks.add(task)
        await self._transaction.commit()
        return task

    async def find(self, workspace_id: uuid.UUID, query: TaskQuery) -> TaskPage:
        return await self._tasks.find(workspace_id, query)

    async def get(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task:
        task = await self._tasks.get(workspace_id, task_id)
        if task is None:
            raise TaskNotFoundError
        return task

    async def update(
        self, workspace_id: uuid.UUID, task_id: uuid.UUID, changes: TaskChanges
    ) -> Task:
        task = await self.get(workspace_id, task_id)
        updated = replace(
            task,
            title=task.title if changes.title is UNSET else changes.title,
            description=task.description if changes.description is UNSET else changes.description,
            priority=task.priority if changes.priority is UNSET else changes.priority,
            due_date=task.due_date if changes.due_date is UNSET else changes.due_date,
        )
        return await self._save_if_changed(task, updated)

    async def complete(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task:
        """Mark the task completed. Completing a completed task keeps its completion time."""
        task = await self.get(workspace_id, task_id)
        if task.status == "completed":
            return task
        return await self._save_if_changed(
            task, replace(task, status="completed", completed_at=self._clock())
        )

    async def reopen(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task:
        task = await self.get(workspace_id, task_id)
        return await self._save_if_changed(task, replace(task, status="open", completed_at=None))

    async def delete(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> None:
        if not await self._tasks.delete(workspace_id, task_id):
            raise TaskNotFoundError
        await self._transaction.commit()

    async def summarize(self, workspace_id: uuid.UUID, today: date) -> TaskSummary:
        return await self._tasks.summarize(workspace_id, today)

    async def _save_if_changed(self, task: Task, updated: Task) -> Task:
        # A request that changes nothing leaves `updated_at` alone.
        if updated == task:
            return task
        updated = replace(updated, updated_at=self._clock())
        await self._tasks.save(updated)
        await self._transaction.commit()
        return updated
