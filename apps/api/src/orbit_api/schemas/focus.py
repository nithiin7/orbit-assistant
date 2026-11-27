"""Focus timer models."""

import uuid
from datetime import UTC, date, datetime
from typing import Annotated

from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field

from orbit_api.services.focus.models import (
    MAX_FOCUS_SECONDS,
    MIN_FOCUS_SECONDS,
    FocusSession,
    FocusSessionDraft,
    FocusSummary,
)


def _as_utc(value: datetime) -> datetime:
    return value.astimezone(UTC)


UtcDatetime = Annotated[AwareDatetime, AfterValidator(_as_utc)]


class RecordFocusSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    started_at: UtcDatetime
    ended_at: UtcDatetime
    focused_seconds: int = Field(
        ge=MIN_FOCUS_SECONDS,
        le=MAX_FOCUS_SECONDS,
        description="Time spent focusing, without pauses: at most the time between start and end.",
    )
    day: date = Field(description="The client's local date when the session started.")
    completed: bool = Field(description="Whether the timer ran to the end.")

    def to_draft(self) -> FocusSessionDraft:
        return FocusSessionDraft(
            started_at=self.started_at,
            ended_at=self.ended_at,
            focused_seconds=self.focused_seconds,
            day=self.day,
            completed=self.completed,
        )


class FocusSessionResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    started_at: datetime
    ended_at: datetime
    focused_seconds: int
    day: date
    completed: bool
    created_at: datetime

    @classmethod
    def of(cls, session: FocusSession) -> "FocusSessionResponse":
        return cls(
            id=session.id,
            task_id=session.task_id,
            started_at=session.started_at,
            ended_at=session.ended_at,
            focused_seconds=session.focused_seconds,
            day=session.day,
            completed=session.completed,
            created_at=session.created_at,
        )


class FocusSummaryParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    today: date | None = Field(
        default=None,
        description="The client's local date, which decides what counts as today. Defaults to "
        "today's date in UTC.",
    )


class TaskFocusResponse(BaseModel):
    task_id: uuid.UUID
    focused_seconds: int
    sessions: int


class FocusSummaryResponse(BaseModel):
    today_seconds: int
    today_sessions: int
    tasks: list[TaskFocusResponse] = Field(
        description="Every task in the workspace with focus time, most focused first."
    )

    @classmethod
    def of(cls, summary: FocusSummary) -> "FocusSummaryResponse":
        return cls(
            today_seconds=summary.today_seconds,
            today_sessions=summary.today_sessions,
            tasks=[
                TaskFocusResponse(
                    task_id=task.task_id,
                    focused_seconds=task.focused_seconds,
                    sessions=task.sessions,
                )
                for task in summary.tasks
            ],
        )
