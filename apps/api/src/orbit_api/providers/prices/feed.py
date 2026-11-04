"""The price feed behind `services/investments/valuation.py`: mutual fund NAVs from mfapi.in
(AMFI's published NAV history, by scheme code) and stock and ETF prices from Yahoo Finance's
public chart and search endpoints (no API key; unofficial, so it may change or rate-limit).

Only a scheme code, a ticker, a date range, or a search phrase leaves the server. Nothing is
logged, and errors never carry response bodies.
"""

from datetime import UTC, date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Final, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx2

from orbit_api.services.finance.money import Currency
from orbit_api.services.investments.models import Holding, HoldingKind
from orbit_api.services.investments.quantities import MAX_PRICE, PRICE_DECIMALS, PRICE_SCALE
from orbit_api.services.investments.valuation import (
    Instrument,
    PriceFeedError,
    Quote,
    price_key,
)

MFAPI_URL: Final = "https://api.mfapi.in"
YAHOO_URL: Final = "https://query1.finance.yahoo.com"
TIMEOUT: Final = httpx2.Timeout(15.0, connect=5.0)
SEARCH_LIMIT: Final = 10
# Yahoo refuses requests without a browser-like user agent.
_HEADERS: Final = {"User-Agent": "Mozilla/5.0 (compatible; Orbit)", "Accept": "application/json"}
_YAHOO_TYPES: Final[dict[str, HoldingKind]] = {"EQUITY": "stock", "ETF": "etf"}
_YAHOO_EXCHANGES: Final = {".NS": "NSE", ".BO": "BSE"}

type Json = dict[str, object]


