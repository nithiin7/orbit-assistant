"""Routines: ordered steps, sessions that run them, and reminder times.

- A routine's steps may link a habit, a task, or a note in the same workspace; the links are
  checked here, and clear by themselves when the item is deleted.
- **Sessions** are separate from the routine. Starting one copies the steps, so editing the
  routine later never changes a session's history. A routine has at most one active session
  (also enforced by a partial unique index). Steps are completed or skipped; the session is
  finished (`completed`) or `abandoned`, keeping whatever steps were done.
- Completing a step linked to a yes-or-no habit also completes that habit for the session's
  day (unless that day is already logged). Steps linked to other kinds of habit, and tasks, are
  left for the user to update, since there's no single right value to record.
- Reminder times work as for habits: on the routine's weekdays, skipping days that already have
  a completed session, and cancelled while the routine is paused or archived.
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import date, datetime
from typing import Literal, Protocol

from orbit_api.services.habits.insights import today_in
from orbit_api.services.habits.models import (
    MAX_STEPS,
    ActiveSessionExistsError,
    HabitCategoryNotFoundError,
    InvalidHabitError,
    LinkedItemNotFoundError,
    LogDraft,
    ReminderTime,
    Routine,
    RoutineChanges,
    RoutineDetail,
    RoutineDraft,
    RoutineNotFoundError,
    RoutineSession,
    RoutineStatus,
    RoutineStep,
    SessionFinishedError,
    SessionNotFoundError,
    SessionStep,
    StepDraft,
    StepStatus,
)
from orbit_api.services.habits.service import HabitService, HabitStore, check_reminder_times
from orbit_api.services.reminders.service import DEFAULT_TIMEZONE
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.changes import UNSET, Change
from orbit_api.utils.clock import utc_now


class RoutineStore(HabitStore, Protocol):
    async def add_routine(self, routine: Routine) -> None: ...

    async def save_routine(self, routine: Routine) -> None:
        """Store the routine's fields and make its steps exactly `routine.steps`."""
        ...

    async def delete_routine(self, workspace_id: uuid.UUID, routine_id: uuid.UUID) -> bool: ...

    async def habit_exists(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> bool: ...

    async def add_session(self, session: RoutineSession) -> None: ...

    async def save_session(self, session: RoutineSession) -> None:
        """Store the session's status, times, notes, and its steps' statuses."""
        ...

    async def get_session(
        self, workspace_id: uuid.UUID, session_id: uuid.UUID
    ) -> RoutineSession | None: ...

    async def active_session(
        self, workspace_id: uuid.UUID, routine_id: uuid.UUID
    ) -> RoutineSession | None: ...

    async def sessions(
        self, workspace_id: uuid.UUID, routine_id: uuid.UUID, limit: int, offset: int
    ) -> tuple[list[RoutineSession], int]:
        """Newest first, and how many there are."""
        ...

    async def completed_sessions(self, workspace_id: uuid.UUID, routine_id: uuid.UUID) -> int: ...


class RoutineService:
    def __init__(
        self,
        store: RoutineStore,
        habits: HabitService,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._habits = habits
        self._transaction = transaction
        self._clock = clock

    async def find(
        self, workspace_id: uuid.UUID, statuses: Sequence[RoutineStatus] | None
    ) -> list[RoutineDetail]:
        return [await self._detail(r) for r in await self._store.routines(workspace_id, statuses)]

    async def get(self, workspace_id: uuid.UUID, routine_id: uuid.UUID) -> RoutineDetail:
        return await self._detail(await self._require(workspace_id, routine_id))

    async def create(
        self, workspace_id: uuid.UUID, draft: RoutineDraft, *, default_timezone: str | None
    ) -> RoutineDetail:
        now = self._clock()
        await self._require_category(workspace_id, draft.category_id)
        check_reminder_times(draft.reminders)
        routine = Routine(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            category_id=draft.category_id,
            name=draft.name,
            description=draft.description,
            icon=draft.icon,
            color=draft.color,
            time_of_day=draft.time_of_day,
            weekdays=draft.weekdays,
            timezone=draft.timezone or default_timezone or DEFAULT_TIMEZONE,
            status="active",
            steps=await self._steps(workspace_id, draft.steps, ()),
            created_at=now,
            updated_at=now,
        )
        await self._store.add_routine(routine)
        await self._store.set_reminder_times(workspace_id, draft.reminders, routine_id=routine.id)
        await self._habits.reminders.sync_routine(routine)
        await self._transaction.commit()
        return await self.get(workspace_id, routine.id)

    async def update(
        self, workspace_id: uuid.UUID, routine_id: uuid.UUID, changes: RoutineChanges
    ) -> RoutineDetail:
        routine = await self._require(workspace_id, routine_id)
        if changes.category_id is not UNSET:
            await self._require_category(workspace_id, changes.category_id)
        c = changes
        updated = replace(
            routine,
            name=routine.name if c.name is UNSET else c.name,
            description=routine.description if c.description is UNSET else c.description,
            category_id=routine.category_id if c.category_id is UNSET else c.category_id,
            icon=routine.icon if c.icon is UNSET else c.icon,
            color=routine.color if c.color is UNSET else c.color,
            time_of_day=routine.time_of_day if c.time_of_day is UNSET else c.time_of_day,
            weekdays=routine.weekdays if c.weekdays is UNSET else c.weekdays,
            timezone=routine.timezone if c.timezone is UNSET else c.timezone,
            status=routine.status if c.status is UNSET else c.status,
            steps=(
                routine.steps
                if c.steps is UNSET
                else await self._steps(workspace_id, c.steps, routine.steps)
            ),
        )
        if updated == routine:
            return await self._detail(routine)
        updated = replace(updated, updated_at=self._clock())
        await self._store.save_routine(updated)
        await self._habits.reminders.sync_routine(updated)
        await self._transaction.commit()
        return await self.get(workspace_id, routine_id)

    async def delete(self, workspace_id: uuid.UUID, routine_id: uuid.UUID) -> None:
        """Delete the routine with its sessions and reminders."""
        if not await self._store.delete_routine(workspace_id, routine_id):
            raise RoutineNotFoundError
        await self._transaction.commit()

    async def set_reminders(
        self, workspace_id: uuid.UUID, routine_id: uuid.UUID, times: Sequence[ReminderTime]
    ) -> RoutineDetail:
        routine = await self._require(workspace_id, routine_id)
        check_reminder_times(times)
        await self._store.set_reminder_times(workspace_id, times, routine_id=routine_id)
        await self._habits.reminders.sync_routine(routine)
        await self._transaction.commit()
        return await self.get(workspace_id, routine_id)

    # Sessions

    async def start(
        self, workspace_id: uuid.UUID, routine_id: uuid.UUID, day: date | None
    ) -> RoutineSession:
        """Start a session for `day` (today in the routine's time zone by default), copying the
        routine's steps. Raises `ActiveSessionExistsError` if one is already running."""
        routine = await self._require(workspace_id, routine_id)
        active = await self._store.active_session(workspace_id, routine_id)
        if active is not None:
            raise ActiveSessionExistsError(active.id)
        now = self._clock()
        session = RoutineSession(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            routine_id=routine_id,
            day=day or today_in(routine.timezone, now),
            routine_name=routine.name,
            status="active",
            started_at=now,
            finished_at=None,
            notes="",
            note_id=None,
            steps=tuple(
                SessionStep(
                    id=uuid.uuid4(),
                    position=step.position,
                    name=step.name,
                    duration_minutes=step.duration_minutes,
                    habit_id=step.habit_id,
                    task_id=step.task_id,
                    status="pending",
                    completed_at=None,
                )
                for step in routine.steps
            ),
        )
        try:
            await self._store.add_session(session)
            await self._transaction.commit()
        except ConflictError:
            # A concurrent request started one first.
            await self._transaction.rollback()
            existing = await self._store.active_session(workspace_id, routine_id)
            raise ActiveSessionExistsError(existing.id if existing else session.id) from None
        return session

    async def sessions(
        self, workspace_id: uuid.UUID, routine_id: uuid.UUID, limit: int, offset: int
    ) -> tuple[list[RoutineSession], int]:
        await self._require(workspace_id, routine_id)
        return await self._store.sessions(workspace_id, routine_id, limit, offset)

    async def get_session(
        self, workspace_id: uuid.UUID, routine_id: uuid.UUID, session_id: uuid.UUID
    ) -> RoutineSession:
        session = await self._store.get_session(workspace_id, session_id)
        if session is None or session.routine_id != routine_id:
            raise SessionNotFoundError
        return session

    async def set_step(
        self,
        workspace_id: uuid.UUID,
        routine_id: uuid.UUID,
        session_id: uuid.UUID,
        step_id: uuid.UUID,
        status: StepStatus,
    ) -> RoutineSession:
        session = await self._require_active(workspace_id, routine_id, session_id)
        step = next((s for s in session.steps if s.id == step_id), None)
        if step is None:
            raise SessionNotFoundError
        now = self._clock()
        changed = replace(step, status=status, completed_at=now if status == "completed" else None)
        session = replace(
            session, steps=tuple(changed if s.id == step_id else s for s in session.steps)
        )
        await self._store.save_session(session)
        if status == "completed" and step.habit_id is not None:
            await self._complete_habit(workspace_id, step.habit_id, session.day)
        await self._transaction.commit()
        return session

    async def update_session(
        self,
        workspace_id: uuid.UUID,
        routine_id: uuid.UUID,
        session_id: uuid.UUID,
        *,
        status: Literal["completed", "abandoned"] | None = None,
        notes: str | None = None,
        note_id: Change[uuid.UUID | None] = UNSET,
    ) -> RoutineSession:
        """Finish (`completed`) or abandon an active session, and edit its notes or linked note
        at any time."""
        session = await self.get_session(workspace_id, routine_id, session_id)
        if status is not None:
            if session.status != "active":
                raise SessionFinishedError
            session = replace(session, status=status, finished_at=self._clock())
        if notes is not None:
            session = replace(session, notes=notes)
        if note_id is not UNSET:
            if note_id is not None and not await self._store.note_exists(workspace_id, note_id):
                raise LinkedItemNotFoundError("note")
            session = replace(session, note_id=note_id)
        await self._store.save_session(session)
        if status is not None:
            routine = await self._require(workspace_id, routine_id)
            await self._habits.reminders.sync_routine(routine)
        await self._transaction.commit()
        return session

    # Helpers

    async def _complete_habit(
        self, workspace_id: uuid.UUID, habit_id: uuid.UUID, day: date
    ) -> None:
        habit = await self._store.get_habit(workspace_id, habit_id)
        if habit is None or habit.kind != "boolean":
            return
        logged = (await self._store.logs(workspace_id, [habit_id], day, day)).get(habit_id)
        if logged or day < habit.start_date or day > today_in(habit.timezone, self._clock()):
            return
        await self._habits.record(habit, day, LogDraft(status="completed"))

    async def _detail(self, routine: Routine) -> RoutineDetail:
        workspace_id = routine.workspace_id
        recent, _ = await self._store.sessions(workspace_id, routine.id, 1, 0)
        return RoutineDetail(
            routine=routine,
            reminders=await self._store.reminder_times(workspace_id, routine_id=routine.id),
            active_session=await self._store.active_session(workspace_id, routine.id),
            last_session=recent[0] if recent else None,
            sessions_completed=await self._store.completed_sessions(workspace_id, routine.id),
        )

    async def _steps(
        self,
        workspace_id: uuid.UUID,
        drafts: Sequence[StepDraft],
        existing: Sequence[RoutineStep],
    ) -> tuple[RoutineStep, ...]:
        if len(drafts) > MAX_STEPS:
            raise InvalidHabitError(f"A routine can have at most {MAX_STEPS} steps.")
        known = {step.id for step in existing}
        ids = [d.id for d in drafts if d.id is not None]
        if len(set(ids)) != len(ids):
            raise InvalidHabitError("A step can appear only once.")
        steps: list[RoutineStep] = []
        for position, draft in enumerate(drafts):
            if draft.id is not None and draft.id not in known:
                raise InvalidHabitError("That step isn't part of this routine.")
            if draft.habit_id and not await self._store.habit_exists(workspace_id, draft.habit_id):
                raise LinkedItemNotFoundError("habit")
            if draft.task_id and not await self._store.task_exists(workspace_id, draft.task_id):
                raise LinkedItemNotFoundError("task")
            if draft.note_id and not await self._store.note_exists(workspace_id, draft.note_id):
                raise LinkedItemNotFoundError("note")
            steps.append(
                RoutineStep(
                    id=draft.id or uuid.uuid4(),
                    position=position,
                    name=draft.name,
                    description=draft.description,
                    duration_minutes=draft.duration_minutes,
                    habit_id=draft.habit_id,
                    task_id=draft.task_id,
                    note_id=draft.note_id,
                )
            )
        return tuple(steps)

    async def _require(self, workspace_id: uuid.UUID, routine_id: uuid.UUID) -> Routine:
        routine = await self._store.get_routine(workspace_id, routine_id)
        if routine is None:
            raise RoutineNotFoundError
        return routine

    async def _require_active(
        self, workspace_id: uuid.UUID, routine_id: uuid.UUID, session_id: uuid.UUID
    ) -> RoutineSession:
        session = await self.get_session(workspace_id, routine_id, session_id)
        if session.status != "active":
            raise SessionFinishedError
        return session

    async def _require_category(
        self, workspace_id: uuid.UUID, category_id: uuid.UUID | None
    ) -> None:
        if category_id is None:
            return
        if not any(c.id == category_id for c in await self._store.categories(workspace_id)):
            raise HabitCategoryNotFoundError
