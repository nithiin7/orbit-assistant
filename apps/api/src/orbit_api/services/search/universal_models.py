"""Universal search types: the query, its filters, and ranked hits from every module.

These sit beside the grouped search in `models.py`, which the command palette used before and
the AI layer's keyword retrieval still uses. Universal search covers more modules and entity
types, ranks across them, filters, and pages.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Final, Literal, get_args

UniversalModule = Literal[
    "tasks",
    "notes",
    "calendar",
    "reminders",
    "finance",
    "habits",
    "documents",
    "health",
    "watchlist",
    "bookmarks",
    "places",
]
# The order modules are listed in (tabs, facets).
UNIVERSAL_MODULES: Final[tuple[UniversalModule, ...]] = get_args(UniversalModule)

EntityType = Literal[
    "task",
    "note",
    "event",
    "reminder",
    "account",
    "transaction",
    "loan",
    "subscription",
    "bill",
    "holding",
    "deposit",
    "asset",
    "budget",
    "savings_goal",
    "habit",
    "routine",
    "document",
    "exercise",
    "workout",
    "workout_template",
    "fitness_goal",
    "measurement",
    "watch_item",
    "bookmark",
    "place",
]
ENTITY_TYPES: Final[tuple[EntityType, ...]] = get_args(EntityType)

# How a record matched, best first. See `ranking.py`.
MatchKind = Literal[
    "exact_title",
    "title_prefix",
    "title_phrase",
    "title_words",
    "metadata",
    "description",
    "content",
    "spread",
]
MATCH_KINDS: Final[tuple[MatchKind, ...]] = get_args(MatchKind)

SearchSort = Literal["relevance", "recent"]

TaskStatusFilter = Literal["open", "completed"]
TaskPriorityFilter = Literal["none", "low", "medium", "high"]
TransactionTypeFilter = Literal["income", "expense", "refund", "transfer"]
HabitKindFilter = Literal["boolean", "numeric", "duration"]

# Filters that only some entity types support. A record type that doesn't support a filter
# that is set can't satisfy it, so it isn't searched.
SpecificFilter = Literal[
    "date", "task_status", "task_priority", "document_category", "transaction_type", "habit_kind"
]

# At most this many words of a query are matched, like the modules' own searches.
MAX_SEARCH_WORDS: Final = 8
# Hits are paged by offset; deeper pages would make every source sort ever more rows.
MAX_SEARCH_OFFSET: Final = 500
MAX_SEARCH_LIMIT: Final = 50


@dataclass(frozen=True, slots=True)
class SearchFilters:
    modules: tuple[UniversalModule, ...] = ()
    types: tuple[EntityType, ...] = ()
    # The record's own date: a task's due date, an event's occurrences, a transaction's date,
    # a journal entry's or workout's day, a document's expiry, and so on.
    date_from: date | None = None
    date_to: date | None = None
    # UTC days.
    updated_from: date | None = None
    updated_to: date | None = None
    created_from: date | None = None
    created_to: date | None = None
    task_status: TaskStatusFilter | None = None
    task_priorities: tuple[TaskPriorityFilter, ...] = ()
    document_category_id: uuid.UUID | None = None
    transaction_types: tuple[TransactionTypeFilter, ...] = ()
    habit_kinds: tuple[HabitKindFilter, ...] = ()
    # Archived records (notes, documents, habits, accounts, …) are left out unless asked for.
    # Trashed records are never searched.
    include_archived: bool = False

    def specific(self) -> frozenset[SpecificFilter]:
        """The type-specific filters that are set."""
        chosen: set[SpecificFilter] = set()
        if self.date_from is not None or self.date_to is not None:
            chosen.add("date")
        if self.task_status is not None:
            chosen.add("task_status")
        if self.task_priorities:
            chosen.add("task_priority")
        if self.document_category_id is not None:
            chosen.add("document_category")
        if self.transaction_types:
            chosen.add("transaction_type")
        if self.habit_kinds:
            chosen.add("habit_kind")
        return frozenset(chosen)


def search_words(text: str) -> tuple[str, ...]:
    """The distinct words of a query, case-folded, at most `MAX_SEARCH_WORDS`."""
    words: list[str] = []
    for word in text.casefold().split():
        if word not in words:
            words.append(word)
    return tuple(words[:MAX_SEARCH_WORDS])


@dataclass(frozen=True, slots=True)
class UniversalQuery:
    text: str
    filters: SearchFilters = field(default_factory=SearchFilters)
    sort: SearchSort = "relevance"
    offset: int = 0
    limit: int = 20

    @property
    def phrase(self) -> str:
        """The whole query, case-folded and single-spaced."""
        return " ".join(self.text.casefold().split())

    @property
    def words(self) -> tuple[str, ...]:
        return search_words(self.text)


@dataclass(frozen=True, slots=True)
class SearchScope:
    """Who is searching where. Every source filters by the workspace; personal modules (health)
    also by the user."""

    workspace_id: uuid.UUID
    user_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class SearchDetail:
    """A short labelled fact shown with a hit, such as a status, folder, or place. Never an
    amount or a document's sensitive metadata."""

    key: str
    value: str


@dataclass(frozen=True, slots=True)
class UniversalHit:
    module: UniversalModule
    entity_type: EntityType
    id: uuid.UUID
    title: str
    # The text around the match, from a field that may be previewed. May be empty.
    snippet: str
    # Which fields matched any word: "title", "description", "tags", "folder", …
    matched_fields: tuple[str, ...]
    match: MatchKind
    score: int
    # Not archived, completed, cancelled, or disabled.
    active: bool
    status: str
    details: tuple[SearchDetail, ...]
    # The record's own date (see `SearchFilters.date_from`); for a recurring event, the next
    # occurrence. Opens the right day in date-based views.
    day: date | None
    # A timed event's start, wall-clock in its own time zone.
    starts_at: datetime | None
    all_day: bool
    # A parent record that the destination needs, such as a holding's account.
    parent_id: uuid.UUID | None
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class SourcePage:
    """One entity type's best hits for a query, in ranking order, and how many matched."""

    hits: list[UniversalHit]
    total: int


@dataclass(frozen=True, slots=True)
class ModuleFacet:
    module: UniversalModule
    # Matches in the module under every filter except the module filter. Zero when the module
    # was skipped or unavailable.
    total: int
    unavailable: bool = False


@dataclass(frozen=True, slots=True)
class UniversalResults:
    query: str
    sort: SearchSort
    offset: int
    limit: int
    hits: list[UniversalHit]
    # Matches in the chosen modules (all when none were chosen).
    total: int
    facets: list[ModuleFacet]

    @property
    def has_more(self) -> bool:
        return self.offset + len(self.hits) < self.total

    @property
    def unavailable(self) -> list[UniversalModule]:
        return [facet.module for facet in self.facets if facet.unavailable]
