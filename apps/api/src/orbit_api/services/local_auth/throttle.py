"""Slowing down password guessing against local accounts.

Failed sign-ins are counted per account (email) and per client address in a sliding window;
past the limit, further attempts are refused until the oldest failure leaves the window. A
successful sign-in clears its account's count. Sign-ups are counted per client address.

Counts live in the API process's memory: they reset on restart and aren't shared between API
processes. That is enough to turn an online guessing attack from thousands of tries a minute
into a handful, which is the goal; it is not an account lockout.
"""

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from orbit_api.utils.clock import utc_now

# Bounds memory under a flood of distinct keys; the oldest key is forgotten first.
MAX_TRACKED_KEYS = 10_000


@dataclass(frozen=True, slots=True)
class Limit:
    attempts: int
    window: timedelta


class SlidingWindow:
    """At most `limit.attempts` recorded events per key within `limit.window`."""

    def __init__(self, limit: Limit, *, clock: Callable[[], datetime] = utc_now) -> None:
        self._limit = limit
        self._clock = clock
        self._events: dict[str, deque[datetime]] = {}

    def retry_after(self, key: str) -> timedelta | None:
        """How long until `key` may try again, or `None` if it may now."""
        events = self._current(key)
        if events is None or len(events) < self._limit.attempts:
            return None
        return events[0] + self._limit.window - self._clock()

    def record(self, key: str) -> None:
        events = self._current(key)
        if events is None:
            if len(self._events) >= MAX_TRACKED_KEYS:
                del self._events[next(iter(self._events))]
            events = self._events[key] = deque()
        events.append(self._clock())

    def clear(self, key: str) -> None:
        self._events.pop(key, None)

    def _current(self, key: str) -> deque[datetime] | None:
        events = self._events.get(key)
        if events is None:
            return None
        cutoff = self._clock() - self._limit.window
        while events and events[0] <= cutoff:
            events.popleft()
        if not events:
            del self._events[key]
            return None
        return events


ACCOUNT_LIMIT = Limit(10, timedelta(minutes=15))
CLIENT_LIMIT = Limit(50, timedelta(minutes=15))
SIGN_UP_LIMIT = Limit(10, timedelta(hours=1))


class SignInThrottle:
    """The limits applied to local sign-in and sign-up."""

    def __init__(
        self,
        *,
        per_account: Limit = ACCOUNT_LIMIT,
        per_client: Limit = CLIENT_LIMIT,
        sign_ups_per_client: Limit = SIGN_UP_LIMIT,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._accounts = SlidingWindow(per_account, clock=clock)
        self._clients = SlidingWindow(per_client, clock=clock)
        self._sign_ups = SlidingWindow(sign_ups_per_client, clock=clock)

    def sign_in_retry_after(self, email: str, client: str) -> timedelta | None:
        waits = [
            wait
            for wait in (self._accounts.retry_after(email), self._clients.retry_after(client))
            if wait is not None
        ]
        return max(waits) if waits else None

    def sign_in_failed(self, email: str, client: str) -> None:
        self._accounts.record(email)
        self._clients.record(client)

    def sign_in_succeeded(self, email: str) -> None:
        self._accounts.clear(email)

    def sign_up_retry_after(self, client: str) -> timedelta | None:
        return self._sign_ups.retry_after(client)

    def sign_up_attempted(self, client: str) -> None:
        self._sign_ups.record(client)
