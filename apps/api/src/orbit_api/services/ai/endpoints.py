"""Checking a provider endpoint before Orbit sends anything to it.

- Only `http` and `https`, with no credentials in the URL.
- Plain `http` only to private hosts: an API key or personal data never crosses the internet
  unencrypted.
- When private endpoints aren't allowed (cloud mode by default), the host must not be, or
  resolve to, a loopback, private, or link-local address, so a hosted Orbit can't be used to
  reach its own internal network. Resolution is checked when the endpoint is saved or tested;
  a DNS record changed afterwards isn't re-checked (see the documented limitations).
"""

import ipaddress
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

from orbit_api.services.ai.models import EndpointNotAllowedError
from orbit_api.services.ai.providers import is_private_host

# Resolves a host name to its IP addresses.
type Resolver = Callable[[str], Awaitable[list[str]]]


async def check_endpoint(url: str, *, allow_private: bool, resolve: Resolver) -> str:
    """The normalized URL (no trailing slash), or `EndpointNotAllowedError`."""
    parts = urlsplit(url.strip())
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise EndpointNotAllowedError("Enter an http:// or https:// address.")
    if parts.username or parts.password:
        raise EndpointNotAllowedError("Don't put credentials in the address; use the API key.")
    if parts.query or parts.fragment:
        raise EndpointNotAllowedError("The address can't have a query or fragment.")
    host = parts.hostname.lower()
    private = is_private_host(host)
    if parts.scheme == "http" and not private:
        raise EndpointNotAllowedError("Use https:// for providers that aren't on this network.")
    if not allow_private:
        addresses = [host] if private else await resolve(host)
        if private or any(_is_internal(address) for address in addresses):
            raise EndpointNotAllowedError(
                "This server doesn't allow providers on private or local addresses."
            )
    return parts.geturl().rstrip("/")


def _is_internal(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return True
    return (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )
