"""Savings goals and their contributions. Every query is filtered by workspace."""

import uuid
from collections.abc import Callable
from datetime import date, datetime
from typing import Any, cast

from sqlalchemy import delete, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import FinanceGoalContributionModel, FinanceSavingsGoalModel
from orbit_api.repositories.budgets import finance_service
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.finance.money import Currency
from orbit_api.services.goals.models import (
    Contribution,
    ContributionType,
    Goal,
    GoalCategory,
    GoalNotFoundError,
    GoalPriority,
    GoalState,
)
from orbit_api.services.goals.service import GoalService

_Goal = FinanceSavingsGoalModel
_Contribution = FinanceGoalContributionModel


def _to_goal(model: FinanceSavingsGoalModel) -> Goal:
    return Goal(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        description=model.description,
        category=cast(GoalCategory, model.category),
        priority=cast(GoalPriority, model.priority),
        currency=cast(Currency, model.currency),
        target_amount=model.target_amount,
        start_date=model.start_date,
        target_date=model.target_date,
        state=cast(GoalState, model.state),
        account_id=model.account_id,
        notes=model.notes,
        completed_at=model.completed_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_contribution(model: FinanceGoalContributionModel) -> Contribution:
    return Contribution(
        id=model.id,
        workspace_id=model.workspace_id,
        goal_id=model.goal_id,
        type=cast(ContributionType, model.type),
        amount=model.amount,
        occurred_on=model.occurred_on,
        transaction_id=model.transaction_id,
        notes=model.notes,
        created_at=model.created_at,
    )


def _goal_fields(goal: Goal) -> dict[str, Any]:
    return {
        "name": goal.name,
        "description": goal.description,
        "category": goal.category,
        "priority": goal.priority,
        "target_amount": goal.target_amount,
        "start_date": goal.start_date,
        "target_date": goal.target_date,
        "state": goal.state,
        "account_id": goal.account_id,
        "notes": goal.notes,
        "completed_at": goal.completed_at,
        "updated_at": goal.updated_at,
    }


class SqlGoalRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, goal: Goal) -> None:
        self._session.add(
            _Goal(
                id=goal.id,
                workspace_id=goal.workspace_id,
                currency=goal.currency,
                created_at=goal.created_at,
                **_goal_fields(goal),
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, goal_id: uuid.UUID) -> Goal | None:
        model = await self._model(workspace_id, goal_id)
        return _to_goal(model) if model else None

    async def list(self, workspace_id: uuid.UUID) -> list[Goal]:
        models = await self._session.scalars(
            select(_Goal).where(_Goal.workspace_id == workspace_id).order_by(_Goal.created_at)
        )
        return [_to_goal(model) for model in models]

    async def save(self, goal: Goal) -> None:
        model = await self._model(goal.workspace_id, goal.id)
        if model is None:
            raise GoalNotFoundError
        for name, value in _goal_fields(goal).items():
            setattr(model, name, value)
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, goal_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(_Goal).where(_Goal.id == goal_id, _Goal.workspace_id == workspace_id)
        )

    async def _model(
        self, workspace_id: uuid.UUID, goal_id: uuid.UUID
    ) -> FinanceSavingsGoalModel | None:
        return await self._session.scalar(
            select(_Goal).where(_Goal.id == goal_id, _Goal.workspace_id == workspace_id)
        )


class SqlContributionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, contribution: Contribution) -> None:
        self._session.add(
            _Contribution(
                id=contribution.id,
                workspace_id=contribution.workspace_id,
                goal_id=contribution.goal_id,
                type=contribution.type,
                amount=contribution.amount,
                occurred_on=contribution.occurred_on,
                transaction_id=contribution.transaction_id,
                notes=contribution.notes,
                created_at=contribution.created_at,
            )
        )
        await flush(self._session)

    async def get(
        self, workspace_id: uuid.UUID, goal_id: uuid.UUID, contribution_id: uuid.UUID
    ) -> Contribution | None:
        model = await self._session.scalar(
            select(_Contribution).where(
                _Contribution.id == contribution_id,
                _Contribution.goal_id == goal_id,
                _Contribution.workspace_id == workspace_id,
            )
        )
        return _to_contribution(model) if model else None

    async def for_goal(self, workspace_id: uuid.UUID, goal_id: uuid.UUID) -> list[Contribution]:
        models = await self._session.scalars(
            select(_Contribution)
            .where(_Contribution.workspace_id == workspace_id, _Contribution.goal_id == goal_id)
            .order_by(_Contribution.occurred_on.desc(), _Contribution.created_at.desc())
        )
        return [_to_contribution(model) for model in models]

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[Contribution]:
        models = await self._session.scalars(
            select(_Contribution).where(_Contribution.workspace_id == workspace_id)
        )
        return [_to_contribution(model) for model in models]

    async def between(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> list[Contribution]:
        models = await self._session.scalars(
            select(_Contribution)
            .join(
                _Goal,
                (_Goal.id == _Contribution.goal_id)
                & (_Goal.workspace_id == _Contribution.workspace_id),
            )
            .where(
                _Contribution.workspace_id == workspace_id,
                _Goal.currency == currency,
                _Contribution.occurred_on >= start,
                _Contribution.occurred_on <= end,
            )
        )
        return [_to_contribution(model) for model in models]

    async def is_linked(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> bool:
        return bool(
            await self._session.scalar(
                select(
                    exists().where(
                        _Contribution.workspace_id == workspace_id,
                        _Contribution.transaction_id == transaction_id,
                    )
                )
            )
        )

    async def delete(self, workspace_id: uuid.UUID, contribution_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(_Contribution).where(
                _Contribution.id == contribution_id, _Contribution.workspace_id == workspace_id
            )
        )


def build_goal_service(
    session: AsyncSession, clock: Callable[[], datetime] | None = None
) -> GoalService:
    """A goal service whose contributions and the transfers they record share `session`'s
    transaction, so each operation commits once."""
    timing: dict[str, Any] = {"clock": clock} if clock else {}
    return GoalService(
        SqlGoalRepository(session),
        SqlContributionRepository(session),
        finance_service(session, clock),
        SqlTransaction(session),
        **timing,
    )
