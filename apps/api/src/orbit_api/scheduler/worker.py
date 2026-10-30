"""The reminder worker: polls the database for due occurrences and delivers them. It also
takes each workspace's month-end net worth snapshots (at most hourly) and checks budgets (every
few minutes: closing finished periods and sending threshold alerts), so Orbit has one scheduler
rather than several.

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
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.columns import utc_now
from orbit_api.db.database import Database
from orbit_api.repositories.budgets import build_budget_service
from orbit_api.repositories.commitments import build_commitment_service
from orbit_api.repositories.investments import SqlSnapshotRepository, build_net_worth_service
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
# How often the worker checks for month-end net worth snapshots to take. Taking one is
# idempotent, so a check that finds nothing to do costs one query per workspace.
DEFAULT_SNAPSHOT_INTERVAL = timedelta(hours=1)
# How often the worker checks budgets. Alerts are recorded per period and threshold, so a check
# never repeats one; this only bounds how soon after spending an alert arrives.
DEFAULT_BUDGET_INTERVAL = timedelta(minutes=5)


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
        snapshot_interval: timedelta = DEFAULT_SNAPSHOT_INTERVAL,
        budget_interval: timedelta = DEFAULT_BUDGET_INTERVAL,
    ) -> None:
        self._database = database
        self._snapshot_interval = snapshot_interval
        self._snapshots_checked_at: datetime | None = None
        self._budget_interval = budget_interval
        self._budgets_checked_at: datetime | None = None
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

    async def take_snapshots(self) -> int:
        """Take the previous month's net worth snapshot for every workspace with finance data
        that doesn't have one yet, each in its own transaction; return how many were taken."""
        today = self._clock().date()
        async with self._database.session() as session:
            workspaces = await SqlSnapshotRepository(session).workspaces_with_finance()
        taken = 0
        for workspace_id in workspaces:
            async with self._database.session() as session:
                try:
                    service = build_net_worth_service(session, self._clock)
                    taken += await service.close_month(workspace_id, today)
                except Exception:
                    # Deliberate boundary: one workspace's failure must not stop the others;
                    # the next check retries it. IDs only: values are personal data.
                    await session.rollback()
                    logger.exception("Taking net worth snapshots for %s failed.", workspace_id)
        if taken:
            logger.info("Took %d month-end net worth snapshot(s).", taken)
        return taken

    async def _maybe_take_snapshots(self) -> None:
        now = self._clock()
        last = self._snapshots_checked_at
        if last is not None and now - last < self._snapshot_interval:
            return
        self._snapshots_checked_at = now
        try:
            await self.take_snapshots()
        except Exception:
            # Deliberate boundary: snapshots must never stop reminder delivery.
            logger.exception("Checking net worth snapshots failed; retrying later.")

    async def check_budgets(self) -> tuple[int, int]:
        """Close finished budget periods and send threshold alerts in every workspace with an
        active budget, each in its own transaction and on the owner's local date; return how
        many periods were closed and alerts sent."""
        async with self._database.session() as session:
            owners = await build_budget_service(session, self._clock).owners()
        closed = alerts = 0
        now = self._clock()
        for owner in owners:
            today = now.astimezone(ZoneInfo(owner.timezone or "UTC")).date()
            async with self._database.session() as session:
                try:
                    report = await build_budget_service(session, self._clock).check(owner, today)
                    closed += report.closed
                    alerts += report.alerts
                except Exception:
                    # Deliberate boundary: one workspace's failure must not stop the others;
                    # the next check retries it. IDs only: amounts are personal data.
                    await session.rollback()
                    logger.exception("Checking budgets for %s failed.", owner.workspace_id)
        if closed or alerts:
            logger.info("Closed %d budget period(s); sent %d budget alert(s).", closed, alerts)
        return closed, alerts

    async def _maybe_check_budgets(self) -> None:
        now = self._clock()
        last = self._budgets_checked_at
        if last is not None and now - last < self._budget_interval:
            return
        self._budgets_checked_at = now
        try:
            await self.check_budgets()
        except Exception:
            # Deliberate boundary: budgets must never stop reminder delivery.
            logger.exception("Checking budgets failed; retrying later.")

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
            await self._maybe_take_snapshots()
            await self._maybe_check_budgets()
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
            # Loan, subscription, and bill reminders move on to the next payment once delivered.
            follow_up=build_commitment_service(session, self._clock),
        )
