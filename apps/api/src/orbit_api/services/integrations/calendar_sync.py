"""Calendar synchronization: external calendars into Orbit's calendar, and, for two-way
calendars, Orbit's changes back out.

Every write goes through `CalendarService`, so imported events are ordinary Orbit events
(ranges, agenda, alerts, search, and the AI index all see them). The service is built on a
transaction that only flushes; this engine commits each page together with its links and
checkpoint, so a crash never leaves an event without the link that prevents importing it twice.

**Identity and duplicates.** A link is unique per connection and external ID. An external
event seen again is matched to its link; an unchanged version is skipped.

**Conflicts.** A link remembers a fingerprint of the Orbit event as last synchronized. When the
provider changes an event that was also changed in Orbit, neither side is overwritten: the link
is marked `conflict` and keeps the provider's version until the person chooses. An event deleted
at the provider but changed in Orbit is kept, as a `deleted_remotely` conflict.

**Deletions.** Deleting an imported event in Orbit is never sent to the provider; the link is
kept as `deleted_locally`, so the event isn't imported again.
"""

import contextlib
import logging
import secrets
import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from orbit_api.services.calendar.models import (
    CalendarEvent,
    EventChanges,
    EventDraft,
    EventNotFoundError,
    OccurrenceChanges,
    OccurrenceNotFoundError,
)
from orbit_api.services.calendar.service import CalendarService
from orbit_api.services.integrations.connectors import (
    CalendarConnector,
    ChangePage,
    ConnectorRegistry,
    CursorExpiredError,
    ProviderError,
    RemoteCalendar,
    RemoteChange,
    RemoteDeletion,
    RemoteEvent,
    RemoteNotFoundError,
    SyncPosition,
    VersionConflictError,
)
from orbit_api.services.integrations.mapping import (
    event_hash,
    exception_hash,
    from_snapshot,
    local_from_instant,
    normalized,
    outgoing,
    start_instant,
    timing_of,
    to_snapshot,
)
from orbit_api.services.integrations.models import (
    AlreadyLinkedError,
    CapabilityNotGrantedError,
    ConflictKind,
    ConflictResolution,
    Connection,
    Link,
    NotConflictedError,
    NotExportableError,
    ProviderNotConfiguredError,
    Resource,
    RunCounts,
    RunStatus,
    SyncRun,
)
from orbit_api.services.integrations.oauth import digest
from orbit_api.services.integrations.store import IntegrationStore
from orbit_api.services.integrations.tokens import TokenManager
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now

logger = logging.getLogger(__name__)

# Pages per run before yielding to other work; the run continues from its checkpoint.
MAX_PAGES_PER_RUN: Final = 20
# Windowed providers synchronize from this long ago to a year ahead, re-windowing monthly.
WINDOW_PAST: Final = timedelta(days=30)
WINDOW_REFRESH: Final = timedelta(days=30)
LEASE: Final = timedelta(minutes=5)
# Renew push channels this long before they expire.
CHANNEL_RENEWAL: Final = timedelta(hours=12)
# Orbit changes pushed per run, bounded like pages.
MAX_PUSHES_PER_RUN: Final = 200

_ITEM_ERRORS = (ValueError, OccurrenceNotFoundError, EventNotFoundError)


