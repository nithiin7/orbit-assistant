"""Budgets, their periods, and their alert records. Every query is filtered by workspace, except
`owners`, which the worker uses to find the workspaces it has to check."""

import uuid
from collections.abc import Callable, Iterable, Sequence
from datetime import datetime
from typing import Any, cast

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    FinanceBudgetAlertModel,
    FinanceBudgetModel,
    FinanceBudgetPeriodModel,
    UserModel,
    WorkspaceModel,
)
from orbit_api.repositories.finance import (
    SqlFinanceAccountRepository,
    SqlFinanceCategoryRepository,
    SqlFinanceTransactionRepository,
)
from orbit_api.repositories.notifications import SqlNotificationRepository
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.budgets.models import (
    Budget,
    BudgetAlert,
    BudgetNotFoundError,
    BudgetOwner,
    BudgetPeriod,
    BudgetPeriodType,
    BudgetScope,
    BudgetState,
    RolloverMode,
)
from orbit_api.services.budgets.service import BudgetService
from orbit_api.services.finance.money import Currency
from orbit_api.services.finance.service import FinanceService

_Budget = FinanceBudgetModel
_Period = FinanceBudgetPeriodModel
_Alert = FinanceBudgetAlertModel


def _to_budget(model: FinanceBudgetModel) -> Budget:
    return Budget(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        scope=cast(BudgetScope, model.scope),
        category_id=model.category_id,
        currency=cast(Currency, model.currency),
        amount=model.amount,
        period=cast(BudgetPeriodType, model.period),
        start_date=model.start_date,
        end_date=model.end_date,
        rollover=cast(RolloverMode, model.rollover),
        alerts_enabled=model.alerts_enabled,
        alert_thresholds=tuple(int(value) for value in model.alert_thresholds),
        state=cast(BudgetState, model.state),
        notes=model.notes,
        archived_at=model.archived_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_period(model: FinanceBudgetPeriodModel) -> BudgetPeriod:
    return BudgetPeriod(
        id=model.id,
        workspace_id=model.workspace_id,
        budget_id=model.budget_id,
        start=model.period_start,
        end=model.period_end,
        base_amount=model.base_amount,
        rollover_amount=model.rollover_amount,
        closed_at=model.closed_at,
        spent_at_close=model.spent_at_close,
        created_at=model.created_at,
    )


class SqlBudgetRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, budget: Budget) -> None:
        self._session.add(
            _Budget(
                id=budget.id,
                workspace_id=budget.workspace_id,
                scope=budget.scope,
                category_id=budget.category_id,
                currency=budget.currency,
                period=budget.period,
                created_at=budget.created_at,
                **_budget_fields(budget),
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, budget_id: uuid.UUID) -> Budget | None:
        model = await self._model(workspace_id, budget_id)
        return _to_budget(model) if model else None

    async def list(self, workspace_id: uuid.UUID) -> list[Budget]:
        models = await self._session.scalars(
            select(_Budget)
            .where(_Budget.workspace_id == workspace_id)
            .order_by(_Budget.created_at, _Budget.id)
        )
        return [_to_budget(model) for model in models]

    async def save(self, budget: Budget) -> None:
        model = await self._model(budget.workspace_id, budget.id)
        if model is None:
            raise BudgetNotFoundError
        for name, value in _budget_fields(budget).items():
            setattr(model, name, value)
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, budget_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(_Budget).where(_Budget.id == budget_id, _Budget.workspace_id == workspace_id)
        )

    async def owners(self) -> Sequence[BudgetOwner]:
        rows = await self._session.execute(
            select(WorkspaceModel.id, WorkspaceModel.owner_id, UserModel.timezone)
            .join(UserModel, UserModel.id == WorkspaceModel.owner_id)
            .where(
                WorkspaceModel.id.in_(select(_Budget.workspace_id).where(_Budget.state == "active"))
            )
            .order_by(WorkspaceModel.id)
        )
        return [
            BudgetOwner(workspace_id=workspace_id, user_id=user_id, timezone=timezone)
            for workspace_id, user_id, timezone in rows
        ]

    async def _model(
        self, workspace_id: uuid.UUID, budget_id: uuid.UUID
    ) -> FinanceBudgetModel | None:
        return await self._session.scalar(
            select(_Budget).where(_Budget.id == budget_id, _Budget.workspace_id == workspace_id)
        )


def _budget_fields(budget: Budget) -> dict[str, Any]:
    """The columns an edit can change."""
    return {
        "name": budget.name,
        "amount": budget.amount,
        "start_date": budget.start_date,
        "end_date": budget.end_date,
        "rollover": budget.rollover,
        "alerts_enabled": budget.alerts_enabled,
        "alert_thresholds": list(budget.alert_thresholds),
        "state": budget.state,
        "notes": budget.notes,
        "archived_at": budget.archived_at,
        "updated_at": budget.updated_at,
    }


class SqlBudgetPeriodRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def for_budget(self, workspace_id: uuid.UUID, budget_id: uuid.UUID) -> list[BudgetPeriod]:
        models = await self._session.scalars(
            select(_Period)
            .where(_Period.workspace_id == workspace_id, _Period.budget_id == budget_id)
            .order_by(_Period.period_start)
            # `save` and `close` update rows directly; reload any already in the session.
            .execution_options(populate_existing=True)
        )
        return [_to_period(model) for model in models]

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[BudgetPeriod]:
        models = await self._session.scalars(
            select(_Period)
            .where(_Period.workspace_id == workspace_id)
            .order_by(_Period.budget_id, _Period.period_start)
            .execution_options(populate_existing=True)
        )
        return [_to_period(model) for model in models]

    async def add(self, period: BudgetPeriod) -> None:
        self._session.add(
            _Period(
                id=period.id,
                workspace_id=period.workspace_id,
                budget_id=period.budget_id,
                period_start=period.start,
                period_end=period.end,
                base_amount=period.base_amount,
                rollover_amount=period.rollover_amount,
                closed_at=period.closed_at,
                spent_at_close=period.spent_at_close,
                created_at=period.created_at,
            )
        )
        await flush(self._session)

    async def save(self, period: BudgetPeriod) -> None:
        # Only open periods change; a closed one is history.
        await self._session.execute(
            update(_Period)
            .where(
                _Period.id == period.id,
                _Period.workspace_id == period.workspace_id,
                _Period.closed_at.is_(None),
            )
            .values(
                period_start=period.start,
                period_end=period.end,
                base_amount=period.base_amount,
                rollover_amount=period.rollover_amount,
            )
            .execution_options(synchronize_session=False)
        )
        await flush(self._session)

    async def close(
        self, workspace_id: uuid.UUID, period_id: uuid.UUID, spent: int, closed_at: datetime
    ) -> bool:
        # Conditional, so of two concurrent closings exactly one writes (and carries rollover).
        rows = await self._session.execute(
            update(_Period)
            .where(
                _Period.id == period_id,
                _Period.workspace_id == workspace_id,
                _Period.closed_at.is_(None),
            )
            .values(closed_at=closed_at, spent_at_close=spent)
            .returning(_Period.id)
            .execution_options(synchronize_session=False)
        )
        return rows.first() is not None

    async def delete(self, workspace_id: uuid.UUID, period_ids: Iterable[uuid.UUID]) -> None:
        ids = list(period_ids)
        if not ids:
            return
        await self._session.execute(
            delete(_Period).where(
                _Period.workspace_id == workspace_id,
                _Period.id.in_(ids),
                _Period.closed_at.is_(None),
            )
        )


class SqlBudgetAlertRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def thresholds(self, workspace_id: uuid.UUID, period_id: uuid.UUID) -> set[int]:
        rows = await self._session.scalars(
            select(_Alert.threshold).where(
                _Alert.workspace_id == workspace_id, _Alert.period_id == period_id
            )
        )
        return set(rows)

    async def add(self, alert: BudgetAlert) -> None:
        self._session.add(
            _Alert(
                id=alert.id,
                workspace_id=alert.workspace_id,
                period_id=alert.period_id,
                threshold=alert.threshold,
                spent=alert.spent,
                available=alert.available,
                notification_id=alert.notification_id,
                created_at=alert.created_at,
            )
        )
        await flush(self._session)


def finance_service(
    session: AsyncSession, clock: Callable[[], datetime] | None = None
) -> FinanceService:
    timing: dict[str, Any] = {"clock": clock} if clock else {}
    return FinanceService(
        SqlFinanceAccountRepository(session),
        SqlFinanceCategoryRepository(session),
        SqlFinanceTransactionRepository(session),
        SqlTransaction(session),
        **timing,
    )


def build_budget_service(
    session: AsyncSession, clock: Callable[[], datetime] | None = None
) -> BudgetService:
    """A budget service whose periods, alerts, and notifications share `session`'s transaction.
    Spending is read through `FinanceService`, the same aggregate the dashboard uses."""
    timing: dict[str, Any] = {"clock": clock} if clock else {}
    return BudgetService(
        SqlBudgetRepository(session),
        SqlBudgetPeriodRepository(session),
        SqlBudgetAlertRepository(session),
        SqlFinanceCategoryRepository(session),
        finance_service(session, clock),
        SqlNotificationRepository(session),
        SqlTransaction(session),
        **timing,
    )
