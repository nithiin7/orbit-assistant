"""The default clock for services, which take a `clock` argument so tests can fix the time."""

from datetime import UTC, datetime


def utc_now() -> datetime:
    return datetime.now(UTC)
