"""Workspaces: the scope that owns user data."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class WorkspaceModel(Base):
    """A workspace owned by one user. Every user has exactly one personal workspace.

    Future user-owned tables carry a non-null `workspace_id` referencing this table, and access
    is authorized through the workspace's owner. Shared workspaces would add a membership table.
    """

    __tablename__ = "workspaces"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        Index(
            "uq_workspaces_personal_owner",
            "owner_id",
            unique=True,
            sqlite_where=text("is_personal"),
            postgresql_where=text("is_personal"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    is_personal: Mapped[bool]
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
