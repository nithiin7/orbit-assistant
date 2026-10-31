"""The calendar. Every query is filtered by workspace, so callers cannot reach other workspaces'
rows; links are composite foreign keys, so the database refuses cross-workspace rows too."""

import uuid
from collections.abc import Callable, Collection
from datetime import date, datetime
from typing import cast

from sqlalchemy import ColumnElement, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    CalendarCategoryModel,
    CalendarEventAlertModel,
    CalendarEventExceptionModel,
    CalendarEventModel,
    CalendarEventNoteModel,
    CalendarEventTaskModel,
    CalendarPreferencesModel,
    NoteModel,
    TaskModel,
)
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.tasks import to_task
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.calendar.models import (
    CalendarEvent,
    CalendarPreferences,
    CalendarView,
    Category,
    CategoryColor,
    EventAlert,
    EventException,
    EventPage,
    EventQuery,
    EventStatus,
    ExceptionKind,
    LinkedNote,
)
from orbit_api.services.calendar.recurrence import rule_from_json, rule_to_json
from orbit_api.services.calendar.service import (
    CalendarPreferenceService,
    CalendarService,
    SeriesBounds,
)
from orbit_api.services.tasks.models import Task
from orbit_api.utils.clock import utc_now
from orbit_api.utils.text_search import LIKE_ESCAPE, contains_pattern

_Event = CalendarEventModel
_Exception = CalendarEventExceptionModel


def _normalize(name: str) -> str:
    return " ".join(name.split()).casefold()


