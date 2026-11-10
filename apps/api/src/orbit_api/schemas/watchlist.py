"""Watchlist models."""

import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import blank_to_none, multi_line, single_line
from orbit_api.services.watchlist.models import (
    MAX_RATING,
    MIN_RATING,
    LookupState,
    Progress,
    TitleMatch,
    WatchChanges,
    WatchDraft,
    WatchItem,
    WatchKind,
    WatchStatus,
)
from orbit_api.utils.changes import UNSET

Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=300),
    AfterValidator(single_line),
]
WatchNotes = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=2000), AfterValidator(multi_line)
]
Platform = Annotated[
    Annotated[
        str,
        StringConstraints(strip_whitespace=True, max_length=60),
        AfterValidator(single_line),
    ]
    | None,
    BeforeValidator(blank_to_none),
]
RecommendedBy = Annotated[
    Annotated[
        str,
        StringConstraints(strip_whitespace=True, max_length=100),
        AfterValidator(single_line),
    ]
    | None,
    BeforeValidator(blank_to_none),
]
ReleaseYear = Annotated[int, Field(ge=1870, le=2200)]
Runtime = Annotated[int, Field(ge=1, le=6000, description="Minutes.")]
Rating = Annotated[
    int, Field(ge=MIN_RATING, le=MAX_RATING, description="Half stars out of five: 1 to 10.")
]
SourceId = Annotated[int, Field(ge=1, le=2_147_483_647, description="The title's TMDB ID.")]


class ProgressModel(BaseModel):
    """The last episode watched."""

    model_config = ConfigDict(extra="forbid")

    season: int = Field(ge=1, le=500)
    episode: int = Field(ge=1, le=10_000)

    def to_progress(self) -> Progress:
        return Progress(season=self.season, episode=self.episode)


class WatchItemResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    kind: WatchKind
    title: str
    release_year: int | None
    overview: str = Field(description="Empty when unknown.")
    genres: list[str]
    runtime_minutes: int | None = Field(
        description="A movie's length, or a series' typical episode length."
    )
    season_episodes: list[int] | None = Field(
        description="A series' episode count per season, when known."
    )
    status: WatchStatus
    progress: ProgressModel | None = Field(description="Series only: the last episode watched.")
    rating: int | None = Field(description="Half stars out of five: 1 to 10.")
    notes: str
    platform: str | None = Field(description='Where to watch it, such as "Netflix".')
    recommended_by: str | None
    looked_up: bool = Field(description="Added from a TMDB search, so it can be refreshed.")
    has_poster: bool
    position: int = Field(description="Order within its status; lower comes first.")
    started_at: datetime | None
    finished_at: datetime | None = Field(description="Set while the title is watched.")
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, item: WatchItem) -> "WatchItemResponse":
        return cls(
            id=item.id,
            workspace_id=item.workspace_id,
            kind=item.kind,
            title=item.title,
            release_year=item.release_year,
            overview=item.overview,
            genres=list(item.genres),
            runtime_minutes=item.runtime_minutes,
            season_episodes=list(item.season_episodes)
            if item.season_episodes is not None
            else None,
            status=item.status,
            progress=ProgressModel(season=item.progress.season, episode=item.progress.episode)
            if item.progress
            else None,
            rating=item.rating,
            notes=item.notes,
            platform=item.platform,
            recommended_by=item.recommended_by,
            looked_up=item.source_id is not None,
            has_poster=item.poster_blob_id is not None,
            position=item.position,
            started_at=item.started_at,
            finished_at=item.finished_at,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )


class WatchItemsResponse(BaseModel):
    items: list[WatchItemResponse] = Field(description="Every title, in position order.")


