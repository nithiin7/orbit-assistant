"""Financial accounts, categories, and transactions. Every query is filtered by workspace, so
callers cannot reach other workspaces' rows.

Balances and reports are aggregated by the database. PostgreSQL's `SUM` of a BIGINT is NUMERIC,
so sums are cast back to BIGINT: amounts stay exact integers on both databases.
"""

import uuid
from collections.abc import Sequence
from datetime import date
from typing import Any, cast

from sqlalchemy import (
    BigInteger,
    ColumnElement,
    Select,
    case,
    delete,
    exists,
    extract,
    func,
    or_,
    select,
    union_all,
)
from sqlalchemy import cast as sql_cast
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    FinanceAccountModel,
    FinanceCategoryModel,
    FinanceRecurringPaymentModel,
    FinanceTransactionModel,
)
from orbit_api.repositories.transaction import flush
from orbit_api.services.finance.models import (
    Account,
    AccountNotFoundError,
    AccountType,
    AccountView,
    CashFlow,
    Category,
    CategoryNotFoundError,
    CategorySpending,
    CategoryType,
    MonthlyCashFlow,
    Transaction,
    TransactionNotFoundError,
    TransactionPage,
    TransactionQuery,
    TransactionType,
)
from orbit_api.services.finance.money import Currency
from orbit_api.services.transactions import ConflictError
from orbit_api.utils.text_search import LIKE_ESCAPE, contains_pattern

_Account = FinanceAccountModel
_Category = FinanceCategoryModel
_Transaction = FinanceTransactionModel


def _sum(value: ColumnElement[int]) -> ColumnElement[int]:
    """An exact integer total: 0 when there are no rows, and BIGINT rather than NUMERIC."""
    return func.coalesce(sql_cast(func.sum(value), BigInteger), 0)


def _amount_of(transaction_type: TransactionType) -> ColumnElement[int]:
    return case((_Transaction.type == transaction_type, _Transaction.amount), else_=0)


def _cash_flow_of(values: tuple[Any, ...]) -> CashFlow:
    """A `CashFlow` from the first four columns of `_cash_flow_columns`."""
    return CashFlow(
        income=int(values[0]),
        expenses=int(values[1]),
        refunds=int(values[2]),
        transactions=int(values[3]),
    )


