"""Reminders and their occurrences.

Reminder queries are filtered by workspace, so callers cannot reach other workspaces' rows. The
delivery methods (`get_for_delivery`, `record_outcome`, and the occurrence claims) serve the
worker, which acts for every workspace; they take IDs it read from claimed occurrences, never
IDs from a request.
"""

import uuid
from datetime import datetime
from typing import Any, cast

from sqlalchemy import (
    ColumnElement,
    Select,
    and_,
    case,
    delete,
    exists,
    false,
    func,
    or_,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import ReminderModel, ReminderOccurrenceModel, TaskModel, WorkspaceModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.reminders.models import (
    ClaimedOccurrence,
    CommitmentLink,
    DeliveryOutcome,
    DeliveryTarget,
    Occurrence,
    OccurrenceStatus,
    Reminder,
    ReminderNotFoundError,
    ReminderPage,
    ReminderQuery,
    ReminderStatus,
    ReminderTask,
    ReminderView,
)
from orbit_api.services.reminders.recurrence import (
    Schedule,
    recurrence_from_json,
    recurrence_to_json,
)
from orbit_api.services.tasks.models import TaskStatus

_ACTIVE: tuple[OccurrenceStatus, ...] = ("pending", "processing")

Occ = ReminderOccurrenceModel


def _to_reminder(model: ReminderModel) -> Reminder:
    return Reminder(
        id=model.id,
        workspace_id=model.workspace_id,
        task_id=model.task_id,
        title=model.title,
        description=model.description,
        enabled=model.enabled,
        schedule=Schedule(
            start_date=model.start_date,
            time_of_day=model.time_of_day,
            timezone=model.timezone,
            recurrence=recurrence_from_json(model.recurrence),
        ),
        last_occurrence_at=model.last_occurrence_at,
        # The table's CHECK constraint limits `last_outcome` to these values.
        last_outcome=cast(DeliveryOutcome | None, model.last_outcome),
        created_at=model.created_at,
        updated_at=model.updated_at,
        commitment=_commitment_of(model),
    )


def _commitment_of(model: ReminderModel) -> CommitmentLink | None:
    if model.finance_loan_id is not None:
        return CommitmentLink(kind="loan", id=model.finance_loan_id)
    if model.finance_recurring_payment_id is not None:
        return CommitmentLink(kind="recurring_payment", id=model.finance_recurring_payment_id)
    if model.finance_deposit_id is not None:
        return CommitmentLink(kind="deposit", id=model.finance_deposit_id)
    return None


def _next_occurrence_at() -> ColumnElement[datetime]:
    """The reminder's earliest active occurrence. There is normally at most one."""
    return (
        select(func.min(Occ.scheduled_for))
        .where(Occ.reminder_id == ReminderModel.id, Occ.status.in_(_ACTIVE))
        .correlate(ReminderModel)
        .scalar_subquery()
    )


def _status(next_at: ColumnElement[datetime], now: datetime) -> ColumnElement[str]:
    """`ReminderStatus`, computed in SQL so lists can filter and page by it."""
    return case(
        (ReminderModel.enabled == false(), "disabled"),
        (TaskModel.status == "completed", "completed"),
        (or_(next_at <= now, ReminderModel.last_outcome == "failed"), "overdue"),
        (next_at.is_not(None), "scheduled"),
        else_="completed",
    )


def _select_views(
    now: datetime,
) -> tuple[
    Select[ReminderModel, str, str, datetime, str], ColumnElement[datetime], ColumnElement[str]
]:
    next_at = _next_occurrence_at()
    status = _status(next_at, now)
    statement = select(
        ReminderModel,
        TaskModel.title,
        TaskModel.status,
        next_at.label("next_at"),
        status.label("status"),
    ).outerjoin(TaskModel, TaskModel.id == ReminderModel.task_id)
    return statement, next_at, status


def _to_view(row: Any) -> ReminderView:
    model: ReminderModel = row[0]
    task_title: str | None = row[1]
    task_status: str | None = row[2]
    task = None
    if model.task_id is not None and task_title is not None:
        task = ReminderTask(
            id=model.task_id, title=task_title, status=cast(TaskStatus, task_status)
        )
    return ReminderView(
        reminder=_to_reminder(model),
        status=cast(ReminderStatus, row[4]),
        next_occurrence_at=row[3],
        task=task,
    )


class SqlReminderRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, reminder: Reminder) -> None:
        link = reminder.commitment
        self._session.add(
            ReminderModel(
                id=reminder.id,
                workspace_id=reminder.workspace_id,
                # The link is fixed once the reminder exists.
                finance_loan_id=link.id if link and link.kind == "loan" else None,
                finance_recurring_payment_id=(
                    link.id if link and link.kind == "recurring_payment" else None
                ),
                finance_deposit_id=link.id if link and link.kind == "deposit" else None,
                last_occurrence_at=reminder.last_occurrence_at,
                last_outcome=reminder.last_outcome,
                created_at=reminder.created_at,
                **self._fields(reminder),
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, reminder_id: uuid.UUID) -> Reminder | None:
        model = await self._get_model(workspace_id, reminder_id)
        return _to_reminder(model) if model else None

    async def for_commitment(
        self, workspace_id: uuid.UUID, link: CommitmentLink
    ) -> Reminder | None:
        """The reminder a commitment manages, if it has one, locked for this transaction."""
        column = {
            "loan": ReminderModel.finance_loan_id,
            "recurring_payment": ReminderModel.finance_recurring_payment_id,
            "deposit": ReminderModel.finance_deposit_id,
        }[link.kind]
        model = await self._session.scalar(
            select(ReminderModel)
            .where(ReminderModel.workspace_id == workspace_id, column == link.id)
            .with_for_update()
        )
        return _to_reminder(model) if model else None

    async def view(
        self, workspace_id: uuid.UUID, reminder_id: uuid.UUID, now: datetime
    ) -> ReminderView | None:
        statement, _, _ = _select_views(now)
        row = (
            await self._session.execute(
                statement.where(
                    ReminderModel.id == reminder_id, ReminderModel.workspace_id == workspace_id
                )
            )
        ).first()
        return _to_view(row) if row else None

    async def find(
        self, workspace_id: uuid.UUID, query: ReminderQuery, now: datetime
    ) -> ReminderPage:
        statement, next_at, status = _select_views(now)
        conditions: list[ColumnElement[bool]] = [ReminderModel.workspace_id == workspace_id]
        if query.task_id is not None:
            conditions.append(ReminderModel.task_id == query.task_id)
        if query.status is not None:
            conditions.append(status == query.status)
        total = await self._session.scalar(
            select(func.count())
            .select_from(ReminderModel)
            .outerjoin(TaskModel, TaskModel.id == ReminderModel.task_id)
            .where(*conditions)
        )
        rows = await self._session.execute(
            statement.where(*conditions)
            # Soonest first; reminders with nothing left to fire after, newest first.
            .order_by(
                next_at.is_(None),
                next_at.asc(),
                ReminderModel.created_at.desc(),
                ReminderModel.id.asc(),
            )
            .limit(query.limit)
            .offset(query.offset)
        )
        return ReminderPage(reminders=[_to_view(row) for row in rows], total=total or 0)

    async def upcoming(
        self, workspace_id: uuid.UUID, now: datetime, limit: int
    ) -> list[ReminderView]:
        statement, next_at, _ = _select_views(now)
        rows = await self._session.execute(
            statement.where(
                ReminderModel.workspace_id == workspace_id,
                ReminderModel.enabled,
                next_at.is_not(None),
                or_(ReminderModel.task_id.is_(None), TaskModel.status == "open"),
            )
            .order_by(next_at.asc(), ReminderModel.id.asc())
            .limit(limit)
        )
        return [_to_view(row) for row in rows]

    async def save(self, reminder: Reminder) -> None:
        model = await self._get_model(reminder.workspace_id, reminder.id)
        if model is None:
            raise ReminderNotFoundError
        for name, value in self._fields(reminder).items():
            setattr(model, name, value)
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, reminder_id: uuid.UUID) -> bool:
        deleted = await self._session.scalars(
            delete(ReminderModel)
            .where(ReminderModel.id == reminder_id, ReminderModel.workspace_id == workspace_id)
            .returning(ReminderModel.id)
        )
        return deleted.first() is not None

    async def get_for_delivery(self, reminder_id: uuid.UUID) -> DeliveryTarget | None:
        row = (
            await self._session.execute(
                select(ReminderModel, TaskModel.status, WorkspaceModel.owner_id)
                .join(WorkspaceModel, WorkspaceModel.id == ReminderModel.workspace_id)
                .outerjoin(TaskModel, TaskModel.id == ReminderModel.task_id)
                .where(ReminderModel.id == reminder_id)
                # PostgreSQL: wait for an edit in progress, so delivery sees the reminder as
                # saved. SQLite serializes writers, and this transaction already writes.
                .with_for_update(of=ReminderModel)
            )
        ).first()
        if row is None:
            return None
        return DeliveryTarget(
            reminder=_to_reminder(row[0]),
            task_completed=row[1] == "completed",
            recipients=(row[2],),
        )

    async def record_outcome(
        self, reminder_id: uuid.UUID, occurrence_at: datetime, outcome: DeliveryOutcome
    ) -> None:
        await self._session.execute(
            update(ReminderModel)
            .where(ReminderModel.id == reminder_id)
            .values(last_occurrence_at=occurrence_at, last_outcome=outcome)
        )

    async def _get_model(
        self, workspace_id: uuid.UUID, reminder_id: uuid.UUID
    ) -> ReminderModel | None:
        return await self._session.scalar(
            select(ReminderModel).where(
                ReminderModel.id == reminder_id, ReminderModel.workspace_id == workspace_id
            )
        )

    @staticmethod
    def _fields(reminder: Reminder) -> dict[str, Any]:
        """The columns a user can edit."""
        schedule = reminder.schedule
        return {
            "task_id": reminder.task_id,
            "title": reminder.title,
            "description": reminder.description,
            "enabled": reminder.enabled,
            "start_date": schedule.start_date,
            "time_of_day": schedule.time_of_day,
            "timezone": schedule.timezone,
            "recurrence": recurrence_to_json(schedule.recurrence),
            "updated_at": reminder.updated_at,
        }


