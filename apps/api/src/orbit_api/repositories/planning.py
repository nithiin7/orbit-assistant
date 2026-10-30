"""Monthly plans, and the ledger aggregates a plan needs that phase 1's reports don't provide:
transfers into investment and loan accounts, and the expenses that pay commitments. Every query
is filtered by workspace and currency, and sums stay exact BIGINTs."""

import uuid
from collections.abc import Callable
from datetime import date, datetime
from typing import Any, cast

from sqlalchemy import BigInteger, ColumnElement, and_, case, delete, func, or_, select
from sqlalchemy import cast as sql_cast
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from orbit_api.db.models import (
    FinanceAccountModel,
    FinanceLoanInstallmentModel,
    FinanceMonthlyPlanModel,
    FinanceRecurringOccurrenceModel,
    FinanceTransactionModel,
)
from orbit_api.repositories.budgets import build_budget_service, finance_service
from orbit_api.repositories.commitments import build_commitment_service
from orbit_api.repositories.goals import build_goal_service
from orbit_api.repositories.investments import build_investment_service
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.finance.money import Currency
from orbit_api.services.planning.models import LedgerFlows, MonthlyPlan
from orbit_api.services.planning.service import PlanningService

_Plan = FinanceMonthlyPlanModel
_Transaction = FinanceTransactionModel


def _sum(value: ColumnElement[int]) -> ColumnElement[int]:
    return func.coalesce(sql_cast(func.sum(value), BigInteger), 0)


def _to_plan(model: FinanceMonthlyPlanModel) -> MonthlyPlan:
    return MonthlyPlan(
        id=model.id,
        workspace_id=model.workspace_id,
        currency=cast(Currency, model.currency),
        month=model.period_start,
        expected_income=model.expected_income,
        notes=model.notes,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class SqlPlanningRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(
        self, workspace_id: uuid.UUID, currency: Currency, month: date
    ) -> MonthlyPlan | None:
        model = await self._model(workspace_id, currency, month)
        return _to_plan(model) if model else None

    async def latest_before(
        self, workspace_id: uuid.UUID, currency: Currency, month: date
    ) -> MonthlyPlan | None:
        model = await self._session.scalar(
            select(_Plan)
            .where(
                _Plan.workspace_id == workspace_id,
                _Plan.currency == currency,
                _Plan.period_start < month,
            )
            .order_by(_Plan.period_start.desc())
            .limit(1)
        )
        return _to_plan(model) if model else None

    async def add(self, plan: MonthlyPlan) -> None:
        self._session.add(
            _Plan(
                id=plan.id,
                workspace_id=plan.workspace_id,
                currency=plan.currency,
                period_start=plan.month,
                expected_income=plan.expected_income,
                notes=plan.notes,
                created_at=plan.created_at,
                updated_at=plan.updated_at,
            )
        )
        await flush(self._session)

    async def save(self, plan: MonthlyPlan) -> None:
        model = await self._model(plan.workspace_id, plan.currency, plan.month)
        if model is None:
            return
        model.expected_income = plan.expected_income
        model.notes = plan.notes
        model.updated_at = plan.updated_at
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, currency: Currency, month: date) -> bool:
        rows = await self._session.execute(
            delete(_Plan)
            .where(
                _Plan.workspace_id == workspace_id,
                _Plan.currency == currency,
                _Plan.period_start == month,
            )
            .returning(_Plan.id)
        )
        return rows.first() is not None

    async def flows(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> LedgerFlows:
        source = aliased(FinanceAccountModel)
        target = aliased(FinanceAccountModel)
        is_transfer = _Transaction.type == "transfer"
        # Money paying a subscription or bill, or an EMI's interest: expenses that a commitment
        # payment recorded.
        pays_commitment = or_(
            _Transaction.id.in_(
                select(FinanceRecurringOccurrenceModel.transaction_id).where(
                    FinanceRecurringOccurrenceModel.workspace_id == workspace_id,
                    FinanceRecurringOccurrenceModel.transaction_id.is_not(None),
                )
            ),
            _Transaction.id.in_(
                select(FinanceLoanInstallmentModel.interest_transaction_id).where(
                    FinanceLoanInstallmentModel.workspace_id == workspace_id,
                    FinanceLoanInstallmentModel.interest_transaction_id.is_not(None),
                )
            ),
        )

        def amount_when(condition: ColumnElement[bool]) -> ColumnElement[int]:
            return case((condition, _Transaction.amount), else_=0)

        row = (
            await self._session.execute(
                select(
                    _sum(
                        amount_when(
                            and_(
                                is_transfer,
                                target.type == "investment",
                                source.type != "investment",
                            )
                        )
                    ),
                    _sum(
                        amount_when(
                            and_(
                                is_transfer,
                                source.type == "investment",
                                target.type != "investment",
                            )
                        )
                    ),
                    _sum(amount_when(and_(is_transfer, target.type == "loan"))),
                    _sum(amount_when(and_(_Transaction.type == "expense", pays_commitment))),
                )
                .select_from(_Transaction)
                .join(source, source.id == _Transaction.account_id)
                .outerjoin(target, target.id == _Transaction.to_account_id)
                .where(
                    _Transaction.workspace_id == workspace_id,
                    _Transaction.currency == currency,
                    _Transaction.occurred_on >= start,
                    _Transaction.occurred_on <= end,
                )
            )
        ).one()
        values = tuple(row)
        return LedgerFlows(
            invested=int(values[0]),
            divested=int(values[1]),
            loan_principal=int(values[2]),
            commitment_expenses=int(values[3]),
        )

    async def _model(
        self, workspace_id: uuid.UUID, currency: Currency, month: date
    ) -> FinanceMonthlyPlanModel | None:
        return await self._session.scalar(
            select(_Plan).where(
                _Plan.workspace_id == workspace_id,
                _Plan.currency == currency,
                _Plan.period_start == month,
            )
        )


def build_planning_service(
    session: AsyncSession, clock: Callable[[], datetime] | None = None
) -> PlanningService:
    timing: dict[str, Any] = {"clock": clock} if clock else {}
    return PlanningService(
        SqlPlanningRepository(session),
        finance_service(session, clock),
        build_commitment_service(session, clock),
        build_budget_service(session, clock),
        build_goal_service(session, clock),
        build_investment_service(session, clock),
        SqlTransaction(session),
        **timing,
    )
