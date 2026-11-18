"""Daily briefings, always addressed by workspace and person.

The snapshot dataclasses are written to JSON and read back with pydantic's `TypeAdapter`, which
validates the stored document against the current types, so a corrupt or foreign document
fails loudly here rather than reaching the API half-formed.
"""

import uuid
from collections.abc import Callable
from datetime import date, datetime
from typing import Any, Final, cast

from pydantic import TypeAdapter
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    BriefingSettingsModel,
    DailyBriefingModel,
    UserModel,
    WorkspaceModel,
)
from orbit_api.repositories.budgets import build_budget_service
from orbit_api.repositories.calendar import build_calendar_service
from orbit_api.repositories.commitments import build_commitment_service
from orbit_api.repositories.documents import build_document_service
from orbit_api.repositories.fitness import build_fitness
from orbit_api.repositories.goals import build_goal_service
from orbit_api.repositories.habits import build_habit_service, build_routine_service
from orbit_api.repositories.investments import build_investment_service
from orbit_api.repositories.notes import build_note_service
from orbit_api.repositories.reminders import (
    SqlOccurrenceRepository,
    SqlReminderRepository,
    build_task_service,
)
from orbit_api.repositories.shopping import SqlShoppingItemRepository, SqlShoppingListRepository
from orbit_api.repositories.tasks import SqlTaskRepository
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.briefings.aggregation import BriefingAggregator, FitnessHealthSource
from orbit_api.services.briefings.models import (
    FORMAT_VERSION,
    SOURCES,
    Briefing,
    BriefingContent,
    BriefingHistoryPage,
    BriefingListing,
    BriefingSettings,
    BriefingStatus,
    BriefingSummary,
    Narrative,
    Source,
)
from orbit_api.services.briefings.service import BriefingService, ScheduledBriefing
from orbit_api.services.reminders.service import ReminderService
from orbit_api.services.shopping.service import ShoppingService
from orbit_api.system.attachment_store import FileAttachmentStore
from orbit_api.utils.clock import utc_now

_CONTENT: Final = TypeAdapter(BriefingContent)
_SUMMARY: Final = TypeAdapter(BriefingSummary)
_NARRATIVE: Final = TypeAdapter(Narrative)


def _status(content: BriefingContent) -> BriefingStatus:
    return "partial" if content.unavailable else "complete"


def encode_content(content: BriefingContent) -> dict[str, Any]:
    """The snapshot as a JSON document."""
    return cast(dict[str, Any], _CONTENT.dump_python(content, mode="json"))


def decode_content(stored: object) -> BriefingContent:
    """A stored snapshot, validated against the current types."""
    return _CONTENT.validate_python(stored)


def _dump_summary(summary: BriefingSummary) -> dict[str, Any]:
    return cast(dict[str, Any], _SUMMARY.dump_python(summary, mode="json"))


def _stored_status(model: DailyBriefingModel) -> BriefingStatus:
    return "partial" if model.status == "partial" else "complete"


def _to_briefing(model: DailyBriefingModel) -> Briefing:
    return Briefing(
        id=model.id,
        workspace_id=model.workspace_id,
        user_id=model.user_id,
        date=model.briefing_date,
        timezone=model.timezone,
        status=_stored_status(model),
        revision=model.revision,
        generated_at=model.generated_at,
        created_at=model.created_at,
        content=decode_content(model.content),
        narrative=_NARRATIVE.validate_python(model.narrative) if model.narrative else None,
    )


class SqlBriefingRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, day: date, timezone: str | None
    ) -> Briefing | None:
        statement = select(DailyBriefingModel).where(
            DailyBriefingModel.workspace_id == workspace_id,
            DailyBriefingModel.user_id == user_id,
            DailyBriefingModel.briefing_date == day,
        )
        if timezone is not None:
            statement = statement.where(DailyBriefingModel.timezone == timezone)
        model = await self._session.scalar(
            # Without a time zone, the date's most recently prepared briefing.
            statement.order_by(DailyBriefingModel.generated_at.desc(), DailyBriefingModel.id.desc())
            .limit(1)
            # A regeneration updates the row with a bulk statement; read it as stored.
            .execution_options(populate_existing=True)
        )
        return _to_briefing(model) if model is not None else None

    async def add(self, briefing: Briefing) -> None:
        self._session.add(
            DailyBriefingModel(
                id=briefing.id,
                workspace_id=briefing.workspace_id,
                user_id=briefing.user_id,
                briefing_date=briefing.date,
                timezone=briefing.timezone,
                status=briefing.status,
                revision=briefing.revision,
                format_version=FORMAT_VERSION,
                summary=_dump_summary(briefing.content.summary),
                content=encode_content(briefing.content),
                generated_at=briefing.generated_at,
                created_at=briefing.created_at,
                updated_at=briefing.created_at,
            )
        )
        await flush(self._session)

    async def replace(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        content: BriefingContent,
        generated_at: datetime,
    ) -> None:
        # One statement, so concurrent regenerations each count: the last snapshot wins.
        await self._session.execute(
            update(DailyBriefingModel)
            .where(
                DailyBriefingModel.workspace_id == workspace_id,
                DailyBriefingModel.user_id == user_id,
                DailyBriefingModel.briefing_date == day,
                DailyBriefingModel.timezone == content.window.timezone,
            )
            .values(
                status=_status(content),
                revision=DailyBriefingModel.revision + 1,
                format_version=FORMAT_VERSION,
                summary=_dump_summary(content.summary),
                content=encode_content(content),
                # The summary described the old snapshot.
                narrative=None,
                generated_at=generated_at,
                updated_at=generated_at,
            )
            .execution_options(synchronize_session=False)
        )

    async def history(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, limit: int, offset: int
    ) -> BriefingHistoryPage:
        scope = (
            DailyBriefingModel.workspace_id == workspace_id,
            DailyBriefingModel.user_id == user_id,
        )
        total = await self._session.scalar(
            select(func.count()).select_from(DailyBriefingModel).where(*scope)
        )
        rows = await self._session.execute(
            select(
                DailyBriefingModel.id,
                DailyBriefingModel.briefing_date,
                DailyBriefingModel.timezone,
                DailyBriefingModel.status,
                DailyBriefingModel.revision,
                DailyBriefingModel.generated_at,
                DailyBriefingModel.summary,
            )
            .where(*scope)
            .order_by(DailyBriefingModel.briefing_date.desc(), DailyBriefingModel.id)
            .limit(limit)
            .offset(offset)
        )
        return BriefingHistoryPage(
            items=[
                BriefingListing(
                    id=row.id,
                    date=row.briefing_date,
                    timezone=row.timezone,
                    status="partial" if row.status == "partial" else "complete",
                    revision=row.revision,
                    generated_at=row.generated_at,
                    summary=_SUMMARY.validate_python(row.summary),
                )
                for row in rows
            ],
            total=total or 0,
        )

    async def set_narrative(self, briefing: Briefing, narrative: Narrative) -> None:
        await self._session.execute(
            update(DailyBriefingModel)
            .where(
                DailyBriefingModel.workspace_id == briefing.workspace_id,
                DailyBriefingModel.user_id == briefing.user_id,
                DailyBriefingModel.id == briefing.id,
            )
            .values(narrative=cast(dict[str, Any], _NARRATIVE.dump_python(narrative, mode="json")))
            .execution_options(synchronize_session=False)
        )


