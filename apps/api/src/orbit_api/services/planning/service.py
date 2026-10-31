"""Monthly financial planning: expected income against commitments, budgets, savings, and
investments, compared with what the ledger recorded.

Nothing here keeps its own accounting. Actual figures come from the ledger (`FinanceService`'s
cash flow, and `PlanningRepository.flows` for transfers into investment and loan accounts and for
the expenses that pay commitments); planned ones from the commitment schedules
(`CommitmentService.payments`), budgets (`BudgetService.month`), goals' suggested contributions
(`GoalService`), and SIP plans. Only expected income is stored, per month and currency.
"""

import uuid
from collections.abc import Callable
from datetime import date, datetime
from typing import Protocol

from orbit_api.services.budgets.service import BudgetService
from orbit_api.services.commitments.models import PaymentItem, PaymentQuery
from orbit_api.services.commitments.schedule import due_dates
from orbit_api.services.commitments.service import CommitmentService
from orbit_api.services.finance.money import Currency, month_bounds
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.goals.calculation import saved
from orbit_api.services.goals.service import GoalService
from orbit_api.services.investments.service import InvestmentService
from orbit_api.services.planning.calculation import summarize
from orbit_api.services.planning.models import (
    FixedCommitments,
    IncomeSource,
    LedgerFlows,
    Line,
    MonthlyPlan,
    PlanInputs,
    PlanSummary,
)
from orbit_api.services.transactions import ConflictError
from orbit_api.services.transactions import Transaction as UnitOfWork
from orbit_api.utils.clock import utc_now

RENT_CATEGORY_KEY = "rent"


