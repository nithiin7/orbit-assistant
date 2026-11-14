"""Habits and routines. Every query is filtered by workspace, so callers cannot reach other
workspaces' rows; links inside the module are composite foreign keys, so the database refuses
cross-workspace rows too."""

import uuid
from collections import defaultdict
from collections.abc import Callable, Sequence
from datetime import date, datetime
from typing import cast

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    HabitCategoryModel,
    HabitLogModel,
    HabitModel,
    HabitNoteModel,
    HabitPauseModel,
    HabitReminderModel,
    HabitScheduleVersionModel,
    HabitTaskModel,
    NoteModel,
    RoutineModel,
    RoutineSessionModel,
    RoutineSessionStepModel,
    RoutineStepModel,
    TaskModel,
)
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.tasks import to_task
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.habits.models import (
    Habit,
    HabitCategory,
    HabitColor,
    HabitIcon,
    HabitKind,
    HabitLog,
    HabitReminder,
    HabitStatus,
    LinkedNote,
    ReminderTime,
    Routine,
    RoutineSession,
    RoutineStatus,
    RoutineStep,
    SessionStatus,
    SessionStep,
    StepStatus,
)
from orbit_api.services.habits.routines import RoutineService
from orbit_api.services.habits.schedule import (
    Pause,
    ScheduleVersion,
    schedule_from_json,
    schedule_to_json,
)
from orbit_api.services.habits.service import HabitService, HealthSource, normalize_name
from orbit_api.services.reminders.recurrence import WEEKDAYS, Weekday
from orbit_api.services.tasks.models import Task
from orbit_api.utils.clock import utc_now

_WEEKDAY_NAMES: dict[str, Weekday] = {day: day for day in WEEKDAYS}


def _weekdays_to_json(days: frozenset[Weekday]) -> list[str]:
    return [day for day in WEEKDAYS if day in days]


def _weekdays_from_json(value: list[str]) -> frozenset[Weekday]:
    return frozenset(_WEEKDAY_NAMES[day] for day in value if day in _WEEKDAY_NAMES)