class CreateWatchItemRequest(BaseModel):
    """Add a title found in a search (`source_id` and `kind`), or one entered by hand (`title`
    and `kind`). A looked-up title's name and details come from TMDB."""

    model_config = ConfigDict(extra="forbid")

    kind: WatchKind
    source_id: SourceId | None = None
    title: Title | None = None
    release_year: ReleaseYear | None = None
    runtime_minutes: Runtime | None = None
    status: WatchStatus = "want"
    platform: Platform = None
    recommended_by: RecommendedBy = None
    notes: WatchNotes = ""

    @model_validator(mode="after")
    def _check_source(self) -> Self:
        if (self.source_id is None) == (self.title is None):
            raise ValueError("give either a source_id from a search or a title")
        return self

    def to_draft(self) -> WatchDraft:
        return WatchDraft(
            kind=self.kind,
            title=self.title or "",
            release_year=self.release_year,
            runtime_minutes=self.runtime_minutes,
            status=self.status,
            platform=self.platform,
            recommended_by=self.recommended_by,
            notes=self.notes,
        )


class UpdateWatchItemRequest(BaseModel):
    """Change some of a title's fields. Omitted fields keep their values; `null` clears an
    optional one. Moving to `watched` fills in a series' last episode when the seasons are
    known; moving back to `want` clears progress."""

    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    kind: WatchKind | None = None
    release_year: ReleaseYear | None = None
    runtime_minutes: Runtime | None = None
    status: WatchStatus | None = None
    progress: ProgressModel | None = None
    rating: Rating | None = None
    notes: WatchNotes | None = None
    platform: Platform = None
    recommended_by: RecommendedBy = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in ("title", "kind", "status", "notes"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> WatchChanges:
        provided = self.model_fields_set
        return WatchChanges(
            title=self.title if self.title is not None else UNSET,
            kind=self.kind if self.kind is not None else UNSET,
            release_year=self.release_year if "release_year" in provided else UNSET,
            runtime_minutes=self.runtime_minutes if "runtime_minutes" in provided else UNSET,
            status=self.status if self.status is not None else UNSET,
            progress=(self.progress.to_progress() if self.progress else None)
            if "progress" in provided
            else UNSET,
            rating=self.rating if "rating" in provided else UNSET,
            notes=self.notes if self.notes is not None else UNSET,
            platform=self.platform if "platform" in provided else UNSET,
            recommended_by=self.recommended_by if "recommended_by" in provided else UNSET,
        )


class WatchlistLookupResponse(BaseModel):
    configured: bool = Field(description="Whether this workspace has saved a TMDB API key.")
    enabled: bool = Field(description="Whether this workspace looks titles up at TMDB.")

    @classmethod
    def of(cls, state: LookupState) -> "WatchlistLookupResponse":
        return cls(configured=state.encrypted_key is not None, enabled=state.enabled)


class WatchlistLookupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class WatchlistKeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: str = Field(
        min_length=16,
        max_length=1000,
        pattern=r"^[A-Za-z0-9._-]+$",
        description="A TMDB v3 API key or v4 read access token. Checked with TMDB, then stored "
        "encrypted; it's never returned.",
    )


class TitleSearchParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: str = Field(min_length=1, max_length=100)


class PosterParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(
        pattern=r"^/[A-Za-z0-9_-]{1,100}\.(?:jpg|jpeg|png)$",
        description="A search result's `poster_path`.",
    )


class TitleMatchResponse(BaseModel):
    source_id: int
    kind: WatchKind
    title: str
    release_year: int | None
    overview: str
    poster_path: str | None = Field(
        description="Fetch the thumbnail from `/watchlist/search/poster?path=`."
    )
    existing_id: uuid.UUID | None = Field(
        description="The watchlist's copy of this title, if it's already added."
    )

    @classmethod
    def of(cls, match: TitleMatch, existing_id: uuid.UUID | None) -> "TitleMatchResponse":
        return cls(
            source_id=match.source_id,
            kind=match.kind,
            title=match.title,
            release_year=match.release_year,
            overview=match.overview,
            poster_path=match.poster_path,
            existing_id=existing_id,
        )


class TitleMatchesResponse(BaseModel):
    results: list[TitleMatchResponse]
