"""People, their dates, and the money between you. Every query is filtered by workspace, so
callers cannot reach other workspaces' rows."""

import uuid
from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Any, cast

from sqlalchemy import BigInteger, Select, and_, delete, func, select
from sqlalchemy import cast as cast_
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    FinanceTransactionModel,
    PersonDateModel,
    PersonLedgerEntryModel,
    PersonModel,
)
from orbit_api.repositories.finance import (
    SqlFinanceAccountRepository,
    SqlFinanceCategoryRepository,
    SqlFinanceTransactionRepository,
)
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.finance.money import Currency
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.people.ledger import PeopleLedgerService
from orbit_api.services.people.models import (
    DateKind,
    LedgerEntry,
    LedgerKind,
    LinkedTransaction,
    Person,
    PersonDate,
    Relationship,
)
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


def _to_entry(
    model: PersonLedgerEntryModel, transaction: FinanceTransactionModel | None
) -> LedgerEntry:
    return LedgerEntry(
        id=model.id,
        workspace_id=model.workspace_id,
        person_id=model.person_id,
        # The table's CHECK constraints limit these to the known values.
        kind=cast(LedgerKind, model.kind),
        amount=model.amount,
        currency=cast(Currency, model.currency),
        occurred_on=model.occurred_on,
        description=model.description,
        transaction=None
        if transaction is None
        else LinkedTransaction(
            id=transaction.id,
            type=transaction.type,
            description=transaction.description,
            amount=transaction.amount,
            occurred_on=transaction.occurred_on,
            account_id=transaction.account_id,
            category_id=transaction.category_id,
        ),
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class SqlLedgerStore:
    """Ledger entries, each read with its linked transaction (only from the same workspace)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def _select(
        self, workspace_id: uuid.UUID
    ) -> Select[PersonLedgerEntryModel, FinanceTransactionModel]:
        return (
            select(PersonLedgerEntryModel, FinanceTransactionModel)
            .outerjoin(
                FinanceTransactionModel,
                and_(
                    FinanceTransactionModel.id == PersonLedgerEntryModel.transaction_id,
                    FinanceTransactionModel.workspace_id == workspace_id,
                ),
            )
            .where(PersonLedgerEntryModel.workspace_id == workspace_id)
        )

    async def all(self, workspace_id: uuid.UUID) -> list[LedgerEntry]:
        rows = await self._session.execute(
            self._select(workspace_id).order_by(
                PersonLedgerEntryModel.occurred_on.desc(),
                PersonLedgerEntryModel.created_at.desc(),
                PersonLedgerEntryModel.id,
            )
        )
        # An outer join: the transaction is `None` when nothing is linked.
        return [_to_entry(row[0], cast(FinanceTransactionModel | None, row[1])) for row in rows]

    async def get(
        self, workspace_id: uuid.UUID, person_id: uuid.UUID, entry_id: uuid.UUID
    ) -> LedgerEntry | None:
        row = (
            await self._session.execute(
                self._select(workspace_id).where(
                    PersonLedgerEntryModel.id == entry_id,
                    PersonLedgerEntryModel.person_id == person_id,
                )
            )
        ).first()
        if row is None:
            return None
        return _to_entry(row[0], cast(FinanceTransactionModel | None, row[1]))

    async def add(self, entry: LedgerEntry) -> None:
        self._session.add(
            PersonLedgerEntryModel(
                id=entry.id,
                workspace_id=entry.workspace_id,
                person_id=entry.person_id,
                kind=entry.kind,
                amount=entry.amount,
                currency=entry.currency,
                occurred_on=entry.occurred_on,
                description=entry.description,
                transaction_id=entry.transaction.id if entry.transaction else None,
                created_at=entry.created_at,
                updated_at=entry.updated_at,
            )
        )
        await flush(self._session)

    async def save(self, entry: LedgerEntry) -> None:
        model = await self._session.scalar(
            select(PersonLedgerEntryModel).where(
                PersonLedgerEntryModel.id == entry.id,
                PersonLedgerEntryModel.workspace_id == entry.workspace_id,
            )
        )
        if model is None:
            return
        model.amount = entry.amount
        model.occurred_on = entry.occurred_on
        model.description = entry.description
        model.updated_at = entry.updated_at
        await flush(self._session)

    async def delete(
        self, workspace_id: uuid.UUID, person_id: uuid.UUID, entry_id: uuid.UUID
    ) -> bool:
        deleted = await self._session.scalars(
            delete(PersonLedgerEntryModel)
            .where(
                PersonLedgerEntryModel.id == entry_id,
                PersonLedgerEntryModel.person_id == person_id,
                PersonLedgerEntryModel.workspace_id == workspace_id,
            )
            .returning(PersonLedgerEntryModel.id)
        )
        return deleted.first() is not None

    async def shared(
        self, workspace_id: uuid.UUID, transaction_id: uuid.UUID, *, excluding: uuid.UUID | None
    ) -> int:
        statement = select(
            cast_(func.coalesce(func.sum(PersonLedgerEntryModel.amount), 0), BigInteger)
        ).where(
            PersonLedgerEntryModel.workspace_id == workspace_id,
            PersonLedgerEntryModel.transaction_id == transaction_id,
            PersonLedgerEntryModel.kind == "they_owe",
        )
        if excluding is not None:
            statement = statement.where(PersonLedgerEntryModel.id != excluding)
        return int(await self._session.scalar(statement) or 0)


def build_ledger_service(
    session: AsyncSession, clock: Callable[[], datetime] = utc_now
) -> PeopleLedgerService:
    """The ledger with Finance in the same session, so a repayment and the refund or expense
    recorded with it commit together."""
    return PeopleLedgerService(
        SqlLedgerStore(session),
        SqlPeopleStore(session),
        FinanceService(
            SqlFinanceAccountRepository(session),
            SqlFinanceCategoryRepository(session),
            SqlFinanceTransactionRepository(session),
            SqlTransaction(session),
            clock,
        ),
        SqlTransaction(session),
        clock,
    )