def _to_category(model: HabitCategoryModel) -> HabitCategory:
    # The table's CHECK constraints limit colors; icons are validated on the way in.
    return HabitCategory(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        color=cast(HabitColor, model.color),
        icon=cast(HabitIcon, model.icon),
        position=model.position,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_log(model: HabitLogModel) -> HabitLog:
    return HabitLog(
        id=model.id,
        workspace_id=model.workspace_id,
        habit_id=model.habit_id,
        day=model.day,
        value=model.value,
        target=model.target,
        skipped=model.skipped,
        note=model.note,
        logged_at=model.logged_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_reminder_time(model: HabitReminderModel) -> HabitReminder:
    return HabitReminder(
        id=model.id,
        workspace_id=model.workspace_id,
        habit_id=model.habit_id,
        routine_id=model.routine_id,
        time_of_day=model.time_of_day,
        weekdays=_weekdays_from_json(model.weekdays),
    )


def _to_step(model: RoutineStepModel) -> RoutineStep:
    return RoutineStep(
        id=model.id,
        position=model.position,
        name=model.name,
        description=model.description,
        duration_minutes=model.duration_minutes,
        habit_id=model.habit_id,
        task_id=model.task_id,
        note_id=model.note_id,
    )


def _to_session_step(model: RoutineSessionStepModel) -> SessionStep:
    return SessionStep(
        id=model.id,
        position=model.position,
        name=model.name,
        duration_minutes=model.duration_minutes,
        habit_id=model.habit_id,
        task_id=model.task_id,
        status=cast(StepStatus, model.status),
        completed_at=model.completed_at,
    )


def _habit_fields(habit: Habit) -> dict[str, object]:
    return {
        "category_id": habit.category_id,
        "name": habit.name,
        "description": habit.description,
        "icon": habit.icon,
        "color": habit.color,
        "kind": habit.kind,
        "unit": habit.unit,
        "target": habit.target,
        "time_of_day": habit.time_of_day,
        "start_date": habit.start_date,
        "end_date": habit.end_date,
        "timezone": habit.timezone,
        "status": habit.status,
        "updated_at": habit.updated_at,
    }


def _routine_fields(routine: Routine) -> dict[str, object]:
    return {
        "category_id": routine.category_id,
        "name": routine.name,
        "description": routine.description,
        "icon": routine.icon,
        "color": routine.color,
        "time_of_day": routine.time_of_day,
        "weekdays": _weekdays_to_json(routine.weekdays),
        "timezone": routine.timezone,
        "status": routine.status,
        "updated_at": routine.updated_at,
    }


class SqlHabitStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # Categories

    async def categories(self, workspace_id: uuid.UUID) -> list[HabitCategory]:
        rows = await self._session.scalars(
            select(HabitCategoryModel)
            .where(HabitCategoryModel.workspace_id == workspace_id)
            .order_by(HabitCategoryModel.position, HabitCategoryModel.id)
        )
        return [_to_category(row) for row in rows]

    async def add_category(self, category: HabitCategory) -> None:
        self._session.add(
            HabitCategoryModel(
                id=category.id,
                workspace_id=category.workspace_id,
                name=category.name,
                normalized_name=normalize_name(category.name),
                color=category.color,
                icon=category.icon,
                position=category.position,
                created_at=category.created_at,
                updated_at=category.updated_at,
            )
        )
        await flush(self._session)

    async def save_category(self, category: HabitCategory) -> None:
        await self._session.execute(
            update(HabitCategoryModel)
            .where(
                HabitCategoryModel.id == category.id,
                HabitCategoryModel.workspace_id == category.workspace_id,
            )
            .values(
                name=category.name,
                normalized_name=normalize_name(category.name),
                color=category.color,
                icon=category.icon,
                updated_at=category.updated_at,
            )
        )
        await flush(self._session)

    async def delete_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> bool:
        for model in (HabitModel, RoutineModel):
            await self._session.execute(
                update(model)
                .where(model.workspace_id == workspace_id, model.category_id == category_id)
                .values(category_id=None)
            )
        deleted = await self._session.execute(
            delete(HabitCategoryModel)
            .where(
                HabitCategoryModel.workspace_id == workspace_id,
                HabitCategoryModel.id == category_id,
            )
            .returning(HabitCategoryModel.id)
        )
        return deleted.first() is not None

    # Habits

    async def habits(
        self, workspace_id: uuid.UUID, statuses: Sequence[HabitStatus] | None = None
    ) -> list[Habit]:
        statement = select(HabitModel).where(HabitModel.workspace_id == workspace_id)
        if statuses:
            statement = statement.where(HabitModel.status.in_(statuses))
        models = list(
            await self._session.scalars(statement.order_by(HabitModel.created_at, HabitModel.id))
        )
        return await self._to_habits(models)

    async def get_habit(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> Habit | None:
        model = await self._session.scalar(
            select(HabitModel).where(
                HabitModel.workspace_id == workspace_id, HabitModel.id == habit_id
            )
        )
        if model is None:
            return None
        return (await self._to_habits([model]))[0]

    async def habit_exists(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> bool:
        return await self.get_habit(workspace_id, habit_id) is not None

    async def add_habit(self, habit: Habit) -> None:
        self._session.add(
            HabitModel(
                id=habit.id,
                workspace_id=habit.workspace_id,
                created_at=habit.created_at,
                **_habit_fields(habit),
            )
        )
        await flush(self._session)
        await self._put_history(habit)

    async def save_habit(self, habit: Habit) -> None:
        await self._session.execute(
            update(HabitModel)
            .where(HabitModel.id == habit.id, HabitModel.workspace_id == habit.workspace_id)
            .values(**_habit_fields(habit))
        )
        for model in (HabitScheduleVersionModel, HabitPauseModel):
            await self._session.execute(delete(model).where(model.habit_id == habit.id))
        await flush(self._session)
        await self._put_history(habit)

    async def delete_habit(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> bool:
        deleted = await self._session.execute(
            delete(HabitModel)
            .where(HabitModel.workspace_id == workspace_id, HabitModel.id == habit_id)
            .returning(HabitModel.id)
        )
        return deleted.first() is not None

    async def _put_history(self, habit: Habit) -> None:
        now = utc_now()
        for version in habit.versions:
            self._session.add(
                HabitScheduleVersionModel(
                    id=uuid.uuid4(),
                    workspace_id=habit.workspace_id,
                    habit_id=habit.id,
                    effective_from=version.effective_from,
                    schedule=schedule_to_json(version.schedule),
                    created_at=now,
                )
            )
        for pause in habit.pauses:
            self._session.add(
                HabitPauseModel(
                    id=uuid.uuid4(),
                    workspace_id=habit.workspace_id,
                    habit_id=habit.id,
                    start_date=pause.start,
                    end_date=pause.end,
                )
            )
        await flush(self._session)

    async def _to_habits(self, models: Sequence[HabitModel]) -> list[Habit]:
        ids = [model.id for model in models]
        versions: dict[uuid.UUID, list[ScheduleVersion]] = defaultdict(list)
        pauses: dict[uuid.UUID, list[Pause]] = defaultdict(list)
        if ids:
            for row in await self._session.scalars(
                select(HabitScheduleVersionModel)
                .where(HabitScheduleVersionModel.habit_id.in_(ids))
                .order_by(HabitScheduleVersionModel.effective_from)
            ):
                versions[row.habit_id].append(
                    ScheduleVersion(row.effective_from, schedule_from_json(row.schedule))
                )
            for row in await self._session.scalars(
                select(HabitPauseModel)
                .where(HabitPauseModel.habit_id.in_(ids))
                .order_by(HabitPauseModel.start_date)
            ):
                pauses[row.habit_id].append(Pause(row.start_date, row.end_date))
        return [
            Habit(
                id=model.id,
                workspace_id=model.workspace_id,
                category_id=model.category_id,
                name=model.name,
                description=model.description,
                icon=cast(HabitIcon, model.icon),
                color=cast(HabitColor, model.color),
                kind=cast(HabitKind, model.kind),
                unit=model.unit,
                target=model.target,
                time_of_day=model.time_of_day,
                start_date=model.start_date,
                end_date=model.end_date,
                timezone=model.timezone,
                status=cast(HabitStatus, model.status),
                versions=tuple(versions[model.id]),
                pauses=tuple(pauses[model.id]),
                created_at=model.created_at,
                updated_at=model.updated_at,
            )
            for model in models
        ]

    # Log

    async def logs(
        self,
        workspace_id: uuid.UUID,
        habit_ids: Sequence[uuid.UUID],
        start: date | None = None,
        end: date | None = None,
    ) -> dict[uuid.UUID, list[HabitLog]]:
        result: dict[uuid.UUID, list[HabitLog]] = defaultdict(list)
        if not habit_ids:
            return result
        statement = select(HabitLogModel).where(
            HabitLogModel.workspace_id == workspace_id, HabitLogModel.habit_id.in_(habit_ids)
        )
        if start is not None:
            statement = statement.where(HabitLogModel.day >= start)
        if end is not None:
            statement = statement.where(HabitLogModel.day <= end)
        for row in await self._session.scalars(statement.order_by(HabitLogModel.day)):
            result[row.habit_id].append(_to_log(row))
        return result

    async def put_log(self, log: HabitLog) -> None:
        model = await self._session.scalar(
            select(HabitLogModel)
            .where(
                HabitLogModel.workspace_id == log.workspace_id,
                HabitLogModel.habit_id == log.habit_id,
                HabitLogModel.day == log.day,
            )
            .with_for_update()
        )
        if model is None:
            model = HabitLogModel(
                id=log.id,
                workspace_id=log.workspace_id,
                habit_id=log.habit_id,
                day=log.day,
                created_at=log.created_at,
            )
            self._session.add(model)
        model.value = log.value
        model.target = log.target
        model.skipped = log.skipped
        model.note = log.note
        model.logged_at = log.logged_at
        model.updated_at = log.updated_at
        await flush(self._session)

    async def delete_log(self, workspace_id: uuid.UUID, habit_id: uuid.UUID, day: date) -> bool:
        deleted = await self._session.execute(
            delete(HabitLogModel)
            .where(
                HabitLogModel.workspace_id == workspace_id,
                HabitLogModel.habit_id == habit_id,
                HabitLogModel.day == day,
            )
            .returning(HabitLogModel.id)
        )
        return deleted.first() is not None

    # Links

    async def habit_tasks(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> list[Task]:
        rows = await self._session.scalars(
            select(TaskModel)
            .join(HabitTaskModel, HabitTaskModel.task_id == TaskModel.id)
            .where(HabitTaskModel.workspace_id == workspace_id, HabitTaskModel.habit_id == habit_id)
            .order_by(TaskModel.status.desc(), TaskModel.created_at, TaskModel.id)
        )
        return [to_task(row) for row in rows]

    async def habit_notes(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> list[LinkedNote]:
        rows = await self._session.execute(
            select(
                NoteModel.id,
                NoteModel.title,
                NoteModel.note_type,
                NoteModel.trashed_at,
                NoteModel.updated_at,
            )
            .join(HabitNoteModel, HabitNoteModel.note_id == NoteModel.id)
            .where(HabitNoteModel.workspace_id == workspace_id, HabitNoteModel.habit_id == habit_id)
            .order_by(NoteModel.updated_at.desc(), NoteModel.id)
        )
        return [
            LinkedNote(
                id=row.id,
                title=row.title,
                note_type=row.note_type,
                trashed=row.trashed_at is not None,
                updated_at=row.updated_at,
            )
            for row in rows
        ]

    async def link_task(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, task_id: uuid.UUID
    ) -> None:
        if await self._session.get(HabitTaskModel, (habit_id, task_id)) is None:
            self._session.add(
                HabitTaskModel(habit_id=habit_id, task_id=task_id, workspace_id=workspace_id)
            )
            await flush(self._session)

    async def unlink_task(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, task_id: uuid.UUID
    ) -> None:
        await self._session.execute(
            delete(HabitTaskModel).where(
                HabitTaskModel.workspace_id == workspace_id,
                HabitTaskModel.habit_id == habit_id,
                HabitTaskModel.task_id == task_id,
            )
        )

    async def link_note(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, note_id: uuid.UUID
    ) -> None:
        if await self._session.get(HabitNoteModel, (habit_id, note_id)) is None:
            self._session.add(
                HabitNoteModel(habit_id=habit_id, note_id=note_id, workspace_id=workspace_id)
            )
            await flush(self._session)

    async def unlink_note(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, note_id: uuid.UUID
    ) -> None:
        await self._session.execute(
            delete(HabitNoteModel).where(
                HabitNoteModel.workspace_id == workspace_id,
                HabitNoteModel.habit_id == habit_id,
                HabitNoteModel.note_id == note_id,
            )
        )

    async def task_exists(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> bool:
        found = await self._session.scalar(
            select(TaskModel.id).where(
                TaskModel.id == task_id, TaskModel.workspace_id == workspace_id
            )
        )
        return found is not None

    async def note_exists(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> bool:
        found = await self._session.scalar(
            select(NoteModel.id).where(
                NoteModel.id == note_id, NoteModel.workspace_id == workspace_id
            )
        )
        return found is not None

    # Reminder times

    async def reminder_times(
        self,
        workspace_id: uuid.UUID,
        *,
        habit_id: uuid.UUID | None = None,
        routine_id: uuid.UUID | None = None,
    ) -> list[HabitReminder]:
        owner = (
            HabitReminderModel.habit_id == habit_id
            if habit_id is not None
            else HabitReminderModel.routine_id == routine_id
        )
        rows = await self._session.scalars(
            select(HabitReminderModel)
            .where(HabitReminderModel.workspace_id == workspace_id, owner)
            .order_by(HabitReminderModel.time_of_day)
        )
        return [_to_reminder_time(row) for row in rows]

    async def get_reminder_time(
        self, workspace_id: uuid.UUID, reminder_id: uuid.UUID
    ) -> HabitReminder | None:
        model = await self._session.scalar(
            select(HabitReminderModel).where(
                HabitReminderModel.workspace_id == workspace_id,
                HabitReminderModel.id == reminder_id,
            )
        )
        return _to_reminder_time(model) if model else None

    async def set_reminder_times(
        self,
        workspace_id: uuid.UUID,
        times: Sequence[ReminderTime],
        *,
        habit_id: uuid.UUID | None = None,
        routine_id: uuid.UUID | None = None,
    ) -> None:
        owner = (
            HabitReminderModel.habit_id == habit_id
            if habit_id is not None
            else HabitReminderModel.routine_id == routine_id
        )
        existing = {
            row.time_of_day: row
            for row in await self._session.scalars(
                select(HabitReminderModel).where(
                    HabitReminderModel.workspace_id == workspace_id, owner
                )
            )
        }
        wanted = {time.time_of_day: time for time in times}
        for at, row in existing.items():
            if at not in wanted:
                # Its managed reminder and pending occurrences go with it (cascade).
                await self._session.delete(row)
        for at, time in wanted.items():
            row = existing.get(at)
            if row is None:
                self._session.add(
                    HabitReminderModel(
                        id=uuid.uuid4(),
                        workspace_id=workspace_id,
                        habit_id=habit_id,
                        routine_id=routine_id,
                        time_of_day=at,
                        weekdays=_weekdays_to_json(time.weekdays),
                        created_at=utc_now(),
                    )
                )
            else:
                row.weekdays = _weekdays_to_json(time.weekdays)
        await flush(self._session)

    # Routines

    async def routines(
        self, workspace_id: uuid.UUID, statuses: Sequence[RoutineStatus] | None = None
    ) -> list[Routine]:
        statement = select(RoutineModel).where(RoutineModel.workspace_id == workspace_id)
        if statuses:
            statement = statement.where(RoutineModel.status.in_(statuses))
        models = list(
            await self._session.scalars(
                statement.order_by(RoutineModel.time_of_day, RoutineModel.created_at)
            )
        )
        return await self._to_routines(models)

    async def get_routine(self, workspace_id: uuid.UUID, routine_id: uuid.UUID) -> Routine | None:
        model = await self._session.scalar(
            select(RoutineModel).where(
                RoutineModel.workspace_id == workspace_id, RoutineModel.id == routine_id
            )
        )
        return (await self._to_routines([model]))[0] if model else None

    async def add_routine(self, routine: Routine) -> None:
        self._session.add(
            RoutineModel(
                id=routine.id,
                workspace_id=routine.workspace_id,
                created_at=routine.created_at,
                **_routine_fields(routine),
            )
        )
        await flush(self._session)
        await self._put_steps(routine)

    async def save_routine(self, routine: Routine) -> None:
        await self._session.execute(
            update(RoutineModel)
            .where(RoutineModel.id == routine.id, RoutineModel.workspace_id == routine.workspace_id)
            .values(**_routine_fields(routine))
        )
        await self._put_steps(routine)

    async def delete_routine(self, workspace_id: uuid.UUID, routine_id: uuid.UUID) -> bool:
        deleted = await self._session.execute(
            delete(RoutineModel)
            .where(RoutineModel.workspace_id == workspace_id, RoutineModel.id == routine_id)
            .returning(RoutineModel.id)
        )
        return deleted.first() is not None

    async def _put_steps(self, routine: Routine) -> None:
        existing = {
            row.id: row
            for row in await self._session.scalars(
                select(RoutineStepModel).where(
                    RoutineStepModel.workspace_id == routine.workspace_id,
                    RoutineStepModel.routine_id == routine.id,
                )
            )
        }
        keep = {step.id for step in routine.steps}
        for step_id, row in existing.items():
            if step_id not in keep:
                await self._session.delete(row)
        for step in routine.steps:
            row = existing.get(step.id)
            if row is None:
                row = RoutineStepModel(
                    id=step.id, workspace_id=routine.workspace_id, routine_id=routine.id
                )
                self._session.add(row)
            row.position = step.position
            row.name = step.name
            row.description = step.description
            row.duration_minutes = step.duration_minutes
            row.habit_id = step.habit_id
            row.task_id = step.task_id
            row.note_id = step.note_id
        await flush(self._session)

    async def _to_routines(self, models: Sequence[RoutineModel]) -> list[Routine]:
        steps: dict[uuid.UUID, list[RoutineStep]] = defaultdict(list)
        ids = [model.id for model in models]
        if ids:
            for row in await self._session.scalars(
                select(RoutineStepModel)
                .where(RoutineStepModel.routine_id.in_(ids))
                .order_by(RoutineStepModel.position)
            ):
                steps[row.routine_id].append(_to_step(row))
        return [
            Routine(
                id=model.id,
                workspace_id=model.workspace_id,
                category_id=model.category_id,
                name=model.name,
                description=model.description,
                icon=cast(HabitIcon, model.icon),
                color=cast(HabitColor, model.color),
                time_of_day=model.time_of_day,
                weekdays=_weekdays_from_json(model.weekdays),
                timezone=model.timezone,
                status=cast(RoutineStatus, model.status),
                steps=tuple(steps[model.id]),
                created_at=model.created_at,
                updated_at=model.updated_at,
            )
            for model in models
        ]

    # Sessions

    async def add_session(self, session: RoutineSession) -> None:
        self._session.add(
            RoutineSessionModel(
                id=session.id,
                workspace_id=session.workspace_id,
                routine_id=session.routine_id,
                day=session.day,
                routine_name=session.routine_name,
                status=session.status,
                started_at=session.started_at,
                finished_at=session.finished_at,
                notes=session.notes,
                note_id=session.note_id,
            )
        )
        await flush(self._session)
        for step in session.steps:
            self._session.add(
                RoutineSessionStepModel(
                    id=step.id,
                    workspace_id=session.workspace_id,
                    session_id=session.id,
                    position=step.position,
                    name=step.name,
                    duration_minutes=step.duration_minutes,
                    habit_id=step.habit_id,
                    task_id=step.task_id,
                    status=step.status,
                    completed_at=step.completed_at,
                )
            )
        await flush(self._session)

    async def save_session(self, session: RoutineSession) -> None:
        await self._session.execute(
            update(RoutineSessionModel)
            .where(
                RoutineSessionModel.id == session.id,
                RoutineSessionModel.workspace_id == session.workspace_id,
            )
            .values(
                status=session.status,
                finished_at=session.finished_at,
                notes=session.notes,
                note_id=session.note_id,
            )
        )
        for step in session.steps:
            await self._session.execute(
                update(RoutineSessionStepModel)
                .where(
                    RoutineSessionStepModel.id == step.id,
                    RoutineSessionStepModel.session_id == session.id,
                    RoutineSessionStepModel.workspace_id == session.workspace_id,
                )
                .values(status=step.status, completed_at=step.completed_at)
            )
        await flush(self._session)

    async def get_session(
        self, workspace_id: uuid.UUID, session_id: uuid.UUID
    ) -> RoutineSession | None:
        model = await self._session.scalar(
            select(RoutineSessionModel).where(
                RoutineSessionModel.workspace_id == workspace_id,
                RoutineSessionModel.id == session_id,
            )
        )
        return (await self._to_sessions([model]))[0] if model else None

    async def active_session(
        self, workspace_id: uuid.UUID, routine_id: uuid.UUID
    ) -> RoutineSession | None:
        model = await self._session.scalar(
            select(RoutineSessionModel).where(
                RoutineSessionModel.workspace_id == workspace_id,
                RoutineSessionModel.routine_id == routine_id,
                RoutineSessionModel.status == "active",
            )
        )
        return (await self._to_sessions([model]))[0] if model else None

    async def sessions(
        self, workspace_id: uuid.UUID, routine_id: uuid.UUID, limit: int, offset: int
    ) -> tuple[list[RoutineSession], int]:
        where = (
            RoutineSessionModel.workspace_id == workspace_id,
            RoutineSessionModel.routine_id == routine_id,
        )
        total = await self._session.scalar(
            select(func.count()).select_from(RoutineSessionModel).where(*where)
        )
        models = list(
            await self._session.scalars(
                select(RoutineSessionModel)
                .where(*where)
                .order_by(RoutineSessionModel.started_at.desc(), RoutineSessionModel.id)
                .limit(limit)
                .offset(offset)
            )
        )
        return await self._to_sessions(models), total or 0

    async def completed_sessions(self, workspace_id: uuid.UUID, routine_id: uuid.UUID) -> int:
        count = await self._session.scalar(
            select(func.count())
            .select_from(RoutineSessionModel)
            .where(
                RoutineSessionModel.workspace_id == workspace_id,
                RoutineSessionModel.routine_id == routine_id,
                RoutineSessionModel.status == "completed",
            )
        )
        return count or 0

    async def finished_days(
        self, workspace_id: uuid.UUID, routine_ids: Sequence[uuid.UUID], start: date, end: date
    ) -> dict[uuid.UUID, set[date]]:
        result: dict[uuid.UUID, set[date]] = defaultdict(set)
        if not routine_ids:
            return result
        rows = await self._session.execute(
            select(RoutineSessionModel.routine_id, RoutineSessionModel.day).where(
                RoutineSessionModel.workspace_id == workspace_id,
                RoutineSessionModel.routine_id.in_(routine_ids),
                RoutineSessionModel.status == "completed",
                RoutineSessionModel.day >= start,
                RoutineSessionModel.day <= end,
            )
        )
        for routine_id, day in rows:
            result[routine_id].add(day)
        return result

    async def _to_sessions(self, models: Sequence[RoutineSessionModel]) -> list[RoutineSession]:
        steps: dict[uuid.UUID, list[SessionStep]] = defaultdict(list)
        ids = [model.id for model in models]
        if ids:
            for row in await self._session.scalars(
                select(RoutineSessionStepModel)
                .where(RoutineSessionStepModel.session_id.in_(ids))
                .order_by(RoutineSessionStepModel.position)
            ):
                steps[row.session_id].append(_to_session_step(row))
        return [
            RoutineSession(
                id=model.id,
                workspace_id=model.workspace_id,
                routine_id=model.routine_id,
                day=model.day,
                routine_name=model.routine_name,
                status=cast(SessionStatus, model.status),
                started_at=model.started_at,
                finished_at=model.finished_at,
                notes=model.notes,
                note_id=model.note_id,
                steps=tuple(steps[model.id]),
            )
            for model in models
        ]


def build_habit_service(
    session: AsyncSession,
    clock: Callable[[], datetime] | None = None,
    health: HealthSource | None = None,
) -> HabitService:
    """A habit service whose changes and reminders share `session`'s transaction. Used by the
    API per request and by the reminder worker inside each delivery transaction."""
    timing = {"clock": clock} if clock else {}
    return HabitService(
        SqlHabitStore(session),
        SqlReminderRepository(session),
        SqlOccurrenceRepository(session),
        SqlTransaction(session),
        health=health,
        **timing,
    )


def build_routine_service(session: AsyncSession) -> RoutineService:
    return RoutineService(
        SqlHabitStore(session), build_habit_service(session), SqlTransaction(session)
    )
