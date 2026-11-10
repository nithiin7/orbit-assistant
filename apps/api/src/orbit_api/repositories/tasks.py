"""Tasks. Every query is filtered by workspace, so callers cannot reach other workspaces' rows."""

import uuid
from collections.abc import Sequence
from datetime import date
from typing import Any, cast

from sqlalchemy import ColumnElement, and_, case, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import TaskListModel, TaskModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.tasks.models import (
    Task,
    TaskList,
    TaskListColor,
    TaskListOverview,
    TaskNotFoundError,
    TaskPage,
    TaskPriority,
    TaskQuery,
    TaskStatus,
    TaskSummary,
)
from orbit_api.services.tasks.service import normalize_list_name
from orbit_api.utils.changes import UNSET
from orbit_api.utils.text_search import LIKE_ESCAPE, contains_pattern

# Priorities are stored as ranks so that ordering by the column orders by importance.
_PRIORITY_RANKS: dict[TaskPriority, int] = {"none": 0, "low": 1, "medium": 2, "high": 3}
_PRIORITIES_BY_RANK: dict[int, TaskPriority] = {
    rank: name for name, rank in _PRIORITY_RANKS.items()
}


def to_task(model: TaskModel) -> Task:
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
        scheduled_start=model.scheduled_start,
        scheduled_end=model.scheduled_end,
        list_id=model.list_id,
    )


def to_task_list(model: TaskListModel) -> TaskList:
    return TaskList(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        # The table's CHECK constraint limits `color` to the palette.
        color=cast(TaskListColor, model.color),
        position=model.position,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _filters(workspace_id: uuid.UUID, query: TaskQuery) -> list[ColumnElement[bool]]:
    conditions = [TaskModel.workspace_id == workspace_id]
    if query.status is not None:
        conditions.append(TaskModel.status == query.status)
    if query.scheduled is not None:
        conditions.append(
            TaskModel.scheduled_start.is_not(None)
            if query.scheduled
            else TaskModel.scheduled_start.is_(None)
        )
    if query.due_from is not None:
        conditions.append(TaskModel.due_date >= query.due_from)
    if query.due_to is not None:
        conditions.append(TaskModel.due_date <= query.due_to)
    if query.list_id is not UNSET:
        conditions.append(
            TaskModel.list_id.is_(None)
            if query.list_id is None
            else TaskModel.list_id == query.list_id
        )
    if query.priorities:
        conditions.append(TaskModel.priority.in_(_PRIORITY_RANKS[p] for p in query.priorities))
    if query.search:
        # `ilike` is case-insensitive on both databases. A substring search can't use an index;
        # it scans one workspace's tasks, which is fine at personal scale.
        pattern = contains_pattern(query.search)
        conditions.append(
            or_(
                TaskModel.title.ilike(pattern, escape=LIKE_ESCAPE),
                TaskModel.description.ilike(pattern, escape=LIKE_ESCAPE),
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
        case "completed_at":
            # Open tasks have no completion time; they come last either way.
            completed = (
                TaskModel.completed_at.asc()
                if query.order == "asc"
                else TaskModel.completed_at.desc()
            )
            return (TaskModel.completed_at.is_(None), completed, newest, TaskModel.id.asc())


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
                scheduled_start=task.scheduled_start,
                scheduled_end=task.scheduled_end,
                list_id=task.list_id,
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task | None:
        model = await self._get_model(workspace_id, task_id)
        return to_task(model) if model else None

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
        return TaskPage(tasks=[to_task(model) for model in models], total=total or 0)

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
        model.scheduled_start = task.scheduled_start
        model.scheduled_end = task.scheduled_end
        model.list_id = task.list_id
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

    # Lists

    async def lists(self, workspace_id: uuid.UUID) -> list[TaskListOverview]:
        open_tasks = (
            select(func.count())
            .where(
                TaskModel.workspace_id == workspace_id,
                TaskModel.list_id == TaskListModel.id,
                TaskModel.status == "open",
            )
            .scalar_subquery()
        )
        rows = await self._session.execute(
            select(TaskListModel, open_tasks)
            .where(TaskListModel.workspace_id == workspace_id)
            .order_by(TaskListModel.position, TaskListModel.created_at, TaskListModel.id)
        )
        return [
            TaskListOverview(task_list=to_task_list(model), open=count) for model, count in rows
        ]

    async def get_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> TaskList | None:
        model = await self._get_list_model(workspace_id, list_id)
        return to_task_list(model) if model else None

    async def add_list(self, task_list: TaskList) -> None:
        self._session.add(
            TaskListModel(
                id=task_list.id,
                workspace_id=task_list.workspace_id,
                name=task_list.name,
                normalized_name=normalize_list_name(task_list.name),
                color=task_list.color,
                position=task_list.position,
                created_at=task_list.created_at,
                updated_at=task_list.updated_at,
            )
        )
        await flush(self._session)

    async def save_list(self, task_list: TaskList) -> None:
        model = await self._get_list_model(task_list.workspace_id, task_list.id)
        if model is None:
            return
        model.name = task_list.name
        model.normalized_name = normalize_list_name(task_list.name)
        model.color = task_list.color
        model.position = task_list.position
        model.updated_at = task_list.updated_at
        await flush(self._session)

    async def delete_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> bool:
        # The foreign key has no ON DELETE action, so the tasks come off the list first.
        await self._session.execute(
            update(TaskModel)
            .where(TaskModel.workspace_id == workspace_id, TaskModel.list_id == list_id)
            .values(list_id=None)
        )
        deleted = await self._session.scalars(
            delete(TaskListModel)
            .where(TaskListModel.id == list_id, TaskListModel.workspace_id == workspace_id)
            .returning(TaskListModel.id)
        )
        return deleted.first() is not None

    async def _get_list_model(
        self, workspace_id: uuid.UUID, list_id: uuid.UUID
    ) -> TaskListModel | None:
        return await self._session.scalar(
            select(TaskListModel).where(
                TaskListModel.id == list_id, TaskListModel.workspace_id == workspace_id
            )
        )

    async def _get_model(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> TaskModel | None:
        return await self._session.scalar(
            select(TaskModel).where(TaskModel.id == task_id, TaskModel.workspace_id == workspace_id)
        )
