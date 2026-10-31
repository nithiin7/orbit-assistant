"""Savings goals: targets, contributions and withdrawals, and how they meet the ledger.

**Saving isn't spending.** A contribution never creates an expense. Money moved into a goal's
linked account is an ordinary ledger `transfer` (recorded by Orbit, or an existing one linked),
which reports already leave out of income and spending. A contribution without a ledger row
(`allocate`) only earmarks money already held, so nothing is counted twice: account balances and
net worth come from the ledger alone and goals never add to them.

**No duplicates.** A ledger transfer backs at most one contribution (a unique key, checked first
for a clear message), and the ledger refuses to delete a transfer a contribution records.

**Atomic.** A contribution and the transfer it records commit together.

Every method takes a `workspace_id` the caller has authorized; repositories filter by it, and
accounts and transactions are looked up in that workspace through `FinanceService`.
"""

import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import date, datetime
from typing import Final, Protocol

from orbit_api.services.finance.models import (
    AccountNotFoundError,
    AccountType,
    AccountView,
    InvalidTransactionError,
    Transaction,
    TransactionDraft,
    TransactionInUseError,
    TransactionNotFoundError,
)
from orbit_api.services.finance.money import Currency
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.goals.calculation import progress, saved
from orbit_api.services.goals.models import (
    Contribution,
    ContributionNotFoundError,
    ContributionRequest,
    Goal,
    GoalChanges,
    GoalConflictError,
    GoalDraft,
    GoalNotFoundError,
    GoalView,
    InvalidGoalError,
    LinkedAccount,
)
from orbit_api.services.transactions import ConflictError
from orbit_api.services.transactions import Transaction as UnitOfWork
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now

# Where savings can be kept. Investment accounts are tracked as investments (counting them as
# goal savings too would show the same money twice in a plan), and cards and loans owe money.
SAVINGS_ACCOUNT_TYPES: Final[frozenset[AccountType]] = frozenset(
    {"bank", "savings", "cash", "wallet", "other"}
)


class GoalRepository(Protocol):
    async def add(self, goal: Goal) -> None: ...

    async def get(self, workspace_id: uuid.UUID, goal_id: uuid.UUID) -> Goal | None:
        """The goal, only if it belongs to `workspace_id`."""
        ...

    async def list(self, workspace_id: uuid.UUID) -> list[Goal]:
        """Oldest first."""
        ...

    async def save(self, goal: Goal) -> None: ...

    async def delete(self, workspace_id: uuid.UUID, goal_id: uuid.UUID) -> None: ...


