"""People and their dates. Every query is filtered by workspace, so callers cannot reach other
workspaces' rows."""

import uuid
from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Any, cast

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import PersonDateModel, PersonModel
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.people.models import DateKind, Person, PersonDate, Relationship
from orbit_api.services.people.service import PeopleReminders, PeopleService
from orbit_api.utils.clock import utc_now


def _to_date(model: PersonDateModel) -> PersonDate:
    return PersonDate(
        # The table's CHECK constraint limits `kind` to these values.
        kind=cast(DateKind, model.kind),
        month=model.month,
        day=model.day,
        label=model.label,
        year=model.year,
        remind_days_before=model.remind_days_before,
    )


def _to_person(model: PersonModel, dates: Sequence[PersonDateModel]) -> Person:
    return Person(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        # The table's CHECK constraint limits `relationship` to these values.
        relationship=cast(Relationship, model.relationship),
        phone=model.phone,
        email=model.email,
        note=model.note,
        favorite=model.favorite,
        dates=tuple(_to_date(date) for date in dates),
        reminder_time=model.reminder_time,
        timezone=model.timezone,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _fields(person: Person) -> dict[str, Any]:
    """The columns a person's fields set, apart from their identity."""
    return {
        "name": person.name,
        "relationship": person.relationship,
        "phone": person.phone,
        "email": person.email,
        "note": person.note,
        "favorite": person.favorite,
        "reminder_time": person.reminder_time,
        "timezone": person.timezone,
        "updated_at": person.updated_at,
    }


class SqlPeopleStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def all(self, workspace_id: uuid.UUID) -> list[Person]:
        models = list(
            await self._session.scalars(
                select(PersonModel)
                .where(PersonModel.workspace_id == workspace_id)
                .order_by(func.lower(PersonModel.name), PersonModel.id)
            )
        )
        dates = await self._dates(workspace_id, [model.id for model in models])
        return [_to_person(model, dates.get(model.id, [])) for model in models]

    async def get(self, workspace_id: uuid.UUID, person_id: uuid.UUID) -> Person | None:
        model = await self._get_model(workspace_id, person_id)
        if model is None:
            return None
        dates = await self._dates(workspace_id, [model.id])
        return _to_person(model, dates.get(model.id, []))

    async def add(self, person: Person) -> None:
        self._session.add(
            PersonModel(
                id=person.id,
                workspace_id=person.workspace_id,
                created_at=person.created_at,
                **_fields(person),
            )
        )
        await flush(self._session)
        await self._add_dates(person)

    async def save(self, person: Person) -> None:
        model = await self._get_model(person.workspace_id, person.id)
        if model is None:
            return
        for name, value in _fields(person).items():
            setattr(model, name, value)
        await self._session.execute(
            delete(PersonDateModel).where(
                PersonDateModel.person_id == person.id,
                PersonDateModel.workspace_id == person.workspace_id,
            )
        )
        await flush(self._session)
        await self._add_dates(person)

    async def delete(self, workspace_id: uuid.UUID, person_id: uuid.UUID) -> bool:
        deleted = await self._session.scalars(
            delete(PersonModel)
            .where(PersonModel.id == person_id, PersonModel.workspace_id == workspace_id)
            .returning(PersonModel.id)
        )
        return deleted.first() is not None

    async def _add_dates(self, person: Person) -> None:
        for position, entry in enumerate(person.dates):
            self._session.add(
                PersonDateModel(
                    id=uuid.uuid4(),
                    workspace_id=person.workspace_id,
                    person_id=person.id,
                    kind=entry.kind,
                    label=entry.label,
                    month=entry.month,
                    day=entry.day,
                    year=entry.year,
                    remind_days_before=entry.remind_days_before,
                    position=position,
                )
            )
        await flush(self._session)

    async def _dates(
        self, workspace_id: uuid.UUID, person_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[PersonDateModel]]:
        if not person_ids:
            return {}
        models = await self._session.scalars(
            select(PersonDateModel)
            .where(
                PersonDateModel.workspace_id == workspace_id,
                PersonDateModel.person_id.in_(person_ids),
            )
            .order_by(PersonDateModel.person_id, PersonDateModel.position)
        )
        grouped: dict[uuid.UUID, list[PersonDateModel]] = {}
        for model in models:
            grouped.setdefault(model.person_id, []).append(model)
        return grouped

    async def _get_model(self, workspace_id: uuid.UUID, person_id: uuid.UUID) -> PersonModel | None:
        return await self._session.scalar(
            select(PersonModel).where(
                PersonModel.id == person_id, PersonModel.workspace_id == workspace_id
            )
        )


def build_people_service(
    session: AsyncSession, clock: Callable[[], datetime] = utc_now
) -> PeopleService:
    return PeopleService(
        SqlPeopleStore(session),
        SqlReminderRepository(session),
        SqlOccurrenceRepository(session),
        SqlTransaction(session),
        clock,
    )


def build_people_reminders(
    session: AsyncSession, clock: Callable[[], datetime] = utc_now
) -> PeopleReminders:
    """People reminders sharing `session`'s transaction, for the reminder worker."""
    return PeopleReminders(
        SqlPeopleStore(session),
        SqlReminderRepository(session),
        SqlOccurrenceRepository(session),
        clock,
    )
