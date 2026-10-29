"""The reminder worker: polls the database for due occurrences and delivers them.

It holds no schedule in memory. Each poll reads due work from the database, so a restart loses
nothing, and any number of workers (the one embedded in each API process, plus standalone
`orbit-worker` processes) can run against the same database without duplicating deliveries.
The guarantees are described in `orbit_api.services.reminders.delivery`.
"""

import asyncio
import contextlib
import logging
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.columns import utc_now
from orbit_api.db.database import Database
from orbit_api.repositories.notifications import SqlNotificationRepository
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.transaction import SqlTransaction
from orbit_api.services.reminders.delivery import (
    DEFAULT_MAX_ATTEMPTS,
    DeliveryResult,
    ReminderDelivery,
)
from orbit_api.services.reminders.models import ClaimedOccurrence, OccurrenceStatus

logger = logging.getLogger(__name__)

DEFAULT_BATCH_SIZE = 50
# Long enough for any single delivery; a worker that dies holding a claim delays that occurrence
# by at most this much.
DEFAULT_LEASE = timedelta(minutes=2)


@dataclass(frozen=True, slots=True)
class WorkerReport:
    """What one poll did."""

    claimed: int = 0
    results: Counter[DeliveryResult] = field(default_factory=Counter[DeliveryResult])


class ReminderWorker:
    def __init__(
        self,
        database: Database,
        *,
        clock: Callable[[], datetime] = utc_now,
        batch_size: int = DEFAULT_BATCH_SIZE,
        lease: timedelta = DEFAULT_LEASE,
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    ) -> None:
        self._database = database
        self._clock = clock
        self._batch_size = batch_size
        self._lease = lease
        self._max_attempts = max_attempts

    async def run_once(self) -> WorkerReport:
        """Claim up to one batch of due occurrences and process each in its own transaction."""
        now = self._clock()
        async with self._database.session() as session:
            claims = await SqlOccurrenceRepository(session).claim_due(
                now, now + self._lease, self._batch_size
            )
            await session.commit()

        results: Counter[DeliveryResult] = Counter()
        for claim in claims:
            results[await self._process(claim)] += 1
        if claims:
            # IDs and counts only: reminder titles are personal data.
            logger.info("Processed %d reminder occurrence(s): %s", len(claims), dict(results))
        return WorkerReport(claimed=len(claims), results=results)

    async def run(self, stop: asyncio.Event, poll_interval: float) -> None:
        """Poll until `stop` is set. A poll in progress finishes first, so shutdown never
        abandons a claimed occurrence mid-transaction."""
        logger.info("Reminder worker started; polling every %g s.", poll_interval)
        while not stop.is_set():
            try:
                report = await self.run_once()
            except Exception:
                # Deliberate boundary: a failed poll (for example, the database being briefly
                # unreachable) must not stop the worker. Claimed work is recovered by lease.
                logger.exception("Reminder worker poll failed; retrying after the interval.")
                report = WorkerReport()
            if report.claimed >= self._batch_size:
                continue  # More may be due: drain the backlog before sleeping.
            # Sleep until the next poll, waking early when asked to stop.
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=poll_interval)
        logger.info("Reminder worker stopped.")

    async def status(self) -> dict[OccurrenceStatus, int]:
        """Occurrences by status, for operators."""
        async with self._database.session() as session:
            return await SqlOccurrenceRepository(session).count_by_status()

    async def retry_failed(self) -> int:
        """Make every failed occurrence pending again; return how many."""
        async with self._database.session() as session:
            count = await SqlOccurrenceRepository(session).retry_failed(self._clock())
            await session.commit()
            return count

    async def _process(self, claim: ClaimedOccurrence) -> DeliveryResult:
        async with self._database.session() as session:
            try:
                return await self._delivery(session).deliver(claim)
            except Exception as exc:
                # Deliberate boundary: one occurrence's failure is recorded and retried, and
                # must not stop the rest of the batch. Only the error's type is kept.
                await session.rollback()
                error = type(exc).__name__
                logger.warning(
                    "Delivering reminder occurrence %s failed (attempt %d): %s",
                    claim.id,
                    claim.attempts,
                    error,
                    exc_info=exc,
                )

        async with self._database.session() as session:
            try:
                return await self._delivery(session).record_failure(claim, error)
            except Exception:
                # Deliberate boundary: if even recording fails, the lease expires and another
                # poll claims the occurrence again.
                logger.exception("Recording the failure of occurrence %s failed.", claim.id)
                return "skipped"

    def _delivery(self, session: AsyncSession) -> ReminderDelivery:
        return ReminderDelivery(
            SqlReminderRepository(session),
            SqlOccurrenceRepository(session),
            SqlNotificationRepository(session),
            SqlTransaction(session),
            clock=self._clock,
            max_attempts=self._max_attempts,
        )
