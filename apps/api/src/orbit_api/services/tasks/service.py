"""Tasks: to-dos inside a workspace, with a priority, an optional due date, and completion.
A task can be on one of the workspace's lists (Work, Personal, ...).

Every method takes a `workspace_id` that the caller has already authorized (the `WorkspaceDep`
API dependency does this), and repositories filter every query by it. A task ID alone never
reaches a task: one in another workspace is indistinguishable from one that doesn't exist.
"""

import uuid
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import replace
from datetime import date, datetime, timedelta
from typing import Protocol

from orbit_api.services.tasks.models import (
    MAX_TASK_LISTS,
    InvalidTaskScheduleError,
    Task,
    TaskChanges,
    TaskDraft,
    TaskList,
    TaskListChanges,
    TaskListColor,
    TaskListNameTakenError,
    TaskListNotFoundError,
    TaskListOverview,
    TaskNotFoundError,
    TaskPage,
    TaskQuery,
    TaskSchedule,
    TaskSummary,
    TooManyTaskListsError,
)
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now

# A scheduled block is a working session, not a deadline: at most a week.
MAX_SCHEDULE_LENGTH = timedelta(days=7)


def _check_schedule(schedule: TaskSchedule | None) -> None:
    if schedule is None:
        return
    if schedule.end <= schedule.start:
        raise InvalidTaskScheduleError("The scheduled end must be after its start.")
    if schedule.end - schedule.start > MAX_SCHEDULE_LENGTH:
        raise InvalidTaskScheduleError("A scheduled block can last at most a week.")


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

    async def lists(self, workspace_id: uuid.UUID) -> list[TaskListOverview]:
        """The workspace's lists in `position` order, each with its open task count."""
        ...

    async def get_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> TaskList | None:
        """The list, only if it belongs to `workspace_id`."""
        ...

    async def add_list(self, task_list: TaskList) -> None: ...

    async def save_list(self, task_list: TaskList) -> None:
        """Store an existing list's fields. Matches on both its ID and workspace."""
        ...

    async def delete_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> bool:
        """Take the list's tasks off it, then delete it; report whether it existed."""
        ...


class TaskService:
    def __init__(
        self,
        tasks: TaskRepository,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._tasks = tasks
        self._transaction = transaction
        self._clock = clock

    async def create(self, workspace_id: uuid.UUID, draft: TaskDraft) -> Task:
        _check_schedule(draft.schedule)
        await self._check_list(workspace_id, draft.list_id)
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
            scheduled_start=draft.schedule.start if draft.schedule else None,
            scheduled_end=draft.schedule.end if draft.schedule else None,
            list_id=draft.list_id,
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
        schedule = _schedule_of(task) if changes.schedule is UNSET else changes.schedule
        if changes.schedule is not UNSET:
            _check_schedule(changes.schedule)
        if changes.list_id is not UNSET:
            await self._check_list(workspace_id, changes.list_id)
        updated = replace(
            task,
            scheduled_start=schedule.start if schedule else None,
            scheduled_end=schedule.end if schedule else None,
            title=task.title if changes.title is UNSET else changes.title,
            description=task.description if changes.description is UNSET else changes.description,
            priority=task.priority if changes.priority is UNSET else changes.priority,
            due_date=task.due_date if changes.due_date is UNSET else changes.due_date,
            list_id=task.list_id if changes.list_id is UNSET else changes.list_id,
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

    # Lists

    async def lists(self, workspace_id: uuid.UUID) -> list[TaskListOverview]:
        return await self._tasks.lists(workspace_id)

    async def get_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> TaskList:
        task_list = await self._tasks.get_list(workspace_id, list_id)
        if task_list is None:
            raise TaskListNotFoundError
        return task_list

    async def create_list(
        self, workspace_id: uuid.UUID, name: str, color: TaskListColor
    ) -> TaskList:
        existing = [entry.task_list for entry in await self._tasks.lists(workspace_id)]
        if len(existing) >= MAX_TASK_LISTS:
            raise TooManyTaskListsError
        if _name_taken(existing, name, None):
            raise TaskListNameTakenError
        now = self._clock()
        task_list = TaskList(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=name,
            color=color,
            position=max((entry.position for entry in existing), default=-1) + 1,
            created_at=now,
            updated_at=now,
        )
        await self._store_list(self._tasks.add_list, task_list)
        return task_list

    async def update_list(
        self, workspace_id: uuid.UUID, list_id: uuid.UUID, changes: TaskListChanges
    ) -> TaskList:
        task_list = await self.get_list(workspace_id, list_id)
        if changes.name is not UNSET:
            existing = [entry.task_list for entry in await self._tasks.lists(workspace_id)]
            if _name_taken(existing, changes.name, list_id):
                raise TaskListNameTakenError
        updated = replace(
            task_list,
            name=task_list.name if changes.name is UNSET else changes.name,
            color=task_list.color if changes.color is UNSET else changes.color,
        )
        if updated == task_list:
            return task_list
        updated = replace(updated, updated_at=self._clock())
        await self._store_list(self._tasks.save_list, updated)
        return updated

    async def delete_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> None:
        """Delete the list. Its tasks stay, on no list."""
        if not await self._tasks.delete_list(workspace_id, list_id):
            raise TaskListNotFoundError
        await self._transaction.commit()

    async def _store_list(
        self, store: Callable[[TaskList], Awaitable[None]], task_list: TaskList
    ) -> None:
        try:
            await store(task_list)
            await self._transaction.commit()
        except ConflictError:
            # A concurrent request took the name first.
            await self._transaction.rollback()
            raise TaskListNameTakenError from None

    async def _check_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID | None) -> None:
        if list_id is not None and await self._tasks.get_list(workspace_id, list_id) is None:
            raise TaskListNotFoundError

    async def _save_if_changed(self, task: Task, updated: Task) -> Task:
        # A request that changes nothing leaves `updated_at` alone.
        if updated == task:
            return task
        updated = replace(updated, updated_at=self._clock())
        await self._tasks.save(updated)
        await self._transaction.commit()
        return updated


def _schedule_of(task: Task) -> TaskSchedule | None:
    if task.scheduled_start is None or task.scheduled_end is None:
        return None
    return TaskSchedule(start=task.scheduled_start, end=task.scheduled_end)


def _name_taken(lists: Iterable[TaskList], name: str, own_id: uuid.UUID | None) -> bool:
    folded = normalize_list_name(name)
    return any(normalize_list_name(entry.name) == folded and entry.id != own_id for entry in lists)


def normalize_list_name(name: str) -> str:
    """Whitespace collapsed and case-folded: the form list names are unique in."""
    return " ".join(name.split()).casefold()
