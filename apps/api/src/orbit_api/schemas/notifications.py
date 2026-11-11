"""Notification models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from orbit_api.services.notifications.models import Notification, NotificationQuery

PAGE_MAX_SIZE = 100


class NotificationResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID = Field(description="The workspace it came from.")
    reminder_id: uuid.UUID | None = Field(
        description="The reminder that fired, or `null` once it has been deleted."
    )
    title: str
    body: str = Field(description="The message; may be empty, and may use Markdown.")
    scheduled_for: datetime = Field(description="When the reminder was scheduled to fire.")
    created_at: datetime = Field(description="When the notification was delivered.")
    read_at: datetime | None = Field(description="When it was first read, or `null` if unread.")
    link: str | None = Field(
        description="The in-app path opening it goes to, such as `/automation?tab=activity`."
    )

    @classmethod
    def of(cls, notification: Notification) -> "NotificationResponse":
        return cls(
            id=notification.id,
            workspace_id=notification.workspace_id,
            reminder_id=notification.reminder_id,
            title=notification.title,
            body=notification.body,
            scheduled_for=notification.scheduled_for,
            created_at=notification.created_at,
            read_at=notification.read_at,
            link=notification.link,
        )


class NotificationListResponse(BaseModel):
    notifications: list[NotificationResponse]
    total: int = Field(description="Notifications matching the filters, across all pages.")
    unread: int = Field(description="All of the user's unread notifications.")


class UnreadCountResponse(BaseModel):
    unread: int


class NotificationListParams(BaseModel):
    """Paging for the inbox, newest first."""

    model_config = ConfigDict(extra="forbid")

    unread: bool = Field(default=False, description="Only unread notifications.")
    limit: int = Field(default=20, ge=1, le=PAGE_MAX_SIZE)
    offset: int = Field(default=0, ge=0)

    def to_query(self) -> NotificationQuery:
        return NotificationQuery(unread_only=self.unread, limit=self.limit, offset=self.offset)


class UpdateNotificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    read: bool


class MarkAllReadResponse(BaseModel):
    count: int = Field(description="How many notifications were marked read.")
