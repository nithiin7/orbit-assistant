"""Dashboard layouts, one per user."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class DashboardLayoutModel(Base):
    """A user's dashboard arrangement: an ordered JSON list of `{"id", "size"}` widgets.

    The layout is always read and written whole, so it is one document rather than a row per
    widget. The API validates it on the way in and filters it on the way out.
    """

    __tablename__ = "dashboard_layouts"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    widgets: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
