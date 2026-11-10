"""Watchlist titles: movies and series."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class WatchItemModel(Base):
    """A movie or series on a workspace's watchlist. The poster, when there is one, lives in
    the attachment store under `poster_blob_id`. Deleting the workspace deletes its titles."""

    __tablename__ = "watch_items"
    __table_args__ = (
        CheckConstraint("kind IN ('movie', 'series')", name="kind"),
        CheckConstraint("status IN ('want', 'watching', 'watched', 'dropped')", name="status"),
        CheckConstraint("length(title) BETWEEN 1 AND 300", name="title_length"),
        CheckConstraint("length(overview) <= 4000", name="overview_length"),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        CheckConstraint("length(platform) <= 60", name="platform_length"),
        CheckConstraint("length(recommended_by) <= 100", name="recommended_by_length"),
        CheckConstraint("release_year BETWEEN 1870 AND 2200", name="release_year_range"),
        CheckConstraint("runtime_minutes BETWEEN 1 AND 6000", name="runtime_range"),
        CheckConstraint("rating BETWEEN 1 AND 10", name="rating_range"),
        CheckConstraint(
            "(progress_season IS NULL AND progress_episode IS NULL)"
            " OR (kind = 'series' AND progress_season >= 1 AND progress_episode >= 1)",
            name="progress_valid",
        ),
        CheckConstraint(
            "(status = 'watched') = (finished_at IS NOT NULL)", name="finished_at_matches_status"
        ),
        # A looked-up title is added once per workspace. NULLs never clash, so titles entered by
        # hand are unaffected.
        UniqueConstraint("workspace_id", "kind", "source_id"),
        UniqueConstraint("poster_blob_id"),
        Index("ix_watch_items_workspace_position", "workspace_id", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(300))
    release_year: Mapped[int | None]
    overview: Mapped[str] = mapped_column(Text)
    # A list of genre names.
    genres: Mapped[list[Any]] = mapped_column(JSON)
    runtime_minutes: Mapped[int | None]
    # A series' episode count per season, when known.
    season_episodes: Mapped[list[Any] | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16))
    progress_season: Mapped[int | None]
    progress_episode: Mapped[int | None]
    rating: Mapped[int | None]
    notes: Mapped[str] = mapped_column(Text)
    platform: Mapped[str | None] = mapped_column(String(60))
    recommended_by: Mapped[str | None] = mapped_column(String(100))
    source_id: Mapped[int | None]
    poster_blob_id: Mapped[uuid.UUID | None]
    position: Mapped[int]
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class WatchlistSettingsModel(Base):
    """A workspace's watchlist settings: its TMDB API key (Fernet-encrypted, never returned) and
    whether lookup is on. No row means no key and lookup off."""

    __tablename__ = "watchlist_settings"
    __table_args__ = (
        CheckConstraint("NOT lookup_enabled OR tmdb_api_key IS NOT NULL", name="lookup_needs_key"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    lookup_enabled: Mapped[bool]
    tmdb_api_key: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
