"""HTTP plumbing shared by the provider adapters: error mapping, reading JSON safely, and
streaming lines.

Errors never carry the API key or the prompt. A provider's own error message is passed on only
for request errors (an unknown model, a bad parameter), shortened and with the key redacted,
because it tells the person what to fix; authentication errors use a fixed message, since some
providers echo part of the key in them.
"""

import json
from collections.abc import AsyncGenerator, AsyncIterator, Mapping
from contextlib import asynccontextmanager
from typing import Final, cast

import httpx2

from orbit_api.services.ai.providers import (
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
    ProviderRequestError,
    ProviderResponseError,
    ProviderUnavailableError,
)

MAX_ERROR_DETAIL: Final = 200

type Json = dict[str, object]


class ProviderHttp:
    """Sends requests for one adapter, mapping failures to `ProviderError`s."""

    def __init__(self, client: httpx2.AsyncClient, name: str, secret: str | None) -> None:
        self._client = client
        self._name = name
        self._secret = secret

    async def get(self, url: str, headers: Mapping[str, str]) -> Json:
        try:
            response = await self._client.get(url, headers=dict(headers))
        except httpx2.HTTPError as exc:
            raise self._unreachable() from exc
        await self._check(response)
        return self._json(response)

    async def post(self, url: str, headers: Mapping[str, str], body: Json) -> Json:
        try:
            response = await self._client.post(url, headers=dict(headers), json=body)
        except httpx2.HTTPError as exc:
            raise self._unreachable() from exc
        await self._check(response)
        return self._json(response)

    @asynccontextmanager
    async def stream_lines(
        self, url: str, headers: Mapping[str, str], body: Json
    ) -> AsyncGenerator[AsyncIterator[str]]:
        """The response's lines, for server-sent events and NDJSON."""
        try:
            async with self._client.stream(
                "POST", url, headers=dict(headers), json=body
            ) as response:
                await self._check(response)
                yield self._lines(response)
        except httpx2.HTTPError as exc:
            raise self._unreachable() from exc

    async def _lines(self, response: httpx2.Response) -> AsyncIterator[str]:
        try:
            async for line in response.aiter_lines():
                yield line
        except httpx2.HTTPError as exc:
            raise self._unreachable() from exc

    async def _check(self, response: httpx2.Response) -> None:
        status = response.status_code
        if status < 400:
            return
        await response.aread()
        if status in (401, 403):
            raise ProviderAuthError(f"{self._name} rejected the API key or its permissions.")
        if status == 429:
            raise ProviderRateLimitError(f"{self._name} is rate limiting or out of quota.")
        if status >= 500:
            raise ProviderUnavailableError(f"{self._name} had a server error ({status}).")
        detail = self._detail(response)
        suffix = f": {detail}" if detail else ""
        raise ProviderRequestError(f"{self._name} refused the request ({status}){suffix}")

    def _detail(self, response: httpx2.Response) -> str:
        try:
            body: object = response.json()
        except ValueError:
            return ""
        message: object = None
        if isinstance(body, dict):
            typed = cast(Json, body)
            error = typed.get("error")
            if isinstance(error, dict):
                message = cast(Json, error).get("message")
            elif isinstance(error, str):
                message = error
            else:
                message = typed.get("message")
        if not isinstance(message, str):
            return ""
        if self._secret:
            message = message.replace(self._secret, "[redacted]")
        return message[:MAX_ERROR_DETAIL]

    def _json(self, response: httpx2.Response) -> Json:
        try:
            body: object = response.json()
        except ValueError as exc:
            raise self.malformed() from exc
        if not isinstance(body, dict):
            raise self.malformed()
        return cast(Json, body)

    def _unreachable(self) -> ProviderError:
        return ProviderUnavailableError(f"Couldn't reach {self._name}. Check its address.")

    def malformed(self) -> ProviderError:
        return ProviderResponseError(f"{self._name} sent a response Orbit couldn't read.")


def obj(value: object) -> Json:
    return cast(Json, value) if isinstance(value, dict) else {}


def items(value: object) -> list[object]:
    return cast(list[object], value) if isinstance(value, list) else []


def text(value: object) -> str:
    return value if isinstance(value, str) else ""


def integer(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def floats(value: object) -> list[float] | None:
    values = items(value)
    if not values or any(isinstance(v, bool) or not isinstance(v, int | float) for v in values):
        return None
    return [float(cast(float, v)) for v in values]


def sse_data(line: str) -> Json | None:
    """The JSON of a server-sent event's `data:` line, or `None` for other lines and `[DONE]`."""
    if not line.startswith("data:"):
        return None
    payload = line[5:].strip()
    if not payload or payload == "[DONE]":
        return None
    try:
        value: object = json.loads(payload)
    except ValueError:
        return None
    return cast(Json, value) if isinstance(value, dict) else None
