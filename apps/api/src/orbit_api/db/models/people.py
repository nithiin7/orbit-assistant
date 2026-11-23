"""People: the people in your life and the dates to remember about them."""

import uuid
from datetime import datetime, time

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class PersonModel(Base):
    """A person in one workspace. Deleting the workspace deletes its people, and deleting a
    person deletes their dates and their managed reminder."""

    __tablename__ = "people"
    __table_args__ = (
        CheckConstraint(
            "relationship IN ('family', 'partner', 'friend', 'colleague', 'other')",
            name="relationship",
        ),
        CheckConstraint("length(name) BETWEEN 1 AND 120", name="name_length"),
        CheckConstraint("length(phone) <= 40", name="phone_length"),
        CheckConstraint("length(email) <= 254", name="email_length"),
        CheckConstraint("length(note) <= 2000", name="note_length"),
        CheckConstraint("length(timezone) BETWEEN 1 AND 64", name="timezone_length"),
        # The target of the dates' and reminders' composite foreign keys, which keep them in
        # the person's workspace.
        UniqueConstraint("id", "workspace_id"),
        Index("ix_people_workspace_name", "workspace_id", "name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    relationship: Mapped[str] = mapped_column(String(16))
    phone: Mapped[str] = mapped_column(String(40))
    email: Mapped[str] = mapped_column(String(254))
    note: Mapped[str] = mapped_column(Text)
    favorite: Mapped[bool]
    # When date reminders fire, in the person's own reminder zone.
    reminder_time: Mapped[time] = mapped_column(Time)
    timezone: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class PersonDateModel(Base):
    """A yearly date about a person: a birthday, an anniversary, or one the user names. The year
    is optional; without it, ages and years together aren't known."""

    __tablename__ = "person_dates"
    __table_args__ = (
        CheckConstraint("kind IN ('birthday', 'anniversary', 'other')", name="kind"),
        CheckConstraint("month BETWEEN 1 AND 12", name="month_range"),
        CheckConstraint("day BETWEEN 1 AND 31", name="day_range"),
        CheckConstraint("year IS NULL OR year BETWEEN 1900 AND 2100", name="year_range"),
        CheckConstraint(
            "remind_days_before IS NULL OR remind_days_before BETWEEN 0 AND 30",
            name="remind_days_before_range",
        ),
        CheckConstraint("length(label) <= 60", name="label_length"),
        CheckConstraint("kind <> 'other' OR length(label) >= 1", name="other_has_label"),
        ForeignKeyConstraint(
            ["person_id", "workspace_id"],
            ["people.id", "people.workspace_id"],
            ondelete="CASCADE",
        ),
        # A person has at most one birthday.
        Index(
            "uq_person_dates_birthday",
            "person_id",
            unique=True,
            sqlite_where=text("kind = 'birthday'"),
            postgresql_where=text("kind = 'birthday'"),
        ),
        Index("ix_person_dates_person_position", "person_id", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    person_id: Mapped[uuid.UUID]
    kind: Mapped[str] = mapped_column(String(16))
    # The date's name for `other`; empty for birthdays and anniversaries.
    label: Mapped[str] = mapped_column(String(60))
    month: Mapped[int] = mapped_column(SmallInteger)
    day: Mapped[int] = mapped_column(SmallInteger)
    year: Mapped[int | None] = mapped_column(SmallInteger)
    # Days before the date to remind; `NULL` means no reminder for this date.
    remind_days_before: Mapped[int | None] = mapped_column(SmallInteger)
    # The order the user listed the dates in.
    position: Mapped[int] = mapped_column(Integer)