class PlanningRepository(Protocol):
    async def get(
        self, workspace_id: uuid.UUID, currency: Currency, month: date
    ) -> MonthlyPlan | None: ...

    async def latest_before(
        self, workspace_id: uuid.UUID, currency: Currency, month: date
    ) -> MonthlyPlan | None:
        """The most recent plan for a month before `month`."""
        ...

    async def add(self, plan: MonthlyPlan) -> None:
        """Raises `ConflictError` if the month has a plan already."""
        ...

    async def save(self, plan: MonthlyPlan) -> None: ...

    async def delete(self, workspace_id: uuid.UUID, currency: Currency, month: date) -> bool: ...

    async def flows(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> LedgerFlows: ...


class PlanningService:
    def __init__(
        self,
        plans: PlanningRepository,
        finance: FinanceService,
        commitments: CommitmentService,
        budgets: BudgetService,
        goals: GoalService,
        investments: InvestmentService,
        unit_of_work: UnitOfWork,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._plans = plans
        self._finance = finance
        self._commitments = commitments
        self._budgets = budgets
        self._goals = goals
        self._investments = investments
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def summary(
        self, workspace_id: uuid.UUID, currency: Currency, month: date, today: date
    ) -> PlanSummary:
        start, end = month_bounds(month)
        plan, source = await self._expected_income(workspace_id, currency, start)
        cash_flow = await self._finance.cash_flow(workspace_id, currency, start)
        periods, budgets, _ = await self._budgets.month(workspace_id, currency, start, today)
        overall = [
            view.period.available
            for view, budget in zip(periods, budgets, strict=True)
            if budget.scope == "overall" and budget.period == "monthly"
        ]
        by_category = [
            view.period.available
            for view, budget in zip(periods, budgets, strict=True)
            if budget.scope == "category" and budget.period == "monthly"
        ]
        goals = [
            view
            for view in await self._goals.views(workspace_id, today)
            if view.goal.currency == currency and view.goal.state == "active"
        ]
        suggestions = [
            view.progress.suggested_monthly
            for view in goals
            if view.progress.suggested_monthly is not None
        ]
        contributions = await self._goals.between(workspace_id, currency, start, end)
        return summarize(
            PlanInputs(
                currency=currency,
                month=start,
                plan=plan,
                expected_income_source=source,
                actual_income=cash_flow.income,
                net_spending=max(cash_flow.net_expenses, 0),
                flows=await self._plans.flows(workspace_id, currency, start, end),
                fixed=await self._fixed(workspace_id, currency, start, end, today),
                overall_budget=overall[0] if overall else None,
                category_budgets=sum(by_category) if by_category else None,
                planned_savings=sum(suggestions) if suggestions else None,
                actual_savings=saved(contributions),
                planned_investments=await self._planned_sips(
                    workspace_id, currency, start, end, today
                ),
            )
        )

    async def set_income(
        self,
        workspace_id: uuid.UUID,
        currency: Currency,
        month: date,
        expected_income: int,
        notes: str,
    ) -> MonthlyPlan:
        start = month_bounds(month)[0]
        now = self._clock()
        existing = await self._plans.get(workspace_id, currency, start)
        if existing is not None:
            plan = MonthlyPlan(
                id=existing.id,
                workspace_id=workspace_id,
                currency=currency,
                month=start,
                expected_income=expected_income,
                notes=notes,
                created_at=existing.created_at,
                updated_at=now,
            )
            await self._plans.save(plan)
            await self._unit_of_work.commit()
            return plan
        plan = MonthlyPlan(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            currency=currency,
            month=start,
            expected_income=expected_income,
            notes=notes,
            created_at=now,
            updated_at=now,
        )
        try:
            await self._plans.add(plan)
            await self._unit_of_work.commit()
        except ConflictError:
            # A concurrent request added it first: apply this change to theirs.
            await self._unit_of_work.rollback()
            return await self.set_income(workspace_id, currency, month, expected_income, notes)
        return plan

    async def clear_income(self, workspace_id: uuid.UUID, currency: Currency, month: date) -> None:
        """Remove the month's own plan, so it falls back to an earlier month's income again."""
        await self._plans.delete(workspace_id, currency, month_bounds(month)[0])
        await self._unit_of_work.commit()

    async def _expected_income(
        self, workspace_id: uuid.UUID, currency: Currency, month: date
    ) -> tuple[MonthlyPlan | None, IncomeSource | None]:
        plan = await self._plans.get(workspace_id, currency, month)
        if plan is not None:
            return plan, "this_month"
        earlier = await self._plans.latest_before(workspace_id, currency, month)
        if earlier is not None:
            return earlier, "earlier"
        return None, None

    async def _fixed(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date, today: date
    ) -> FixedCommitments:
        """Commitments due in the month: everything scheduled (paid or not, except skipped) as
        planned, and what was paid as actual."""
        items = [
            item
            for item in await self._commitments.payments(
                workspace_id,
                PaymentQuery(today=today, date_from=start, date_to=end, include_overdue=False),
            )
            if item.currency == currency and item.status != "skipped"
        ]
        rent_ids = await self._rent_commitments(workspace_id, today)

        def line(selected: list[PaymentItem]) -> Line:
            return Line(
                planned=sum(item.amount for item in selected),
                actual=sum(item.amount for item in selected if item.status == "paid"),
            )

        loans = [item for item in items if item.kind == "loan"]
        rent = [item for item in items if item.kind == "bill" and item.commitment_id in rent_ids]
        bills = [
            item for item in items if item.kind == "bill" and item.commitment_id not in rent_ids
        ]
        return FixedCommitments(
            emi=line(loans),
            rent=line(rent),
            subscriptions=line([item for item in items if item.kind == "subscription"]),
            bills=line(bills),
            planned_interest=sum(item.interest or 0 for item in loans),
        )

    async def _rent_commitments(self, workspace_id: uuid.UUID, today: date) -> set[uuid.UUID]:
        """Bills in the built-in Rent category (whatever it has been renamed to)."""
        rent = {
            category.id
            for category in await self._finance.categories(workspace_id)
            if category.key == RENT_CATEGORY_KEY
        }
        if not rent:
            return set()
        return {
            view.payment.id
            for view in await self._commitments.recurring_payments(workspace_id, "bill", today)
            if view.payment.category_id in rent
        }

    async def _planned_sips(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date, today: date
    ) -> int | None:
        plans = [
            view.plan
            for view in await self._investments.sip_plans(workspace_id, today)
            if view.plan.currency == currency and view.plan.state == "active"
        ]
        if not plans:
            return None
        total = 0
        for plan in plans:
            last = end if plan.end_date is None else min(end, plan.end_date)
            total += plan.amount * sum(
                1 for _ in due_dates(plan.anchor_date, plan.frequency, start=start, end=last)
            )
        return total
