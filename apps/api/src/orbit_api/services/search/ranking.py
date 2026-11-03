"""How universal search ranks hits.

Every hit falls into one match tier, the first that applies (the query is compared
case-insensitively, as a whole "phrase" and as separate words):

1. `exact_title`: the title is the phrase.
2. `title_prefix`: the title starts with the phrase.
3. `title_phrase`: the title contains the phrase.
4. `title_words`: the title contains every word, in any order.
5. `metadata`: a tag, folder, category, place, payee, or similar field contains the phrase.
6. `description`: a description or notes field contains the phrase.
7. `content`: long text (a note's body, a routine's steps) contains the phrase.
8. `spread`: every word matched somewhere, but the phrase nowhere in one field.

A hit's score is its tier's weight, less a small penalty when the record isn't active
(completed, archived, cancelled, disabled). The penalty is smaller than the gap between tiers,
so an archived exact match still outranks an active partial one. Ties are broken by recency
(`updated_at`, newest first) and then by ID, so recency orders hits only within a tier and an
unrelated record edited a minute ago never jumps a better match.

The tiers are computed in SQL from a strategy's weights, so each source can return its best hits
in the final order and pages can be merged across modules. A different strategy (other weights
or penalty) only needs a new `RankingStrategy`.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Final

from orbit_api.services.search.universal_models import MATCH_KINDS, MatchKind, UniversalHit

DEFAULT_WEIGHTS: Final[Mapping[MatchKind, int]] = MappingProxyType(
    {
        "exact_title": 1000,
        "title_prefix": 800,
        "title_phrase": 600,
        "title_words": 500,
        "metadata": 400,
        "description": 300,
        "content": 200,
        "spread": 100,
    }
)


@dataclass(frozen=True, slots=True)
class RankingStrategy:
    weights: Mapping[MatchKind, int] = field(default_factory=lambda: DEFAULT_WEIGHTS)
    inactive_penalty: int = 50

    def __post_init__(self) -> None:
        if set(self.weights) != set(MATCH_KINDS):
            raise ValueError("A ranking strategy needs a weight for every match kind.")

    def score(self, match: MatchKind, *, active: bool) -> int:
        return self.weights[match] - (0 if active else self.inactive_penalty)


DEFAULT_RANKING: Final = RankingStrategy()


def relevance_key(hit: UniversalHit) -> tuple[int, float, str]:
    """Sorts best first: score, then the most recently updated, then ID for a stable order."""
    return (-hit.score, -hit.updated_at.timestamp(), str(hit.id))


def recency_key(hit: UniversalHit) -> tuple[float, str]:
    return (-hit.updated_at.timestamp(), str(hit.id))
