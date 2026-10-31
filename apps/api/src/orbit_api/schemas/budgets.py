"""Budget models: budgets and their periods, the month overview, history, and copying.

Amounts are integers in the currency's minor unit and must be JSON integers. Percentages are
decimal text with two places (`"87.50"`), computed from integers, for display only; statuses and
alerts are decided by integer comparisons on the server.
"""

import uuid
from datetime import date, datetime
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from orbit_api.schemas.common import Name
from orbit_api.schemas.finance import Amount, Month, Notes, TransactionDate
from orbit_api.services.budgets.calculation import (
    budget_status,
    utilization_bps,
    utilization_status,
)
from orbit_api.services.budgets.models import (
    DEFAULT_THRESHOLDS,
    MAX_THRESHOLD_PERCENT,
    MAX_THRESHOLDS,
    Budget,
    BudgetChanges,
    BudgetDetail,
    BudgetDraft,
    BudgetPeriodType,
    BudgetScope,
    BudgetState,
    BudgetStatus,
    CategoryMonth,
    MonthSummary,
    PeriodView,
    RolloverMode,
    TotalBasis,
    UtilizationStatus,
)
from orbit_api.services.finance.money import DEFAULT_CURRENCY, Currency
from orbit_api.utils.changes import UNSET

HISTORY_MAX_MONTHS = 24

Threshold = Annotated[int, Field(ge=1, le=MAX_THRESHOLD_PERCENT)]
Thresholds = Annotated[
    list[Threshold],
    Field(
        max_length=MAX_THRESHOLDS,
        description=f"Whole percentages of the period's budget, 1 to {MAX_THRESHOLD_PERCENT}; "
        "an in-app notification is sent the first time each is reached in a period.",
    ),
]


def percent_text(bps: int | None) -> str | None:
    """Hundredths of a percent as decimal text: 8750 is `"87.50"`."""
    if bps is None:
        return None
    return f"{bps // 100}.{bps % 100:02d}"


class BudgetPeriodResponse(BaseModel):
    start: date
    end: date
    base_amount: int = Field(description="The budget's amount for this period.")
    rollover_amount: int = Field(
        description="Carried from the previous period: positive for money left unspent, "
        "negative for overspending (with `full` rollover)."
    )
    available: int = Field(
        description="`base_amount` plus `rollover_amount`, never below zero: what can be spent."
    )
    spent: int = Field(
        description="Net spending (expenses minus refunds) in the period, from the ledger; never "
        "below zero."
    )
    remaining: int = Field(description="`available` minus `spent`: negative when overspent.")
    utilization_percent: str | None = Field(
        description="`spent` as a percentage of `available`, two decimals; `null` when nothing "
        "is available."
    )
    status: UtilizationStatus = Field(
        description="`on_track` below 75%, `approaching` from 75%, `near` from 90%, `exceeded` "
        "once more than `available` is spent."
    )
    projected: int | None = Field(
        description="Spending at the period's end at its pace so far, once 7 days have passed; "
        "the final spending for a finished period; `null` otherwise."
    )
    closed: bool = Field(description="Finished, with its rollover passed on.")
    closed_at: datetime | None
    spent_at_close: int | None = Field(
        description="Spending recorded when the period closed, which decided its rollover. "
        "`spent` follows later corrections; this doesn't."
    )

    @classmethod
    def of(cls, view: PeriodView) -> "BudgetPeriodResponse":
        period, usage = view.period, view.utilization
        return cls(
            start=period.start,
            end=period.end,
            base_amount=period.base_amount,
            rollover_amount=period.rollover_amount,
            available=usage.available,
            spent=usage.spent,
            remaining=usage.remaining,
            utilization_percent=percent_text(usage.utilization_bps),
            status=usage.status,
            projected=usage.projected,
            closed=period.closed_at is not None,
            closed_at=period.closed_at,
            spent_at_close=period.spent_at_close,
        )


class BudgetResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    scope: BudgetScope
    category_id: uuid.UUID | None
    currency: Currency
    amount: int = Field(description="Each period's base amount from now on.")
    period: BudgetPeriodType
    start_date: date
    end_date: date | None = Field(description="`null` for a monthly budget without end.")
    recurring: bool = Field(description="A monthly budget covering more than one month.")
    rollover: RolloverMode
    alerts_enabled: bool
    alert_thresholds: list[int]
    state: BudgetState
    status: BudgetStatus = Field(
        description="`upcoming` before its start, `completed` after its end, `archived`, or "
        "`active`."
    )
    notes: str
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    current_period: BudgetPeriodResponse | None = Field(
        description="The current period (or, for the month overview, the one overlapping that "
        "month); the first or last one for a budget that hasn't started or has ended."
    )

    @classmethod
    def of(cls, budget: Budget, status: BudgetStatus, view: PeriodView | None) -> "BudgetResponse":
        return cls(
            id=budget.id,
            workspace_id=budget.workspace_id,
            name=budget.name,
            scope=budget.scope,
            category_id=budget.category_id,
            currency=budget.currency,
            amount=budget.amount,
            period=budget.period,
            start_date=budget.start_date,
            end_date=budget.end_date,
            recurring=budget.recurring,
            rollover=budget.rollover,
            alerts_enabled=budget.alerts_enabled,
            alert_thresholds=list(budget.alert_thresholds),
            state=budget.state,
            status=status,
            notes=budget.notes,
            archived_at=budget.archived_at,
            created_at=budget.created_at,
            updated_at=budget.updated_at,
            current_period=BudgetPeriodResponse.of(view) if view else None,
        )


class BudgetListResponse(BaseModel):
    budgets: list[BudgetResponse] = Field(
        description="Active first, then upcoming, completed, and archived; each by name."
    )


class BudgetDetailResponse(BaseModel):
    budget: BudgetResponse
    periods: list[BudgetPeriodResponse] = Field(
        description="Every period from the start through the current one, newest first."
    )
    periods_closed: int
    periods_within: int = Field(description="Closed periods that stayed within their budget.")

    @classmethod
    def of(cls, detail: BudgetDetail) -> "BudgetDetailResponse":
        view = detail.view
        return cls(
            budget=BudgetResponse.of(view.budget, view.status, view.current),
            periods=[BudgetPeriodResponse.of(period) for period in detail.periods],
            periods_closed=detail.periods_closed,
            periods_within=detail.periods_within,
        )


class CreateBudgetRequest(BaseModel):
    """Limit net spending, overall or in one expense category. A monthly budget runs from the
    first of `start_date`'s month, every month until `end_date` (a month's last day) or without
    end; a custom one covers `start_date` to `end_date` once."""

    model_config = ConfigDict(extra="forbid")

    name: Name
    scope: BudgetScope
    category_id: uuid.UUID | None = Field(
        default=None, description="Required for `category` budgets: an expense category."
    )
    currency: Currency = DEFAULT_CURRENCY
    amount: Amount
    period: BudgetPeriodType = "monthly"
    start_date: TransactionDate
    end_date: TransactionDate | None = None
    rollover: RolloverMode = Field(
        default="none",
        description="Monthly budgets only. `surplus` carries unspent money into the next month; "
        "`full` also carries overspending, which reduces the next month (never below zero).",
    )
    alerts_enabled: bool = True
    alert_thresholds: Thresholds = Field(default_factory=lambda: list(DEFAULT_THRESHOLDS))
    notes: Notes = ""

    @model_validator(mode="after")
    def _check_scope(self) -> Self:
        if (self.scope == "category") != (self.category_id is not None):
            raise ValueError("category_id is required for category budgets, and only for them")
        return self

    def to_draft(self) -> BudgetDraft:
        return BudgetDraft(
            name=self.name,
            scope=self.scope,
            category_id=self.category_id,
            currency=self.currency,
            amount=self.amount,
            period=self.period,
            start_date=self.start_date,
            end_date=self.end_date,
            rollover=self.rollover,
            alerts_enabled=self.alerts_enabled,
            alert_thresholds=tuple(self.alert_thresholds),
            notes=self.notes,
        )


