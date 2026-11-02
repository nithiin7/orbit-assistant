"""Name resolution for endpoint checks, off the event loop."""

import socket

import anyio.to_thread

from orbit_api.services.ai.models import EndpointNotAllowedError


async def resolve_host(host: str) -> list[str]:
    try:
        infos = await anyio.to_thread.run_sync(
            lambda: socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
        )
    except OSError:
        raise EndpointNotAllowedError("That address couldn't be found.") from None
    return sorted({str(info[4][0]) for info in infos})
