"""Place search with Nominatim, OpenStreetMap's geocoder, for workspaces that turn online maps
on.

Only the search phrase leaves the server: no account, workspace, or user details. The public
instance allows at most one request a second from a client and asks that results be cached, so
requests are spaced a second apart across the whole server and recent answers are kept in
memory. Self-hosters can point `ORBIT_GEOCODER_URL` at their own instance.
"""

import time
from collections import OrderedDict
from typing import Final, cast

import anyio
import httpx2

from orbit_api.services.places.countries import COUNTRY_CODES
from orbit_api.services.places.models import Location, PlaceMatch, PlaceSearchError

DEFAULT_URL: Final = "https://nominatim.openstreetmap.org"
TIMEOUT: Final = httpx2.Timeout(10.0, connect=5.0)
USER_AGENT: Final = "Orbit/1.0 (self-hosted personal assistant)"
RESULT_LIMIT: Final = 8
MIN_INTERVAL_SECONDS: Final = 1.0
CACHE_SIZE: Final = 256
_LOCALITY_KEYS: Final = ("city", "town", "village", "municipality", "county", "state")

type Json = dict[str, object]


class NominatimGeocoder:
    """One HTTP client for every workspace's place searches. Close it on shutdown."""

    def __init__(
        self,
        transport: httpx2.AsyncBaseTransport | None = None,
        *,
        base_url: str = DEFAULT_URL,
        min_interval: float = MIN_INTERVAL_SECONDS,
    ) -> None:
        self._client = httpx2.AsyncClient(
            timeout=TIMEOUT,
            transport=transport,
            follow_redirects=False,
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        )
        self._url = base_url.rstrip("/")
        self._min_interval = min_interval
        self._lock = anyio.Lock()
        self._last_request = 0.0
        self._cache: OrderedDict[str, list[PlaceMatch]] = OrderedDict()

    async def search(self, query: str) -> list[PlaceMatch]:
        key = " ".join(query.casefold().split())
        if (cached := self._cache.get(key)) is not None:
            self._cache.move_to_end(key)
            return cached
        async with self._lock:
            wait = self._last_request + self._min_interval - time.monotonic()
            if wait > 0:
                await anyio.sleep(wait)
            try:
                response = await self._client.get(
                    f"{self._url}/search",
                    params={
                        "q": query,
                        "format": "jsonv2",
                        "addressdetails": "1",
                        "limit": str(RESULT_LIMIT),
                        "accept-language": "en",
                    },
                )
            except httpx2.HTTPError:
                raise PlaceSearchError from None
            finally:
                self._last_request = time.monotonic()
        if response.status_code != 200:
            raise PlaceSearchError
        try:
            data = response.json()
        except ValueError:
            raise PlaceSearchError from None
        matches = parse_results(data)
        self._cache[key] = matches
        if len(self._cache) > CACHE_SIZE:
            self._cache.popitem(last=False)
        return matches

    async def aclose(self) -> None:
        await self._client.aclose()


def parse_results(data: object) -> list[PlaceMatch]:
    """Nominatim's `jsonv2` results as matches, skipping any without a known country or a valid
    position."""
    if not isinstance(data, list):
        raise PlaceSearchError
    matches: list[PlaceMatch] = []
    for item in cast(list[object], data):
        if not isinstance(item, dict):
            continue
        row = cast(Json, item)
        address = row.get("address")
        address = cast(Json, address) if isinstance(address, dict) else {}
        country = _text(address.get("country_code")).upper()
        location = _location(row.get("lat"), row.get("lon"))
        label = _text(row.get("display_name"))
        name = _text(row.get("name")) or label.split(",", 1)[0].strip()
        if country not in COUNTRY_CODES or location is None or not name:
            continue
        locality = next(
            (text for key in _LOCALITY_KEYS if (text := _text(address.get(key))) and text != name),
            "",
        )
        matches.append(
            PlaceMatch(
                name=name[:120],
                locality=locality[:120],
                country_code=country,
                location=location,
                label=label[:300],
            )
        )
    return matches


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _location(lat: object, lon: object) -> Location | None:
    try:
        latitude = float(cast(str, lat))
        longitude = float(cast(str, lon))
    except (TypeError, ValueError):
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    return Location(latitude=round(latitude, 6), longitude=round(longitude, 6))
