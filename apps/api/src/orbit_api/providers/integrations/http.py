"""HTTP plumbing shared by the integration adapters: timeouts, bounded retries with exponential
backoff (honoring `Retry-After`), error mapping, JSON reading, and size-capped downloads.

Errors never carry tokens or response bodies (which may contain personal data): they are mapped
to the connector errors in `services/integrations/connectors.py` with fixed messages. Redirects
are never followed with credentials attached.
"""

import asyncio
import json
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Final, cast
from zoneinfo import ZoneInfo

import httpx2

from orbit_api.services.integrations.connectors import (
    AccessDeniedError,
    CursorExpiredError,
    FileTooLargeError,
    ProviderError,
    ProviderResponseError,
    ProviderUnavailableError,
    RateLimitedError,
    ReauthRequiredError,
    RemoteNotFoundError,
    VersionConflictError,
)

type Json = dict[str, object]

TIMEOUT: Final = httpx2.Timeout(30.0, connect=10.0)
# Retries within one call, for idempotent requests only; runs retry further with backoff.
MAX_RETRIES: Final = 2
MAX_INLINE_WAIT: Final = 10.0
# Google reports quota exhaustion as 403 with these reasons.
_RATE_LIMIT_REASONS: Final = frozenset(
    {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"}
)

Sleep = Callable[[float], Awaitable[None]]


class ApiClient:
    def __init__(
        self,
        client: httpx2.AsyncClient,
        name: str,
        *,
        sleep: Sleep = asyncio.sleep,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        self._client = client
        self._name = name
        self._sleep = sleep
        self._max_retries = max_retries

    async def send(
        self,
        method: str,
        url: str,
        *,
        token: str | None = None,
        params: Mapping[str, str | list[str]] | None = None,
        json_body: Json | None = None,
        form: Mapping[str, str] | None = None,
        headers: Mapping[str, str] | None = None,
        expect_gone: bool = False,
    ) -> httpx2.Response:
        """Send a request; return a 2xx or 3xx response, or raise a connector error.

        `expect_gone` maps 410 to `CursorExpiredError` (an expired sync token) rather than to
        `RemoteNotFoundError`."""
        all_headers = dict(headers or {})
        if token is not None:
            all_headers["Authorization"] = f"Bearer {token}"
        idempotent = method in ("GET", "HEAD", "DELETE")
        attempt = 0
        while True:
            try:
                response = await self._client.request(
                    method,
                    url,
                    params=params,
                    json=json_body,
                    data=form,
                    headers=all_headers,
                )
            except httpx2.HTTPError as exc:
                if idempotent and attempt < self._max_retries:
                    attempt += 1
                    await self._sleep(min(2.0**attempt, MAX_INLINE_WAIT))
                    continue
                raise ProviderUnavailableError(f"Couldn't reach {self._name}.") from exc
            try:
                self._check(response, expect_gone)
            except (RateLimitedError, ProviderUnavailableError) as exc:
                wait = exc.retry_after if isinstance(exc, RateLimitedError) else None
                delay = wait if wait is not None else 2.0 ** (attempt + 1)
                if idempotent and attempt < self._max_retries and delay <= MAX_INLINE_WAIT:
                    attempt += 1
                    await self._sleep(delay)
                    continue
                raise
            return response

    async def json(
        self,
        method: str,
        url: str,
        *,
        token: str | None = None,
        params: Mapping[str, str | list[str]] | None = None,
        json_body: Json | None = None,
        form: Mapping[str, str] | None = None,
        headers: Mapping[str, str] | None = None,
        expect_gone: bool = False,
    ) -> Json:
        response = await self.send(
            method,
            url,
            token=token,
            params=params,
            json_body=json_body,
            form=form,
            headers=headers,
            expect_gone=expect_gone,
        )
        if response.status_code == 204 or not response.content:
            return {}
        try:
            body: object = response.json()
        except ValueError as exc:
            raise ProviderResponseError(
                f"{self._name} sent a response Orbit couldn't read."
            ) from exc
        if not isinstance(body, dict):
            raise ProviderResponseError(f"{self._name} sent a response Orbit couldn't read.")
        return cast(Json, body)

    async def download(
        self,
        url: str,
        *,
        token: str | None,
        max_bytes: int,
        params: Mapping[str, str] | None = None,
    ) -> bytes | str:
        """The response body, at most `max_bytes`; or the `Location` of a redirect (which the
        caller fetches without credentials, after checking it)."""
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        try:
            async with self._client.stream("GET", url, params=params, headers=headers) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise ProviderResponseError()
                    return location
                if response.status_code >= 400:
                    await response.aread()
                    self._check(response, False)
                declared = response.headers.get("content-length")
                if declared is not None and declared.isdigit() and int(declared) > max_bytes:
                    raise FileTooLargeError
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise FileTooLargeError
                    chunks.append(chunk)
                return b"".join(chunks)
        except httpx2.HTTPError as exc:
            raise ProviderUnavailableError(f"Couldn't reach {self._name}.") from exc

    def _check(self, response: httpx2.Response, expect_gone: bool) -> None:
        status = response.status_code
        if status < 400:
            return
        if status == 401:
            raise ReauthRequiredError
        if status == 403:
            if _google_reason(response) in _RATE_LIMIT_REASONS:
                raise RateLimitedError(_retry_after(response))
            raise AccessDeniedError
        if status == 404:
            raise RemoteNotFoundError
        if status == 410:
            raise CursorExpiredError if expect_gone else RemoteNotFoundError
        if status == 412:
            raise VersionConflictError
        if status == 429:
            raise RateLimitedError(_retry_after(response))
        if status >= 500:
            raise ProviderUnavailableError(f"{self._name} had a server error ({status}).")
        if status == 400 and _oauth_error(response) == "invalid_grant":
            raise ReauthRequiredError
        raise ProviderError(f"{self._name} refused the request ({status}).")


def _body(response: httpx2.Response) -> object:
    try:
        return response.json()
    except (ValueError, json.JSONDecodeError):
        return None


def _oauth_error(response: httpx2.Response) -> str | None:
    body = _body(response)
    if isinstance(body, dict):
        error = cast(Json, body).get("error")
        return error if isinstance(error, str) else None
    return None


def _google_reason(response: httpx2.Response) -> str | None:
    error = obj(obj(_body(response)).get("error"))
    for item in items(error.get("errors")):
        reason = obj(item).get("reason")
        if isinstance(reason, str):
            return reason
    return None


def _retry_after(response: httpx2.Response) -> float | None:
    value = response.headers.get("retry-after")
    if value is None:
        return None
    if value.strip().isdigit():
        return float(value)
    try:
        moment = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    return max((moment - datetime.now(UTC)).total_seconds(), 0.0)


def obj(value: object) -> Json:
    return cast(Json, value) if isinstance(value, dict) else {}


def items(value: object) -> list[object]:
    return cast(list[object], value) if isinstance(value, list) else []


def text(value: object) -> str:
    return value if isinstance(value, str) else ""


def integer(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def parse_instant(value: object, default_zone: str = "UTC") -> datetime | None:
    """An ISO 8601 date-time as an aware datetime. Values without an offset are in
    `default_zone`. Fractions beyond microseconds (Graph sends seven digits) are dropped."""
    if not isinstance(value, str) or not value:
        return None
    raw = value.strip()
    if "." in raw:
        head, _, rest = raw.partition(".")
        digits = "".join(c for c in rest if c.isdigit())
        suffix = rest[len(digits) :]
        raw = f"{head}.{digits[:6]}{suffix}" if digits else head + suffix
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=ZoneInfo(default_zone))
    return moment
