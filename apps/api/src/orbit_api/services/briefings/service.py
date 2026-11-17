"""Daily briefings: preparing, keeping, summarizing, and listing one person's briefing per day.

There is one canonical briefing per person, workspace, local date, and time zone: the same
date is a different day elsewhere, so opening the briefing in a second time zone prepares its
own. It is prepared the first
time today's briefing is asked for (or at the person's chosen time, by the worker), in the time
zone it was asked in, and kept: asking again returns the same snapshot until it is regenerated.
Regenerating replaces today's snapshot, adds one to its `revision`, and clears its written
summary. Only today's briefing can be prepared or regenerated, since doing it for another day
would present today's records as that day's; earlier briefings are history, kept as they were.

Concurrent first requests both aggregate, but the database's unique key lets only one insert
win; the other discards its work and returns the winner's briefing.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import date, datetime, time
from typing import Protocol
from zoneinfo import ZoneInfo

from orbit_api.services.briefings.models import (
    MAX_HORIZON_DAYS,
    MIN_HORIZON_DAYS,
    Briefing,
    BriefingContent,
    BriefingHistoryPage,
    BriefingNotFoundError,
    BriefingSettings,
    InvalidBriefingSettingsError,
    Narrative,
)
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.clock import utc_now


class BriefingRepository(Protocol):
    async def get(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, day: date, timezone: str | None
    ) -> Briefing | None:
        """The briefing for `day` in `timezone`; without one, the date's most recently
        prepared briefing in any time zone."""
        ...

    async def add(self, briefing: Briefing) -> None:
        """Raises `ConflictError` when that person already has a briefing for that date in
        that time zone."""
        ...

    async def replace(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        content: BriefingContent,
        generated_at: datetime,
    ) -> None:
        """Replace the snapshot for `day` in the snapshot's time zone, clear its summary, and
        add one to its revision."""
        ...

    async def set_narrative(self, briefing: Briefing, narrative: Narrative) -> None: ...

    async def history(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, limit: int, offset: int
    ) -> BriefingHistoryPage: ...


class BriefingSettingsRepository(Protocol):
    async def get(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> BriefingSettings:
        """The stored settings, or the defaults."""
        ...

    async def put(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, settings: BriefingSettings
    ) -> None: ...


class BriefingSource(Protocol):
    async def collect(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        timezone: str,
        settings: BriefingSettings | None = None,
    ) -> BriefingContent: ...


class NarrativeWriter(Protocol):
    async def write(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, content: BriefingContent
    ) -> Narrative: ...


@dataclass(frozen=True, slots=True)
class ScheduledBriefing:
    """Someone whose briefing the worker prepares at `prepare_at`, local time in `timezone`."""

    workspace_id: uuid.UUID
    user_id: uuid.UUID
    prepare_at: time
    timezone: str


def today_in(timezone: str, now: datetime) -> date:
    return now.astimezone(ZoneInfo(timezone)).date()


def check_settings(settings: BriefingSettings) -> None:
    if not MIN_HORIZON_DAYS <= settings.horizon_days <= MAX_HORIZON_DAYS:
        raise InvalidBriefingSettingsError


class BriefingService:
    def __init__(
        self,
        briefings: BriefingRepository,
        settings: BriefingSettingsRepository,
        source: BriefingSource,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._briefings = briefings
        self._settings = settings
        self._source = source
        self._transaction = transaction
        self._clock = clock

    async def today(self, workspace_id: uuid.UUID, user_id: uuid.UUID, timezone: str) -> Briefing:
        """Today's briefing in `timezone`, prepared now if there isn't one yet."""
        day = today_in(timezone, self._clock())
        stored = await self._briefings.get(workspace_id, user_id, day, timezone)
        if stored is not None:
            return stored
        content = await self._collect(workspace_id, user_id, day, timezone)
        return await self._insert(workspace_id, user_id, content)

    async def peek(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, timezone: str
    ) -> BriefingContent:
        """Today's snapshot without storing anything: the stored one, or a fresh read. For
        readers that must not write, such as the agent's briefing tool."""
        day = today_in(timezone, self._clock())
        stored = await self._briefings.get(workspace_id, user_id, day, timezone)
        if stored is not None:
            return stored.content
        return await self._collect(workspace_id, user_id, day, timezone)

    async def regenerate(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, timezone: str
    ) -> Briefing:
        """Prepare today's briefing again from the records as they are now."""
        day = today_in(timezone, self._clock())
        content = await self._collect(workspace_id, user_id, day, timezone)
        if await self._briefings.get(workspace_id, user_id, day, timezone) is None:
            return await self._insert(workspace_id, user_id, content)
        await self._briefings.replace(workspace_id, user_id, day, content, self._clock())
        await self._transaction.commit()
        return await self.get(workspace_id, user_id, day, timezone)

    async def prepare_if_due(self, scheduled: ScheduledBriefing) -> bool:
        """Prepare today's briefing once its time has come and there isn't one yet; return
        whether one was prepared. Safe to call often and from several workers."""
        now = self._clock().astimezone(ZoneInfo(scheduled.timezone))
        if now.time() < scheduled.prepare_at:
            return False
        day = now.date()
        stored = await self._briefings.get(
            scheduled.workspace_id, scheduled.user_id, day, scheduled.timezone
        )
        if stored is not None:
            return False
        content = await self._collect(
            scheduled.workspace_id, scheduled.user_id, day, scheduled.timezone
        )
        briefing = await self._insert(scheduled.workspace_id, scheduled.user_id, content)
        return briefing.content is content

    async def get(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        timezone: str | None = None,
    ) -> Briefing:
        """The briefing for `day` in `timezone`, or the date's most recent one without it."""
        stored = await self._briefings.get(workspace_id, user_id, day, timezone)
        if stored is None:
            raise BriefingNotFoundError
        return stored

    async def narrate(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        timezone: str | None,
        writer: NarrativeWriter,
    ) -> Briefing:
        """Write (or rewrite) the summary of the briefing stored for `day` (in `timezone`, or
        the date's most recent), from its snapshot alone, and keep it with the briefing."""
        briefing = await self.get(workspace_id, user_id, day, timezone)
        narrative = await writer.write(workspace_id, user_id, briefing.content)
        await self._briefings.set_narrative(briefing, narrative)
        await self._transaction.commit()
        return replace(briefing, narrative=narrative)

    async def history(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, limit: int, offset: int
    ) -> BriefingHistoryPage:
        """Briefings newest first, without their content."""
        return await self._briefings.history(workspace_id, user_id, limit, offset)

    async def settings(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> BriefingSettings:
        return await self._settings.get(workspace_id, user_id)

    async def update_settings(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, settings: BriefingSettings
    ) -> BriefingSettings:
        """Applies from the next briefing prepared; today's stays until regenerated."""
        check_settings(settings)
        await self._settings.put(workspace_id, user_id, settings)
        await self._transaction.commit()
        return settings

    async def _collect(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, day: date, timezone: str
    ) -> BriefingContent:
        settings = await self._settings.get(workspace_id, user_id)
        return await self._source.collect(workspace_id, user_id, day, timezone, settings)

    async def _insert(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, content: BriefingContent
    ) -> Briefing:
        now = self._clock()
        day = content.window.date
        briefing = Briefing(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            user_id=user_id,
            date=day,
            timezone=content.window.timezone,
            status="partial" if content.unavailable else "complete",
            revision=1,
            generated_at=now,
            created_at=now,
            content=content,
        )
        try:
            await self._briefings.add(briefing)
            await self._transaction.commit()
        except ConflictError:
            # Another request prepared it first: theirs is the canonical briefing.
            await self._transaction.rollback()
            return await self.get(workspace_id, user_id, day, content.window.timezone)
        return briefing