def _claimable(now: datetime) -> ColumnElement[bool]:
    """Pending occurrences that are available, and processing ones whose lease expired."""
    return or_(
        and_(Occ.status == "pending", Occ.available_at <= now),
        and_(Occ.status == "processing", Occ.claimed_until < now),
    )


class SqlOccurrenceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, occurrence: Occurrence) -> None:
        self._session.add(
            Occ(
                id=occurrence.id,
                reminder_id=occurrence.reminder_id,
                scheduled_for=occurrence.scheduled_for,
                status=occurrence.status,
                attempts=occurrence.attempts,
                available_at=occurrence.available_at,
                created_at=occurrence.created_at,
            )
        )
        await flush(self._session)

    async def remove_pending(self, reminder_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(Occ).where(Occ.reminder_id == reminder_id, Occ.status == "pending")
        )

    async def has_active(self, reminder_id: uuid.UUID) -> bool:
        found = await self._session.scalar(
            select(exists().where(Occ.reminder_id == reminder_id, Occ.status.in_(_ACTIVE)))
        )
        return bool(found)

    async def claim_due(
        self, now: datetime, lease_until: datetime, limit: int
    ) -> list[ClaimedOccurrence]:
        """Lease up to `limit` due occurrences, oldest first, in one atomic statement.

        The update re-checks `_claimable` on each row as it writes it, so when two workers race
        for a row, the second finds it already `processing` and skips it. On PostgreSQL,
        `SKIP LOCKED` also lets concurrent workers pick different rows instead of waiting.
        """
        token = uuid.uuid4()
        candidates = (
            select(Occ.id)
            .where(_claimable(now))
            .order_by(Occ.available_at, Occ.id)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        rows = await self._session.execute(
            update(Occ)
            .where(Occ.id.in_(candidates), _claimable(now))
            .values(
                status="processing",
                claim_token=token,
                claimed_until=lease_until,
                attempts=Occ.attempts + 1,
            )
            .returning(Occ.id, Occ.reminder_id, Occ.scheduled_for, Occ.attempts)
            .execution_options(synchronize_session=False)
        )
        claims = [
            ClaimedOccurrence(
                id=row[0],
                reminder_id=row[1],
                scheduled_for=row[2],
                attempts=row[3],
                claim_token=token,
            )
            for row in rows
        ]
        return sorted(claims, key=lambda claim: (claim.scheduled_for, claim.id))

    async def confirm_claim(self, occurrence_id: uuid.UUID, claim_token: uuid.UUID) -> bool:
        # A no-op write: it takes the row lock (PostgreSQL) or the write lock (SQLite) up front,
        # so no other worker can take over this occurrence until the transaction ends.
        return await self._update_claimed(
            occurrence_id, claim_token, {"claimed_until": Occ.claimed_until}
        )

    async def finish(
        self,
        occurrence_id: uuid.UUID,
        claim_token: uuid.UUID,
        outcome: DeliveryOutcome,
        now: datetime,
        error: str | None = None,
    ) -> bool:
        return await self._update_claimed(
            occurrence_id,
            claim_token,
            {
                "status": outcome,
                "finished_at": now,
                "claim_token": None,
                "claimed_until": None,
                "last_error": error,
            },
        )

    async def release(
        self,
        occurrence_id: uuid.UUID,
        claim_token: uuid.UUID,
        available_at: datetime,
        error: str,
    ) -> bool:
        return await self._update_claimed(
            occurrence_id,
            claim_token,
            {
                "status": "pending",
                "available_at": available_at,
                "claim_token": None,
                "claimed_until": None,
                "last_error": error,
            },
        )

    async def count_by_status(self) -> dict[OccurrenceStatus, int]:
        rows = await self._session.execute(
            select(Occ.status, func.count()).group_by(Occ.status).order_by(Occ.status)
        )
        return {cast(OccurrenceStatus, status): count for status, count in rows}

    async def retry_failed(self, now: datetime) -> int:
        """Return every failed occurrence to `pending`, available now, with fresh attempts."""
        rows = await self._session.execute(
            update(Occ)
            .where(Occ.status == "failed")
            .values(
                status="pending", attempts=0, available_at=now, finished_at=None, last_error=None
            )
            .returning(Occ.id)
            .execution_options(synchronize_session=False)
        )
        return len(rows.all())

    async def _update_claimed(
        self, occurrence_id: uuid.UUID, claim_token: uuid.UUID, values: dict[str, Any]
    ) -> bool:
        rows = await self._session.execute(
            update(Occ)
            .where(
                Occ.id == occurrence_id,
                Occ.claim_token == claim_token,
                Occ.status == "processing",
            )
            .values(values)
            .returning(Occ.id)
            .execution_options(synchronize_session=False)
        )
        return rows.first() is not None
