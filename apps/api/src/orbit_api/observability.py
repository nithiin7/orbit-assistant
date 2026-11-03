"""Request IDs, request logging, and log formatting.

Every request gets an ID: the caller's `X-Request-ID` when it is a short, plain token (so a
reverse proxy's ID carries through), otherwise a new one. The ID is returned in the response's
`X-Request-ID` header and stamped on every `orbit_api` log record written while the request is
handled, so a failure a person reports can be matched to the server's log.

Request logs record the method, the path without its query string, the status, and the
duration. Query strings are left out because they carry search terms and provider tokens.
Uvicorn's own access log, which would print them, is turned off (see `__main__`).
"""

import json
import logging
import re
import time
import uuid
from contextvars import ContextVar
from typing import Any, Final

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id_var: ContextVar[str | None] = ContextVar("orbit_request_id", default=None)

_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

# Sent on every API response unless a route set its own. API responses are data, never pages:
# they may not be framed, sniffed into another type, or leak the URL as a referrer, and nothing
# personal is kept in shared or browser caches.
SECURITY_HEADERS: Final[tuple[tuple[str, str], ...]] = (
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "no-referrer"),
    ("Cache-Control", "no-store"),
)

request_logger = logging.getLogger("orbit_api.requests")

_PROBES = "/api/v1/health"


class RequestContextMiddleware:
    """Assigns request IDs, adds security headers, and logs each request once."""

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        incoming = _header(scope, b"x-request-id")
        request_id = incoming if incoming and _REQUEST_ID.match(incoming) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status = 500

        async def send_with_headers(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
                for name, value in SECURITY_HEADERS:
                    if name not in headers:
                        headers[name] = value
            await send(message)

        try:
            await self._app(scope, receive, send_with_headers)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 1)
            # Monitoring probes run every few seconds; logging each success would drown out
            # everything else. Failing probes are still logged.
            if not (scope["path"].startswith(_PROBES) and status < 400):
                request_logger.info(
                    "%s %s %s %.1fms",
                    scope["method"],
                    scope["path"],
                    status,
                    duration_ms,
                    extra={
                        "http_method": scope["method"],
                        "http_path": scope["path"],
                        "http_status": status,
                        "duration_ms": duration_ms,
                    },
                )
            request_id_var.reset(token)


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope["headers"]:
        if key == name:
            return value.decode("latin-1")
    return None


class RequestIdFilter(logging.Filter):
    """Adds `request_id` to every record (`-` outside a request)."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get() or "-"
        return True


# Attributes every LogRecord has; anything else on a record came from `extra=`.
_STANDARD_ATTRIBUTES: Final = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__
) | {"message", "asctime", "request_id", "color_message"}


class JsonFormatter(logging.Formatter):
    """One JSON object per line, for log collectors."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        entry |= {
            key: value
            for key, value in record.__dict__.items()
            if key not in _STANDARD_ATTRIBUTES and not key.startswith("_")
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


TEXT_FORMAT: Final = "%(levelname)s:     [%(request_id)s] %(name)s: %(message)s"
