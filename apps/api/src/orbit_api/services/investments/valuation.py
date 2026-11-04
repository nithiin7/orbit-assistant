"""Where prices come from. Prices are entered by hand (`source = manual`) unless a workspace
opts in under Settings → Finance and the server allows market data (`ORBIT_MARKET_DATA_ENABLED`);
then a `PriceFeed` (mutual fund NAVs and stock and ETF prices, `providers/prices/`) supplies them
and they are stored with `source = provider`, one per holding and date, like manual prices.

A feed is asked only for a holding's identifier (a scheme code or a ticker, see `price_key`)
and a date range: never for units, amounts, or anything else about the person.
"""

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from orbit_api.services.finance.money import Currency
from orbit_api.services.investments.models import Holding, HoldingKind, PriceSource


@dataclass(frozen=True, slots=True)
class Quote:
    holding_id: uuid.UUID
    price_date: date
    # Scaled major units per unit (see `quantities.py`).
    price: int
    source: PriceSource


@dataclass(frozen=True, slots=True)
class Instrument:
    """A fund or security a feed knows, as a search result: the fields a holding is created
    with."""

    kind: HoldingKind
    name: str
    # A scheme code for mutual funds, a ticker for stocks and ETFs.
    symbol: str
    exchange: str = ""
    isin: str = ""
    issuer: str = ""
    category: str = ""
    currency: Currency | None = None


class PriceFeedError(Exception):
    """The feed couldn't be reached or answered with something unusable. Carries no response
    content."""


class PriceFeed(Protocol):
    async def quotes(self, holding: Holding, start: date, end: date) -> list[Quote]:
        """The holding's prices dated from `start` to `end`, oldest first; empty when the feed
        doesn't know it or prices it in another currency."""
        ...

    async def search(self, kind: HoldingKind, query: str) -> list[Instrument]: ...


def price_key(holding: Holding) -> str | None:
    """What a feed looks a holding up by, or `None` when it can't be priced automatically: a
    mutual fund's numeric AMFI scheme code, or a stock's or ETF's ticker, suffixed `.NS` or
    `.BO` for NSE and BSE unless it already names its market."""
    symbol = holding.symbol.strip()
    if not symbol:
        return None
    if holding.kind == "mutual_fund":
        return symbol if symbol.isdigit() else None
    exchange = holding.exchange.strip().upper()
    if "." in symbol or exchange not in _SUFFIXES:
        return symbol.upper()
    return f"{symbol.upper()}{_SUFFIXES[exchange]}"


_SUFFIXES = {"NSE": ".NS", "BSE": ".BO"}
