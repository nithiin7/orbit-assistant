"""Search history: each person's recent and saved searches in a workspace.

Universal search itself has no tables: it reads the modules' own. These rows belong to one user
in one workspace and are deleted with either.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class RecentSearchModel(Base):
    """A search the person committed to (only its text). At most a few are kept per person and
    workspace; the service drops the oldest."""

    __tablename__ = "recent_searches"
    __table_args__ = (
        CheckConstraint("length(query) BETWEEN 1 AND 200", name="query_length"),
        UniqueConstraint("user_id", "workspace_id", "normalized_query"),
        Index("ix_recent_searches_owner_used_at", "user_id", "workspace_id", "used_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    query: Mapped[str] = mapped_column(String(200))
    # Case-folded and single-spaced, so "Garden" and "garden " are one search.
    normalized_query: Mapped[str] = mapped_column(String(200))
    used_at: Mapped[datetime] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class SavedSearchModel(Base):
    """A named search with its filters. `filters` is validated by the API on the way in and
    again on the way out."""

    __tablename__ = "saved_searches"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        CheckConstraint("length(query) BETWEEN 1 AND 200", name="query_length"),
        UniqueConstraint("user_id", "workspace_id", "normalized_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    normalized_name: Mapped[str] = mapped_column(String(100))
    query: Mapped[str] = mapped_column(String(200))
    filters: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
