"""Dashboard models: the per-user layout and the daily overview."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from orbit_api.schemas.calendar import OccurrenceResponse
from orbit_api.schemas.common import TimeZoneName
from orbit_api.schemas.tasks import TaskResponse
from orbit_api.services.commitments.models import CommitmentKind, PaymentStatus
from orbit_api.services.dashboard.models import (
    WIDGET_IDS,
    DashboardLayout,
    DashboardWidget,
    Density,
    WidgetId,
    WidgetSize,
)
from orbit_api.services.dashboard.today import (
    DailyOverview,
    DocumentSection,
    EventSection,
    HabitSection,
    PaymentSection,
    ReminderSection,
    TaskSection,
)
from orbit_api.services.dashboard.today import Section as OverviewSection


class DashboardWidgetModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: WidgetId
    size: WidgetSize = Field(description="`half` widgets sit side by side on wide screens.")

    def to_widget(self) -> DashboardWidget:
        return DashboardWidget(id=self.id, size=self.size)


class DashboardLayoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    widgets: list[DashboardWidgetModel] = Field(
        max_length=len(WIDGET_IDS),
        description="The widgets to show, in order. Each widget may appear once; an empty list "
        "is an empty dashboard.",
    )
    density: Density = Field(
        default="comfortable", description="`compact` tightens spacing so more fits on screen."
    )
    hide_amounts: bool = Field(
        default=False, description="Hide money amounts on the dashboard, shown as dots instead."
    )


class DashboardLayoutResponse(BaseModel):
    widgets: list[DashboardWidgetModel]
    density: Density
    hide_amounts: bool
    updated_at: datetime

    @classmethod
    def of(cls, layout: DashboardLayout) -> "DashboardLayoutResponse":
        return cls(
            widgets=[
                DashboardWidgetModel(id=widget.id, size=widget.size) for widget in layout.widgets
            ],
            density=layout.density,
            hide_amounts=layout.hide_amounts,
            updated_at=layout.updated_at,
        )


# The daily overview


class TodayOverviewParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timezone: TimeZoneName | None = Field(
        default=None, description="Where today is. Defaults to the user's preference, else UTC."
    )
    section: list[OverviewSection] = Field(
        default_factory=list[OverviewSection],
        description="Repeat to load only some sections, to refresh one widget. Omit for all.",
    )


class OverviewTasksResponse(BaseModel):
    open: int
    overdue: int = Field(description="Open tasks due before today.")
    due_today: int
    overdue_items: list[TaskResponse] = Field(description="The most overdue first, at most 5.")
    due_today_items: list[TaskResponse] = Field(description="Highest priority first, at most 5.")

    @classmethod
    def of(cls, section: TaskSection) -> "OverviewTasksResponse":
        return cls(
            open=section.summary.open,
            overdue=section.summary.overdue,
            due_today=section.summary.due_today,
            overdue_items=[TaskResponse.of(task) for task in section.overdue],
            due_today_items=[TaskResponse.of(task) for task in section.due_today],
        )


class OverviewEventsResponse(BaseModel):
    today: list[OccurrenceResponse] = Field(
        description="Today's occurrences that aren't cancelled: all-day ones first, then by start."
    )
    next: OccurrenceResponse | None = Field(
        description="The next timed occurrence that hasn't started, within 7 days."
    )

    @classmethod
    def of(cls, section: EventSection) -> "OverviewEventsResponse":
        return cls(
            today=[OccurrenceResponse.of(item) for item in section.today],
            next=OccurrenceResponse.of(section.next) if section.next else None,
        )


class OverviewReminderResponse(BaseModel):
    id: uuid.UUID
    title: str
    next_occurrence_at: datetime
    task_id: uuid.UUID | None


class OverviewRemindersResponse(BaseModel):
    pending: int = Field(
        description="Enabled reminders due before the end of today, including any already due."
    )
    items: list[OverviewReminderResponse]

    @classmethod
    def of(cls, section: ReminderSection) -> "OverviewRemindersResponse":
        return cls(
            pending=section.pending,
            items=[
                OverviewReminderResponse(
                    id=view.reminder.id,
                    title=view.reminder.title,
                    next_occurrence_at=view.next_occurrence_at,
                    task_id=view.reminder.task_id,
                )
                for view in section.items
                if view.next_occurrence_at is not None
            ],
        )


class OverviewHabitsResponse(BaseModel):
    remaining: int = Field(description="Habits still to do today.")
    done: int = Field(description="Habits done today, including extra days.")
    total: int

    @classmethod
    def of(cls, section: HabitSection) -> "OverviewHabitsResponse":
        return cls(remaining=section.remaining, done=section.done, total=section.total)


class OverviewDocumentResponse(BaseModel):
    """Only what identifies a document and when it expires: no other metadata."""

    id: uuid.UUID
    title: str
    expiry_date: date


class OverviewDocumentsResponse(BaseModel):
    expired: int
    expiring: int = Field(description="Expiring in the next 30 days.")
    items: list[OverviewDocumentResponse] = Field(
        description="Expired (most recent first), then the soonest to expire; at most 5."
    )

    @classmethod
    def of(cls, section: DocumentSection) -> "OverviewDocumentsResponse":
        return cls(
            expired=section.expired,
            expiring=section.expiring,
            items=[
                OverviewDocumentResponse(
                    id=item.id, title=item.title, expiry_date=item.details.expiry_date
                )
                for item in section.items
                if item.details.expiry_date is not None
            ],
        )


class OverviewPaymentResponse(BaseModel):
    """A payment falling due. Amounts are left out: the Finance page shows them."""

    kind: CommitmentKind
    commitment_id: uuid.UUID
    name: str
    due_date: date
    status: PaymentStatus


class OverviewPaymentsResponse(BaseModel):
    overdue: int
    due_soon: int = Field(description="Unsettled payments due in the next 7 days.")
    items: list[OverviewPaymentResponse] = Field(description="Overdue first; at most 5.")

    @classmethod
    def of(cls, section: PaymentSection) -> "OverviewPaymentsResponse":
        return cls(
            overdue=section.overdue,
            due_soon=section.due_soon,
            items=[
                OverviewPaymentResponse(
                    kind=item.kind,
                    commitment_id=item.commitment_id,
                    name=item.name,
                    due_date=item.due_date,
                    status=item.status,
                )
                for item in section.items
            ],
        )


class TodayOverviewResponse(BaseModel):
    """Each section is `null` when it wasn't requested or failed to load; failed ones are
    listed in `unavailable`."""

    date: date
    timezone: str
    generated_at: datetime
    tasks: OverviewTasksResponse | None
    events: OverviewEventsResponse | None
    reminders: OverviewRemindersResponse | None
    habits: OverviewHabitsResponse | None
    documents: OverviewDocumentsResponse | None
    payments: OverviewPaymentsResponse | None
    unavailable: list[OverviewSection]

    @classmethod
    def of(cls, overview: DailyOverview) -> "TodayOverviewResponse":
        return cls(
            date=overview.day,
            timezone=overview.timezone,
            generated_at=overview.now,
            tasks=OverviewTasksResponse.of(overview.tasks) if overview.tasks else None,
            events=OverviewEventsResponse.of(overview.events) if overview.events else None,
            reminders=OverviewRemindersResponse.of(overview.reminders)
            if overview.reminders
            else None,
            habits=OverviewHabitsResponse.of(overview.habits) if overview.habits else None,
            documents=OverviewDocumentsResponse.of(overview.documents)
            if overview.documents
            else None,
            payments=OverviewPaymentsResponse.of(overview.payments) if overview.payments else None,
            unavailable=list(overview.unavailable),
        )
