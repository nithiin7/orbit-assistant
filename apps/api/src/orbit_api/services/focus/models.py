"""Focus timer types."""

import uuid
from dataclasses import dataclass
from datetime import date, datetime

# A session shorter than a minute is a false start, not focus.
MIN_FOCUS_SECONDS = 60
# A focus session is a working block, not a whole day.
MAX_FOCUS_SECONDS = 4 * 60 * 60


@dataclass(frozen=True, slots=True)
class FocusSession:
    id: uuid.UUID
    workspace_id: uuid.UUID
    task_id: uuid.UUID
    started_at: datetime
    ended_at: datetime
    # Time spent focusing, without pauses.
    focused_seconds: int
    # The client's local date when the session started; it decides focus streaks.
    day: date
    # The timer ran to the end rather than being stopped early.
    completed: bool
    created_at: datetime


@dataclass(frozen=True, slots=True)
class FocusSessionDraft:
    started_at: datetime
    ended_at: datetime
    focused_seconds: int
    day: date
    completed: bool


@dataclass(frozen=True, slots=True)
class TaskFocus:
    task_id: uuid.UUID
    focused_seconds: int
    sessions: int


@dataclass(frozen=True, slots=True)
class FocusSummary:
    today_seconds: int
    today_sessions: int
    # Every task in the workspace with focus time, most focused first.
    tasks: tuple[TaskFocus, ...]


class InvalidFocusSessionError(ValueError):
    """The session's times don't add up."""
