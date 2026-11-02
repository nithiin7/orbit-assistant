"""The reminder worker: polls the database for due occurrences and delivers them. It also
takes each workspace's month-end net worth snapshots (at most hourly), checks budgets (every
few minutes: closing finished periods and sending threshold alerts), and sweeps the attachment
store for files no metadata references (every few hours), and keeps AI retrieval indexes up to
date for people who turned indexing on (every `ORBIT_AI_INDEX_INTERVAL_SECONDS`), and runs
external integrations' synchronization (every `ORBIT_INTEGRATIONS_POLL_SECONDS`), so Orbit has
one scheduler rather than several.

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

from orbit_api.config import Settings
from orbit_api.db.columns import utc_now
from orbit_api.db.database import Database
from orbit_api.repositories.ai import SqlAiSettingsRepository
from orbit_api.repositories.ai_services import build_ai
from orbit_api.repositories.budgets import build_budget_service
from orbit_api.repositories.calendar import build_calendar_service
from orbit_api.repositories.commitments import build_commitment_service
from orbit_api.repositories.documents import build_document_reminders, referenced_blob_ids
from orbit_api.repositories.fitness import referenced_photo_blob_ids
from orbit_api.repositories.habits import build_habit_service
from orbit_api.repositories.integrations import build_integrations
from orbit_api.repositories.investments import SqlSnapshotRepository, build_net_worth_service
from orbit_api.repositories.notifications import SqlNotificationRepository
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.transaction import SqlTransaction
from orbit_api.services.ai.indexing import IndexRun, permitted_types
from orbit_api.services.ai.providers import ProviderFactory
from orbit_api.services.integrations.connectors import ConnectorRegistry
from orbit_api.services.reminders.delivery import (
    DEFAULT_MAX_ATTEMPTS,
    DeliveryResult,
    ReminderDelivery,
    ReminderFollowUp,
)
from orbit_api.services.reminders.models import ClaimedOccurrence, OccurrenceStatus, Reminder
from orbit_api.system.attachment_store import FileAttachmentStore

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
# How often the worker looks for unreferenced files, and how old one must be to be deleted: an
# upload writes its file a moment before its metadata commits, so younger files are left alone.
DEFAULT_SWEEP_INTERVAL = timedelta(hours=6)
SWEEP_MIN_AGE = timedelta(hours=1)
# Synchronization runs taken per check, and how often imported files are checked for changes.
INTEGRATION_BATCH = 10
DEFAULT_FILE_CHECK_INTERVAL = timedelta(hours=6)


class ManagedFollowUp:
    """Hands a delivered managed reminder to the record that manages it: a calendar event's
    alert, a habit's or routine's reminder time, a document, or a financial commitment."""

    def __init__(
        self,
        calendar: ReminderFollowUp,
        commitments: ReminderFollowUp,
        habits: ReminderFollowUp,
        documents: ReminderFollowUp,
    ) -> None:
        self._calendar = calendar
        self._commitments = commitments
        self._habits = habits
        self._documents = documents

    async def after_delivery(self, reminder: Reminder, now: datetime) -> None:
        link = reminder.commitment
        if link is not None and link.kind == "calendar_alert":
            await self._calendar.after_delivery(reminder, now)
        elif link is not None and link.kind == "habit_reminder":
            await self._habits.after_delivery(reminder, now)
        elif link is not None and link.kind == "document":
            await self._documents.after_delivery(reminder, now)
        else:
            await self._commitments.after_delivery(reminder, now)


@dataclass(frozen=True, slots=True)
class AiIndexing:
    """What the worker needs to index: the settings (for the file store and the AI secret
    key) and the provider factory."""

    settings: Settings
    providers: ProviderFactory
    interval: timedelta | None = None


@dataclass(frozen=True, slots=True)
class IntegrationSync:
    """What the worker needs to synchronize integrations: the settings (secret key, file store,
    limits) and the provider connectors."""

    settings: Settings
    connectors: ConnectorRegistry
    interval: timedelta | None = None
    file_check_interval: timedelta = DEFAULT_FILE_CHECK_INTERVAL


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
        files: FileAttachmentStore | None = None,
        sweep_interval: timedelta = DEFAULT_SWEEP_INTERVAL,
        ai: AiIndexing | None = None,
        integrations: IntegrationSync | None = None,
    ) -> None:
        self._database = database
        self._ai = ai
        self._integrations = integrations
        self._integrations_checked_at: datetime | None = None
        self._files_checked_at: datetime | None = None
        self._indexed_at: datetime | None = None
        self._files = files
        self._sweep_interval = sweep_interval
        self._swept_at: datetime | None = None
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

    async def sweep_files(self) -> int:
        """Delete stored files that no note attachment, document version, or progress photo
        references and that are older than `SWEEP_MIN_AGE`, such as leftovers of a crash
        mid-upload or of a file deletion that failed; return how many."""
        if self._files is None:
            return 0
        async with self._database.session() as session:
            referenced = await referenced_blob_ids(session)
            referenced |= await referenced_photo_blob_ids(session)
        removed = await self._files.sweep(referenced, self._clock() - SWEEP_MIN_AGE)
        if removed:
            logger.info("Removed %d unreferenced file(s) from the attachment store.", removed)
        return removed

    async def _maybe_sweep_files(self) -> None:
        now = self._clock()
        last = self._swept_at
        if last is not None and now - last < self._sweep_interval:
            return
        self._swept_at = now
        try:
            await self.sweep_files()
        except Exception:
            # Deliberate boundary: housekeeping must never stop reminder delivery.
            logger.exception("Sweeping unreferenced files failed; retrying later.")

    async def index_ai(self) -> IndexRun:
        """Reconcile and index a batch for every workspace whose owner has AI indexing on.
        Each workspace runs in its own sessions; one failing never stops the others."""
        if self._ai is None or not self._ai.settings.ai_enabled:
            return IndexRun()
        async with self._database.session() as session:
            targets = await SqlAiSettingsRepository(session).indexing_workspaces()
        queued = removed = indexed = failed = 0
        for user_id, workspace_id in targets:
            async with self._database.session() as session:
                try:
                    ai = build_ai(session, self._ai.settings, self._ai.providers, clock=self._clock)
                    settings = await ai.config.settings(user_id)
                    embedder = await ai.config.embedding_provider(settings, workspace_id)
                    if embedder is None or not permitted_types(settings.modules):
                        continue
                    reconciled = await ai.index.reconcile(
                        workspace_id, settings.modules, embedder.embedding_key
                    )
                    run = await ai.index.process(workspace_id, embedder)
                    queued += reconciled.queued
                    removed += reconciled.removed + run.removed
                    indexed += run.indexed
                    failed += run.failed
                except Exception:
                    # Deliberate boundary: one workspace's failure must not stop the others;
                    # the next check retries it. IDs only: content is personal data.
                    await session.rollback()
                    logger.exception("AI indexing for workspace %s failed.", workspace_id)
        if indexed or failed or removed:
            logger.info(
                "AI index: %d queued, %d indexed, %d failed, %d removed.",
                queued,
                indexed,
                failed,
                removed,
            )
        return IndexRun(queued=queued, removed=removed, indexed=indexed, failed=failed)

    async def _maybe_index_ai(self) -> None:
        if self._ai is None:
            return
        now = self._clock()
        interval = self._ai.interval or timedelta(
            seconds=self._ai.settings.ai_index_interval_seconds
        )
        if self._indexed_at is not None and now - self._indexed_at < interval:
            return
        self._indexed_at = now
        try:
            await self.index_ai()
        except Exception:
            # Deliberate boundary: indexing must never stop reminder delivery.
            logger.exception("AI indexing failed; retrying later.")

    async def sync_integrations(self) -> int:
        """Queue due synchronizations, then run a batch of queued ones, each in its own session,
        so one provider's failure never blocks another's; return how many ran."""
        config = self._integrations
        if config is None or not config.settings.integrations_enabled:
            return 0
        async with self._database.session() as session:
            runner = build_integrations(
                session, config.settings, config.connectors, self._clock
            ).runner
            await runner.schedule_due()
            now = self._clock()
            last = self._files_checked_at
            if last is None or now - last >= config.file_check_interval:
                self._files_checked_at = now
                await runner.queue_file_checks()
            claims = await runner.claim(INTEGRATION_BATCH)
        for run in claims:
            async with self._database.session() as session:
                try:
                    integrations = build_integrations(
                        session, config.settings, config.connectors, self._clock
                    )
                    await integrations.runner.process(run)
                    continue
                except Exception as exc:
                    # Deliberate boundary: an unexpected failure is recorded on the run and
                    # retried with backoff; it must not stop other runs. Type only: no content.
                    await session.rollback()
                    error = type(exc).__name__
                    logger.warning("Integration run %s failed: %s", run.id, error, exc_info=exc)
            async with self._database.session() as session:
                try:
                    runner = build_integrations(
                        session, config.settings, config.connectors, self._clock
                    ).runner
                    await runner.record_crash(run.id, error)
                except Exception:
                    # Deliberate boundary: the lease expires and the run is claimed again.
                    logger.exception("Recording the failure of integration run %s failed.", run.id)
        if claims:
            logger.info("Ran %d integration synchronization(s).", len(claims))
        return len(claims)

    async def _maybe_sync_integrations(self) -> None:
        config = self._integrations
        if config is None:
            return
        now = self._clock()
        interval = config.interval or timedelta(seconds=config.settings.integrations_poll_seconds)
        last = self._integrations_checked_at
        if last is not None and now - last < interval:
            return
        self._integrations_checked_at = now
        try:
            await self.sync_integrations()
        except Exception:
            # Deliberate boundary: integrations must never stop reminder delivery.
            logger.exception("Integration synchronization failed; retrying later.")

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
            await self._maybe_sweep_files()
            await self._maybe_index_ai()
            await self._maybe_sync_integrations()
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
            # Loan, subscription, and bill reminders move on to the next payment once delivered;
            # event alerts move on to the next occurrence; habit and routine reminders to the
            # next due day; document reminders to the next expiry, renewal, or review alert.
            follow_up=ManagedFollowUp(
                build_calendar_service(session, self._clock),
                build_commitment_service(session, self._clock),
                build_habit_service(session, self._clock).reminders,
                build_document_reminders(session, self._clock),
            ),
        )