class UpdateBudgetRequest(BaseModel):
    """Change a budget from the current period on; finished periods keep their amounts. Scope,
    category, currency, and period type are fixed."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    amount: Amount | None = None
    start_date: TransactionDate | None = None
    end_date: TransactionDate | None = Field(
        default=None, description="`null` removes the end of a monthly budget."
    )
    rollover: RolloverMode | None = None
    alerts_enabled: bool | None = None
    alert_thresholds: Thresholds | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in self.model_fields_set - {"end_date"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> BudgetChanges:
        provided = self.model_fields_set
        return BudgetChanges(
            name=self.name if self.name is not None else UNSET,
            amount=self.amount if self.amount is not None else UNSET,
            start_date=self.start_date if self.start_date is not None else UNSET,
            end_date=self.end_date if "end_date" in provided else UNSET,
            rollover=self.rollover if self.rollover is not None else UNSET,
            alerts_enabled=self.alerts_enabled if self.alerts_enabled is not None else UNSET,
            alert_thresholds=tuple(self.alert_thresholds)
            if self.alert_thresholds is not None
            else UNSET,
            notes=self.notes if self.notes is not None else UNSET,
        )


class CopyBudgetsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_month: Month = Field(description="`YYYY-MM`: the month whose budgets are copied.")
    to_month: Month = Field(description="`YYYY-MM`: the month they're copied into.")


class CopyBudgetsResponse(BaseModel):
    created: list[BudgetResponse] = Field(description="New one-month budgets in `to_month`.")
    skipped: list[uuid.UUID] = Field(
        description="Budgets not copied because `to_month` is already covered (a recurring "
        "budget, or one added there)."
    )


class BudgetMonthParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: Month | None = Field(
        default=None, description="`YYYY-MM` in your time zone. Defaults to the month of `today`."
    )
    currency: Currency = DEFAULT_CURRENCY
    today: TransactionDate | None = Field(
        default=None,
        description="Your local date. Defaults to today in your time zone preference, else UTC.",
    )


class BudgetHistoryParams(BudgetMonthParams):
    months: int = Field(
        default=6, ge=1, le=HISTORY_MAX_MONTHS, description="How many months, ending with `month`."
    )


class CategoryMonthResponse(BaseModel):
    category_id: uuid.UUID | None = Field(description="`null` for uncategorized spending.")
    spent: int = Field(description="Net spending; negative when refunds exceed it.")
    budget: int | None = Field(description="The category budget's available amount, if any.")

    @classmethod
    def of(cls, entry: CategoryMonth) -> "CategoryMonthResponse":
        return cls(category_id=entry.category_id, spent=entry.spent, budget=entry.budget)


class BudgetMonthResponse(BaseModel):
    month: str = Field(description="`YYYY-MM`.")
    currency: Currency
    total: int | None = Field(
        description="The month's total budget: its overall monthly budget, else the sum of its "
        "monthly category budgets; `null` without either."
    )
    basis: TotalBasis | None
    spent: int = Field(description="The month's net spending, the dashboard's figure.")
    remaining: int | None
    utilization_percent: str | None
    status: UtilizationStatus | None
    budgets_counted: int
    budgets_within: int = Field(description="Monthly budgets not exceeded.")
    unbudgeted: int | None = Field(
        description="Net spending in categories without a category budget, when any category "
        "has one."
    )
    categories: list[CategoryMonthResponse] = Field(
        description="Categories with spending or a budget, largest spending first."
    )
    budgets: list[BudgetResponse] = Field(
        description="Budgets covering the month, each with its period overlapping it."
    )

    @classmethod
    def of(cls, summary: MonthSummary, currency: Currency, today: date) -> "BudgetMonthResponse":
        total = summary.total
        return cls(
            month=f"{summary.month.year:04d}-{summary.month.month:02d}",
            currency=currency,
            total=total,
            basis=summary.basis,
            spent=summary.spent,
            remaining=None if total is None else total - summary.spent,
            utilization_percent=None
            if total is None
            else percent_text(utilization_bps(total, summary.spent)),
            status=None if total is None else utilization_status(total, summary.spent),
            budgets_counted=summary.counted,
            budgets_within=summary.within,
            unbudgeted=summary.unbudgeted,
            categories=[CategoryMonthResponse.of(entry) for entry in summary.categories],
            budgets=[
                BudgetResponse.of(budget, budget_status(budget, today), view)
                for budget, view in summary.budgets
            ],
        )


class BudgetHistoryResponse(BaseModel):
    currency: Currency
    months: list[BudgetMonthResponse] = Field(description="Oldest first, one per month.")