class HttpPriceFeed:
    """Both feeds over one shared HTTP client. Close it on shutdown."""

    def __init__(
        self,
        transport: httpx2.AsyncBaseTransport | None = None,
        *,
        mfapi_url: str = MFAPI_URL,
        yahoo_url: str = YAHOO_URL,
    ) -> None:
        self._client = httpx2.AsyncClient(
            timeout=TIMEOUT, transport=transport, follow_redirects=False, headers=_HEADERS
        )
        self._mfapi = mfapi_url
        self._yahoo = yahoo_url

    async def aclose(self) -> None:
        await self._client.aclose()

    async def quotes(self, holding: Holding, start: date, end: date) -> list[Quote]:
        key = price_key(holding)
        if key is None or start > end:
            return []
        if holding.kind == "mutual_fund":
            prices = await self._fund_navs(key, holding.currency, start, end)
        else:
            prices = await self._chart(key, holding.currency, start, end)
        return [
            Quote(holding_id=holding.id, price_date=day, price=price, source="provider")
            for day, price in sorted(prices.items())
        ]

    async def search(self, kind: HoldingKind, query: str) -> list[Instrument]:
        if kind == "mutual_fund":
            return await self._search_funds(query)
        return await self._search_securities(kind, query)

    # mfapi.in

    async def _fund_navs(
        self, code: str, currency: Currency, start: date, end: date
    ) -> dict[date, int]:
        if currency != "INR":
            return {}
        body = await self._get(f"{self._mfapi}/mf/{code}")
        if not isinstance(body, dict):
            raise PriceFeedError
        rows = cast(Json, body).get("data")
        if not isinstance(rows, list):
            return {}  # An unknown scheme code.
        prices: dict[date, int] = {}
        for row in cast(list[object], rows):
            if not isinstance(row, dict):
                continue
            row = cast(Json, row)
            day = _parse_day(row.get("date"))
            price = _scaled(row.get("nav"))
            if day is not None and price is not None and start <= day <= end:
                prices[day] = price
        return prices

    async def _search_funds(self, query: str) -> list[Instrument]:
        body = await self._get(f"{self._mfapi}/mf/search", params={"q": query})
        if not isinstance(body, list):
            raise PriceFeedError
        found: list[Instrument] = []
        for row in cast(list[object], body):
            if not isinstance(row, dict):
                continue
            row = cast(Json, row)
            code, name = row.get("schemeCode"), row.get("schemeName")
            if isinstance(code, int | str) and isinstance(name, str) and str(code).isdigit():
                found.append(
                    Instrument(
                        kind="mutual_fund",
                        name=name.strip()[:200],
                        symbol=str(code),
                        currency="INR",
                    )
                )
            if len(found) == SEARCH_LIMIT:
                break
        return found

    # Yahoo Finance

    async def _chart(
        self, ticker: str, currency: Currency, start: date, end: date
    ) -> dict[date, int]:
        # One day either side: the range is in UTC, the dates in the exchange's time zone.
        period1 = int(datetime.combine(start - timedelta(days=1), time(), UTC).timestamp())
        period2 = int(datetime.combine(end + timedelta(days=2), time(), UTC).timestamp())
        body = await self._get(
            f"{self._yahoo}/v8/finance/chart/{ticker}",
            params={"period1": period1, "period2": period2, "interval": "1d"},
            missing_ok=True,
        )
        result = _first(_dig(body, "chart", "result"))
        if not isinstance(result, dict):
            return {}
        result = cast(Json, result)
        meta = result.get("meta")
        if not isinstance(meta, dict) or cast(Json, meta).get("currency") != currency:
            return {}  # Unknown, or priced in another currency than the holding.
        zone = _zone(cast(Json, meta).get("exchangeTimezoneName"))
        stamps = result.get("timestamp")
        closes = _first(_dig(result, "indicators", "quote"))
        closes = cast(Json, closes).get("close") if isinstance(closes, dict) else None
        if not isinstance(stamps, list) or not isinstance(closes, list):
            return {}
        prices: dict[date, int] = {}
        for stamp, close in zip(
            cast(list[object], stamps), cast(list[object], closes), strict=False
        ):
            if not isinstance(stamp, int):
                continue
            day = datetime.fromtimestamp(stamp, zone).date()
            price = _scaled(close)
            if price is not None and start <= day <= end:
                prices[day] = price
        return prices

    async def _search_securities(self, kind: HoldingKind, query: str) -> list[Instrument]:
        body = await self._get(
            f"{self._yahoo}/v1/finance/search",
            params={"q": query, "quotesCount": 20, "newsCount": 0, "listsCount": 0},
        )
        rows = _dig(body, "quotes")
        if not isinstance(rows, list):
            raise PriceFeedError
        found: list[Instrument] = []
        for row in cast(list[object], rows):
            if not isinstance(row, dict):
                continue
            row = cast(Json, row)
            symbol = row.get("symbol")
            name = row.get("longname") or row.get("shortname")
            if (
                _YAHOO_TYPES.get(str(row.get("quoteType"))) != kind
                or not isinstance(symbol, str)
                or not isinstance(name, str)
            ):
                continue
            ticker, exchange = symbol, str(row.get("exchDisp") or "")
            for suffix, market in _YAHOO_EXCHANGES.items():
                if symbol.endswith(suffix):
                    ticker, exchange = symbol.removesuffix(suffix), market
            sector = row.get("sector")
            found.append(
                Instrument(
                    kind=kind,
                    name=name.strip()[:200],
                    symbol=ticker[:40],
                    exchange=exchange[:20],
                    category=sector[:100] if isinstance(sector, str) else "",
                    currency="INR" if exchange in ("NSE", "BSE") else None,
                )
            )
            if len(found) == SEARCH_LIMIT:
                break
        return found

    # Plumbing

    async def _get(
        self, url: str, *, params: dict[str, str | int] | None = None, missing_ok: bool = False
    ) -> object:
        try:
            response = await self._client.get(url, params=params)
        except httpx2.HTTPError:
            raise PriceFeedError from None
        if missing_ok and response.status_code == 404:
            return None
        if response.status_code != 200:
            raise PriceFeedError
        try:
            return response.json()
        except ValueError:
            raise PriceFeedError from None


def _dig(value: object, *keys: str) -> object:
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = cast(Json, value).get(key)
    return value


def _first(value: object) -> object:
    return cast(list[object], value)[0] if isinstance(value, list) and value else None


def _parse_day(value: object) -> date | None:
    """mfapi.in dates are `dd-mm-yyyy`."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%d-%m-%Y").date()
    except ValueError:
        return None


def _scaled(value: object) -> int | None:
    """A price as a scaled integer, rounded half up to 6 decimals; `None` if unusable."""
    if isinstance(value, bool) or not isinstance(value, str | int | float):
        return None
    try:
        amount = Decimal(str(value)).quantize(Decimal(1).scaleb(-PRICE_DECIMALS), ROUND_HALF_UP)
    except InvalidOperation:
        return None
    if not amount.is_finite():
        return None
    scaled = int(amount * PRICE_SCALE)
    return scaled if 0 < scaled <= MAX_PRICE else None


def _zone(name: object) -> ZoneInfo:
    try:
        return ZoneInfo(name) if isinstance(name, str) else ZoneInfo("UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")
