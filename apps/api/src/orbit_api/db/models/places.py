"""Places: where you've been and where you want to go, shown on a world map."""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class PlaceModel(Base):
    """A place in one workspace, visited or wished for. Deleting the workspace deletes its
    places."""

    __tablename__ = "places"
    __table_args__ = (
        CheckConstraint("status IN ('visited', 'want_to_visit')", name="status"),
        CheckConstraint("length(name) BETWEEN 1 AND 120", name="name_length"),
        CheckConstraint("length(locality) <= 120", name="locality_length"),
        CheckConstraint("length(country_code) = 2", name="country_code_length"),
        CheckConstraint("length(note) <= 1000", name="note_length"),
        CheckConstraint(
            "(latitude IS NULL AND longitude IS NULL)"
            " OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)",
            name="location",
        ),
        CheckConstraint("status = 'visited' OR visited_on IS NULL", name="visited_on_status"),
        Index("ix_places_workspace_created", "workspace_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    # The city or region, in the user's words or from place search. Empty when not given.
    locality: Mapped[str] = mapped_column(String(120))
    # ISO 3166-1 alpha-2, upper case. Drives the countries shaded on the map.
    country_code: Mapped[str] = mapped_column(String(2))
    # Both set or both empty: places added without online search have no pin, only a country.
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16))
    # When the visit was, for visited places only.
    visited_on: Mapped[date | None] = mapped_column(Date)
    favorite: Mapped[bool]
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class PlaceSettingsModel(Base):
    """A workspace's Places settings. No row means online maps are off."""

    __tablename__ = "place_settings"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    online_maps: Mapped[bool]
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