def _to_category(model: CalendarCategoryModel) -> Category:
    return Category(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        # The table's CHECK constraint limits `color` to the palette.
        color=cast(CategoryColor, model.color),
        is_visible=model.is_visible,
        position=model.position,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_event(model: CalendarEventModel) -> CalendarEvent:
    return CalendarEvent(
        id=model.id,
        workspace_id=model.workspace_id,
        title=model.title,
        description=model.description,
        location=model.location,
        category_id=model.category_id,
        all_day=model.all_day,
        timezone=model.timezone,
        start=model.start_local,
        end=model.end_local,
        recurrence=rule_from_json(model.recurrence),
        status=cast(EventStatus, model.status),
        series_id=model.series_id,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_exception(model: CalendarEventExceptionModel) -> EventException:
    return EventException(
        id=model.id,
        workspace_id=model.workspace_id,
        event_id=model.event_id,
        original_start=model.original_start,
        kind=cast(ExceptionKind, model.kind),
        title=model.title,
        description=model.description,
        location=model.location,
        category_id=model.category_id,
        start=model.start_local,
        end=model.end_local,
        status=cast(EventStatus | None, model.status),
    )


def _event_fields(event: CalendarEvent, bounds: SeriesBounds) -> dict[str, object]:
    return {
        "title": event.title,
        "description": event.description,
        "location": event.location,
        "category_id": event.category_id,
        "all_day": event.all_day,
        "timezone": event.timezone,
        "start_local": event.start,
        "end_local": event.end,
        "start_at": bounds.start_at,
        "end_at": bounds.end_at,
        "until_at": bounds.until_at,
        "recurrence": rule_to_json(event.recurrence),
        "status": event.status,
        "series_id": event.series_id,
        "updated_at": event.updated_at,
    }


class SqlCalendarRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # Categories

    async def categories(self, workspace_id: uuid.UUID) -> list[Category]:
        models = await self._session.scalars(
            select(CalendarCategoryModel)
            .where(CalendarCategoryModel.workspace_id == workspace_id)
            .order_by(CalendarCategoryModel.position, CalendarCategoryModel.name)
        )
        return [_to_category(model) for model in models]

    async def get_category(
        self, workspace_id: uuid.UUID, category_id: uuid.UUID
    ) -> Category | None:
        model = await self._category_model(workspace_id, category_id)
        return _to_category(model) if model else None

    async def add_category(self, category: Category) -> None:
        self._session.add(
            CalendarCategoryModel(
                id=category.id,
                workspace_id=category.workspace_id,
                name=category.name,
                normalized_name=_normalize(category.name),
                color=category.color,
                is_visible=category.is_visible,
                position=category.position,
                created_at=category.created_at,
                updated_at=category.updated_at,
            )
        )
        await flush(self._session)

    async def save_category(self, category: Category) -> None:
        model = await self._category_model(category.workspace_id, category.id)
        if model is None:
            return
        model.name = category.name
        model.normalized_name = _normalize(category.name)
        model.color = category.color
        model.is_visible = category.is_visible
        model.position = category.position
        model.updated_at = category.updated_at
        await flush(self._session)

    async def delete_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> bool:
        for table in (_Event, _Exception):
            await self._session.execute(
                update(table)
                .where(table.workspace_id == workspace_id, table.category_id == category_id)
                .values(category_id=None)
            )
        deleted = await self._session.scalars(
            delete(CalendarCategoryModel)
            .where(
                CalendarCategoryModel.id == category_id,
                CalendarCategoryModel.workspace_id == workspace_id,
            )
            .returning(CalendarCategoryModel.id)
        )
        return deleted.first() is not None

    # Events

    async def add_event(self, event: CalendarEvent, bounds: SeriesBounds) -> None:
        self._session.add(
            CalendarEventModel(
                id=event.id,
                workspace_id=event.workspace_id,
                created_at=event.created_at,
                **_event_fields(event, bounds),
            )
        )
        await flush(self._session)

    async def get_event(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> CalendarEvent | None:
        model = await self._event_model(workspace_id, event_id)
        return _to_event(model) if model else None

    async def save_event(self, event: CalendarEvent, bounds: SeriesBounds) -> None:
        model = await self._event_model(event.workspace_id, event.id)
        if model is None:
            return
        for name, value in _event_fields(event, bounds).items():
            setattr(model, name, value)
        await flush(self._session)

    async def delete_event(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> bool:
        # Exceptions, alerts (and their reminders), and links cascade.
        deleted = await self._session.scalars(
            delete(_Event)
            .where(_Event.id == event_id, _Event.workspace_id == workspace_id)
            .returning(_Event.id)
        )
        return deleted.first() is not None

    async def find_events(self, workspace_id: uuid.UUID, query: EventQuery) -> EventPage:
        conditions: list[ColumnElement[bool]] = [_Event.workspace_id == workspace_id]
        if query.search:
            # A substring search can't use an index; it scans one workspace's events, which is
            # fine at personal scale.
            pattern = contains_pattern(query.search)
            conditions.append(
                or_(
                    _Event.title.ilike(pattern, escape=LIKE_ESCAPE),
                    _Event.description.ilike(pattern, escape=LIKE_ESCAPE),
                    _Event.location.ilike(pattern, escape=LIKE_ESCAPE),
                )
            )
        if query.category_id is not None:
            conditions.append(_Event.category_id == query.category_id)
        total = await self._session.scalar(
            select(func.count()).select_from(_Event).where(*conditions)
        )
        models = await self._session.scalars(
            select(_Event)
            .where(*conditions)
            .order_by(_Event.start_at.desc(), _Event.id)
            .limit(query.limit)
            .offset(query.offset)
        )
        return EventPage(events=[_to_event(model) for model in models], total=total or 0)

    async def events_in(
        self, workspace_id: uuid.UUID, start: datetime, end: datetime
    ) -> list[CalendarEvent]:
        moved = select(_Exception.event_id).where(
            _Exception.workspace_id == workspace_id,
            _Exception.start_at < end,
            _Exception.end_at >= start,
        )
        models = await self._session.scalars(
            select(_Event).where(
                _Event.workspace_id == workspace_id,
                or_(
                    (_Event.start_at < end)
                    & (_Event.until_at.is_(None) | (_Event.until_at >= start)),
                    _Event.id.in_(moved),
                ),
            )
        )
        return [_to_event(model) for model in models]

    # Exceptions

    async def exceptions(
        self, workspace_id: uuid.UUID, event_ids: Collection[uuid.UUID]
    ) -> dict[uuid.UUID, dict[datetime, EventException]]:
        if not event_ids:
            return {}
        models = await self._session.scalars(
            select(_Exception).where(
                _Exception.workspace_id == workspace_id, _Exception.event_id.in_(event_ids)
            )
        )
        result: dict[uuid.UUID, dict[datetime, EventException]] = {}
        for model in models:
            result.setdefault(model.event_id, {})[model.original_start] = _to_exception(model)
        return result

    async def put_exception(
        self, exception: EventException, bounds: tuple[datetime, datetime] | None
    ) -> None:
        model = await self._session.scalar(
            select(_Exception).where(
                _Exception.workspace_id == exception.workspace_id,
                _Exception.event_id == exception.event_id,
                _Exception.original_start == exception.original_start,
            )
        )
        now = utc_now()
        fields: dict[str, object] = {
            "kind": exception.kind,
            "title": exception.title,
            "description": exception.description,
            "location": exception.location,
            "category_id": exception.category_id,
            "start_local": exception.start,
            "end_local": exception.end,
            "start_at": bounds[0] if bounds else None,
            "end_at": bounds[1] if bounds else None,
            "status": exception.status,
            "updated_at": now,
        }
        if model is None:
            self._session.add(
                CalendarEventExceptionModel(
                    id=exception.id,
                    workspace_id=exception.workspace_id,
                    event_id=exception.event_id,
                    original_start=exception.original_start,
                    created_at=now,
                    **fields,
                )
            )
        else:
            for name, value in fields.items():
                setattr(model, name, value)
        await flush(self._session)

    async def delete_exceptions(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, *, from_start: datetime | None = None
    ) -> None:
        statement = delete(_Exception).where(
            _Exception.workspace_id == workspace_id, _Exception.event_id == event_id
        )
        if from_start is not None:
            statement = statement.where(_Exception.original_start >= from_start)
        await self._session.execute(statement)

    # Alerts

    async def alerts(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> list[EventAlert]:
        models = await self._session.scalars(
            select(CalendarEventAlertModel)
            .where(
                CalendarEventAlertModel.workspace_id == workspace_id,
                CalendarEventAlertModel.event_id == event_id,
            )
            .order_by(CalendarEventAlertModel.minutes_before)
        )
        return [EventAlert(m.id, m.event_id, m.minutes_before) for m in models]

    async def get_alert(self, workspace_id: uuid.UUID, alert_id: uuid.UUID) -> EventAlert | None:
        model = await self._session.scalar(
            select(CalendarEventAlertModel).where(
                CalendarEventAlertModel.id == alert_id,
                CalendarEventAlertModel.workspace_id == workspace_id,
            )
        )
        return EventAlert(model.id, model.event_id, model.minutes_before) if model else None

    async def set_alerts(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, minutes: Collection[int]
    ) -> list[EventAlert]:
        existing = await self.alerts(workspace_id, event_id)
        keep = set(minutes)
        stale = [alert.id for alert in existing if alert.minutes_before not in keep]
        if stale:
            # Each alert's reminder (and its pending occurrence) cascades.
            await self._session.execute(
                delete(CalendarEventAlertModel).where(
                    CalendarEventAlertModel.workspace_id == workspace_id,
                    CalendarEventAlertModel.id.in_(stale),
                )
            )
        present = {alert.minutes_before for alert in existing}
        for value in sorted(keep - present):
            self._session.add(
                CalendarEventAlertModel(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    event_id=event_id,
                    minutes_before=value,
                )
            )
        await flush(self._session)
        return await self.alerts(workspace_id, event_id)

    # Notes and tasks

    async def note_exists(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> bool:
        found = await self._session.scalar(
            select(NoteModel.id).where(
                NoteModel.id == note_id, NoteModel.workspace_id == workspace_id
            )
        )
        return found is not None

    async def linked_notes(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> list[LinkedNote]:
        rows = await self._session.execute(
            select(
                NoteModel.id,
                NoteModel.title,
                NoteModel.note_type,
                NoteModel.trashed_at,
                NoteModel.updated_at,
            )
            .join(CalendarEventNoteModel, CalendarEventNoteModel.note_id == NoteModel.id)
            .where(
                CalendarEventNoteModel.workspace_id == workspace_id,
                CalendarEventNoteModel.event_id == event_id,
            )
            .order_by(NoteModel.updated_at.desc(), NoteModel.id)
        )
        return [
            LinkedNote(
                id=row[0],
                title=row[1],
                note_type=row[2],
                trashed=row[3] is not None,
                updated_at=row[4],
            )
            for row in rows
        ]

    async def link_note(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, note_id: uuid.UUID
    ) -> None:
        if await self._session.get(CalendarEventNoteModel, (event_id, note_id)) is None:
            self._session.add(
                CalendarEventNoteModel(
                    event_id=event_id, note_id=note_id, workspace_id=workspace_id
                )
            )
            await flush(self._session)

    async def unlink_note(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, note_id: uuid.UUID
    ) -> bool:
        deleted = await self._session.execute(
            delete(CalendarEventNoteModel)
            .where(
                CalendarEventNoteModel.workspace_id == workspace_id,
                CalendarEventNoteModel.event_id == event_id,
                CalendarEventNoteModel.note_id == note_id,
            )
            .returning(CalendarEventNoteModel.note_id)
        )
        return deleted.first() is not None

    async def get_task(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task | None:
        model = await self._session.scalar(
            select(TaskModel).where(TaskModel.id == task_id, TaskModel.workspace_id == workspace_id)
        )
        return to_task(model) if model else None

    async def linked_tasks(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> list[Task]:
        models = await self._session.scalars(
            select(TaskModel)
            .join(CalendarEventTaskModel, CalendarEventTaskModel.task_id == TaskModel.id)
            .where(
                CalendarEventTaskModel.workspace_id == workspace_id,
                CalendarEventTaskModel.event_id == event_id,
            )
            .order_by(TaskModel.status.desc(), TaskModel.created_at, TaskModel.id)
        )
        return [to_task(model) for model in models]

    async def link_task(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, task_id: uuid.UUID
    ) -> None:
        if await self._session.get(CalendarEventTaskModel, (event_id, task_id)) is None:
            self._session.add(
                CalendarEventTaskModel(
                    event_id=event_id, task_id=task_id, workspace_id=workspace_id
                )
            )
            await flush(self._session)

    async def unlink_task(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, task_id: uuid.UUID
    ) -> bool:
        deleted = await self._session.execute(
            delete(CalendarEventTaskModel)
            .where(
                CalendarEventTaskModel.workspace_id == workspace_id,
                CalendarEventTaskModel.event_id == event_id,
                CalendarEventTaskModel.task_id == task_id,
            )
            .returning(CalendarEventTaskModel.task_id)
        )
        return deleted.first() is not None

    async def scheduled_tasks(
        self, workspace_id: uuid.UUID, start: datetime, end: datetime, include_completed: bool
    ) -> list[Task]:
        conditions = [
            TaskModel.workspace_id == workspace_id,
            TaskModel.scheduled_start < end,
            TaskModel.scheduled_end > start,
        ]
        if not include_completed:
            conditions.append(TaskModel.status == "open")
        models = await self._session.scalars(
            select(TaskModel).where(*conditions).order_by(TaskModel.scheduled_start, TaskModel.id)
        )
        return [to_task(model) for model in models]

    async def due_tasks(
        self, workspace_id: uuid.UUID, start: date, end: date, include_completed: bool
    ) -> list[Task]:
        conditions = [
            TaskModel.workspace_id == workspace_id,
            TaskModel.scheduled_start.is_(None),
            TaskModel.due_date >= start,
            TaskModel.due_date < end,
        ]
        if not include_completed:
            conditions.append(TaskModel.status == "open")
        models = await self._session.scalars(
            select(TaskModel)
            .where(*conditions)
            .order_by(TaskModel.due_date, TaskModel.priority.desc(), TaskModel.id)
        )
        return [to_task(model) for model in models]

    async def _category_model(
        self, workspace_id: uuid.UUID, category_id: uuid.UUID
    ) -> CalendarCategoryModel | None:
        return await self._session.scalar(
            select(CalendarCategoryModel).where(
                CalendarCategoryModel.id == category_id,
                CalendarCategoryModel.workspace_id == workspace_id,
            )
        )

    async def _event_model(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID
    ) -> CalendarEventModel | None:
        # Locked, so concurrent edits of one series (and alert re-pointing) apply in turn.
        return await self._session.scalar(
            select(_Event)
            .where(_Event.id == event_id, _Event.workspace_id == workspace_id)
            .with_for_update()
        )


class SqlCalendarPreferenceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, user_id: uuid.UUID) -> CalendarPreferences | None:
        model = await self._session.get(CalendarPreferencesModel, user_id)
        if model is None:
            return None
        return CalendarPreferences(
            default_view=cast(CalendarView, model.default_view),
            week_start=model.week_start,
            working_hours_start=model.working_hours_start,
            working_hours_end=model.working_hours_end,
            show_completed_tasks=model.show_completed_tasks,
            show_unscheduled_tasks=model.show_unscheduled_tasks,
            show_due_tasks=model.show_due_tasks,
            updated_at=model.updated_at,
        )

    async def put(self, user_id: uuid.UUID, preferences: CalendarPreferences) -> None:
        model = await self._session.get(CalendarPreferencesModel, user_id)
        if model is None:
            model = CalendarPreferencesModel(user_id=user_id)
            self._session.add(model)
        model.default_view = preferences.default_view
        model.week_start = preferences.week_start
        model.working_hours_start = preferences.working_hours_start
        model.working_hours_end = preferences.working_hours_end
        model.show_completed_tasks = preferences.show_completed_tasks
        model.show_unscheduled_tasks = preferences.show_unscheduled_tasks
        model.show_due_tasks = preferences.show_due_tasks
        model.updated_at = preferences.updated_at or utc_now()
        await flush(self._session)


def build_calendar_service(
    session: AsyncSession, clock: Callable[[], datetime] | None = None
) -> CalendarService:
    """A calendar service whose event changes and alert reminders share `session`'s
    transaction. Used by the API per request and by the reminder worker inside each delivery
    transaction."""
    timing = {"clock": clock} if clock else {}
    return CalendarService(
        SqlCalendarRepository(session),
        SqlReminderRepository(session),
        SqlOccurrenceRepository(session),
        SqlTransaction(session),
        **timing,
    )


def build_calendar_preference_service(session: AsyncSession) -> CalendarPreferenceService:
    return CalendarPreferenceService(
        SqlCalendarPreferenceRepository(session), SqlTransaction(session)
    )
