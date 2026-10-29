"""Tasks. Every query is filtered by workspace, so callers cannot reach other workspaces' rows."""

import uuid
from collections.abc import Sequence
from datetime import date
from typing import Any, cast

from sqlalchemy import ColumnElement, and_, case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import TaskModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.tasks.models import (
    Task,
    TaskNotFoundError,
    TaskPage,
    TaskPriority,
    TaskQuery,
    TaskStatus,
    TaskSummary,
)

# Priorities are stored as ranks so that ordering by the column orders by importance.
_PRIORITY_RANKS: dict[TaskPriority, int] = {"none": 0, "low": 1, "medium": 2, "high": 3}
_PRIORITIES_BY_RANK: dict[int, TaskPriority] = {
    rank: name for name, rank in _PRIORITY_RANKS.items()
}
_LIKE_ESCAPE = "\\"


def _to_task(model: TaskModel) -> Task:
    return Task(
        id=model.id,
        workspace_id=model.workspace_id,
        title=model.title,
        description=model.description,
        # The table's CHECK constraint limits `status` to these values.
        status=cast(TaskStatus, model.status),
        priority=_PRIORITIES_BY_RANK[model.priority],
        due_date=model.due_date,
        completed_at=model.completed_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _contains(text: str) -> str:
    """A LIKE pattern matching `text` anywhere, with LIKE's wildcards matched literally."""
    for character in (_LIKE_ESCAPE, "%", "_"):
        text = text.replace(character, _LIKE_ESCAPE + character)
    return f"%{text}%"


def _filters(workspace_id: uuid.UUID, query: TaskQuery) -> list[ColumnElement[bool]]:
    conditions = [TaskModel.workspace_id == workspace_id]
    if query.status is not None:
        conditions.append(TaskModel.status == query.status)
    if query.priorities:
        conditions.append(TaskModel.priority.in_(_PRIORITY_RANKS[p] for p in query.priorities))
    if query.search:
        # `ilike` is case-insensitive on both databases. A substring search can't use an index;
        # it scans one workspace's tasks, which is fine at personal scale.
        pattern = _contains(query.search)
        conditions.append(
            or_(
                TaskModel.title.ilike(pattern, escape=_LIKE_ESCAPE),
                TaskModel.description.ilike(pattern, escape=_LIKE_ESCAPE),
            )
        )
    return conditions


def _ordering(query: TaskQuery) -> Sequence[ColumnElement[Any]]:
    # Tasks without a due date always come last, whichever direction dates are sorted in.
    undated_last = TaskModel.due_date.is_(None)
    due_date_soonest = TaskModel.due_date.asc()
    newest = TaskModel.created_at.desc()
    match query.sort:
        case "due_date":
            due = TaskModel.due_date.desc() if query.order == "desc" else due_date_soonest
            return (undated_last, due, TaskModel.priority.desc(), newest, TaskModel.id.asc())
        case "priority":
            priority = (
                TaskModel.priority.asc() if query.order == "asc" else TaskModel.priority.desc()
            )
            return (priority, undated_last, due_date_soonest, newest, TaskModel.id.asc())
        case "created_at":
            created = TaskModel.created_at.asc() if query.order == "asc" else newest
            return (created, TaskModel.id.asc())


class SqlTaskRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, task: Task) -> None:
        self._session.add(
            TaskModel(
                id=task.id,
                workspace_id=task.workspace_id,
                title=task.title,
                description=task.description,
                status=task.status,
                priority=_PRIORITY_RANKS[task.priority],
                due_date=task.due_date,
                completed_at=task.completed_at,
                created_at=task.created_at,
                updated_at=task.updated_at,
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task | None:
        model = await self._get_model(workspace_id, task_id)
        return _to_task(model) if model else None

    async def find(self, workspace_id: uuid.UUID, query: TaskQuery) -> TaskPage:
        conditions = _filters(workspace_id, query)
        total = await self._session.scalar(select(func.count()).where(*conditions))
        models = await self._session.scalars(
            select(TaskModel)
            .where(*conditions)
            .order_by(*_ordering(query))
            .limit(query.limit)
            .offset(query.offset)
        )
        return TaskPage(tasks=[_to_task(model) for model in models], total=total or 0)

    async def save(self, task: Task) -> None:
        model = await self._get_model(task.workspace_id, task.id)
        if model is None:
            raise TaskNotFoundError
        model.title = task.title
        model.description = task.description
        model.status = task.status
        model.priority = _PRIORITY_RANKS[task.priority]
        model.due_date = task.due_date
        model.completed_at = task.completed_at
        model.updated_at = task.updated_at
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> bool:
        deleted = await self._session.scalars(
            delete(TaskModel)
            .where(TaskModel.id == task_id, TaskModel.workspace_id == workspace_id)
            .returning(TaskModel.id)
        )
        return deleted.first() is not None

    async def summarize(self, workspace_id: uuid.UUID, today: date) -> TaskSummary:
        is_open = TaskModel.status == "open"

        def count(condition: ColumnElement[bool]) -> ColumnElement[int]:
            # COUNT skips the NULL that CASE yields for non-matching rows.
            return func.count(case((condition, 1)))

        row = (
            await self._session.execute(
                select(
                    count(is_open),
                    count(TaskModel.status == "completed"),
                    count(and_(is_open, TaskModel.due_date < today)),
                    count(and_(is_open, TaskModel.due_date == today)),
                ).where(TaskModel.workspace_id == workspace_id)
            )
        ).one()
        return TaskSummary(open=row[0], completed=row[1], overdue=row[2], due_today=row[3])

    async def _get_model(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> TaskModel | None:
        return await self._session.scalar(
            select(TaskModel).where(TaskModel.id == task_id, TaskModel.workspace_id == workspace_id)
        )
