"""Daily briefings: one structured snapshot of a person's day per workspace and date."""

import uuid
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class DailyBriefingModel(Base):
    """The canonical briefing for one person, in one workspace, on one local date in one time
    zone.

    `content` is the normalized snapshot (see `services/briefings/models.py`) as JSON: titles,
    times, states, and figures the modules computed, with references to the source records,
    never their descriptions or note content. `summary` repeats its counts so history can be
    listed without reading every snapshot. Regenerating replaces both and adds one to
    `revision`; the unique key settles concurrent first generation.
    """

    __tablename__ = "daily_briefings"
    __table_args__ = (
        CheckConstraint("status IN ('complete', 'partial')", name="status"),
        CheckConstraint("revision >= 1", name="revision"),
        # One per time zone: the same local date is a different day elsewhere.
        UniqueConstraint("workspace_id", "user_id", "briefing_date", "timezone"),
        # History is listed newest first per person.
        Index("ix_daily_briefings_user_id_briefing_date", "user_id", "briefing_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    briefing_date: Mapped[date] = mapped_column(Date)
    timezone: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    revision: Mapped[int] = mapped_column(Integer)
    format_version: Mapped[int] = mapped_column(Integer)
    summary: Mapped[dict[str, Any]] = mapped_column(JSON)
    content: Mapped[dict[str, Any]] = mapped_column(JSON)
    # The AI-written summary of `content`, if one was asked for; cleared on regeneration.
    narrative: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    generated_at: Mapped[datetime] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class BriefingSettingsModel(Base):
    """One person's briefing settings in one workspace: how many days ahead it looks, the
    sources it leaves out (a JSON list), and the local time the worker prepares it, if any."""

    __tablename__ = "briefing_settings"
    __table_args__ = (
        PrimaryKeyConstraint("workspace_id", "user_id"),
        CheckConstraint("horizon_days BETWEEN 1 AND 14", name="horizon_days"),
        # The worker looks for people whose preparation time has come.
        Index("ix_briefing_settings_prepare_at", "prepare_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    horizon_days: Mapped[int] = mapped_column(Integer)
    hidden_sources: Mapped[list[str]] = mapped_column(JSON)
    prepare_at: Mapped[time | None] = mapped_column(Time)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