def _to_account(model: FinanceAccountModel) -> Account:
    # The table's CHECK constraints limit `type` to these values; `currency` is checked on the
    # way in by the API.
    return Account(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        type=cast(AccountType, model.type),
        currency=cast(Currency, model.currency),
        opening_balance=model.opening_balance,
        notes=model.notes,
        archived_at=model.archived_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_category(model: FinanceCategoryModel) -> Category:
    return Category(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        type=cast(CategoryType, model.type),
        key=model.key,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_transaction(model: FinanceTransactionModel) -> Transaction:
    return Transaction(
        id=model.id,
        workspace_id=model.workspace_id,
        type=cast(TransactionType, model.type),
        amount=model.amount,
        currency=cast(Currency, model.currency),
        occurred_on=model.occurred_on,
        description=model.description,
        category_id=model.category_id,
        account_id=model.account_id,
        to_account_id=model.to_account_id,
        notes=model.notes,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class SqlFinanceAccountRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, account: Account) -> None:
        self._session.add(
            FinanceAccountModel(
                id=account.id,
                workspace_id=account.workspace_id,
                name=account.name,
                type=account.type,
                currency=account.currency,
                opening_balance=account.opening_balance,
                notes=account.notes,
                archived_at=account.archived_at,
                created_at=account.created_at,
                updated_at=account.updated_at,
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, account_id: uuid.UUID) -> Account | None:
        model = await self._get_model(workspace_id, account_id)
        return _to_account(model) if model else None

    async def views(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID | None = None
    ) -> list[AccountView]:
        # Each transaction moves money out of or into `account_id`; a transfer also moves it into
        # `to_account_id`. One grouped pass over the workspace's transactions gives every
        # account's total movement.
        signed = case(
            (_Transaction.type.in_(("income", "refund")), _Transaction.amount),
            else_=-_Transaction.amount,
        )
        from_side = select(
            _Transaction.account_id.label("account_id"), signed.label("delta")
        ).where(_Transaction.workspace_id == workspace_id)
        to_side = select(
            _Transaction.to_account_id.label("account_id"), _Transaction.amount.label("delta")
        ).where(_Transaction.workspace_id == workspace_id, _Transaction.type == "transfer")
        if account_id is not None:
            from_side = from_side.where(_Transaction.account_id == account_id)
            to_side = to_side.where(_Transaction.to_account_id == account_id)
        movements = union_all(from_side, to_side).subquery()
        totals = (
            select(
                movements.c.account_id,
                sql_cast(func.sum(movements.c.delta), BigInteger).label("total"),
            )
            .group_by(movements.c.account_id)
            .subquery()
        )

        statement = (
            select(_Account, func.coalesce(totals.c.total, 0))
            .outerjoin(totals, totals.c.account_id == _Account.id)
            .where(_Account.workspace_id == workspace_id)
            .order_by(_Account.archived_at.is_not(None), _Account.name, _Account.id)
        )
        if account_id is not None:
            statement = statement.where(_Account.id == account_id)
        rows = await self._session.execute(statement)
        return [
            AccountView(account=_to_account(model), balance=model.opening_balance + int(total))
            for model, total in rows
        ]

    async def save(self, account: Account) -> None:
        model = await self._get_model(account.workspace_id, account.id)
        if model is None:
            raise AccountNotFoundError
        model.name = account.name
        model.opening_balance = account.opening_balance
        model.notes = account.notes
        model.archived_at = account.archived_at
        model.updated_at = account.updated_at
        await flush(self._session)

    async def _get_model(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID
    ) -> FinanceAccountModel | None:
        return await self._session.scalar(
            select(_Account).where(_Account.id == account_id, _Account.workspace_id == workspace_id)
        )


class SqlFinanceCategoryRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, category: Category) -> None:
        self._session.add(
            FinanceCategoryModel(
                id=category.id,
                workspace_id=category.workspace_id,
                name=category.name,
                type=category.type,
                key=category.key,
                created_at=category.created_at,
                updated_at=category.updated_at,
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> Category | None:
        model = await self._get_model(workspace_id, category_id)
        return _to_category(model) if model else None

    async def list(self, workspace_id: uuid.UUID) -> list[Category]:
        models = await self._session.scalars(
            select(_Category)
            .where(_Category.workspace_id == workspace_id)
            # "income" sorts after "expense", so descending puts income first.
            .order_by(_Category.type.desc(), _Category.name, _Category.id)
        )
        return [_to_category(model) for model in models]

    async def save(self, category: Category) -> None:
        model = await self._get_model(category.workspace_id, category.id)
        if model is None:
            raise CategoryNotFoundError
        model.name = category.name
        model.updated_at = category.updated_at
        await flush(self._session)

    async def is_used(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> bool:
        return bool(
            await self._session.scalar(
                select(
                    exists().where(
                        _Transaction.workspace_id == workspace_id,
                        _Transaction.category_id == category_id,
                    )
                )
            )
        )

    async def is_used_by_recurring(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> bool:
        return bool(
            await self._session.scalar(
                select(
                    exists().where(
                        FinanceRecurringPaymentModel.workspace_id == workspace_id,
                        FinanceRecurringPaymentModel.category_id == category_id,
                    )
                )
            )
        )

    async def delete(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> None:
        try:
            await self._session.execute(
                delete(_Category).where(
                    _Category.id == category_id, _Category.workspace_id == workspace_id
                )
            )
        except IntegrityError as exc:
            # The foreign key from transactions refuses to orphan them.
            raise ConflictError from exc

    async def _get_model(
        self, workspace_id: uuid.UUID, category_id: uuid.UUID
    ) -> FinanceCategoryModel | None:
        return await self._session.scalar(
            select(_Category).where(
                _Category.id == category_id, _Category.workspace_id == workspace_id
            )
        )


def _filters(workspace_id: uuid.UUID, query: TransactionQuery) -> list[ColumnElement[bool]]:
    conditions = [_Transaction.workspace_id == workspace_id]
    if query.types:
        conditions.append(_Transaction.type.in_(query.types))
    if query.account_id is not None:
        conditions.append(
            or_(
                _Transaction.account_id == query.account_id,
                _Transaction.to_account_id == query.account_id,
            )
        )
    if query.category_id is not None:
        conditions.append(_Transaction.category_id == query.category_id)
    if query.date_from is not None:
        conditions.append(_Transaction.occurred_on >= query.date_from)
    if query.date_to is not None:
        conditions.append(_Transaction.occurred_on <= query.date_to)
    if query.search:
        # Case-insensitive on both databases. A substring search can't use an index; it scans one
        # workspace's transactions, which is fine at personal scale.
        pattern = contains_pattern(query.search)
        conditions.append(
            or_(
                _Transaction.description.ilike(pattern, escape=LIKE_ESCAPE),
                _Transaction.notes.ilike(pattern, escape=LIKE_ESCAPE),
            )
        )
    return conditions


def _ordering(query: TransactionQuery) -> Sequence[ColumnElement[Any]]:
    newest_first = (
        _Transaction.occurred_on.desc(),
        _Transaction.created_at.desc(),
        _Transaction.id.asc(),
    )
    match query.sort:
        case "date":
            if query.order == "asc":
                return (
                    _Transaction.occurred_on.asc(),
                    _Transaction.created_at.asc(),
                    _Transaction.id.asc(),
                )
            return newest_first
        case "amount":
            amount = (
                _Transaction.amount.asc() if query.order == "asc" else _Transaction.amount.desc()
            )
            return (amount, *newest_first)


class SqlFinanceTransactionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, transaction: Transaction) -> None:
        self._session.add(
            FinanceTransactionModel(
                id=transaction.id,
                workspace_id=transaction.workspace_id,
                type=transaction.type,
                amount=transaction.amount,
                currency=transaction.currency,
                occurred_on=transaction.occurred_on,
                description=transaction.description,
                category_id=transaction.category_id,
                account_id=transaction.account_id,
                to_account_id=transaction.to_account_id,
                notes=transaction.notes,
                created_at=transaction.created_at,
                updated_at=transaction.updated_at,
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> Transaction | None:
        model = await self._get_model(workspace_id, transaction_id)
        return _to_transaction(model) if model else None

    async def find(self, workspace_id: uuid.UUID, query: TransactionQuery) -> TransactionPage:
        conditions = _filters(workspace_id, query)
        total = await self._session.scalar(
            select(func.count()).select_from(_Transaction).where(*conditions)
        )
        models = await self._session.scalars(
            select(_Transaction)
            .where(*conditions)
            .order_by(*_ordering(query))
            .limit(query.limit)
            .offset(query.offset)
        )
        return TransactionPage(
            transactions=[_to_transaction(model) for model in models], total=total or 0
        )

    async def between(
        self, workspace_id: uuid.UUID, date_from: date | None, date_to: date | None
    ) -> list[Transaction]:
        query = TransactionQuery(date_from=date_from, date_to=date_to)
        models = await self._session.scalars(
            select(_Transaction)
            .where(*_filters(workspace_id, query))
            .order_by(
                _Transaction.occurred_on.asc(),
                _Transaction.created_at.asc(),
                _Transaction.id.asc(),
            )
        )
        return [_to_transaction(model) for model in models]

    async def save(self, transaction: Transaction) -> None:
        model = await self._get_model(transaction.workspace_id, transaction.id)
        if model is None:
            raise TransactionNotFoundError
        model.type = transaction.type
        model.amount = transaction.amount
        model.currency = transaction.currency
        model.occurred_on = transaction.occurred_on
        model.description = transaction.description
        model.category_id = transaction.category_id
        model.account_id = transaction.account_id
        model.to_account_id = transaction.to_account_id
        model.notes = transaction.notes
        model.updated_at = transaction.updated_at
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> bool:
        try:
            deleted = await self._session.scalars(
                delete(_Transaction)
                .where(_Transaction.id == transaction_id, _Transaction.workspace_id == workspace_id)
                .returning(_Transaction.id)
            )
            return deleted.first() is not None
        except IntegrityError as exc:
            # A commitment payment's foreign key refuses to lose its transaction.
            raise ConflictError from exc

    async def cash_flow(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> CashFlow:
        row = (
            await self._session.execute(
                self._cash_flow_columns().where(*self._in_range(workspace_id, currency, start, end))
            )
        ).one()
        return _cash_flow_of(tuple(row))

    async def monthly_cash_flow(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> list[MonthlyCashFlow]:
        year = extract("year", _Transaction.occurred_on)
        month = extract("month", _Transaction.occurred_on)
        rows = await self._session.execute(
            self._cash_flow_columns(year, month)
            .where(*self._in_range(workspace_id, currency, start, end))
            .group_by(year, month)
            .order_by(year, month)
        )
        result: list[MonthlyCashFlow] = []
        for row in rows:
            values = tuple(row)
            # EXTRACT returns NUMERIC on PostgreSQL and an integer on SQLite.
            month_start = date(int(values[4]), int(values[5]), 1)
            result.append(MonthlyCashFlow(month=month_start, cash_flow=_cash_flow_of(values)))
        return result

    async def spending_by_category(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> list[CategorySpending]:
        rows = await self._session.execute(
            select(
                _Transaction.category_id, _sum(_amount_of("expense")), _sum(_amount_of("refund"))
            )
            .where(
                *self._in_range(workspace_id, currency, start, end),
                _Transaction.type.in_(("expense", "refund")),
            )
            .group_by(_Transaction.category_id)
        )
        return [
            CategorySpending(category_id=category_id, expenses=int(spent), refunds=int(refunded))
            for category_id, spent, refunded in rows
        ]

    @staticmethod
    def _cash_flow_columns(*extra: ColumnElement[Any]) -> Select[Any]:
        # Transfers move money between the user's own accounts, so they are neither income nor
        # spending, and aren't counted.
        return select(
            _sum(_amount_of("income")),
            _sum(_amount_of("expense")),
            _sum(_amount_of("refund")),
            func.count(case((_Transaction.type != "transfer", 1))),
            *extra,
        )

    @staticmethod
    def _in_range(
        workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> list[ColumnElement[bool]]:
        return [
            _Transaction.workspace_id == workspace_id,
            _Transaction.currency == currency,
            _Transaction.occurred_on >= start,
            _Transaction.occurred_on <= end,
        ]

    async def _get_model(
        self, workspace_id: uuid.UUID, transaction_id: uuid.UUID
    ) -> FinanceTransactionModel | None:
        return await self._session.scalar(
            select(_Transaction).where(
                _Transaction.id == transaction_id, _Transaction.workspace_id == workspace_id
            )
        )
