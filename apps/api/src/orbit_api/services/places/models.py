"""Place types: where you've been and where you want to go."""

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from orbit_api.utils.changes import UNSET, Change

PlaceStatus = Literal["visited", "want_to_visit"]

MAX_NAME_LENGTH = 120
MAX_LOCALITY_LENGTH = 120
MAX_NOTE_LENGTH = 1000
MAX_QUERY_LENGTH = 200


@dataclass(frozen=True, slots=True)
class Location:
    latitude: float
    longitude: float


@dataclass(frozen=True, slots=True)
class Place:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    # The city or region. Empty when not given.
    locality: str
    # ISO 3166-1 alpha-2, upper case.
    country_code: str
    # Where to pin it on the map; places added without online search have none.
    location: Location | None
    status: PlaceStatus
    # When the visit was; only visited places have one.
    visited_on: date | None
    favorite: bool
    note: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class PlaceDraft:
    name: str
    country_code: str
    status: PlaceStatus
    locality: str = ""
    location: Location | None = None
    visited_on: date | None = None
    favorite: bool = False
    note: str = ""


@dataclass(frozen=True, slots=True)
class PlaceChanges:
    """A partial update. `UNSET` leaves a field as it is; `location=None` removes the pin and
    `visited_on=None` clears the date. Moving a place to `want_to_visit` clears its date."""

    name: Change[str] = UNSET
    locality: Change[str] = UNSET
    country_code: Change[str] = UNSET
    location: Change[Location | None] = UNSET
    status: Change[PlaceStatus] = UNSET
    visited_on: Change[date | None] = UNSET
    favorite: Change[bool] = UNSET
    note: Change[str] = UNSET


@dataclass(frozen=True, slots=True)
class PlaceMatch:
    """A result from place search, for filling in a new place."""

    name: str
    locality: str
    country_code: str
    location: Location
    # The full address, to tell matches apart.
    label: str


class PlaceNotFoundError(Exception):
    """The place does not exist in this workspace."""


class VisitDateError(Exception):
    """A visit date was given for a place that hasn't been visited."""


class OnlineMapsOffError(Exception):
    """The workspace hasn't turned online maps on, or the server doesn't allow them."""


class PlaceSearchError(Exception):
    """Place search failed or returned something unexpected."""
