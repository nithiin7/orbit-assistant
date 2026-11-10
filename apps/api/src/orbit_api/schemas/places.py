"""Place models."""

import uuid
from datetime import date, datetime
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import multi_line, single_line
from orbit_api.services.places.countries import COUNTRY_CODES
from orbit_api.services.places.models import (
    MAX_LOCALITY_LENGTH,
    MAX_NAME_LENGTH,
    MAX_NOTE_LENGTH,
    MAX_QUERY_LENGTH,
    Location,
    Place,
    PlaceChanges,
    PlaceDraft,
    PlaceMatch,
    PlaceStatus,
)
from orbit_api.utils.changes import UNSET


def country_code(value: str) -> str:
    code = value.upper()
    if code not in COUNTRY_CODES:
        raise ValueError("must be an ISO 3166-1 alpha-2 country code")
    return code


Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NAME_LENGTH),
    AfterValidator(single_line),
]
Locality = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=MAX_LOCALITY_LENGTH),
    AfterValidator(single_line),
]
CountryCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=2),
    AfterValidator(country_code),
]
Note = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=MAX_NOTE_LENGTH),
    AfterValidator(multi_line),
]


class PlaceLocation(BaseModel):
    """Where to pin a place on the map."""

    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)

    @classmethod
    def of(cls, location: Location) -> "PlaceLocation":
        return cls(latitude=location.latitude, longitude=location.longitude)

    def to_location(self) -> Location:
        return Location(latitude=self.latitude, longitude=self.longitude)


class PlaceResponse(BaseModel):
    id: uuid.UUID
    name: str
    locality: str = Field(description="The city or region. Empty when not given.")
    country_code: str = Field(description="ISO 3166-1 alpha-2, upper case.")
    location: PlaceLocation | None = Field(
        description="Where to pin it; places added without place search have none."
    )
    status: PlaceStatus
    visited_on: date | None = Field(description="When the visit was; visited places only.")
    favorite: bool
    note: str = Field(description="Empty when not given.")
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, place: Place) -> "PlaceResponse":
        return cls(
            id=place.id,
            name=place.name,
            locality=place.locality,
            country_code=place.country_code,
            location=PlaceLocation.of(place.location) if place.location else None,
            status=place.status,
            visited_on=place.visited_on,
            favorite=place.favorite,
            note=place.note,
            created_at=place.created_at,
            updated_at=place.updated_at,
        )


class PlacesResponse(BaseModel):
    places: list[PlaceResponse] = Field(description="Every place, newest first.")


class CreatePlaceRequest(BaseModel):
    """Add a place. A name and a country are enough to shade the country on the map; a location
    adds a pin."""

    model_config = ConfigDict(extra="forbid")

    name: Name
    country_code: CountryCode
    status: PlaceStatus
    locality: Locality = ""
    location: PlaceLocation | None = None
    visited_on: date | None = Field(default=None, description="Visited places only.")
    favorite: bool = False
    note: Note = ""

    def to_draft(self) -> PlaceDraft:
        return PlaceDraft(
            name=self.name,
            country_code=self.country_code,
            status=self.status,
            locality=self.locality,
            location=self.location.to_location() if self.location else None,
            visited_on=self.visited_on,
            favorite=self.favorite,
            note=self.note,
        )


class UpdatePlaceRequest(BaseModel):
    """Change some of a place's fields. Omitted fields keep their values; `location: null`
    removes the pin and `visited_on: null` clears the date. Moving a place to `want_to_visit`
    clears its date."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    locality: Locality | None = None
    country_code: CountryCode | None = None
    location: PlaceLocation | None = None
    status: PlaceStatus | None = None
    visited_on: date | None = None
    favorite: bool | None = None
    note: Note | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in self.model_fields_set - {"location", "visited_on"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> PlaceChanges:
        fields = self.model_fields_set
        return PlaceChanges(
            name=self.name if self.name is not None else UNSET,
            locality=self.locality if self.locality is not None else UNSET,
            country_code=self.country_code if self.country_code is not None else UNSET,
            location=(self.location.to_location() if self.location else None)
            if "location" in fields
            else UNSET,
            status=self.status if self.status is not None else UNSET,
            visited_on=self.visited_on if "visited_on" in fields else UNSET,
            favorite=self.favorite if self.favorite is not None else UNSET,
            note=self.note if self.note is not None else UNSET,
        )


class PlaceMatchResponse(BaseModel):
    name: str
    locality: str
    country_code: str
    location: PlaceLocation
    label: str = Field(description="The full address, to tell matches apart.")

    @classmethod
    def of(cls, match: PlaceMatch) -> "PlaceMatchResponse":
        return cls(
            name=match.name,
            locality=match.locality,
            country_code=match.country_code,
            location=PlaceLocation.of(match.location),
            label=match.label,
        )


class PlaceMatchesResponse(BaseModel):
    matches: list[PlaceMatchResponse]


class PlaceSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=2, max_length=MAX_QUERY_LENGTH),
        AfterValidator(single_line),
    ]


class PlaceSettingsResponse(BaseModel):
    online_maps: bool = Field(
        description="Whether the map loads tiles from the internet and place search is on."
    )
    online_maps_allowed: bool = Field(description="Whether this server allows online maps.")
    map_style_url: str | None = Field(
        description="The MapLibre style to load while online maps are on; otherwise null."
    )


class PlaceSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    online_maps: bool
