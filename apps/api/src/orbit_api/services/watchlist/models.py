"""Watchlist types: movies and series to watch, being watched, watched, or dropped."""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from orbit_api.utils.changes import UNSET, Change

WatchKind = Literal["movie", "series"]
WatchStatus = Literal["want", "watching", "watched", "dropped"]

# Ratings are half stars out of five, stored as whole numbers from 1 (half a star) to 10.
MIN_RATING = 1
MAX_RATING = 10


@dataclass(frozen=True, slots=True)
class Progress:
    """The last episode watched: season and episode numbers, both from 1."""

    season: int
    episode: int


@dataclass(frozen=True, slots=True)
class WatchItem:
    id: uuid.UUID
    workspace_id: uuid.UUID
    kind: WatchKind
    title: str
    release_year: int | None
    overview: str
    genres: tuple[str, ...]
    # A movie's length, or a series' typical episode length.
    runtime_minutes: int | None
    # A series' episode count per season (specials left out), when known.
    season_episodes: tuple[int, ...] | None
    status: WatchStatus
    # Series only: the last episode watched, or `None` before the first.
    progress: Progress | None
    rating: int | None
    notes: str
    platform: str | None
    recommended_by: str | None
    # The title's ID at the lookup service (TMDB), for titles added from a search.
    source_id: int | None
    # The poster's file in the attachment store.
    poster_blob_id: uuid.UUID | None
    # Order within its status; lower comes first.
    position: int
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class WatchDraft:
    """A title entered by hand, or the details a lookup filled in."""

    kind: WatchKind
    title: str
    release_year: int | None = None
    overview: str = ""
    genres: tuple[str, ...] = ()
    runtime_minutes: int | None = None
    season_episodes: tuple[int, ...] | None = None
    status: WatchStatus = "want"
    platform: str | None = None
    recommended_by: str | None = None
    notes: str = ""


@dataclass(frozen=True, slots=True)
class WatchChanges:
    """A partial update. `UNSET` leaves a field as it is; `None` clears an optional one."""

    title: Change[str] = UNSET
    kind: Change[WatchKind] = UNSET
    release_year: Change[int | None] = UNSET
    runtime_minutes: Change[int | None] = UNSET
    status: Change[WatchStatus] = UNSET
    progress: Change[Progress | None] = UNSET
    rating: Change[int | None] = UNSET
    notes: Change[str] = UNSET
    platform: Change[str | None] = UNSET
    recommended_by: Change[str | None] = UNSET


@dataclass(frozen=True, slots=True)
class LookupState:
    enabled: bool
    # The workspace's TMDB key, encrypted; `None` until one is saved.
    encrypted_key: str | None


@dataclass(frozen=True, slots=True)
class TitleMatch:
    """A search result from the lookup service."""

    source_id: int
    kind: WatchKind
    title: str
    release_year: int | None
    overview: str
    # The lookup service's poster path, such as `/abc123.jpg`.
    poster_path: str | None
    # ISO 639-1 code of the language it was made in, such as `ko`, when known.
    original_language: str | None = None


@dataclass(frozen=True, slots=True)
class WatchSuggestion:
    """A title the lookup service recommends from titles already on the watchlist."""

    match: TitleMatch
    # The watchlist titles it was recommended from, strongest first.
    because: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class TitleDetails:
    source_id: int
    kind: WatchKind
    title: str
    release_year: int | None
    overview: str
    genres: tuple[str, ...]
    runtime_minutes: int | None
    season_episodes: tuple[int, ...] | None
    poster_path: str | None


@dataclass(frozen=True, slots=True)
class Poster:
    content_type: Literal["image/jpeg", "image/png"]
    data: bytes


class WatchItemNotFoundError(Exception):
    """The title does not exist in this workspace."""


class DuplicateTitleError(Exception):
    """The looked-up title is already on this workspace's watchlist."""

    def __init__(self, existing_id: uuid.UUID) -> None:
        super().__init__()
        self.existing_id = existing_id


class InvalidWatchItemError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class CatalogError(Exception):
    """The lookup service couldn't be reached or answered with something unusable."""


class CatalogAuthError(CatalogError):
    """The lookup service refused the API key."""


class CatalogNotFoundError(CatalogError):
    """The lookup service has no such title or poster."""