class CalendarSync:
    def __init__(
        self,
        store: IntegrationStore,
        calendar: CalendarService,
        tokens: TokenManager,
        connectors: ConnectorRegistry,
        transaction: Transaction,
        *,
        webhook_url: str | None = None,
        clock: Callable[[], datetime] = utc_now,
        max_pages: int | None = None,
    ) -> None:
        self._store = store
        self._calendar = calendar
        self._tokens = tokens
        self._connectors = connectors
        self._transaction = transaction
        self._webhook_url = webhook_url
        self._clock = clock
        self._max_pages = max_pages or MAX_PAGES_PER_RUN

    # Running a synchronization

    async def process(self, run: SyncRun, connection: Connection, resource: Resource) -> SyncRun:
        """Synchronize one calendar from its checkpoint. Returns the run, finished, or queued
        again (after `max_pages`) to continue from where it stopped."""
        connector = self._connector(connection)
        remote = RemoteCalendar(
            resource.external_id, resource.name, resource.writable, resource.timezone
        )
        resource, run = await self._start(resource, run, connector.windowed)
        resource = await self._check_category(resource)
        pages = 0
        while True:
            if await self._cancel_requested(run):
                return await self._finish(run, "cancelled", connection, resource)
            position = SyncPosition(resource.cursor, resource.checkpoint, resource.window_start)
            try:
                page: ChangePage = await self._tokens.call(
                    connection, lambda token, at=position: connector.changes(token, remote, at)
                )
            except CursorExpiredError:
                resource, run = await self._restart_full(resource, run, connector.windowed)
                continue
            counts, resource = await self._apply_page(run, resource, page.changes)
            if page.next_page is not None:
                resource = replace(resource, checkpoint=page.next_page)
            else:
                resource = replace(resource, cursor=page.next_cursor, checkpoint=None)
            run = replace(run, counts=run.counts + counts, lease_until=self._clock() + LEASE)
            await self._store.save_resource(resource)
            await self._store.save_run(run)
            await self._transaction.commit()
            pages += 1
            if page.next_page is None:
                break
            if pages >= self._max_pages:
                run = replace(run, status="queued", next_attempt_at=self._clock(), lease_until=None)
                await self._store.save_run(run)
                await self._transaction.commit()
                return run
        extra = RunCounts()
        if run.full:
            extra += await self._reconcile(run, resource, connector.windowed)
        extra += await self._push(connection, resource, connector)
        run = replace(run, counts=run.counts + extra)
        resource = await self._maintain_channel(connection, resource, connector)
        status: RunStatus = "partial" if run.counts.failed else "succeeded"
        return await self._finish(run, status, connection, resource)

    async def _start(
        self, resource: Resource, run: SyncRun, windowed: bool
    ) -> tuple[Resource, SyncRun]:
        now = self._clock()
        if (
            windowed
            and resource.checkpoint is None
            and (
                resource.cursor is None
                or resource.window_start is None
                or resource.window_start < now - WINDOW_PAST - WINDOW_REFRESH
            )
        ):
            return await self._restart_full(resource, run, windowed)
        if resource.cursor is None and not run.full:
            run = replace(run, full=True)
        run = replace(run, status="running", started_at=run.started_at or now)
        await self._store.save_run(run)
        await self._transaction.commit()
        return resource, run

    async def _restart_full(
        self, resource: Resource, run: SyncRun, windowed: bool
    ) -> tuple[Resource, SyncRun]:
        now = self._clock()
        window = (
            datetime.combine((now - WINDOW_PAST).date(), time(), tzinfo=UTC) if windowed else None
        )
        resource = replace(resource, cursor=None, checkpoint=None, window_start=window)
        run = replace(run, full=True, status="running", started_at=run.started_at or now)
        await self._store.save_resource(resource)
        await self._store.save_run(run)
        await self._transaction.commit()
        return resource, run

    async def _cancel_requested(self, run: SyncRun) -> bool:
        current = await self._store.run_by_id(run.id)
        return current is None or current.cancel_requested

    async def _finish(
        self, run: SyncRun, status: RunStatus, connection: Connection, resource: Resource
    ) -> SyncRun:
        now = self._clock()
        finished = replace(
            run,
            status=status,
            finished_at=now,
            lease_until=None,
            claim_token=None,
            error=None,
        )
        interval = resource.sync_interval_minutes
        await self._store.save_run(finished)
        if status != "cancelled":
            await self._store.save_resource(
                replace(
                    resource,
                    last_synced_at=now,
                    last_error=None,
                    next_sync_at=now + timedelta(minutes=interval) if interval else None,
                    updated_at=now,
                )
            )
            current = await self._store.connection_by_id(connection.id)
            if current is not None:
                await self._store.save_connection(
                    replace(current, status="active", last_synced_at=now, last_error=None)
                )
        await self._transaction.commit()
        return finished

    async def _check_category(self, resource: Resource) -> Resource:
        if resource.category_id is None:
            return resource
        categories = await self._calendar.categories(resource.workspace_id)
        if any(c.id == resource.category_id for c in categories):
            return resource
        resource = replace(resource, category_id=None)
        await self._store.save_resource(resource)
        return resource

    # Applying changes

    async def _apply_page(
        self, run: SyncRun, resource: Resource, changes: list[RemoteChange]
    ) -> tuple[RunCounts, Resource]:
        # Series before their occurrences, so an occurrence finds its series in the same page.
        def order(change: RemoteChange) -> int:
            if isinstance(change, RemoteDeletion):
                return 2
            return 1 if change.parent_id and not change.expanded else 0

        counts = RunCounts()
        for change in sorted(changes, key=order):
            try:
                if isinstance(change, RemoteDeletion):
                    link = await self._store.find_link(
                        resource.connection_id, "event", change.external_id
                    )
                    counts += await self._remote_deleted(link)
                else:
                    counts += await self._apply_event(run, resource, change)
            except _ITEM_ERRORS as exc:
                # One event Orbit can't hold doesn't stop the rest. Type only: no content.
                logger.info("Skipped an external event that failed: %s", type(exc).__name__)
                counts += RunCounts(failed=1)
        return counts, resource

    async def _apply_event(
        self, run: SyncRun, resource: Resource, remote: RemoteEvent
    ) -> RunCounts:
        remote = normalized(remote)
        link = await self._store.find_link(resource.connection_id, "event", remote.external_id)
        if remote.parent_id is not None and not remote.expanded:
            parent = await self._store.find_link(resource.connection_id, "event", remote.parent_id)
            series = await self._event_of(parent) if parent is not None else None
            if (
                parent is not None
                and series is not None
                and series.recurrence is not None
                and remote.original_start is not None
            ):
                return await self._apply_occurrence(run, resource, parent, series, link, remote)
        if remote.cancelled:
            return await self._remote_deleted(link)
        return await self._apply_standalone(run, resource, link, remote)

    async def _apply_standalone(
        self, run: SyncRun, resource: Resource, link: Link | None, remote: RemoteEvent
    ) -> RunCounts:
        now = self._clock()
        if link is None:
            detail = await self._calendar.create_event(
                resource.workspace_id, self._draft(remote, resource), default_timezone=None
            )
            event = await self._skip_excluded(detail.event, remote)
            link = self._new_link(resource, remote, event, run, now)
            await self._store.add_link(link)
            if event.recurrence is not None:
                await self._adopt_children(run, resource, link, event)
            return RunCounts(imported=1)

        event = await self._event_of(link)
        if event is None:
            await self._save_seen(link, run, deleted_locally=True)
            return RunCounts(skipped=1)
        if link.status == "conflict":
            if _snapshot_version(link) == remote.version:
                await self._save_seen(link, run)
                return RunCounts(skipped=1)
            await self._conflict(link, "both_changed", remote, run)
            return RunCounts(conflicts=1)
        if link.remote_version == remote.version:
            await self._save_seen(link, run)
            return RunCounts(skipped=1)
        if event_hash(event) != link.local_hash:
            await self._conflict(link, "both_changed", remote, run)
            return RunCounts(conflicts=1)
        previous = from_snapshot(link.remote_snapshot) if link.remote_snapshot else None
        event = await self._write_event(event, remote)
        await self._store.save_link(self._synced(link, remote, event_hash(event), run))
        if event.recurrence is not None and (
            previous is None or timing_of(previous) != timing_of(remote)
        ):
            await self._reapply_children(run, resource, link, event)
        return RunCounts(updated=1)

    async def _apply_occurrence(
        self,
        run: SyncRun,
        resource: Resource,
        parent: Link,
        series: CalendarEvent,
        link: Link | None,
        remote: RemoteEvent,
    ) -> RunCounts:
        original = self._in_zone(remote.original_start or remote.start, remote, series.timezone)
        current = await self._store.event_exception(series.workspace_id, series.id, original)
        if link is not None:
            seen_version = (
                _snapshot_version(link) if link.status == "conflict" else link.remote_version
            )
            if seen_version == remote.version:
                await self._save_seen(link, run)
                return RunCounts(skipped=1)
            if link.status == "conflict" or exception_hash(current) != link.local_hash:
                await self._conflict(link, "both_changed", remote, run)
                return RunCounts(conflicts=1)
        await self._write_occurrence(series, original, remote)
        written = await self._store.event_exception(series.workspace_id, series.id, original)
        now = self._clock()
        if link is None:
            link = replace(
                self._new_link(resource, remote, series, run, now),
                external_parent_id=parent.external_id,
                original_start=original,
                local_hash=exception_hash(written),
            )
            await self._store.add_link(link)
            return RunCounts(imported=1)
        await self._store.save_link(
            replace(
                self._synced(link, remote, exception_hash(written), run),
                entity_id=series.id,
                original_start=original,
            )
        )
        return RunCounts(updated=1)

    async def _remote_deleted(self, link: Link | None) -> RunCounts:
        if link is None:
            return RunCounts(skipped=1)
        event = await self._event_of(link)
        if event is None:
            await self._store.delete_links([link.id])
            return RunCounts(skipped=1)
        if self._is_occurrence_link(link, event):
            # A changed occurrence that disappeared: the series' own occurrence remains.
            await self._store.delete_links([link.id])
            return RunCounts(deleted=1)
        if link.status == "conflict" or event_hash(event) != link.local_hash:
            await self._conflict(link, "deleted_remotely", None, None)
            return RunCounts(conflicts=1)
        await self._calendar.delete_event(event.workspace_id, event.id)
        await self._delete_with_children(link)
        return RunCounts(deleted=1)

    async def _reconcile(self, run: SyncRun, resource: Resource, windowed: bool) -> RunCounts:
        """After a full synchronization: whatever wasn't seen was deleted at the provider."""
        counts = RunCounts()
        window = resource.window_start
        for link in await self._store.resource_links(resource.id):
            if link.last_seen_run_id == run.id or link.origin == "linked":
                continue
            if windowed and (
                window is None or link.remote_start_at is None or link.remote_start_at < window
            ):
                continue  # Outside the window: not seen because it wasn't asked for.
            current = await self._store.get_link(link.workspace_id, link.id)
            if current is not None:
                counts += await self._remote_deleted(current)
        await self._transaction.commit()
        return counts

    # Orbit → provider

    async def _push(
        self, connection: Connection, resource: Resource, connector: CalendarConnector
    ) -> RunCounts:
        two_way = (
            resource.direction == "two_way"
            and resource.writable
            and "calendar_write" in connection.capabilities
        )
        exported = 0
        for link in await self._store.resource_links(resource.id):
            if link.status not in ("synced", "local_changes") or exported >= MAX_PUSHES_PER_RUN:
                continue
            event = await self._event_of(link)
            if event is None:
                await self._store.save_link(replace(link, status="deleted_locally"))
                continue
            if self._is_occurrence_link(link, event):
                continue
            fingerprint = event_hash(event)
            if fingerprint == link.local_hash:
                continue
            if not two_way or event.recurrence is not None:
                # Kept in Orbit and shown as not sent: import-only calendars, and repeating
                # events (their rules and occurrences stay the provider's).
                if link.status != "local_changes":
                    await self._store.save_link(replace(link, status="local_changes"))
                continue
            body = outgoing(event)
            try:
                sent = await self._tokens.call(
                    connection,
                    lambda token, item=link, body=body: connector.update_event(
                        token, resource.external_id, item.external_id, body, item.remote_version
                    ),
                )
            except VersionConflictError:
                continue  # Changed at the provider meanwhile: the next pull sees the conflict.
            except RemoteNotFoundError:
                await self._conflict(link, "deleted_remotely", None, None)
                await self._transaction.commit()
                continue
            await self._store.save_link(self._synced(link, normalized(sent), fingerprint, None))
            await self._transaction.commit()
            exported += 1
        await self._transaction.commit()
        return RunCounts(exported=exported)

    async def export_event(
        self, connection: Connection, resource: Resource, event_id: uuid.UUID
    ) -> Link:
        """Create an Orbit event in an external calendar and link it (two-way from then on)."""
        if "calendar_write" not in connection.capabilities or not resource.writable:
            raise CapabilityNotGrantedError
        detail = await self._calendar.get_event(resource.workspace_id, event_id)
        event = detail.event
        if event.recurrence is not None:
            raise NotExportableError
        existing = await self._store.links_for_entity(resource.workspace_id, "event", event.id)
        if any(link.connection_id == connection.id for link in existing):
            raise AlreadyLinkedError
        connector = self._connector(connection)
        created = await self._tokens.call(
            connection,
            lambda token: connector.create_event(token, resource.external_id, outgoing(event)),
        )
        remote = normalized(created)
        link = replace(
            self._new_link(resource, remote, event, None, self._clock()),
            origin="orbit",
        )
        await self._store.add_link(link)
        await self._transaction.commit()
        return link

    # Conflicts

    async def resolve(
        self, connection: Connection, link: Link, resolution: ConflictResolution
    ) -> Link | None:
        """Settle a conflict. Returns the link, or `None` when it no longer exists (the event was
        deleted, or detached and kept as an Orbit-only event)."""
        if link.status != "conflict" or link.conflict_kind is None:
            raise NotConflictedError
        event = await self._event_of(link)
        if link.conflict_kind == "deleted_remotely" or event is None:
            if resolution == "keep_external" and event is not None:
                if self._is_occurrence_link(link, event) and link.original_start is not None:
                    await self._calendar.delete_occurrence(
                        event.workspace_id, event.id, link.original_start, "this"
                    )
                else:
                    await self._calendar.delete_event(event.workspace_id, event.id)
            await self._delete_with_children(link)
            await self._transaction.commit()
            return None

        snapshot = from_snapshot(link.remote_snapshot or {})
        if resolution == "keep_external":
            if self._is_occurrence_link(link, event) and link.original_start is not None:
                await self._write_occurrence(event, link.original_start, snapshot)
                written = await self._store.event_exception(
                    event.workspace_id, event.id, link.original_start
                )
                fingerprint = exception_hash(written)
            else:
                event = await self._write_event(event, snapshot)
                fingerprint = event_hash(event)
            resolved = self._synced(link, snapshot, fingerprint, None)
        else:
            resource = (
                await self._store.resource_by_id(link.resource_id) if link.resource_id else None
            )
            if (
                resource is not None
                and resource.direction == "two_way"
                and resource.writable
                and "calendar_write" in connection.capabilities
                and event.recurrence is None
            ):
                connector = self._connector(connection)
                sent = await self._tokens.call(
                    connection,
                    lambda token: connector.update_event(
                        token, resource.external_id, link.external_id, outgoing(event), None
                    ),
                )
                resolved = self._synced(link, normalized(sent), event_hash(event), None)
            else:
                # Keep Orbit's version without sending it: later provider changes conflict again.
                resolved = replace(
                    link,
                    status="local_changes",
                    remote_version=snapshot.version,
                    conflict_kind=None,
                    conflict_detected_at=None,
                    updated_at=self._clock(),
                )
        await self._store.save_link(resolved)
        await self._transaction.commit()
        return resolved

    # Writing to Orbit's calendar

    def _draft(self, remote: RemoteEvent, resource: Resource) -> EventDraft:
        return EventDraft(
            title=remote.title,
            start=remote.start,
            end=remote.end,
            timezone=remote.timezone,
            all_day=remote.all_day,
            description=remote.description,
            location=remote.location,
            category_id=resource.category_id,
            recurrence=remote.recurrence,
        )

    async def _write_event(self, event: CalendarEvent, remote: RemoteEvent) -> CalendarEvent:
        detail = await self._calendar.update_event(
            event.workspace_id,
            event.id,
            EventChanges(
                title=remote.title,
                description=remote.description,
                location=remote.location,
                all_day=remote.all_day,
                timezone=remote.timezone,
                start=remote.start,
                end=remote.end,
                recurrence=remote.recurrence,
            ),
        )
        return await self._skip_excluded(detail.event, remote)

    async def _skip_excluded(self, event: CalendarEvent, remote: RemoteEvent) -> CalendarEvent:
        if event.recurrence is None or not remote.skipped:
            return event
        for start in remote.skipped:
            try:
                await self._calendar.delete_occurrence(event.workspace_id, event.id, start, "this")
            except OccurrenceNotFoundError:
                continue
        return (await self._calendar.get_event(event.workspace_id, event.id)).event

    async def _write_occurrence(
        self, series: CalendarEvent, original: datetime, remote: RemoteEvent
    ) -> None:
        if remote.cancelled:
            await self._calendar.delete_occurrence(series.workspace_id, series.id, original, "this")
            return
        await self._calendar.update_occurrence(
            series.workspace_id,
            series.id,
            original,
            "this",
            OccurrenceChanges(
                title=remote.title,
                description=remote.description,
                location=remote.location,
                start=self._in_zone(remote.start, remote, series.timezone),
                end=self._in_zone(remote.end, remote, series.timezone),
            ),
        )

    async def _adopt_children(
        self, run: SyncRun, resource: Resource, link: Link, series: CalendarEvent
    ) -> None:
        """Occurrences that arrived before their series (on an earlier page) were imported as
        standalone events; now that the series exists, they become its occurrences."""
        for child in await self._store.child_links(resource.id, link.external_id):
            if child.entity_id == series.id or child.remote_snapshot is None:
                continue
            standalone = await self._event_of(child)
            if standalone is not None:
                if event_hash(standalone) != child.local_hash:
                    continue  # Changed in Orbit: left alone rather than replaced.
                await self._calendar.delete_event(standalone.workspace_id, standalone.id)
            await self._store.delete_links([child.id])
            await self._apply_occurrence(
                run, resource, link, series, None, from_snapshot(child.remote_snapshot)
            )

    async def _reapply_children(
        self, run: SyncRun, resource: Resource, link: Link, series: CalendarEvent
    ) -> None:
        """Changing a series' timing clears its exceptions in Orbit; the provider's changed and
        cancelled occurrences are applied again where they still exist."""
        for child in await self._store.child_links(resource.id, link.external_id):
            if child.entity_id != series.id or child.remote_snapshot is None:
                continue
            remote = from_snapshot(child.remote_snapshot)
            original = self._in_zone(remote.original_start or remote.start, remote, series.timezone)
            try:
                await self._write_occurrence(series, original, remote)
            except _ITEM_ERRORS:
                await self._store.delete_links([child.id])
                continue
            written = await self._store.event_exception(series.workspace_id, series.id, original)
            await self._store.save_link(
                replace(
                    child,
                    original_start=original,
                    local_hash=exception_hash(written),
                    last_seen_run_id=run.id,
                )
            )

    # Push channels

    async def _maintain_channel(
        self, connection: Connection, resource: Resource, connector: CalendarConnector
    ) -> Resource:
        if self._webhook_url is None or not resource.enabled:
            return resource
        now = self._clock()
        expires = resource.channel_expires_at
        if resource.channel_id and expires is not None and expires > now + CHANNEL_RENEWAL:
            return resource
        channel_id = uuid.uuid4().hex
        secret = secrets.token_urlsafe(32)
        address = f"{self._webhook_url.rstrip('/')}/{connection.provider}"
        try:
            channel = await self._tokens.call(
                connection,
                lambda token: connector.watch(
                    token, resource.external_id, address, channel_id, secret
                ),
            )
        except ProviderError as exc:
            # Push is an optimization; polling continues without it.
            logger.warning("Couldn't register a push channel: %s", type(exc).__name__)
            return resource
        old_id, old_resource = resource.channel_id, resource.channel_resource_id
        resource = replace(
            resource,
            channel_id=channel.channel_id,
            channel_token_hash=digest(secret),
            channel_resource_id=channel.resource_id,
            channel_expires_at=channel.expires_at,
        )
        await self._store.save_resource(resource)
        await self._transaction.commit()
        if old_id:
            # The old channel expires on its own if stopping it fails.
            with contextlib.suppress(ProviderError):
                await self._tokens.call(
                    connection, lambda token: connector.unwatch(token, old_id, old_resource)
                )
        return resource

    # Helpers

    def _connector(self, connection: Connection) -> CalendarConnector:
        provider = self._connectors.get(connection.provider)
        if provider is None or provider.calendar is None:
            raise ProviderNotConfiguredError
        return provider.calendar

    async def _event_of(self, link: Link | None) -> CalendarEvent | None:
        if link is None or link.entity_type != "event":
            return None
        try:
            return (await self._calendar.get_event(link.workspace_id, link.entity_id)).event
        except EventNotFoundError:
            return None

    @staticmethod
    def _is_occurrence_link(link: Link, event: CalendarEvent) -> bool:
        """Whether the link is a changed or cancelled occurrence of an imported series (rather
        than the series itself, or a standalone event)."""
        return (
            link.original_start is not None
            and link.external_parent_id is not None
            and event.recurrence is not None
        )

    @staticmethod
    def _in_zone(local: datetime, remote: RemoteEvent, timezone: str) -> datetime:
        if remote.timezone == timezone or remote.all_day:
            return local
        return local_from_instant(local.replace(tzinfo=ZoneInfo(remote.timezone)), timezone)

    def _new_link(
        self,
        resource: Resource,
        remote: RemoteEvent,
        event: CalendarEvent,
        run: SyncRun | None,
        now: datetime,
    ) -> Link:
        return Link(
            id=uuid.uuid4(),
            workspace_id=resource.workspace_id,
            connection_id=resource.connection_id,
            resource_id=resource.id,
            external_kind="event",
            external_id=remote.external_id,
            external_parent_id=remote.parent_id,
            entity_type="event",
            entity_id=event.id,
            original_start=remote.original_start,
            origin="external",
            title=remote.title,
            external_url=remote.url,
            remote_version=remote.version,
            remote_snapshot=to_snapshot(remote),
            local_hash=event_hash(event),
            remote_start_at=start_instant(remote),
            status="synced",
            conflict_kind=None,
            conflict_detected_at=None,
            last_seen_run_id=run.id if run else None,
            last_synced_at=now,
            created_at=now,
            updated_at=now,
        )

    def _synced(
        self, link: Link, remote: RemoteEvent, local_hash: str, run: SyncRun | None
    ) -> Link:
        now = self._clock()
        return replace(
            link,
            title=remote.title,
            external_url=remote.url or link.external_url,
            remote_version=remote.version,
            remote_snapshot=to_snapshot(remote),
            local_hash=local_hash,
            remote_start_at=start_instant(remote),
            status="synced",
            conflict_kind=None,
            conflict_detected_at=None,
            last_seen_run_id=run.id if run else link.last_seen_run_id,
            last_synced_at=now,
            updated_at=now,
        )

    async def _save_seen(self, link: Link, run: SyncRun, *, deleted_locally: bool = False) -> None:
        updated = replace(link, last_seen_run_id=run.id)
        if deleted_locally:
            updated = replace(updated, status="deleted_locally")
        if updated != link:
            await self._store.save_link(updated)

    async def _conflict(
        self, link: Link, kind: ConflictKind, remote: RemoteEvent | None, run: SyncRun | None
    ) -> None:
        now = self._clock()
        await self._store.save_link(
            replace(
                link,
                status="conflict",
                conflict_kind=kind,
                conflict_detected_at=link.conflict_detected_at or now,
                remote_snapshot=to_snapshot(remote) if remote else link.remote_snapshot,
                last_seen_run_id=run.id if run else link.last_seen_run_id,
                updated_at=now,
            )
        )

    async def _delete_with_children(self, link: Link) -> None:
        ids = [link.id]
        if link.resource_id is not None:
            ids += [
                child.id
                for child in await self._store.child_links(link.resource_id, link.external_id)
                if child.entity_id == link.entity_id
            ]
        await self._store.delete_links(ids)


def _snapshot_version(link: Link) -> str | None:
    version = (link.remote_snapshot or {}).get("version")
    return version if isinstance(version, str) else None
