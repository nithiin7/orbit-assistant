"""Savings goal models: goals with their progress, and contributions and withdrawals.

Amounts are integers in the currency's minor unit and must be JSON integers. A goal earmarks
money; it is never an account, and contributions never count as spending.
"""

import uuid
from datetime import date, datetime
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.budgets import percent_text
from orbit_api.schemas.common import Name, multi_line
from orbit_api.schemas.finance import Amount, Notes, TransactionDate
from orbit_api.services.finance.money import DEFAULT_CURRENCY, Currency
from orbit_api.services.goals.models import (
    Contribution,
    ContributionMode,
    ContributionRequest,
    ContributionType,
    GoalCategory,
    GoalChanges,
    GoalDraft,
    GoalPriority,
    GoalState,
    GoalView,
)
from orbit_api.utils.changes import UNSET

DESCRIPTION_MAX_LENGTH = 500

Description = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=DESCRIPTION_MAX_LENGTH),
    AfterValidator(multi_line),
]


class LinkedAccountResponse(BaseModel):
    account_id: uuid.UUID
    name: str
    balance: int = Field(description="The account's ledger balance.")
    allocated: int = Field(
        description="Saved across every active or paused goal kept in this account. More than "
        "`balance` means the goals count on money the account doesn't hold."
    )


class GoalResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    description: str
    category: GoalCategory
    priority: GoalPriority
    currency: Currency
    target_amount: int
    start_date: date
    target_date: date | None
    state: GoalState
    account_id: uuid.UUID | None
    notes: str
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    saved: int = Field(description="Contributions minus withdrawals: allocated to the goal.")
    remaining: int = Field(description="What is left to reach the target, never below zero.")
    progress_percent: str = Field(description="`saved` over the target, two decimals, ≤ 100.")
    reached: bool
    suggested_monthly: int | None = Field(
        description="What to save each month, from this month through the target date's, to "
        "reach the target (rounded up); everything remaining once the date has passed. `null` "
        "without a target date."
    )
    months_left: int | None
    this_month: int = Field(description="Net contributions this month.")
    available: int = Field(
        description="What can be withdrawn: `saved`, but no more than the linked account holds."
    )
    account: LinkedAccountResponse | None

    @classmethod
    def of(cls, view: GoalView) -> "GoalResponse":
        goal, progress = view.goal, view.progress
        account = view.account
        return cls(
            id=goal.id,
            workspace_id=goal.workspace_id,
            name=goal.name,
            description=goal.description,
            category=goal.category,
            priority=goal.priority,
            currency=goal.currency,
            target_amount=goal.target_amount,
            start_date=goal.start_date,
            target_date=goal.target_date,
            state=goal.state,
            account_id=goal.account_id,
            notes=goal.notes,
            completed_at=goal.completed_at,
            created_at=goal.created_at,
            updated_at=goal.updated_at,
            saved=progress.saved,
            remaining=progress.remaining,
            progress_percent=percent_text(progress.progress_bps) or "0.00",
            reached=progress.reached,
            suggested_monthly=progress.suggested_monthly,
            months_left=progress.months_left,
            this_month=progress.this_month,
            available=view.available,
            account=LinkedAccountResponse(
                account_id=account.account_id,
                name=account.name,
                balance=account.balance,
                allocated=account.allocated,
            )
            if account
            else None,
        )


class GoalListResponse(BaseModel):
    goals: list[GoalResponse] = Field(
        description="Active, paused, completed, then cancelled; by priority and target date."
    )


class CreateGoalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    description: Description = ""
    category: GoalCategory = "other"
    priority: GoalPriority = "medium"
    currency: Currency = DEFAULT_CURRENCY
    target_amount: Amount
    start_date: TransactionDate
    target_date: TransactionDate | None = None
    account_id: uuid.UUID | None = Field(
        default=None,
        description="Where the savings are kept: a bank, savings, cash, wallet, or other account "
        "in the goal's currency. Omit to track the goal on its own.",
    )
    notes: Notes = ""

    def to_draft(self) -> GoalDraft:
        return GoalDraft(
            name=self.name,
            description=self.description,
            category=self.category,
            priority=self.priority,
            currency=self.currency,
            target_amount=self.target_amount,
            start_date=self.start_date,
            target_date=self.target_date,
            account_id=self.account_id,
            notes=self.notes,
        )


