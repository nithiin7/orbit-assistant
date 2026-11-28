"""The latest Orbit release from GitHub's public releases API, for update notices.

Only the repository name leaves the server, with no account, workspace, or user details. No
token is used, so GitHub allows 60 requests an hour from the server's address; the service asks
about once a day. Errors never carry response bodies.
"""

import re
from datetime import datetime
from typing import Final, cast

import httpx2

from orbit_api.services.system.models import Release, ReleaseFeedError

API_URL: Final = "https://api.github.com"
TIMEOUT: Final = httpx2.Timeout(10.0, connect=5.0)
_HEADERS: Final = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "Orbit (self-hosted personal assistant)",
    "X-GitHub-Api-Version": "2022-11-28",
}
_TAG: Final = re.compile(r"^v?(\d{1,6}\.\d{1,6}\.\d{1,6})$")

type Json = dict[str, object]


class GitHubReleaseFeed:
    """One HTTP client for update checks. Close it on shutdown."""

    def __init__(
        self, transport: httpx2.AsyncBaseTransport | None = None, *, api_url: str = API_URL
    ) -> None:
        self._client = httpx2.AsyncClient(
            timeout=TIMEOUT, transport=transport, follow_redirects=False, headers=_HEADERS
        )
        self._url = api_url.rstrip("/")

    async def latest(self, repository: str) -> Release:
        """The newest published release; GitHub leaves out drafts and pre-releases."""
        try:
            response = await self._client.get(f"{self._url}/repos/{repository}/releases/latest")
        except httpx2.HTTPError:
            raise ReleaseFeedError from None
        if response.status_code != 200:
            raise ReleaseFeedError
        try:
            data = response.json()
        except ValueError:
            raise ReleaseFeedError from None
        return parse_release(data)

    async def aclose(self) -> None:
        await self._client.aclose()


def parse_release(data: object) -> Release:
    if not isinstance(data, dict):
        raise ReleaseFeedError
    body = cast(Json, data)
    tag = body.get("tag_name")
    match = _TAG.match(tag) if isinstance(tag, str) else None
    if match is None:
        raise ReleaseFeedError
    return Release(version=match.group(1), published_at=_timestamp(body.get("published_at")))


def _timestamp(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None
