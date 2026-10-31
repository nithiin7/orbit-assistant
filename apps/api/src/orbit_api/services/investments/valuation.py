"""Where prices come from. Today every price is entered by hand (`source = manual`); this module
is the seam for adding mutual fund NAV feeds, market price providers, and statement imports
later without changing the data model.

A feed returns `Quote`s; `InvestmentService.record_prices` stores them like manual prices, one
per holding and date, with the feed's `source`. Nothing in Orbit calls a feed yet, and no
external service is contacted.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from orbit_api.services.investments.models import Holding, PriceSource


@dataclass(frozen=True, slots=True)
class Quote:
    holding_id: uuid.UUID
    price_date: date
    # Scaled major units per unit (see `quantities.py`).
    price: int
    source: PriceSource


class PriceFeed(Protocol):
    """A source of prices for holdings, identified by ISIN, symbol, or scheme code."""

    async def quotes(self, holdings: Sequence[Holding]) -> list[Quote]: ...