class UpdateGoalRequest(BaseModel):
    """Change a goal; its contributions stay. `state` pauses, completes, cancels, or reopens it."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    description: Description | None = None
    category: GoalCategory | None = None
    priority: GoalPriority | None = None
    target_amount: Amount | None = None
    start_date: TransactionDate | None = None
    target_date: TransactionDate | None = Field(default=None, description="`null` removes it.")
    state: GoalState | None = None
    account_id: uuid.UUID | None = Field(default=None, description="`null` unlinks the account.")
    notes: Notes | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in self.model_fields_set - {"target_date", "account_id"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> GoalChanges:
        provided = self.model_fields_set
        return GoalChanges(
            name=self.name if self.name is not None else UNSET,
            description=self.description if self.description is not None else UNSET,
            category=self.category if self.category is not None else UNSET,
            priority=self.priority if self.priority is not None else UNSET,
            target_amount=self.target_amount if self.target_amount is not None else UNSET,
            start_date=self.start_date if self.start_date is not None else UNSET,
            target_date=self.target_date if "target_date" in provided else UNSET,
            state=self.state if self.state is not None else UNSET,
            account_id=self.account_id if "account_id" in provided else UNSET,
            notes=self.notes if self.notes is not None else UNSET,
        )


class ContributionResponse(BaseModel):
    id: uuid.UUID
    goal_id: uuid.UUID
    type: ContributionType
    amount: int
    occurred_on: date
    transaction_id: uuid.UUID | None = Field(
        description="The ledger transfer that moved the money; `null` for an allocation."
    )
    notes: str
    created_at: datetime

    @classmethod
    def of(cls, contribution: Contribution) -> "ContributionResponse":
        return cls(
            id=contribution.id,
            goal_id=contribution.goal_id,
            type=contribution.type,
            amount=contribution.amount,
            occurred_on=contribution.occurred_on,
            transaction_id=contribution.transaction_id,
            notes=contribution.notes,
            created_at=contribution.created_at,
        )


class ContributionListResponse(BaseModel):
    contributions: list[ContributionResponse] = Field(description="Newest first.")


class CreateContributionRequest(BaseModel):
    """Put money into a goal, or take it out.

    - `allocate`: earmark money you already hold (or release it); nothing is recorded in the
      ledger. Needs `amount`.
    - `transfer`: Orbit records a transfer from `account_id` into the goal's linked account (or
      out of it, for a withdrawal). Needs `amount` and `account_id`.
    - `link`: record an existing transfer into (or out of) the linked account. Needs
      `transaction_id`; its amount and date are used.
    """

    model_config = ConfigDict(extra="forbid")

    type: ContributionType = "contribution"
    mode: ContributionMode = "allocate"
    amount: Amount | None = None
    occurred_on: TransactionDate | None = Field(
        default=None, description="Defaults to today in your time zone."
    )
    account_id: uuid.UUID | None = None
    transaction_id: uuid.UUID | None = None
    notes: Notes = ""

    @model_validator(mode="after")
    def _check_mode(self) -> Self:
        if self.mode == "link":
            if self.transaction_id is None:
                raise ValueError("transaction_id is required to link a transfer")
            if self.amount is not None or self.account_id is not None:
                raise ValueError("a linked transfer's own amount and accounts are used")
        else:
            if self.amount is None:
                raise ValueError("amount is required")
            if self.transaction_id is not None:
                raise ValueError("transaction_id is only for mode link")
            if self.mode == "allocate" and self.account_id is not None:
                raise ValueError("allocations move no money, so they take no account")
        return self

    def to_request(self) -> ContributionRequest:
        return ContributionRequest(
            type=self.type,
            mode=self.mode,
            amount=self.amount,
            occurred_on=self.occurred_on,
            account_id=self.account_id,
            transaction_id=self.transaction_id,
            notes=self.notes,
        )