class ContributionRepository(Protocol):
    async def add(self, contribution: Contribution) -> None:
        """Raises `ConflictError` if the transaction backs another contribution."""
        ...

    async def get(
        self, workspace_id: uuid.UUID, goal_id: uuid.UUID, contribution_id: uuid.UUID
    ) -> Contribution | None: ...

    async def for_goal(self, workspace_id: uuid.UUID, goal_id: uuid.UUID) -> list[Contribution]:
        """Newest first."""
        ...

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[Contribution]: ...

    async def between(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> list[Contribution]:
        """Contributions and withdrawals of the currency's goals in the inclusive range."""
        ...

    async def is_linked(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> bool: ...

    async def delete(self, workspace_id: uuid.UUID, contribution_id: uuid.UUID) -> None: ...


class GoalService:
    def __init__(
        self,
        goals: GoalRepository,
        contributions: ContributionRepository,
        finance: FinanceService,
        unit_of_work: UnitOfWork,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._goals = goals
        self._contributions = contributions
        self._finance = finance
        self._unit_of_work = unit_of_work
        self._clock = clock

    # Reads

    async def views(self, workspace_id: uuid.UUID, today: date) -> list[GoalView]:
        """Every goal: active first, then paused, completed, and cancelled; by priority and
        target date within each."""
        goals = await self._goals.list(workspace_id)
        entries = await self._contributions.for_workspace(workspace_id)
        accounts = {view.account.id: view for view in await self._finance.accounts(workspace_id)}
        views = _views(goals, entries, accounts, today)
        state_order = {"active": 0, "paused": 1, "completed": 2, "cancelled": 3}
        priority_order = {"high": 0, "medium": 1, "low": 2}
        return sorted(
            views,
            key=lambda view: (
                state_order[view.goal.state],
                priority_order[view.goal.priority],
                view.goal.target_date or date.max,
                view.goal.name.casefold(),
            ),
        )

    async def view(self, workspace_id: uuid.UUID, goal_id: uuid.UUID, today: date) -> GoalView:
        await self._get(workspace_id, goal_id)
        for view in await self.views(workspace_id, today):
            if view.goal.id == goal_id:
                return view
        raise GoalNotFoundError

    async def contributions(
        self, workspace_id: uuid.UUID, goal_id: uuid.UUID
    ) -> list[Contribution]:
        await self._get(workspace_id, goal_id)
        return await self._contributions.for_goal(workspace_id, goal_id)

    async def between(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> list[Contribution]:
        return await self._contributions.between(workspace_id, currency, start, end)

    # Goals

    async def create(self, workspace_id: uuid.UUID, draft: GoalDraft, today: date) -> GoalView:
        now = self._clock()
        goal = Goal(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=draft.name,
            description=draft.description,
            category=draft.category,
            priority=draft.priority,
            currency=draft.currency,
            target_amount=draft.target_amount,
            start_date=draft.start_date,
            target_date=draft.target_date,
            state="active",
            account_id=draft.account_id,
            notes=draft.notes,
            completed_at=None,
            created_at=now,
            updated_at=now,
        )
        await self._check(goal, previous=None)
        await self._goals.add(goal)
        await self._unit_of_work.commit()
        return await self.view(workspace_id, goal.id, today)

    async def update(
        self, workspace_id: uuid.UUID, goal_id: uuid.UUID, changes: GoalChanges, today: date
    ) -> GoalView:
        """Change a goal, including its target and target date; its contributions stay as they
        were. Marking it completed records when; reopening clears that."""
        goal = await self._get(workspace_id, goal_id)
        state = goal.state if changes.state is UNSET else changes.state
        updated = replace(
            goal,
            name=goal.name if changes.name is UNSET else changes.name,
            description=goal.description if changes.description is UNSET else changes.description,
            category=goal.category if changes.category is UNSET else changes.category,
            priority=goal.priority if changes.priority is UNSET else changes.priority,
            target_amount=goal.target_amount
            if changes.target_amount is UNSET
            else changes.target_amount,
            start_date=goal.start_date if changes.start_date is UNSET else changes.start_date,
            target_date=goal.target_date if changes.target_date is UNSET else changes.target_date,
            state=state,
            account_id=goal.account_id if changes.account_id is UNSET else changes.account_id,
            notes=goal.notes if changes.notes is UNSET else changes.notes,
            completed_at=(goal.completed_at or self._clock()) if state == "completed" else None,
        )
        if updated == goal:
            return await self.view(workspace_id, goal_id, today)
        if updated.account_id != goal.account_id:
            entries = await self._contributions.for_goal(workspace_id, goal_id)
            if any(entry.transaction_id is not None for entry in entries):
                raise InvalidGoalError(
                    "Transfers into the current account are recorded against this goal, so its "
                    "account can't change. Undo them first, or start a new goal."
                )
        await self._check(updated, previous=goal)
        await self._goals.save(replace(updated, updated_at=self._clock()))
        await self._unit_of_work.commit()
        return await self.view(workspace_id, goal_id, today)

    async def delete(self, workspace_id: uuid.UUID, goal_id: uuid.UUID) -> None:
        """Delete a goal with no history. One with contributions is cancelled instead, so its
        history stays."""
        await self._get(workspace_id, goal_id)
        if await self._contributions.for_goal(workspace_id, goal_id):
            raise GoalConflictError(
                "This goal has contributions. Cancel it instead to keep its history, or undo "
                "them first."
            )
        await self._goals.delete(workspace_id, goal_id)
        await self._unit_of_work.commit()

    # Contributions

    async def contribute(
        self, workspace_id: uuid.UUID, goal_id: uuid.UUID, request: ContributionRequest, today: date
    ) -> Contribution:
        goal = await self._get(workspace_id, goal_id)
        if request.type == "contribution" and goal.state != "active":
            raise InvalidGoalError(
                "Only active goals take contributions. Resume it first."
                if goal.state == "paused"
                else "This goal is closed. Reopen it to add to it."
            )
        if request.mode in ("transfer", "link") and goal.account_id is None:
            raise InvalidGoalError(
                "Link an account to this goal to record transfers; otherwise allocate the "
                "money without moving it."
            )

        transaction: Transaction | None = None
        if request.mode == "link":
            transaction = await self._linkable(goal, request)
            amount, occurred_on = transaction.amount, transaction.occurred_on
        else:
            if request.amount is None:
                raise InvalidGoalError("Enter an amount.")
            amount, occurred_on = request.amount, request.occurred_on or today

        if request.type == "withdrawal":
            held = saved(await self._contributions.for_goal(workspace_id, goal_id))
            if amount > held:
                raise InvalidGoalError("You can't withdraw more than the goal has saved.")

        if request.mode == "transfer":
            transaction = await self._record_transfer(goal, request, amount, occurred_on)

        contribution = Contribution(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            goal_id=goal_id,
            type=request.type,
            amount=amount,
            occurred_on=occurred_on,
            transaction_id=transaction.id if transaction else None,
            notes=request.notes,
            created_at=self._clock(),
        )
        try:
            await self._contributions.add(contribution)
            await self._unit_of_work.commit()
        except ConflictError:
            await self._unit_of_work.rollback()
            raise _already_recorded() from None
        return contribution

    async def undo(
        self,
        workspace_id: uuid.UUID,
        goal_id: uuid.UUID,
        contribution_id: uuid.UUID,
        *,
        delete_transaction: bool,
    ) -> None:
        """Remove a contribution or withdrawal. Its transfer stays in the ledger unless
        `delete_transaction`."""
        await self._get(workspace_id, goal_id)
        contribution = await self._contributions.get(workspace_id, goal_id, contribution_id)
        if contribution is None:
            raise ContributionNotFoundError
        if contribution.type == "contribution":
            remaining = saved(await self._contributions.for_goal(workspace_id, goal_id))
            if remaining - contribution.amount < 0:
                raise InvalidGoalError("Withdrawals depend on this contribution. Undo them first.")
        await self._contributions.delete(workspace_id, contribution_id)
        if delete_transaction and contribution.transaction_id is not None:
            try:
                await self._finance.delete(workspace_id, contribution.transaction_id, commit=False)
            except TransactionNotFoundError:
                pass  # Already gone; the contribution is what was asked about.
            except TransactionInUseError:
                raise GoalConflictError(
                    "Something else records that transfer, so it can't be deleted."
                ) from None
        await self._unit_of_work.commit()

    # Helpers

    async def _get(self, workspace_id: uuid.UUID, goal_id: uuid.UUID) -> Goal:
        goal = await self._goals.get(workspace_id, goal_id)
        if goal is None:
            raise GoalNotFoundError
        return goal

    async def _check(self, goal: Goal, previous: Goal | None) -> None:
        if goal.target_date is not None and goal.target_date < goal.start_date:
            raise InvalidGoalError("The target date can't be before the start date.")
        if goal.account_id is None or (
            previous is not None and previous.account_id == goal.account_id
        ):
            return
        try:
            view = await self._finance.account(goal.workspace_id, goal.account_id)
        except AccountNotFoundError:
            raise InvalidGoalError("That account doesn't exist in this workspace.") from None
        account = view.account
        if account.type not in SAVINGS_ACCOUNT_TYPES:
            raise InvalidGoalError(
                "Keep savings in a bank, savings, cash, wallet, or other account. Investments "
                "are tracked separately, and cards and loans owe money."
            )
        if account.currency != goal.currency:
            raise InvalidGoalError("The account must use the goal's currency.")
        if account.archived_at is not None:
            raise InvalidGoalError(f"“{account.name}” is archived. Restore it first.")

    async def _linkable(self, goal: Goal, request: ContributionRequest) -> Transaction:
        if request.transaction_id is None:
            raise InvalidGoalError("Choose the transfer to link.")
        try:
            transaction = await self._finance.get(goal.workspace_id, request.transaction_id)
        except TransactionNotFoundError:
            raise InvalidGoalError("That transaction doesn't exist in this workspace.") from None
        if transaction.type != "transfer":
            raise InvalidGoalError(
                "Only transfers can be linked: saving moves money, it isn't spending."
            )
        if transaction.currency != goal.currency:
            raise InvalidGoalError("The transfer must be in the goal's currency.")
        expected = (
            transaction.to_account_id if request.type == "contribution" else transaction.account_id
        )
        if expected != goal.account_id:
            raise InvalidGoalError(
                "A contribution links a transfer into the goal's account; a withdrawal, one out "
                "of it."
            )
        if await self._contributions.is_linked(goal.workspace_id, transaction.id):
            raise _already_recorded()
        return transaction

    async def _record_transfer(
        self, goal: Goal, request: ContributionRequest, amount: int, occurred_on: date
    ) -> Transaction:
        assert goal.account_id is not None
        if request.account_id is None:
            raise InvalidGoalError(
                "Choose the account the money comes from."
                if request.type == "contribution"
                else "Choose the account the money goes to."
            )
        source, destination = (
            (request.account_id, goal.account_id)
            if request.type == "contribution"
            else (goal.account_id, request.account_id)
        )
        try:
            return await self._finance.create(
                goal.workspace_id,
                TransactionDraft(
                    type="transfer",
                    amount=amount,
                    occurred_on=occurred_on,
                    description=f"Savings: {goal.name}"
                    if request.type == "contribution"
                    else f"From savings: {goal.name}",
                    account_id=source,
                    to_account_id=destination,
                    notes=request.notes,
                ),
                commit=False,
            )
        except InvalidTransactionError as error:
            raise InvalidGoalError(error.message) from None


def _views(
    goals: list[Goal],
    contributions: list[Contribution],
    accounts: dict[uuid.UUID, AccountView],
    today: date,
) -> list[GoalView]:
    by_goal: dict[uuid.UUID, list[Contribution]] = {}
    for entry in contributions:
        by_goal.setdefault(entry.goal_id, []).append(entry)
    progresses = {
        goal.id: progress(goal.target_amount, goal.target_date, by_goal.get(goal.id, []), today)
        for goal in goals
    }
    allocated: dict[uuid.UUID, int] = {}
    for goal in goals:
        if goal.account_id is not None and goal.state in ("active", "paused"):
            allocated[goal.account_id] = (
                allocated.get(goal.account_id, 0) + progresses[goal.id].saved
            )
    views: list[GoalView] = []
    for goal in goals:
        current = progresses[goal.id]
        linked: LinkedAccount | None = None
        available = max(current.saved, 0)
        account = accounts.get(goal.account_id) if goal.account_id else None
        if account is not None:
            linked = LinkedAccount(
                account_id=account.account.id,
                name=account.account.name,
                balance=account.balance,
                allocated=allocated.get(account.account.id, 0),
            )
            available = min(available, max(account.balance, 0))
        views.append(GoalView(goal=goal, progress=current, account=linked, available=available))
    return views


def _already_recorded() -> GoalConflictError:
    return GoalConflictError("That transfer is already recorded against a savings goal.")
