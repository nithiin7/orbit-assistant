"""The installation's status page and update notices.

Update checks are off until someone turns them on. Then the server asks the release feed for
the configured repository's latest release at most once a day (an hour after a failed attempt,
and at most once a minute when asked to check now). Only the repository name leaves the server.
"""

import re
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Final, Protocol

from orbit_api.config import StorageMode
from orbit_api.services.system.models import (
    DatabaseStatus,
    Release,
    ReleaseFeedError,
    ServerFeatures,
    SystemStatus,
    UpdateCheckState,
    UpdateStatus,
    WorkerStatus,
)
from orbit_api.services.transactions import Transaction

CHECK_INTERVAL: Final = timedelta(days=1)
RETRY_INTERVAL: Final = timedelta(hours=1)
MIN_FORCED_INTERVAL: Final = timedelta(minutes=1)
# A reminder still waiting this long after it was due means no worker is delivering them.
MIN_WORKER_LAG: Final = timedelta(minutes=5)
_VERSION: Final = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)")


class ReleaseFeed(Protocol):
    """Raises `ReleaseFeedError` when it can't say what the latest release is."""

    async def latest(self, repository: str) -> Release: ...


class SystemSettingsStore(Protocol):
    async def update_check(self) -> UpdateCheckState: ...

    async def set_update_check_enabled(self, enabled: bool) -> None: ...

    async def record_check(self, release: Release | None, checked_at: datetime) -> None:
        """Store a check's result; `None` means it failed and keeps the last release found."""
        ...


class SystemHealth(Protocol):
    async def schema_revision(self) -> str | None: ...

    async def reminders_waiting_since(self, before: datetime) -> bool:
        """Whether any reminder that was due before `before` is still waiting to be delivered."""
        ...


def parse_version(text: str) -> tuple[int, int, int] | None:
    match = _VERSION.match(text.strip())
    if match is None:
        return None
    major, minor, patch = match.groups()
    return int(major), int(minor), int(patch)


def is_newer(latest: str, current: str) -> bool:
    latest_parts, current_parts = parse_version(latest), parse_version(current)
    return latest_parts is not None and current_parts is not None and latest_parts > current_parts


class SystemService:
    def __init__(
        self,
        settings: SystemSettingsStore,
        health: SystemHealth,
        transaction: Transaction,
        feed: ReleaseFeed,
        *,
        repository: str,
        current_version: str,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._settings = settings
        self._health = health
        self._transaction = transaction
        self._feed = feed
        self._repository = repository
        self._version = current_version
        self._clock = clock

    async def status(
        self,
        *,
        storage_mode: StorageMode,
        started_at: datetime,
        expected_revision: str | None,
        worker_in_api: bool,
        poll_interval: timedelta,
        features: ServerFeatures,
    ) -> SystemStatus:
        revision = await self._health.schema_revision()
        lag = max(MIN_WORKER_LAG, poll_interval * 4)
        behind = await self._health.reminders_waiting_since(self._clock() - lag)
        return SystemStatus(
            version=self._version,
            storage_mode=storage_mode,
            started_at=started_at,
            database=DatabaseStatus(
                state="ok" if revision == expected_revision else "outdated",
                revision=revision,
                expected_revision=expected_revision,
            ),
            worker=WorkerStatus(runs_in_api=worker_in_api, state="behind" if behind else "ok"),
            features=features,
        )

    async def update_status(self, *, check_now: bool = False) -> UpdateStatus:
        """The stored result, refreshed first when it's due (or `check_now` and not just
        checked). Never raises for a failed check: the result says it failed."""
        state = await self._settings.update_check()
        if state.enabled and self._due(state, check_now=check_now):
            now = self._clock()
            try:
                release: Release | None = await self._feed.latest(self._repository)
            except ReleaseFeedError:
                release = None
            await self._settings.record_check(release, now)
            await self._transaction.commit()
            state = await self._settings.update_check()
        return self._describe(state)

    async def set_update_check_enabled(self, enabled: bool) -> UpdateStatus:
        await self._settings.set_update_check_enabled(enabled)
        await self._transaction.commit()
        return await self.update_status()

    def _due(self, state: UpdateCheckState, *, check_now: bool) -> bool:
        if state.checked_at is None:
            return True
        elapsed = self._clock() - state.checked_at
        if check_now:
            return elapsed >= MIN_FORCED_INTERVAL
        return elapsed >= (RETRY_INTERVAL if state.check_failed else CHECK_INTERVAL)

    def _describe(self, state: UpdateCheckState) -> UpdateStatus:
        latest = state.latest_version if state.enabled else None
        return UpdateStatus(
            enabled=state.enabled,
            repository=self._repository,
            current_version=self._version,
            latest_version=latest,
            latest_published_at=state.latest_published_at if latest else None,
            update_available=latest is not None and is_newer(latest, self._version),
            release_url=(
                f"https://github.com/{self._repository}/releases/tag/v{latest}" if latest else None
            ),
            checked_at=state.checked_at if state.enabled else None,
            check_failed=state.enabled and state.check_failed,
        )
