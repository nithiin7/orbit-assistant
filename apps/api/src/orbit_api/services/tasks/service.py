"""Tasks: to-dos inside a workspace, with a priority, an optional due date, and completion.

Every method takes a `workspace_id` that the caller has already authorized (the `WorkspaceDep`
API dependency does this), and repositories filter every query by it. A task ID alone never
reaches a task: one in another workspace is indistinguishable from one that doesn't exist.
"""

import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import date, datetime, timedelta
from typing import Protocol

from orbit_api.services.tasks.models import (
    InvalidTaskScheduleError,
    Task,
    TaskChanges,
    TaskDraft,
    TaskNotFoundError,
    TaskPage,
    TaskQuery,
    TaskSchedule,
    TaskSummary,
)
from orbit_api.services.transactions import Transaction
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
        updated = replace(
            task,
            scheduled_start=schedule.start if schedule else None,
            scheduled_end=schedule.end if schedule else None,
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


def _schedule_of(task: Task) -> TaskSchedule | None:
    if task.scheduled_start is None or task.scheduled_end is None:
        return None
    return TaskSchedule(start=task.scheduled_start, end=task.scheduled_end)
