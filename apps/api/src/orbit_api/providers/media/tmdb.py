"""The title catalog behind the watchlist: The Movie Database (TMDB), with the API key a
workspace saved in Settings → Watchlist.

Only a search phrase, a title's TMDB ID, or a poster path leaves the server. Nothing is logged,
and errors never carry response bodies or the key. Accepts either a v3 API key or a v4 read
access token.
"""

import re
from datetime import date
from typing import Final, cast

import httpx2

from orbit_api.services.watchlist.models import (
    CatalogAuthError,
    CatalogError,
    CatalogNotFoundError,
    Poster,
    TitleDetails,
    TitleMatch,
    WatchKind,
)
from orbit_api.services.watchlist.service import PosterSize

API_URL: Final = "https://api.themoviedb.org/3"
IMAGE_URL: Final = "https://image.tmdb.org/t/p"
TIMEOUT: Final = httpx2.Timeout(15.0, connect=5.0)
SEARCH_LIMIT: Final = 12
MAX_IMAGE_BYTES: Final = 2 * 1024 * 1024
_SIZES: Final[dict[PosterSize, str]] = {"thumbnail": "w92", "full": "w342"}
_KINDS: Final[dict[str, WatchKind]] = {"movie": "movie", "tv": "series"}
_PATHS: Final[dict[WatchKind, str]] = {"movie": "movie", "series": "tv"}
POSTER_PATH: Final = re.compile(r"/[A-Za-z0-9_-]{1,100}\.(?:jpg|jpeg|png)")

type Json = dict[str, object]


class TmdbClient:
    """One HTTP client for every workspace's TMDB calls. Close it on shutdown."""

    def __init__(
        self,
        transport: httpx2.AsyncBaseTransport | None = None,
        *,
        api_url: str = API_URL,
        image_url: str = IMAGE_URL,
    ) -> None:
        self._client = httpx2.AsyncClient(
            timeout=TIMEOUT,
            transport=transport,
            follow_redirects=False,
            headers={"Accept": "application/json"},
        )
        self._api = api_url
        self._images = image_url

    def catalog(self, api_key: str) -> "TmdbCatalog":
        return TmdbCatalog(self._client, api_key, api_url=self._api, image_url=self._images)

    async def aclose(self) -> None:
        await self._client.aclose()


class TmdbCatalog:
    """TMDB with one workspace's key, over the shared client."""

    def __init__(
        self, client: httpx2.AsyncClient, api_key: str, *, api_url: str, image_url: str
    ) -> None:
        self._client = client
        # v4 read access tokens are JWTs; v3 keys are short hex strings sent as a parameter.
        self._params: dict[str, str] = {}
        self._headers: dict[str, str] = {}
        if api_key.startswith("eyJ"):
            self._headers["Authorization"] = f"Bearer {api_key}"
        else:
            self._params["api_key"] = api_key
        self._api = api_url
        self._images = image_url

    async def verify(self) -> None:
        """Check the key works. Raises `CatalogAuthError` if TMDB refuses it."""
        await self._get_json("/authentication", {})

    async def search(self, query: str) -> list[TitleMatch]:
        data = await self._get_json(
            "/search/multi", {"query": query, "include_adult": "false", "page": "1"}
        )
        found: list[TitleMatch] = []
        for row in _rows(data, "results"):
            kind = _KINDS.get(str(row.get("media_type")))
            source_id = row.get("id")
            title = _text(row.get("title") or row.get("name"))
            if kind is None or not isinstance(source_id, int) or not title:
                continue
            found.append(
                TitleMatch(
                    source_id=source_id,
                    kind=kind,
                    title=title[:300],
                    release_year=_year(row.get("release_date") or row.get("first_air_date")),
                    overview=_text(row.get("overview"))[:4000],
                    poster_path=_poster_path(row.get("poster_path")),
                )
            )
            if len(found) == SEARCH_LIMIT:
                break
        return found

    async def details(self, kind: WatchKind, source_id: int) -> TitleDetails:
        data = await self._get_json(f"/{_PATHS[kind]}/{source_id}", {})
        if not isinstance(data, dict):
            raise CatalogError
        row = cast(Json, data)
        title = _text(row.get("title") or row.get("name"))
        if not title:
            raise CatalogError
        genres = tuple(
            name[:60] for genre in _rows(row, "genres") if (name := _text(genre.get("name")))
        )
        if kind == "movie":
            runtime = _minutes(row.get("runtime"))
            seasons = None
        else:
            run_times = row.get("episode_run_time")
            runtime = _minutes(cast(list[object], run_times)[0]) if _nonempty(run_times) else None
            if runtime is None:
                runtime = _minutes(_dig(row, "last_episode_to_air", "runtime"))
            counts = sorted(
                (number, count)
                for season in _rows(row, "seasons")
                if isinstance(number := season.get("season_number"), int)
                and number >= 1
                and isinstance(count := season.get("episode_count"), int)
                and count >= 0
            )
            # Seasons announced without episodes yet are left out, so progress can't stall on
            # one, and specials (season 0) never count.
            seasons = tuple(count for _, count in counts if count > 0)[:200] or None
        return TitleDetails(
            source_id=source_id,
            kind=kind,
            title=title[:300],
            release_year=_year(row.get("release_date") or row.get("first_air_date")),
            overview=_text(row.get("overview"))[:4000],
            genres=genres[:10],
            runtime_minutes=runtime,
            season_episodes=seasons,
            poster_path=_poster_path(row.get("poster_path")),
        )

    async def poster(self, path: str, size: PosterSize) -> Poster:
        if not POSTER_PATH.fullmatch(path):
            raise CatalogNotFoundError
        try:
            response = await self._client.get(f"{self._images}/{_SIZES[size]}{path}")
        except httpx2.HTTPError:
            raise CatalogError from None
        if response.status_code == 404:
            raise CatalogNotFoundError
        if response.status_code != 200 or len(response.content) > MAX_IMAGE_BYTES:
            raise CatalogError
        data = response.content
        if data.startswith(b"\xff\xd8\xff"):
            return Poster(content_type="image/jpeg", data=data)
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return Poster(content_type="image/png", data=data)
        raise CatalogError

    async def _get_json(self, path: str, params: dict[str, str]) -> object:
        try:
            response = await self._client.get(
                f"{self._api}{path}", params={**params, **self._params}, headers=self._headers
            )
        except httpx2.HTTPError:
            raise CatalogError from None
        if response.status_code == 401:
            raise CatalogAuthError
        if response.status_code == 404:
            raise CatalogNotFoundError
        if response.status_code != 200:
            raise CatalogError
        try:
            return response.json()
        except ValueError:
            raise CatalogError from None


def _rows(value: object, key: str) -> list[Json]:
    rows = cast(Json, value).get(key) if isinstance(value, dict) else None
    if not isinstance(rows, list):
        return []
    return [cast(Json, row) for row in cast(list[object], rows) if isinstance(row, dict)]


def _dig(value: object, *keys: str) -> object:
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = cast(Json, value).get(key)
    return value


def _nonempty(value: object) -> bool:
    return isinstance(value, list) and len(cast(list[object], value)) > 0


def _text(value: object) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def _year(value: object) -> int | None:
    if not isinstance(value, str):
        return None
    try:
        year = date.fromisoformat(value).year
    except ValueError:
        return None
    return year if 1870 <= year <= 2200 else None


def _minutes(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if 1 <= value <= 6000 else None


def _poster_path(value: object) -> str | None:
    return value if isinstance(value, str) and POSTER_PATH.fullmatch(value) else None
