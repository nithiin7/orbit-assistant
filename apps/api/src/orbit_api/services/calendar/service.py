"""The calendar: events and recurring series in a workspace, alongside its tasks and notes.

Every method takes a `workspace_id` that the caller has already authorized (the `WorkspaceDep`
API dependency does this), and repositories filter every query by it. An event, category, note,
or task ID from another workspace is indistinguishable from one that doesn't exist.

- **Series, not rows.** A recurring event is one row with a rule; occurrences are expanded for
  the range a view asks for (`occurrences.expand`). Exceptions (a skipped or changed occurrence)
  are stored under the occurrence's original start.
- **Editing scopes.** `this` writes an exception; `following` splits the series in two at the
  occurrence (the original ends the day before, a new series continues with the change);
  `series` changes the rule's event. Changing a whole series' timing or rule clears its
  exceptions, since their original starts may no longer exist.
- **Tasks** are never copied. Scheduled tasks (`tasks.scheduled_start`/`scheduled_end`) and
  tasks due in a range are read from the tasks table; events can also link to tasks.
- **Notes** are linked by ID, so renaming either side keeps the link.
- **Alerts** are reminders the event manages (`Reminder.commitment` with kind `calendar_alert`),
  delivered by the existing reminder worker. Each alert keeps one reminder pointed at the next
  occurrence whose alert time is ahead, re-pointed in the same transaction as every change and,
  after each delivery, by `after_delivery`. Skipped, cancelled, and moved occurrences are
  handled because the target is computed from the expanded occurrences.
"""

import base64
import binascii
import uuid
from collections.abc import Callable, Collection, Iterable
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from itertools import pairwise
from typing import Protocol
from zoneinfo import ZoneInfo

from orbit_api.services.calendar.models import (
    ALL_DAY_ALERT_TIME,
    DEFAULT_CATEGORIES,
    MAX_CATEGORIES,
    AgendaItem,
    AgendaPage,
    CalendarEvent,
    CalendarPreferences,
    CalendarRange,
    Category,
    CategoryColor,
    CategoryNameTakenError,
    CategoryNotFoundError,
    DateWindow,
    EditScope,
    EventAlert,
    EventChanges,
    EventDetail,
    EventDraft,
    EventException,
    EventNoteNotFoundError,
    EventNotFoundError,
    EventOccurrence,
    EventPage,
    EventQuery,
    EventTaskNotFoundError,
    InvalidCursorError,
    InvalidEventTimesError,
    LinkedNote,
    OccurrenceChanges,
    OccurrenceNotFoundError,
    TooManyCategoriesError,
)
from orbit_api.services.calendar.occurrences import (
    expand,
    in_date_window,
    occurrence_key,
    occurrence_order,
    to_utc,
    widen,
    window_instants,
)
from orbit_api.services.calendar.recurrence import (
    EventRecurrence,
    is_occurrence,
    last_start,
    remaining_from,
    truncate_before,
    validate_rule,
)
from orbit_api.services.reminders.managed import ReminderStore, ReminderTarget, point_reminder
from orbit_api.services.reminders.models import CommitmentLink, Reminder
from orbit_api.services.reminders.recurrence import WEEKDAYS, Schedule, local_to_utc
from orbit_api.services.reminders.service import OccurrenceScheduler
from orbit_api.services.tasks.models import Task
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.changes import UNSET, Change
from orbit_api.utils.clock import utc_now

DEFAULT_TIMEZONE = "UTC"
MAX_EVENT_LENGTH = timedelta(days=366)
# The agenda looks this far ahead, in growing steps.
AGENDA_HORIZON = timedelta(days=366)
_AGENDA_STEPS = (timedelta(days=7), timedelta(days=31), timedelta(days=92), AGENDA_HORIZON)
# How far ahead an alert's next occurrence is looked for. An alert with nothing to announce in
# this time is re-pointed after the series changes or the next delivery.
_ALERT_HORIZON = timedelta(days=400)


@dataclass(frozen=True, slots=True)
class SeriesBounds:
    """Where a series sits in time, in UTC, for range queries: its first occurrence, and the end
    of its last (`None` when it never ends)."""

    start_at: datetime
    end_at: datetime
    until_at: datetime | None