class SqlBriefingSettings:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> BriefingSettings:
        model = await self._session.get(BriefingSettingsModel, (workspace_id, user_id))
        if model is None:
            return BriefingSettings()
        # Sources this version doesn't know (one retired since) are dropped.
        stored = set(model.hidden_sources)
        hidden: frozenset[Source] = frozenset(s for s in SOURCES if s in stored)
        return BriefingSettings(
            horizon_days=model.horizon_days, hidden=hidden, prepare_at=model.prepare_at
        )

    async def put(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, settings: BriefingSettings
    ) -> None:
        model = await self._session.get(BriefingSettingsModel, (workspace_id, user_id))
        hidden: list[str] = sorted(settings.hidden)
        if model is None:
            self._session.add(
                BriefingSettingsModel(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    horizon_days=settings.horizon_days,
                    hidden_sources=hidden,
                    prepare_at=settings.prepare_at,
                )
            )
        else:
            model.horizon_days = settings.horizon_days
            model.hidden_sources = hidden
            model.prepare_at = settings.prepare_at
        await flush(self._session)

    async def scheduled(self) -> list[ScheduledBriefing]:
        """Everyone who asked for their briefing to be prepared, in workspaces they own."""
        rows = await self._session.execute(
            select(
                BriefingSettingsModel.workspace_id,
                BriefingSettingsModel.user_id,
                BriefingSettingsModel.prepare_at,
                UserModel.timezone,
            )
            .join(WorkspaceModel, WorkspaceModel.id == BriefingSettingsModel.workspace_id)
            .join(UserModel, UserModel.id == BriefingSettingsModel.user_id)
            .where(
                BriefingSettingsModel.prepare_at.is_not(None),
                WorkspaceModel.owner_id == BriefingSettingsModel.user_id,
            )
            .order_by(BriefingSettingsModel.workspace_id, BriefingSettingsModel.user_id)
        )
        return [
            ScheduledBriefing(
                workspace_id=workspace_id,
                user_id=user_id,
                prepare_at=prepare_at,
                timezone=timezone or "UTC",
            )
            for workspace_id, user_id, prepare_at, timezone in rows
            if prepare_at is not None
        ]


def build_briefing_service(
    session: AsyncSession,
    files: FileAttachmentStore,
    clock: Callable[[], datetime] | None = None,
) -> BriefingService:
    """Briefings over the modules' own services, all sharing `session`'s transaction. Used by
    the API per request, by the agent's briefing tool, and by the worker."""
    now = clock or utc_now
    transaction = SqlTransaction(session)
    aggregator = BriefingAggregator(
        tasks=build_task_service(session, transaction, now),
        calendar=build_calendar_service(session, clock),
        reminders=ReminderService(
            SqlReminderRepository(session),
            SqlOccurrenceRepository(session),
            SqlTaskRepository(session),
            transaction,
        ),
        payments=build_commitment_service(session, clock),
        budgets=build_budget_service(session, clock),
        goals=build_goal_service(session, clock),
        habits=build_habit_service(session, clock),
        routines=build_routine_service(session),
        health=FitnessHealthSource(build_fitness(session, files, clock)),
        notes=build_note_service(session),
        documents=build_document_service(session, files, now),
        shopping=ShoppingService(
            SqlShoppingListRepository(session), SqlShoppingItemRepository(session), transaction
        ),
        investments=build_investment_service(session, clock),
        transaction=transaction,
        clock=now,
    )
    return BriefingService(
        SqlBriefingRepository(session),
        SqlBriefingSettings(session),
        aggregator,
        transaction,
        clock=now,
    )
