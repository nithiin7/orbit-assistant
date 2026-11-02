"""Search result types: hits from each module, grouped by module."""

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Final, Literal, get_args

SearchModule = Literal["tasks", "notes", "events", "documents", "habits", "transactions"]
# The order groups are returned in.
SEARCH_MODULES: Final[tuple[SearchModule, ...]] = get_args(SearchModule)


@dataclass(frozen=True, slots=True)
class SearchHit:
    """One matching record, with only what a result list needs to show and open it.

    Hits carry no amounts, document metadata, or document contents: search is for finding a
    record, and the record's own page shows the rest."""

    id: uuid.UUID
    title: str
    # A short line under the title: a note's excerpt, an event's place. May be empty.
    detail: str
    # The record's state in its module: a task's or habit's status, a note's or transaction's
    # type, an event's status.
    status: str
    # The date that orders it in its module: a task's due date, an event's first day, a
    # transaction's date, a journal entry's day. `None` when it has none.
    day: date | None = None
    # A timed event's start in its own time zone (wall-clock), for display.
    starts_at: datetime | None = None
    all_day: bool = False


@dataclass(frozen=True, slots=True)
class SearchGroup:
    module: SearchModule
    hits: list[SearchHit]
    # Every match in the module, beyond the hits returned.
    total: int
    # The module failed to search; `hits` is empty.
    unavailable: bool = False


@dataclass(frozen=True, slots=True)
class SearchResults:
    query: str
    groups: list[SearchGroup]
