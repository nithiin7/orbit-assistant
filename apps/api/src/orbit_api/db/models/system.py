"""Server-wide settings: one row for the whole installation, not for a workspace or person."""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class SystemSettingsModel(Base):
    """Whether this server checks for new Orbit releases, and what the last check found. There
    is at most one row, with `id = 1`; no row means update checks are off and never ran."""

    __tablename__ = "system_settings"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    update_check_enabled: Mapped[bool] = mapped_column(Boolean)
    # The latest release found, e.g. `1.2.0`, and when it was published.
    latest_version: Mapped[str | None] = mapped_column(String(32))
    latest_published_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # When the server last asked, and whether that attempt failed (the release above is then
    # from an earlier check).
    checked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    check_failed: Mapped[bool] = mapped_column(Boolean)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
