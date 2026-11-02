"""The synchronization job's lifecycle, driven by the reminder worker (Orbit's one scheduler).

Runs live in the database: queued by people, by schedules, and by push notifications, then
claimed with a lease. A run that dies with its worker is claimed again when the lease expires and
continues from its checkpoint, so a restart loses nothing. Retryable failures (rate limits,
provider outages) back off exponentially; a refused token stops the connection until it's
reconnected. Each run uses its own session, so one provider's failure never blocks another's.
"""

import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Final

from orbit_api.services.integrations.calendar_sync import CalendarSync
from orbit_api.services.integrations.connectors import (
    ProviderError,
    ProviderUnavailableError,
    RateLimitedError,
    ReauthRequiredError,
)
from orbit_api.services.integrations.files import FileService
from orbit_api.services.integrations.models import IntegrationError, RunStatus, SyncRun
from orbit_api.services.integrations.service import IntegrationService
from orbit_api.services.integrations.store import IntegrationStore
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now

MAX_ATTEMPTS: Final = 5
BASE_BACKOFF: Final = timedelta(seconds=30)
MAX_BACKOFF: Final = timedelta(minutes=30)
LEASE: Final = timedelta(minutes=5)


def backoff(attempts: int, retry_after: float | None = None) -> timedelta:
    """30 s, 1 min, 2 min, … up to 30 min, or the provider's `Retry-After` if longer."""
    delay = min(BASE_BACKOFF * (2 ** max(attempts - 1, 0)), MAX_BACKOFF)
    if retry_after is not None:
        delay = max(delay, min(timedelta(seconds=retry_after), MAX_BACKOFF))
    return delay


class SyncRunner:
    def __init__(
        self,
        store: IntegrationStore,
        integrations: IntegrationService,
        calendar_sync: CalendarSync,
        files: FileService,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._integrations = integrations
        self._calendar_sync = calendar_sync
        self._files = files
        self._transaction = transaction
        self._clock = clock

    async def schedule_due(self, limit: int = 100) -> int:
        """Queue runs for calendars whose automatic synchronization is due."""
        now = self._clock()
        queued = 0
        for resource in await self._store.due_resources(now, limit):
            connection = await self._store.connection_by_id(resource.connection_id)
            if connection is None:
                continue
            await self._integrations.queue(connection, resource.id, "calendar", "scheduled")
            # Rescheduled when the run finishes.
            await self._store.save_resource(replace(resource, next_sync_at=None))
            queued += 1
        await self._transaction.commit()
        return queued

    async def queue_file_checks(self) -> int:
        queued = 0
        for connection_id in await self._store.connections_with_files():
            connection = await self._store.connection_by_id(connection_id)
            if connection is None or connection.status == "reauth_required":
                continue
            await self._integrations.queue(connection, None, "files", "scheduled")
            queued += 1
        await self._transaction.commit()
        return queued

    async def claim(self, limit: int) -> list[SyncRun]:
        now = self._clock()
        runs = await self._store.claim_runs(now, now + LEASE, limit)
        await self._transaction.commit()
        return runs

    async def process(self, run: SyncRun) -> SyncRun:
        """Run one claimed synchronization. Provider and integration errors are recorded on the
        run; anything else propagates to the worker, which calls `record_crash`."""
        connection = await self._store.connection_by_id(run.connection_id)
        if connection is None:
            return run  # Disconnected meanwhile: its runs went with it.
        if run.cancel_requested:
            return await self._finish(run, "cancelled", None)
        if connection.status == "reauth_required":
            return await self._finish(run, "failed", ReauthRequiredError.message)
        try:
            if run.kind == "files":
                return await self._files.check(run, connection)
            resource = (
                await self._store.resource_by_id(run.resource_id) if run.resource_id else None
            )
            if resource is None or not resource.enabled:
                return await self._finish(run, "cancelled", None)
            return await self._calendar_sync.process(run, connection, resource)
        except ReauthRequiredError as exc:
            await self._transaction.rollback()
            return await self._finish(run, "failed", exc.message)
        except (RateLimitedError, ProviderUnavailableError) as exc:
            await self._transaction.rollback()
            retry_after = exc.retry_after if isinstance(exc, RateLimitedError) else None
            return await self._retry(run, exc.message, retry_after)
        except (ProviderError, IntegrationError) as exc:
            await self._transaction.rollback()
            return await self._finish(run, "failed", exc.message)

    async def record_crash(self, run_id: uuid.UUID, error: str) -> None:
        """An unexpected failure: retried with backoff, then failed. Only the error's type is
        stored, never content."""
        run = await self._store.run_by_id(run_id)
        if run is None:
            return
        await self._retry(run, f"Synchronization failed unexpectedly ({error[:80]}).", None)

    async def _retry(self, run: SyncRun, message: str, retry_after: float | None) -> SyncRun:
        current = await self._store.run_by_id(run.id) or run
        attempts = current.attempts + 1
        if attempts >= MAX_ATTEMPTS:
            return await self._finish(replace(current, attempts=attempts), "failed", message)
        retried = replace(
            current,
            status="queued",
            attempts=attempts,
            error=message,
            lease_until=None,
            claim_token=None,
            next_attempt_at=self._clock() + backoff(attempts, retry_after),
        )
        await self._store.save_run(retried)
        await self._transaction.commit()
        return retried

    async def _finish(self, run: SyncRun, status: RunStatus, message: str | None) -> SyncRun:
        now = self._clock()
        current = await self._store.run_by_id(run.id) or run
        finished = replace(
            current,
            status=status,
            attempts=max(current.attempts, run.attempts),
            error=message,
            finished_at=now,
            lease_until=None,
            claim_token=None,
        )
        await self._store.save_run(finished)
        if run.resource_id is not None and status == "failed":
            resource = await self._store.resource_by_id(run.resource_id)
            if resource is not None:
                minutes = resource.sync_interval_minutes
                await self._store.save_resource(
                    replace(
                        resource,
                        last_error=message,
                        next_sync_at=now + timedelta(minutes=minutes) if minutes else None,
                        updated_at=now,
                    )
                )
        if status == "failed":
            connection = await self._store.connection_by_id(run.connection_id)
            if connection is not None and connection.status == "active":
                await self._store.save_connection(replace(connection, last_error=message))
        await self._transaction.commit()
        return finished
