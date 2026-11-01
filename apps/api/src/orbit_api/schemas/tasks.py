"""Task models."""

import uuid
from datetime import date, datetime
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import SearchText, multi_line, single_line
from orbit_api.services.tasks.models import (
    Task,
    TaskChanges,
    TaskDraft,
    TaskPriority,
    TaskQuery,
    TaskSchedule,
    TaskSort,
    TaskStatus,
    TaskSummary,
)
from orbit_api.utils.changes import UNSET
from orbit_api.utils.sorting import SortOrder

TITLE_MAX_LENGTH = 200
DESCRIPTION_MAX_LENGTH = 5000
PAGE_MAX_SIZE = 500

Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=TITLE_MAX_LENGTH),
    AfterValidator(single_line),
]
Description = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=DESCRIPTION_MAX_LENGTH),
    AfterValidator(multi_line),
]


class TaskResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    description: str = Field(description="Empty when the task has no description.")
    status: TaskStatus
    priority: TaskPriority
    due_date: date | None = Field(description="A calendar date, without a time or time zone.")
    completed_at: datetime | None = Field(description="When the task was completed, if it is.")
    scheduled_start: datetime | None = Field(
        description="When the task is planned to be worked on (a calendar time block), separate "
        "from the due date. Set together with `scheduled_end`."
    )
    scheduled_end: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, task: Task) -> "TaskResponse":
        return cls(
            id=task.id,
            workspace_id=task.workspace_id,
            title=task.title,
            description=task.description,
            status=task.status,
            priority=task.priority,
            due_date=task.due_date,
            completed_at=task.completed_at,
            scheduled_start=task.scheduled_start,
            scheduled_end=task.scheduled_end,
            created_at=task.created_at,
            updated_at=task.updated_at,
        )


class TaskListResponse(BaseModel):
    tasks: list[TaskResponse]
    total: int = Field(description="Tasks matching the filters, across all pages.")


class TaskListParams(BaseModel):
    """Filters, sorting, and paging for listing tasks."""

    model_config = ConfigDict(extra="forbid")

    status: TaskStatus | None = Field(default=None, description="Omit for both statuses.")
    priority: list[TaskPriority] = Field(
        default_factory=list[TaskPriority],
        description="Repeat to match any of several priorities. Omit for all.",
    )
    q: SearchText = Field(
        default=None, description="Case-insensitive text to find in titles and descriptions."
    )
    scheduled: bool | None = Field(
        default=None,
        description="`true` for tasks with a scheduled time, `false` for tasks without one.",
    )
    sort: TaskSort = "created_at"
    order: SortOrder | None = Field(
        default=None,
        description="Defaults to the sort's natural order: soonest due date, highest priority, "
        "or newest. Tasks without a due date always come last.",
    )
    limit: int = Field(default=100, ge=1, le=PAGE_MAX_SIZE)
    offset: int = Field(default=0, ge=0)

    def to_query(self) -> TaskQuery:
        return TaskQuery(
            status=self.status,
            priorities=frozenset(self.priority),
            search=self.q,
            scheduled=self.scheduled,
            sort=self.sort,
            order=self.order,
            limit=self.limit,
            offset=self.offset,
        )


class TaskSummaryParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    today: date | None = Field(
        default=None,
        description="The client's local date, which decides what is overdue or due today. "
        "Defaults to today's date in UTC.",
    )


class TaskSummaryResponse(BaseModel):
    open: int
    completed: int
    overdue: int = Field(description="Open tasks due before today.")
    due_today: int = Field(description="Open tasks due today.")

    @classmethod
    def of(cls, summary: TaskSummary) -> "TaskSummaryResponse":
        return cls(
            open=summary.open,
            completed=summary.completed,
            overdue=summary.overdue,
            due_today=summary.due_today,
        )


class CreateTaskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    description: Description = ""
    priority: TaskPriority = "none"
    due_date: date | None = None
    scheduled_start: AwareDatetime | None = None
    scheduled_end: AwareDatetime | None = None

    @model_validator(mode="after")
    def _check_schedule(self) -> Self:
        if (self.scheduled_start is None) != (self.scheduled_end is None):
            raise ValueError("set scheduled_start and scheduled_end together")
        return self

    def to_draft(self) -> TaskDraft:
        return TaskDraft(
            title=self.title,
            description=self.description,
            priority=self.priority,
            due_date=self.due_date,
            schedule=_schedule(self.scheduled_start, self.scheduled_end),
        )


class UpdateTaskRequest(BaseModel):
    """Change some of a task's fields. Omitted fields keep their values; `due_date: null` clears
    the due date. Completion has its own endpoints."""

    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    description: Description | None = None
    priority: TaskPriority | None = None
    due_date: date | None = None
    scheduled_start: AwareDatetime | None = Field(
        default=None, description="Change with `scheduled_end`; both `null` unschedules the task."
    )
    scheduled_end: AwareDatetime | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        schedule = {"scheduled_start", "scheduled_end"} & self.model_fields_set
        if len(schedule) == 1 or (self.scheduled_start is None) != (self.scheduled_end is None):
            raise ValueError("change scheduled_start and scheduled_end together")
        for name in ("title", "description", "priority"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> TaskChanges:
        provided = self.model_fields_set
        return TaskChanges(
            title=self.title if self.title is not None else UNSET,
            description=self.description if self.description is not None else UNSET,
            priority=self.priority if self.priority is not None else UNSET,
            due_date=self.due_date if "due_date" in provided else UNSET,
            schedule=(
                _schedule(self.scheduled_start, self.scheduled_end)
                if "scheduled_start" in provided
                else UNSET
            ),
        )


def _schedule(start: datetime | None, end: datetime | None) -> TaskSchedule | None:
    return TaskSchedule(start=start, end=end) if start is not None and end is not None else None
