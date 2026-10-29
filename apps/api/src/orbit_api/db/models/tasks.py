"""Tasks: the first workspace-owned product data."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class TaskModel(Base):
    """A task in one workspace. Deleting the workspace deletes its tasks.

    `priority` is stored as a rank (0 none, 1 low, 2 medium, 3 high) so that sorting by priority
    is a plain, indexable column order; the repository maps ranks to names.
    """

    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("length(title) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("length(description) <= 5000", name="description_length"),
        CheckConstraint("status IN ('open', 'completed')", name="status"),
        CheckConstraint("priority BETWEEN 0 AND 3", name="priority"),
        CheckConstraint(
            "(status = 'completed' AND completed_at IS NOT NULL)"
            " OR (status = 'open' AND completed_at IS NULL)",
            name="completed_at_matches_status",
        ),
        # The target of `reminders`' composite foreign key, which keeps a reminder in the same
        # workspace as its task.
        UniqueConstraint("id", "workspace_id"),
        # Lists are always scoped to a workspace, usually filtered by status, and sorted by due
        # date or priority.
        Index("ix_tasks_workspace_status_due_date", "workspace_id", "status", "due_date"),
        Index("ix_tasks_workspace_status_priority", "workspace_id", "status", "priority"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16))
    priority: Mapped[int] = mapped_column(SmallInteger)
    due_date: Mapped[date | None] = mapped_column(Date)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
