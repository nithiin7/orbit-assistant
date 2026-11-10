"""Fetches pages and images for link previews, guarding against server-side request forgery.

A saved link is untrusted input that makes the server connect somewhere, so every request:

- uses `http` or `https` on the default port (80 or 443) only;
- resolves the host itself and refuses unless every address is public (no loopback, private,
  link-local, carrier-grade NAT, multicast, or reserved ranges, including IPv4-mapped IPv6);
- connects to the address it checked, sending the real host name as `Host` and in TLS (SNI and
  certificate checks), so a second DNS answer can't redirect the connection;
- follows at most four redirects, checking each hop the same way;
- ignores proxy environment variables, sends no cookies or credentials, reads at most a fixed
  number of bytes, and gives up after a few seconds.
"""

import ipaddress
import socket
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Final
from urllib.parse import urljoin, urlsplit, urlunsplit

import anyio
import httpx2

from orbit_api.services.bookmarks.models import (
    BlockedAddressError,
    FetchedPage,
    PreviewFetchError,
)
from orbit_api.services.bookmarks.preview import MAX_HTML_BYTES

DEFAULT_PORTS: Final = {"http": 80, "https": 443}
MAX_REDIRECTS: Final = 4
# The whole fetch, redirects included.
TOTAL_SECONDS: Final = 8.0
TIMEOUT: Final = httpx2.Timeout(5.0, connect=4.0)
USER_AGENT: Final = "Mozilla/5.0 (compatible; OrbitLinkPreview/1.0; +self-hosted)"
_HTML_TYPES: Final = ("text/html", "application/xhtml+xml")
_REDIRECTS: Final = (301, 302, 303, 307, 308)

type Resolver = Callable[[str, int], Awaitable[list[str]]]


async def resolve(host: str, port: int) -> list[str]:
    """Every address the host resolves to."""
    try:
        infos = await anyio.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        raise PreviewFetchError from None
    return [str(info[4][0]) for info in infos]


def is_public(address: str) -> bool:
    """Whether connecting to `address` reaches the public internet and nothing else."""
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _ascii_host(host: str) -> str:
    try:
        return host.encode("idna").decode("ascii")
    except UnicodeError:
        raise PreviewFetchError from None


class LinkPreviewClient:
    """Fetches pages and images for previews. A new connection per request, so a connection
    made for one host name is never reused for another."""

    def __init__(
        self,
        transport: httpx2.AsyncBaseTransport | None = None,
        resolver: Resolver = resolve,
    ) -> None:
        self._transport = transport
        self._resolve = resolver

    async def page(self, url: str) -> FetchedPage:
        """The page's HTML (its first `MAX_HTML_BYTES`), and where it ended up."""
        final_url, body, content_type = await self._get(
            url, MAX_HTML_BYTES, "text/html,application/xhtml+xml;q=0.9", truncate=True
        )
        media_type, _, params = content_type.partition(";")
        if media_type.strip().lower() not in _HTML_TYPES:
            raise PreviewFetchError
        charset = "utf-8"
        for param in params.split(";"):
            name, _, value = param.partition("=")
            if name.strip().lower() == "charset" and value.strip():
                charset = value.strip().strip("\"'")
        try:
            html = body.decode(charset, errors="replace")
        except LookupError:
            html = body.decode("utf-8", errors="replace")
        return FetchedPage(url=final_url, html=html)

    async def image(self, url: str, max_bytes: int) -> bytes:
        """An image's bytes; larger than `max_bytes` is an error. The caller checks the type."""
        _, body, _ = await self._get(url, max_bytes, "image/*", truncate=False)
        return body

    async def _get(
        self, url: str, limit: int, accept: str, *, truncate: bool
    ) -> tuple[str, bytes, str]:
        current = url
        try:
            with anyio.fail_after(TOTAL_SECONDS):
                for _ in range(MAX_REDIRECTS + 1):
                    async with self._send(current, accept) as response:
                        if response.status_code in _REDIRECTS:
                            location = response.headers.get("location")
                            if not location:
                                raise PreviewFetchError
                            current = urljoin(current, location)
                            continue
                        if response.status_code != 200:
                            raise PreviewFetchError
                        body = await _read(response, limit, truncate=truncate)
                        return current, body, response.headers.get("content-type", "")
        except TimeoutError:
            raise PreviewFetchError from None
        except httpx2.HTTPError:
            raise PreviewFetchError from None
        raise PreviewFetchError

    @asynccontextmanager
    async def _send(self, url: str, accept: str) -> AsyncGenerator[httpx2.Response]:
        parts = urlsplit(url)
        scheme = parts.scheme.lower()
        try:
            port = parts.port
        except ValueError:
            raise BlockedAddressError from None
        if scheme not in DEFAULT_PORTS or not parts.hostname or parts.username or parts.password:
            raise BlockedAddressError
        if port is not None and port != DEFAULT_PORTS[scheme]:
            raise BlockedAddressError
        host = _ascii_host(parts.hostname)
        addresses = await self._resolve(host, DEFAULT_PORTS[scheme])
        if not addresses or not all(is_public(address) for address in addresses):
            raise BlockedAddressError
        address = addresses[0].split("%", 1)[0]
        literal = f"[{address}]" if ":" in address else address
        target = urlunsplit((scheme, literal, parts.path or "/", parts.query, ""))
        async with httpx2.AsyncClient(
            transport=self._transport,
            timeout=TIMEOUT,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            request = client.build_request(
                "GET",
                target,
                headers={"Host": host, "User-Agent": USER_AGENT, "Accept": accept},
                extensions={"sni_hostname": host},
            )
            response = await client.send(request, stream=True)
            try:
                yield response
            finally:
                await response.aclose()


async def _read(response: httpx2.Response, limit: int, *, truncate: bool) -> bytes:
    declared = response.headers.get("content-length")
    if not truncate and declared and declared.isdigit() and int(declared) > limit:
        raise PreviewFetchError
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > limit:
            if not truncate:
                raise PreviewFetchError
            chunks.append(chunk[: limit - (size - len(chunk))])
            break
        chunks.append(chunk)
    return b"".join(chunks)
