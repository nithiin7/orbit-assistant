"""Focus sessions: time spent on a task with the focus timer. The timer runs in the browser;
the API records each finished or stopped session, and focus achievements count them.

Every method takes a `workspace_id` that the caller has already authorized, and repositories
filter every query by it, so a task in another workspace looks like one that doesn't exist.
"""

import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Protocol

from orbit_api.services.focus.models import (
    MAX_FOCUS_SECONDS,
    MIN_FOCUS_SECONDS,
    FocusSession,
    FocusSessionDraft,
    FocusSummary,
    InvalidFocusSessionError,
)
from orbit_api.services.tasks.models import Task, TaskNotFoundError
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now

# Room for a client clock that runs a little fast.
CLOCK_SKEW = timedelta(minutes=5)
# A session is recorded when it ends; one from long ago is not a timer's.
MAX_SESSION_AGE = timedelta(days=2)


class FocusRepository(Protocol):
    async def add(self, session: FocusSession) -> None: ...

    async def summary(self, workspace_id: uuid.UUID, today: date) -> FocusSummary: ...


class TaskLookup(Protocol):
    async def get(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task | None: ...


class FocusService:
    def __init__(
        self,
        sessions: FocusRepository,
        tasks: TaskLookup,
        transaction: Transaction,
        *,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._sessions = sessions
        self._tasks = tasks
        self._transaction = transaction
        self._clock = clock

    async def record(
        self, workspace_id: uuid.UUID, task_id: uuid.UUID, draft: FocusSessionDraft
    ) -> FocusSession:
        if await self._tasks.get(workspace_id, task_id) is None:
            raise TaskNotFoundError
        now = self._clock()
        _check(draft, now)
        session = FocusSession(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            task_id=task_id,
            started_at=draft.started_at,
            ended_at=draft.ended_at,
            focused_seconds=draft.focused_seconds,
            day=draft.day,
            completed=draft.completed,
            created_at=now,
        )
        await self._sessions.add(session)
        await self._transaction.commit()
        return session

    async def summary(self, workspace_id: uuid.UUID, today: date | None = None) -> FocusSummary:
        return await self._sessions.summary(workspace_id, today or self._clock().date())


def _check(draft: FocusSessionDraft, now: datetime) -> None:
    if draft.ended_at <= draft.started_at:
        raise InvalidFocusSessionError("A session must end after it starts.")
    if draft.ended_at > now + CLOCK_SKEW:
        raise InvalidFocusSessionError("A session can't end in the future.")
    if draft.started_at < now - MAX_SESSION_AGE:
        raise InvalidFocusSessionError("Only sessions from the last two days can be recorded.")
    if not MIN_FOCUS_SECONDS <= draft.focused_seconds <= MAX_FOCUS_SECONDS:
        raise InvalidFocusSessionError("A session is between one minute and four hours of focus.")
    # Pauses only ever shorten focus; a second of rounding is allowed.
    if draft.focused_seconds > (draft.ended_at - draft.started_at).total_seconds() + 1:
        raise InvalidFocusSessionError("Focus time can't be longer than the session.")
    # The local day is the UTC day give or take one, in any time zone.
    if abs((draft.day - draft.started_at.date()).days) > 1:
        raise InvalidFocusSessionError("The day doesn't match when the session started.")
