"""Savings goal types.

A goal **earmarks** money; it isn't an account and holds nothing itself. Its saved amount is
derived from its contributions and withdrawals, never stored. A goal may be linked to the account
the money sits in (a savings account, say): contributions can then move money there as an
ordinary ledger transfer, and the account's balance shows how much of the goal can really be
withdrawn. Without a link, a goal is tracked on its own, as allocations of money held anywhere.

Amounts are integers in the currency's minor unit.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from orbit_api.services.finance.money import Currency
from orbit_api.utils.changes import UNSET, Change

GoalCategory = Literal[
    "emergency_fund", "vehicle", "travel", "home", "electronics", "education", "wedding", "other"
]
GoalPriority = Literal["low", "medium", "high"]
GoalState = Literal["active", "paused", "completed", "cancelled"]
ContributionType = Literal["contribution", "withdrawal"]
# How a contribution or withdrawal relates to the ledger:
# - `allocate`: no ledger row; money already held is earmarked (or released).
# - `transfer`: Orbit records a transfer into (or out of) the goal's linked account.
# - `link`: an existing transfer is recorded against the goal.
ContributionMode = Literal["allocate", "transfer", "link"]


@dataclass(frozen=True, slots=True)
class Goal:
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
    # The account the savings are kept in, if any: an asset account in the goal's currency.
    account_id: uuid.UUID | None
    notes: str
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class Contribution:
    id: uuid.UUID
    workspace_id: uuid.UUID
    goal_id: uuid.UUID
    type: ContributionType
    # Always positive; `type` says which way.
    amount: int
    occurred_on: date
    # The ledger transfer that moved the money, if any. A transfer backs at most one entry.
    transaction_id: uuid.UUID | None
    notes: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class Progress:
    """A goal's figures on a date, computed from its contributions."""

    # Contributions minus withdrawals.
    saved: int
    remaining: int
    # Hundredths of a percent of the target: 2500 is 25%. Capped at 10000.
    progress_bps: int
    reached: bool
    # What to put in each month, from this month through the target date's, to reach it;
    # everything remaining once the target date has passed. `None` without a target date.
    suggested_monthly: int | None
    # Months from this one through the target date's month (0 once it has passed).
    months_left: int | None
    # Net contributions in the month of the date.
    this_month: int


@dataclass(frozen=True, slots=True)
class LinkedAccount:
    """The linked account's balance and how much of it goals have earmarked."""

    account_id: uuid.UUID
    name: str
    balance: int
    # Saved across every active or paused goal linked to this account.
    allocated: int


@dataclass(frozen=True, slots=True)
class GoalView:
    goal: Goal
    progress: Progress
    account: LinkedAccount | None
    # What can be withdrawn: the saved amount, but no more than the linked account holds.
    available: int


@dataclass(frozen=True, slots=True)
class GoalDraft:
    name: str
    currency: Currency
    target_amount: int
    start_date: date
    target_date: date | None = None
    description: str = ""
    category: GoalCategory = "other"
    priority: GoalPriority = "medium"
    account_id: uuid.UUID | None = None
    notes: str = ""


@dataclass(frozen=True, slots=True)
class GoalChanges:
    name: Change[str] = UNSET
    description: Change[str] = UNSET
    category: Change[GoalCategory] = UNSET
    priority: Change[GoalPriority] = UNSET
    target_amount: Change[int] = UNSET
    start_date: Change[date] = UNSET
    target_date: Change[date | None] = UNSET
    state: Change[GoalState] = UNSET
    account_id: Change[uuid.UUID | None] = UNSET
    notes: Change[str] = UNSET


@dataclass(frozen=True, slots=True)
class ContributionRequest:
    type: ContributionType
    mode: ContributionMode
    # Required for `allocate` and `transfer`; a linked transfer's own amount and date are used.
    amount: int | None = None
    occurred_on: date | None = None
    # `transfer`: where a contribution comes from, or where a withdrawal goes.
    account_id: uuid.UUID | None = None
    # `link`: the existing transfer.
    transaction_id: uuid.UUID | None = None
    notes: str = ""


class GoalNotFoundError(Exception):
    """The savings goal does not exist in this workspace."""


class ContributionNotFoundError(Exception):
    """The contribution does not exist on this goal."""


class InvalidGoalError(Exception):
    """The request breaks a rule. The message is written for the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class GoalConflictError(Exception):
    """The transaction is already recorded, or the goal has history. The message is written for
    the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