class CalendarRepository(Protocol):
    async def categories(self, workspace_id: uuid.UUID) -> list[Category]: ...

    async def get_category(
        self, workspace_id: uuid.UUID, category_id: uuid.UUID
    ) -> Category | None: ...

    async def add_category(self, category: Category) -> None: ...

    async def save_category(self, category: Category) -> None: ...

    async def delete_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> bool:
        """Delete the category; events and exceptions using it keep no category."""
        ...

    async def add_event(self, event: CalendarEvent, bounds: SeriesBounds) -> None: ...

    async def get_event(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> CalendarEvent | None:
        """The event, locked for this transaction, only if it belongs to `workspace_id`."""
        ...

    async def save_event(self, event: CalendarEvent, bounds: SeriesBounds) -> None: ...

    async def delete_event(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> bool: ...

    async def find_events(self, workspace_id: uuid.UUID, query: EventQuery) -> EventPage: ...

    async def events_in(
        self, workspace_id: uuid.UUID, start: datetime, end: datetime
    ) -> list[CalendarEvent]:
        """Events that may have an occurrence overlapping `[start, end)`: series overlapping it,
        and series with an exception moved into it."""
        ...

    async def exceptions(
        self, workspace_id: uuid.UUID, event_ids: Collection[uuid.UUID]
    ) -> dict[uuid.UUID, dict[datetime, EventException]]: ...

    async def put_exception(
        self, exception: EventException, bounds: tuple[datetime, datetime] | None
    ) -> None:
        """Insert or replace the exception for its event and original start."""
        ...

    async def delete_exceptions(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, *, from_start: datetime | None = None
    ) -> None:
        """Delete the event's exceptions, or only those at or after `from_start`."""
        ...

    async def alerts(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> list[EventAlert]: ...

    async def get_alert(
        self, workspace_id: uuid.UUID, alert_id: uuid.UUID
    ) -> EventAlert | None: ...

    async def set_alerts(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, minutes: Collection[int]
    ) -> list[EventAlert]:
        """Make the event's alerts exactly `minutes`, keeping existing ones (and their
        reminders) that stay. Removing an alert deletes its reminder."""
        ...

    async def note_exists(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> bool: ...

    async def linked_notes(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID
    ) -> list[LinkedNote]: ...

    async def link_note(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, note_id: uuid.UUID
    ) -> None:
        """Idempotent."""
        ...

    async def unlink_note(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, note_id: uuid.UUID
    ) -> bool: ...

    async def get_task(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task | None: ...

    async def linked_tasks(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> list[Task]: ...

    async def link_task(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, task_id: uuid.UUID
    ) -> None:
        """Idempotent."""
        ...

    async def unlink_task(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, task_id: uuid.UUID
    ) -> bool: ...

    async def scheduled_tasks(
        self, workspace_id: uuid.UUID, start: datetime, end: datetime, include_completed: bool
    ) -> list[Task]:
        """Tasks whose scheduled time overlaps `[start, end)`, by start."""
        ...

    async def due_tasks(
        self, workspace_id: uuid.UUID, start: date, end: date, include_completed: bool
    ) -> list[Task]:
        """Tasks without a scheduled time, due on a date in `[start, end)`."""
        ...


class PreferenceRepository(Protocol):
    async def get(self, user_id: uuid.UUID) -> CalendarPreferences | None: ...

    async def put(self, user_id: uuid.UUID, preferences: CalendarPreferences) -> None: ...


class CalendarService:
    def __init__(
        self,
        calendar: CalendarRepository,
        reminders: ReminderStore,
        occurrences: OccurrenceScheduler,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._calendar = calendar
        self._reminders = reminders
        self._occurrences = occurrences
        self._transaction = transaction
        self._clock = clock

    # Categories

    async def categories(self, workspace_id: uuid.UUID) -> list[Category]:
        """The workspace's categories, creating the defaults the first time."""
        categories = await self._calendar.categories(workspace_id)
        if categories:
            return categories
        now = self._clock()
        try:
            for position, (name, color) in enumerate(DEFAULT_CATEGORIES):
                await self._calendar.add_category(
                    Category(uuid.uuid4(), workspace_id, name, color, True, position, now, now)
                )
            await self._transaction.commit()
        except ConflictError:
            # A concurrent first request created them.
            await self._transaction.rollback()
        return await self._calendar.categories(workspace_id)

    async def create_category(
        self, workspace_id: uuid.UUID, name: str, color: CategoryColor
    ) -> Category:
        existing = await self.categories(workspace_id)
        if len(existing) >= MAX_CATEGORIES:
            raise TooManyCategoriesError
        if _name_taken(existing, name, None):
            raise CategoryNameTakenError
        now = self._clock()
        position = max((c.position for c in existing), default=-1) + 1
        category = Category(uuid.uuid4(), workspace_id, name, color, True, position, now, now)
        try:
            await self._calendar.add_category(category)
            await self._transaction.commit()
        except ConflictError:
            await self._transaction.rollback()
            raise CategoryNameTakenError from None
        return category

    async def update_category(
        self,
        workspace_id: uuid.UUID,
        category_id: uuid.UUID,
        *,
        name: str | None = None,
        color: CategoryColor | None = None,
        is_visible: bool | None = None,
    ) -> Category:
        category = await self._require_category(workspace_id, category_id)
        if name is not None and _name_taken(
            await self._calendar.categories(workspace_id), name, category_id
        ):
            raise CategoryNameTakenError
        updated = replace(
            category,
            name=category.name if name is None else name,
            color=category.color if color is None else color,
            is_visible=category.is_visible if is_visible is None else is_visible,
        )
        if updated == category:
            return category
        updated = replace(updated, updated_at=self._clock())
        try:
            await self._calendar.save_category(updated)
            await self._transaction.commit()
        except ConflictError:
            await self._transaction.rollback()
            raise CategoryNameTakenError from None
        return updated

    async def delete_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> None:
        if not await self._calendar.delete_category(workspace_id, category_id):
            raise CategoryNotFoundError
        await self._transaction.commit()

    # Events

    async def create_event(
        self, workspace_id: uuid.UUID, draft: EventDraft, *, default_timezone: str | None
    ) -> EventDetail:
        now = self._clock()
        if draft.category_id is not None:
            await self._require_category(workspace_id, draft.category_id)
        for note_id in draft.note_ids:
            await self._require_note(workspace_id, note_id)
        for task_id in draft.task_ids:
            await self._require_task(workspace_id, task_id)
        event = CalendarEvent(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            title=draft.title,
            description=draft.description,
            location=draft.location,
            category_id=draft.category_id,
            all_day=draft.all_day,
            timezone=draft.timezone or default_timezone or DEFAULT_TIMEZONE,
            start=draft.start,
            end=draft.end,
            recurrence=draft.recurrence,
            status=draft.status,
            series_id=None,
            created_at=now,
            updated_at=now,
        )
        _check_event(event)
        await self._calendar.add_event(event, _bounds(event))
        for note_id in dict.fromkeys(draft.note_ids):
            await self._calendar.link_note(workspace_id, event.id, note_id)
        for task_id in dict.fromkeys(draft.task_ids):
            await self._calendar.link_task(workspace_id, event.id, task_id)
        await self._calendar.set_alerts(workspace_id, event.id, sorted(set(draft.alerts)))
        await self._sync_alerts(event, now)
        await self._transaction.commit()
        return await self.get_event(workspace_id, event.id)

    async def get_event(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> EventDetail:
        event = await self._require_event(workspace_id, event_id)
        exceptions = (await self._calendar.exceptions(workspace_id, [event.id])).get(event.id, {})
        # Look from the series' first occurrence if it hasn't started yet.
        begin = max(self._clock(), _bounds(event).start_at)
        upcoming = expand(event, exceptions, begin, begin + _ALERT_HORIZON)
        return EventDetail(
            event=event,
            alerts=tuple(
                a.minutes_before for a in await self._calendar.alerts(workspace_id, event.id)
            ),
            notes=await self._calendar.linked_notes(workspace_id, event.id),
            tasks=await self._calendar.linked_tasks(workspace_id, event.id),
            next_occurrence=upcoming[0] if upcoming else None,
        )

    async def find_events(self, workspace_id: uuid.UUID, query: EventQuery) -> EventPage:
        return await self._calendar.find_events(workspace_id, query)

    async def update_event(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, changes: EventChanges
    ) -> EventDetail:
        event = await self._require_event(workspace_id, event_id)
        if changes.category_id is not UNSET and changes.category_id is not None:
            await self._require_category(workspace_id, changes.category_id)
        updated = _apply(event, changes)
        now = self._clock()
        if updated != event:
            if changes.touches_timing() and _timing(updated) != _timing(event):
                # Original starts may no longer exist; one-off changes go with them.
                await self._calendar.delete_exceptions(workspace_id, event.id)
            updated = replace(updated, updated_at=now)
            await self._calendar.save_event(updated, _bounds(updated))
        if changes.alerts is not UNSET:
            await self._calendar.set_alerts(workspace_id, event.id, sorted(set(changes.alerts)))
        await self._sync_alerts(updated, now)
        await self._transaction.commit()
        return await self.get_event(workspace_id, event.id)

    async def delete_event(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> None:
        """Delete the event or whole series. Its alerts' reminders go with it (cascade)."""
        if not await self._calendar.delete_event(workspace_id, event_id):
            raise EventNotFoundError
        await self._transaction.commit()

    async def duplicate_event(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> EventDetail:
        """Copy the event or series, with its alerts and links but not its exceptions."""
        detail = await self.get_event(workspace_id, event_id)
        source = detail.event
        return await self.create_event(
            workspace_id,
            EventDraft(
                title=source.title,
                start=source.start,
                end=source.end,
                timezone=source.timezone,
                all_day=source.all_day,
                description=source.description,
                location=source.location,
                category_id=source.category_id,
                recurrence=source.recurrence,
                status=source.status,
                alerts=detail.alerts,
                note_ids=tuple(note.id for note in detail.notes),
                task_ids=tuple(task.id for task in detail.tasks),
            ),
            default_timezone=None,
        )

    async def update_occurrence(
        self,
        workspace_id: uuid.UUID,
        event_id: uuid.UUID,
        original_start: datetime,
        scope: EditScope,
        changes: OccurrenceChanges,
    ) -> EventDetail:
        """Change one occurrence, it and the following ones, or the whole series. Returns the
        event that now holds the occurrence (a new series for `following`)."""
        event = await self._require_event(workspace_id, event_id)
        await self._require_occurrence(event, original_start)
        if changes.category_id is not UNSET and changes.category_id is not None:
            await self._require_category(workspace_id, changes.category_id)
        if (
            event.recurrence is None
            or scope == "series"
            or (scope == "following" and original_start == event.start)
        ):
            return await self.update_event(
                workspace_id, event_id, _series_changes(event, original_start, changes)
            )
        if scope == "this":
            return await self._change_one(event, original_start, changes)
        return await self._split(event, original_start, changes)

    async def delete_occurrence(
        self,
        workspace_id: uuid.UUID,
        event_id: uuid.UUID,
        original_start: datetime,
        scope: EditScope,
    ) -> None:
        event = await self._require_event(workspace_id, event_id)
        await self._require_occurrence(event, original_start)
        rule = event.recurrence
        if (
            rule is None
            or scope == "series"
            or (scope == "following" and original_start == event.start)
        ):
            await self.delete_event(workspace_id, event_id)
            return
        now = self._clock()
        if scope == "this":
            await self._calendar.put_exception(
                EventException(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    event_id=event.id,
                    original_start=original_start,
                    kind="skipped",
                ),
                None,
            )
            updated = replace(event, updated_at=now)
        else:
            truncated = truncate_before(rule, event.start, original_start)
            if truncated is None:
                await self.delete_event(workspace_id, event_id)
                return
            await self._calendar.delete_exceptions(
                workspace_id, event.id, from_start=original_start
            )
            updated = replace(event, recurrence=truncated, updated_at=now)
        await self._calendar.save_event(updated, _bounds(updated))
        await self._sync_alerts(updated, now)
        await self._transaction.commit()

    # Views

    async def range(self, workspace_id: uuid.UUID, window: DateWindow) -> CalendarRange:
        """Occurrences and tasks for local dates `[start, end)` in the viewer's time zone.

        Timed occurrences and scheduled tasks are matched by instant; all-day occurrences by
        date, so an all-day event shows on its dates for any viewer. Events in hidden
        categories are left out."""
        start, end = window_instants(window.start, window.end, window.timezone)
        hidden = await self._hidden_categories(workspace_id)
        occurrences: list[EventOccurrence] = []
        for occurrence in await self._expand(workspace_id, *widen(start, end)):
            if occurrence.category_id in hidden:
                continue
            if occurrence.event.all_day:
                if in_date_window(occurrence, window.start, window.end):
                    occurrences.append(occurrence)
            elif occurrence.start_at < end and (
                occurrence.end_at > start or occurrence.start_at >= start
            ):
                occurrences.append(occurrence)
        scheduled: list[Task] = []
        due: list[Task] = []
        if window.include_tasks:
            scheduled = await self._calendar.scheduled_tasks(
                workspace_id, start, end, window.include_completed_tasks
            )
            due = await self._calendar.due_tasks(
                workspace_id, window.start, window.end, window.include_completed_tasks
            )
        return CalendarRange(occurrences=occurrences, scheduled_tasks=scheduled, due_tasks=due)

    async def agenda(
        self,
        workspace_id: uuid.UUID,
        start: datetime,
        limit: int,
        cursor: str | None = None,
        include_tasks: bool = True,
    ) -> AgendaPage:
        """Occurrences and open scheduled tasks that haven't ended by `start`, in order, a page
        at a time. Looks at most `AGENDA_HORIZON` ahead."""
        after = decode_cursor(cursor) if cursor else None
        hidden = await self._hidden_categories(workspace_id)
        items: list[AgendaItem] = []
        for step in _AGENDA_STEPS:
            end = start + step
            items = []
            for occurrence in await self._expand(workspace_id, start, end):
                if occurrence.category_id in hidden or occurrence.status == "cancelled":
                    continue
                items.append(
                    AgendaItem(
                        start_at=occurrence.start_at,
                        sort_key=_agenda_key(occurrence),
                        occurrence=occurrence,
                    )
                )
            if include_tasks:
                for task in await self._calendar.scheduled_tasks(workspace_id, start, end, False):
                    assert task.scheduled_start is not None
                    items.append(
                        AgendaItem(
                            start_at=task.scheduled_start, sort_key=f"2:{task.id}", task=task
                        )
                    )
            items.sort(key=lambda item: (item.start_at, item.sort_key))
            if after is not None:
                items = [item for item in items if (item.start_at, item.sort_key) > after]
            if len(items) > limit:
                break
        page = items[:limit]
        more = len(items) > limit
        last = page[-1] if page else None
        return AgendaPage(
            items=page,
            next_cursor=encode_cursor(last.start_at, last.sort_key) if more and last else None,
        )

    # Links

    async def link_note(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, note_id: uuid.UUID
    ) -> None:
        await self._require_event(workspace_id, event_id)
        await self._require_note(workspace_id, note_id)
        await self._calendar.link_note(workspace_id, event_id, note_id)
        await self._transaction.commit()

    async def unlink_note(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, note_id: uuid.UUID
    ) -> None:
        await self._require_event(workspace_id, event_id)
        await self._calendar.unlink_note(workspace_id, event_id, note_id)
        await self._transaction.commit()

    async def link_task(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, task_id: uuid.UUID
    ) -> None:
        await self._require_event(workspace_id, event_id)
        await self._require_task(workspace_id, task_id)
        await self._calendar.link_task(workspace_id, event_id, task_id)
        await self._transaction.commit()

    async def unlink_task(
        self, workspace_id: uuid.UUID, event_id: uuid.UUID, task_id: uuid.UUID
    ) -> None:
        await self._require_event(workspace_id, event_id)
        await self._calendar.unlink_task(workspace_id, event_id, task_id)
        await self._transaction.commit()

    # Alerts

    async def after_delivery(self, reminder: Reminder, now: datetime) -> None:
        """Point an alert's reminder at the next occurrence once it has fired. Called by the
        reminder worker inside its delivery transaction, which commits."""
        link = reminder.commitment
        if link is None or link.kind != "calendar_alert":
            return
        alert = await self._calendar.get_alert(reminder.workspace_id, link.id)
        if alert is None:
            return
        event = await self._calendar.get_event(reminder.workspace_id, alert.event_id)
        if event is None:
            return
        await self._point_alert(event, alert, await self._exceptions_of(event), now)

    async def _sync_alerts(self, event: CalendarEvent, now: datetime) -> None:
        exceptions = await self._exceptions_of(event)
        for alert in await self._calendar.alerts(event.workspace_id, event.id):
            await self._point_alert(event, alert, exceptions, now)

    async def _point_alert(
        self,
        event: CalendarEvent,
        alert: EventAlert,
        exceptions: dict[datetime, EventException],
        now: datetime,
    ) -> None:
        await point_reminder(
            self._reminders,
            self._occurrences,
            event.workspace_id,
            CommitmentLink(kind="calendar_alert", id=alert.id),
            alert_target(event, exceptions, alert.minutes_before, now),
            now,
        )

    # Helpers

    async def _change_one(
        self, event: CalendarEvent, original_start: datetime, changes: OccurrenceChanges
    ) -> EventDetail:
        current = (await self._exceptions_of(event)).get(original_start)
        base = current if current is not None and current.kind == "modified" else None
        duration = event.end - event.start
        # The occurrence's times now, then with the change. Moving keeps its length.
        now_start = base.start if base and base.start else original_start
        now_end = base.end if base and base.end else original_start + duration
        start = now_start if changes.start is UNSET else changes.start
        end = changes.end if changes.end is not UNSET else start + (now_end - now_start)
        _check_times(start, end, event.all_day)
        moved = (start, end) != (original_start, original_start + duration)
        exception = EventException(
            id=current.id if current else uuid.uuid4(),
            workspace_id=event.workspace_id,
            event_id=event.id,
            original_start=original_start,
            kind="modified",
            title=_override(changes.title, base.title if base else None, event.title),
            description=_override(
                changes.description, base.description if base else None, event.description
            ),
            location=_override(changes.location, base.location if base else None, event.location),
            category_id=_override(
                changes.category_id, base.category_id if base else None, event.category_id
            ),
            start=start if moved else None,
            end=end if moved else None,
            status=_override(changes.status, base.status if base else None, event.status),
        )
        zone = ZoneInfo(event.timezone)
        await self._calendar.put_exception(exception, (to_utc(start, zone), to_utc(end, zone)))
        now = self._clock()
        updated = replace(event, updated_at=now)
        await self._calendar.save_event(updated, _bounds(updated))
        await self._sync_alerts(updated, now)
        await self._transaction.commit()
        return await self.get_event(event.workspace_id, event.id)

    async def _split(
        self, event: CalendarEvent, original_start: datetime, changes: OccurrenceChanges
    ) -> EventDetail:
        """End the series before `original_start` and continue it, changed, as a new series."""
        rule = event.recurrence
        assert rule is not None
        truncated = truncate_before(rule, event.start, original_start)
        assert truncated is not None  # The first occurrence edits the whole series instead.
        now = self._clock()
        workspace_id = event.workspace_id
        detail = await self.get_event(workspace_id, event.id)
        await self._calendar.delete_exceptions(workspace_id, event.id, from_start=original_start)
        head = replace(event, recurrence=truncated, updated_at=now)
        await self._calendar.save_event(head, _bounds(head))
        await self._sync_alerts(head, now)

        duration = event.end - event.start
        start = original_start if changes.start is UNSET else changes.start
        end = start + duration if changes.end is UNSET else changes.end
        tail = CalendarEvent(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            title=event.title if changes.title is UNSET else changes.title,
            description=event.description if changes.description is UNSET else changes.description,
            location=event.location if changes.location is UNSET else changes.location,
            category_id=event.category_id if changes.category_id is UNSET else changes.category_id,
            all_day=event.all_day,
            timezone=event.timezone,
            start=start,
            end=end,
            recurrence=_shift_weekdays(
                remaining_from(rule, event.start, original_start),
                (start.date() - original_start.date()).days,
            ),
            status=event.status if changes.status is UNSET else changes.status,
            series_id=event.series_id or event.id,
            created_at=now,
            updated_at=now,
        )
        _check_event(tail)
        await self._calendar.add_event(tail, _bounds(tail))
        for note in detail.notes:
            await self._calendar.link_note(workspace_id, tail.id, note.id)
        for task in detail.tasks:
            await self._calendar.link_task(workspace_id, tail.id, task.id)
        await self._calendar.set_alerts(workspace_id, tail.id, detail.alerts)
        await self._sync_alerts(tail, now)
        await self._transaction.commit()
        return await self.get_event(workspace_id, tail.id)

    async def _expand(
        self, workspace_id: uuid.UUID, start: datetime, end: datetime
    ) -> list[EventOccurrence]:
        events = await self._calendar.events_in(workspace_id, start, end)
        exceptions = await self._calendar.exceptions(workspace_id, [e.id for e in events])
        occurrences = [
            occurrence
            for event in events
            for occurrence in expand(event, exceptions.get(event.id, {}), start, end)
        ]
        return sorted(occurrences, key=occurrence_order)

    async def _exceptions_of(self, event: CalendarEvent) -> dict[datetime, EventException]:
        return (await self._calendar.exceptions(event.workspace_id, [event.id])).get(event.id, {})

    async def _hidden_categories(self, workspace_id: uuid.UUID) -> set[uuid.UUID | None]:
        return {c.id for c in await self._calendar.categories(workspace_id) if not c.is_visible}

    async def _require_event(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> CalendarEvent:
        event = await self._calendar.get_event(workspace_id, event_id)
        if event is None:
            raise EventNotFoundError
        return event

    async def _require_occurrence(self, event: CalendarEvent, original_start: datetime) -> None:
        rule = event.recurrence
        if rule is None:
            if original_start != event.start:
                raise OccurrenceNotFoundError
        elif not is_occurrence(rule, event.start, original_start):
            raise OccurrenceNotFoundError

    async def _require_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> Category:
        category = await self._calendar.get_category(workspace_id, category_id)
        if category is None:
            raise CategoryNotFoundError
        return category

    async def _require_note(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> None:
        if not await self._calendar.note_exists(workspace_id, note_id):
            raise EventNoteNotFoundError

    async def _require_task(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> None:
        if await self._calendar.get_task(workspace_id, task_id) is None:
            raise EventTaskNotFoundError


class CalendarPreferenceService:
    """Per-user calendar settings. They follow the user across workspaces and devices."""

    def __init__(
        self,
        preferences: PreferenceRepository,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._preferences = preferences
        self._transaction = transaction
        self._clock = clock

    async def get(self, user_id: uuid.UUID) -> CalendarPreferences:
        return await self._preferences.get(user_id) or CalendarPreferences()

    async def put(
        self, user_id: uuid.UUID, preferences: CalendarPreferences
    ) -> CalendarPreferences:
        if preferences.working_hours_end <= preferences.working_hours_start:
            raise InvalidEventTimesError("Working hours must end after they start.")
        stored = replace(preferences, updated_at=self._clock())
        await self._preferences.put(user_id, stored)
        await self._transaction.commit()
        return stored


def alert_target(
    event: CalendarEvent,
    exceptions: dict[datetime, EventException],
    minutes_before: int,
    now: datetime,
) -> ReminderTarget | None:
    """What the alert should announce next: the earliest confirmed occurrence whose alert time is
    still ahead, or `None` (the series is cancelled, over, or has nothing within the horizon)."""
    if event.status == "cancelled":
        return None
    lead = timedelta(minutes=minutes_before)
    zone = ZoneInfo(event.timezone)
    best: tuple[datetime, EventOccurrence] | None = None
    begin = max(now, _bounds(event).start_at - lead)
    for occurrence in expand(event, exceptions, begin, begin + lead + _ALERT_HORIZON):
        if occurrence.status == "cancelled":
            continue
        base = (
            local_to_utc(occurrence.start.date(), ALL_DAY_ALERT_TIME, zone)
            if event.all_day
            else occurrence.start_at
        )
        at = base - lead
        if at > now and (best is None or at < best[0]):
            best = (at, occurrence)
    if best is None:
        return None
    at, occurrence = best
    at = at.astimezone(UTC)
    return ReminderTarget(
        schedule=Schedule(
            start_date=at.date(),
            time_of_day=at.time().replace(second=0, microsecond=0),
            timezone="UTC",
        ),
        title=occurrence.title,
        description=describe_occurrence(occurrence),
    )


def describe_occurrence(occurrence: EventOccurrence) -> str:
    """A short, locale-neutral description for a notification."""
    event = occurrence.event
    if event.all_day:
        when = f"{occurrence.start:%a %d %b %Y}, all day"
    else:
        when = f"{occurrence.start:%a %d %b %Y, %H:%M} to {occurrence.end:%H:%M} ({event.timezone})"
    return f"{when}\n{occurrence.location}" if occurrence.location else when


def encode_cursor(start_at: datetime, sort_key: str) -> str:
    raw = f"{start_at.astimezone(UTC).isoformat()}|{sort_key}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        instant, key = raw.split("|", 1)
        value = datetime.fromisoformat(instant)
    except (ValueError, UnicodeDecodeError, binascii.Error):
        raise InvalidCursorError from None
    if value.tzinfo is None or not key:
        raise InvalidCursorError
    return value, key


def _agenda_key(occurrence: EventOccurrence) -> str:
    # Events sort before tasks at the same instant; all-day first.
    return f"{0 if occurrence.event.all_day else 1}:{occurrence_key(occurrence)}"


def _name_taken(categories: Iterable[Category], name: str, own_id: uuid.UUID | None) -> bool:
    folded = " ".join(name.split()).casefold()
    return any(" ".join(c.name.split()).casefold() == folded and c.id != own_id for c in categories)


def _check_times(start: datetime, end: datetime, all_day: bool) -> None:
    if end < start:
        raise InvalidEventTimesError("The end can't be before the start.")
    if end - start > MAX_EVENT_LENGTH:
        raise InvalidEventTimesError("An event can last at most a year.")
    if all_day and (
        start.time() != datetime.min.time() or end.time() != datetime.min.time() or end <= start
    ):
        raise InvalidEventTimesError("All-day events run from midnight to midnight, a day or more.")


def _check_event(event: CalendarEvent) -> None:
    _check_times(event.start, event.end, event.all_day)
    if event.recurrence is not None:
        validate_rule(event.recurrence, event.start)
        if event.end - event.start > timedelta(days=1) * _min_gap_days(event.recurrence):
            raise InvalidEventTimesError("A repeating event must end before its next occurrence.")


def _min_gap_days(rule: EventRecurrence) -> int:
    """The fewest days between two of the rule's occurrences (approximately, for months)."""
    match rule.frequency:
        case "daily":
            return rule.interval
        case "weekly":
            days = sorted(WEEKDAYS.index(day) for day in rule.weekdays)
            if len(days) == 1:
                return 7 * rule.interval
            gaps = [b - a for a, b in pairwise(days)]
            return min([*gaps, days[0] + 7 - days[-1]])
        case "monthly":
            return 28 * rule.interval
        case "yearly":
            return 365 * rule.interval


def _apply(event: CalendarEvent, changes: EventChanges) -> CalendarEvent:
    updated = replace(
        event,
        title=event.title if changes.title is UNSET else changes.title,
        description=event.description if changes.description is UNSET else changes.description,
        location=event.location if changes.location is UNSET else changes.location,
        category_id=event.category_id if changes.category_id is UNSET else changes.category_id,
        all_day=event.all_day if changes.all_day is UNSET else changes.all_day,
        timezone=event.timezone if changes.timezone is UNSET else changes.timezone,
        start=event.start if changes.start is UNSET else changes.start,
        end=event.end if changes.end is UNSET else changes.end,
        recurrence=event.recurrence if changes.recurrence is UNSET else changes.recurrence,
        status=event.status if changes.status is UNSET else changes.status,
    )
    _check_event(updated)
    return updated


def _timing(event: CalendarEvent) -> tuple[object, ...]:
    return (event.all_day, event.timezone, event.start, event.end, event.recurrence)


def _series_changes(
    event: CalendarEvent, original_start: datetime, changes: OccurrenceChanges
) -> EventChanges:
    """An occurrence-level change applied to the whole series: moving the occurrence moves every
    occurrence by the same amount; resizing it resizes them all."""
    start: Change[datetime] = UNSET
    end: Change[datetime] = UNSET
    recurrence: Change[EventRecurrence | None] = UNSET
    series_start = event.start
    occurrence_start = original_start
    if changes.start is not UNSET:
        series_start = event.start + (changes.start - original_start)
        occurrence_start = changes.start
        start = series_start
        day_shift = (changes.start.date() - original_start.date()).days
        if event.recurrence is not None and day_shift % 7:
            recurrence = _shift_weekdays(event.recurrence, day_shift)
    if changes.end is not UNSET:
        end = series_start + (changes.end - occurrence_start)
    elif changes.start is not UNSET:
        end = series_start + (event.end - event.start)
    return EventChanges(
        title=changes.title,
        description=changes.description,
        location=changes.location,
        category_id=changes.category_id,
        status=changes.status,
        start=start,
        end=end,
        recurrence=recurrence,
    )


def _shift_weekdays(rule: EventRecurrence, days: int) -> EventRecurrence:
    """A weekly rule's weekdays moved by `days`, so moving a series keeps its pattern."""
    if rule.frequency != "weekly" or days % 7 == 0:
        return rule
    moved = frozenset(WEEKDAYS[(WEEKDAYS.index(day) + days) % 7] for day in rule.weekdays)
    return replace(rule, weekdays=moved)


def _override[T](change: Change[T], current: T | None, series: T) -> T | None:
    """The exception's stored override: `None` when it matches the series (so the occurrence
    follows later series changes)."""
    value = current if change is UNSET else change
    if value is None or value == series:
        return None
    return value


def _bounds(event: CalendarEvent) -> SeriesBounds:
    zone = ZoneInfo(event.timezone)
    start_at = to_utc(event.start, zone)
    end_at = to_utc(event.end, zone)
    rule = event.recurrence
    if rule is None:
        return SeriesBounds(start_at, end_at, end_at)
    last = last_start(rule, event.start)
    until_at = None if last is None else to_utc(last + (event.end - event.start), zone)
    return SeriesBounds(start_at, end_at, until_at)
