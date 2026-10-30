"""Finance: accounts, categories, and the transactions that move money in, out, and between them.

Balances are never stored. An account's balance is its opening balance plus its transactions,
computed by the database when read, so it can't drift from the ledger and editing or deleting a
past transaction corrects every balance at once.

Every method takes a `workspace_id` that the caller has already authorized (the `WorkspaceDep`
API dependency does this), and repositories filter every query by it. Referenced accounts and
categories are looked up in that workspace too, so a transaction can never point into another
one; composite foreign keys back this up in the database.
"""

import uuid
from collections.abc import Callable, Iterable
from dataclasses import replace
from datetime import date, datetime
from typing import Protocol

from orbit_api.services.finance.categories import DEFAULT_CATEGORIES
from orbit_api.services.finance.models import (
    Account,
    AccountChanges,
    AccountDraft,
    AccountNotFoundError,
    AccountView,
    BalanceTotals,
    CashFlow,
    Category,
    CategoryConflictError,
    CategoryNotFoundError,
    CategorySpending,
    CategoryType,
    InvalidTransactionError,
    MonthlyCashFlow,
    Transaction,
    TransactionChanges,
    TransactionDraft,
    TransactionInUseError,
    TransactionNotFoundError,
    TransactionPage,
    TransactionQuery,
)
from orbit_api.services.finance.money import Currency, add_months, month_bounds
from orbit_api.services.transactions import ConflictError
from orbit_api.services.transactions import Transaction as UnitOfWork
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now


class AccountRepository(Protocol):
    async def add(self, account: Account) -> None: ...

    async def get(self, workspace_id: uuid.UUID, account_id: uuid.UUID) -> Account | None:
        """The account, only if it belongs to `workspace_id`."""
        ...

    async def views(
        self,
        workspace_id: uuid.UUID,
        account_id: uuid.UUID | None = None,
        as_of: date | None = None,
    ) -> list[AccountView]:
        """Accounts with their balances, active ones first, each group by name: every account in
        the workspace, or only `account_id`. With `as_of`, balances count only transactions on
        or before that date (opening balances have no date and always count)."""
        ...

    async def save(self, account: Account) -> None:
        """Store an existing account's fields. Matches on both its ID and workspace."""
        ...


class CategoryRepository(Protocol):
    async def add(self, category: Category) -> None:
        """Raises `ConflictError` if the workspace has a category of that type and name, or with
        that key, already."""
        ...

    async def get(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> Category | None:
        """The category, only if it belongs to `workspace_id`."""
        ...

    async def list(self, workspace_id: uuid.UUID) -> list[Category]:
        """Every category in the workspace: income first, then expense, each by name."""
        ...

    async def save(self, category: Category) -> None:
        """Store an existing category's name. Raises `ConflictError` on a duplicate name."""
        ...

    async def is_used(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> bool:
        """Whether any transaction has this category."""
        ...

    async def is_used_by_recurring(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> bool:
        """Whether any subscription or bill has this category."""
        ...

    async def is_used_by_budget(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> bool:
        """Whether any budget limits spending in this category."""
        ...

    async def delete(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> None: ...


class TransactionRepository(Protocol):
    async def add(self, transaction: Transaction) -> None: ...

    async def get(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> Transaction | None:
        """The transaction, only if it belongs to `workspace_id`."""
        ...

    async def find(self, workspace_id: uuid.UUID, query: TransactionQuery) -> TransactionPage: ...

    async def between(
        self, workspace_id: uuid.UUID, date_from: date | None, date_to: date | None
    ) -> list[Transaction]:
        """Every transaction in the inclusive date range, oldest first."""
        ...

    async def save(self, transaction: Transaction) -> None:
        """Store an existing transaction's fields. Matches on both its ID and workspace."""
        ...

    async def delete(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> bool:
        """Delete the transaction if it belongs to `workspace_id`; report whether it did.
        Raises `ConflictError` if a loan, subscription, or bill payment links to it."""
        ...

    async def cash_flow(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> CashFlow:
        """Income, expenses, and refunds in `currency` between the inclusive dates."""
        ...

    async def monthly_cash_flow(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> list[MonthlyCashFlow]:
        """`cash_flow` per calendar month between the inclusive dates, for months that have
        transactions, oldest first."""
        ...

    async def spending_by_category(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> list[CategorySpending]:
        """Expenses and refunds in `currency` between the inclusive dates, per category."""
        ...


def balance_totals(views: Iterable[AccountView]) -> list[BalanceTotals]:
    """Balances per currency, split into assets and liabilities, ordered by currency. Archived
    accounts count: their balance is still real. Different currencies are never added up."""
    assets: dict[Currency, int] = {}
    owed: dict[Currency, int] = {}
    for view in views:
        currency = view.account.currency
        assets.setdefault(currency, 0)
        owed.setdefault(currency, 0)
        if view.account.account_class == "liability":
            # A liability's balance is negative while money is owed.
            owed[currency] -= view.balance
        else:
            assets[currency] += view.balance
    return [
        BalanceTotals(currency=currency, assets=assets[currency], liabilities=owed[currency])
        for currency in sorted(assets)
    ]


class FinanceService:
    def __init__(
        self,
        accounts: AccountRepository,
        categories: CategoryRepository,
        transactions: TransactionRepository,
        unit_of_work: UnitOfWork,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._accounts = accounts
        self._categories = categories
        self._transactions = transactions
        self._unit_of_work = unit_of_work
        self._clock = clock

    # Accounts

    async def accounts(
        self, workspace_id: uuid.UUID, as_of: date | None = None
    ) -> list[AccountView]:
        """Every account with its balance: today's, or as of the end of `as_of`."""
        return await self._accounts.views(workspace_id, as_of=as_of)

    async def account(self, workspace_id: uuid.UUID, account_id: uuid.UUID) -> AccountView:
        views = await self._accounts.views(workspace_id, account_id)
        if not views:
            raise AccountNotFoundError
        return views[0]

    async def create_account(
        self, workspace_id: uuid.UUID, draft: AccountDraft, *, commit: bool = True
    ) -> AccountView:
        """With `commit=False` the caller commits, as when a loan creates its account."""
        now = self._clock()
        account = Account(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=draft.name,
            type=draft.type,
            currency=draft.currency,
            opening_balance=draft.opening_balance,
            notes=draft.notes,
            archived_at=None,
            created_at=now,
            updated_at=now,
        )
        await self._accounts.add(account)
        if commit:
            await self._unit_of_work.commit()
        return AccountView(account=account, balance=account.opening_balance)

    async def update_account(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID, changes: AccountChanges
    ) -> AccountView:
        account = await self._get_account(workspace_id, account_id)
        updated = replace(
            account,
            name=account.name if changes.name is UNSET else changes.name,
            opening_balance=account.opening_balance
            if changes.opening_balance is UNSET
            else changes.opening_balance,
            notes=account.notes if changes.notes is UNSET else changes.notes,
        )
        await self._save_account_if_changed(account, updated)
        return await self.account(workspace_id, account_id)

    async def archive_account(self, workspace_id: uuid.UUID, account_id: uuid.UUID) -> AccountView:
        """Hide the account from new transactions, keeping its history and balance. Idempotent:
        archiving an archived account keeps its original archive time."""
        account = await self._get_account(workspace_id, account_id)
        if account.archived_at is None:
            await self._save_account_if_changed(
                account, replace(account, archived_at=self._clock())
            )
        return await self.account(workspace_id, account_id)

    async def restore_account(self, workspace_id: uuid.UUID, account_id: uuid.UUID) -> AccountView:
        account = await self._get_account(workspace_id, account_id)
        await self._save_account_if_changed(account, replace(account, archived_at=None))
        return await self.account(workspace_id, account_id)

    # Categories

    async def categories(self, workspace_id: uuid.UUID) -> list[Category]:
        """The workspace's categories, adding any built-in ones it doesn't have yet."""
        categories = await self._categories.list(workspace_id)
        keys = {category.key for category in categories}
        names = {(category.type, category.name.casefold()) for category in categories}
        missing = [
            default
            for default in DEFAULT_CATEGORIES
            if default.key not in keys and (default.type, default.name.casefold()) not in names
        ]
        if not missing:
            return categories
        now = self._clock()
        try:
            for default in missing:
                await self._categories.add(
                    Category(
                        id=uuid.uuid4(),
                        workspace_id=workspace_id,
                        name=default.name,
                        type=default.type,
                        key=default.key,
                        created_at=now,
                        updated_at=now,
                    )
                )
            await self._unit_of_work.commit()
        except ConflictError:
            # A concurrent request seeded them first; use its rows.
            await self._unit_of_work.rollback()
        return await self._categories.list(workspace_id)

    async def create_category(
        self, workspace_id: uuid.UUID, name: str, category_type: CategoryType
    ) -> Category:
        await self._check_name_free(workspace_id, category_type, name, except_id=None)
        now = self._clock()
        category = Category(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=name,
            type=category_type,
            key=None,
            created_at=now,
            updated_at=now,
        )
        try:
            await self._categories.add(category)
            await self._unit_of_work.commit()
        except ConflictError:
            await self._unit_of_work.rollback()
            raise _duplicate_category() from None
        return category

    async def rename_category(
        self, workspace_id: uuid.UUID, category_id: uuid.UUID, name: str
    ) -> Category:
        category = await self._get_category(workspace_id, category_id)
        if category.name == name:
            return category
        await self._check_name_free(workspace_id, category.type, name, except_id=category.id)
        renamed = replace(category, name=name, updated_at=self._clock())
        try:
            await self._categories.save(renamed)
            await self._unit_of_work.commit()
        except ConflictError:
            await self._unit_of_work.rollback()
            raise _duplicate_category() from None
        return renamed

    async def delete_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> None:
        """Delete one of the user's own categories that no transaction uses. Built-in categories
        stay, so that seeding never brings a deleted one back."""
        category = await self._get_category(workspace_id, category_id)
        if category.is_default:
            raise CategoryConflictError("Built-in categories can't be deleted. Rename it instead.")
        if await self._categories.is_used(workspace_id, category_id):
            raise _category_in_use()
        if await self._categories.is_used_by_recurring(workspace_id, category_id):
            raise CategoryConflictError(
                "Subscriptions or bills use this category. Move them to another category first."
            )
        if await self._categories.is_used_by_budget(workspace_id, category_id):
            raise CategoryConflictError(
                "A budget limits spending in this category. Delete that budget first."
            )
        try:
            await self._categories.delete(workspace_id, category_id)
            await self._unit_of_work.commit()
        except ConflictError:
            # A transaction took the category between the check and the delete.
            await self._unit_of_work.rollback()
            raise _category_in_use() from None

    # Transactions

    async def find(self, workspace_id: uuid.UUID, query: TransactionQuery) -> TransactionPage:
        return await self._transactions.find(workspace_id, query)

    async def get(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> Transaction:
        transaction = await self._transactions.get(workspace_id, transaction_id)
        if transaction is None:
            raise TransactionNotFoundError
        return transaction

    async def create(
        self, workspace_id: uuid.UUID, draft: TransactionDraft, *, commit: bool = True
    ) -> Transaction:
        """Validate and record a transaction. With `commit=False` the caller commits, so the
        transaction can be written atomically with related records (a commitment payment)."""
        currency = await self._check(workspace_id, draft, previous=None)
        now = self._clock()
        transaction = Transaction(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            type=draft.type,
            amount=draft.amount,
            currency=currency,
            occurred_on=draft.occurred_on,
            description=draft.description,
            category_id=draft.category_id,
            account_id=draft.account_id,
            to_account_id=draft.to_account_id,
            notes=draft.notes,
            created_at=now,
            updated_at=now,
        )
        await self._transactions.add(transaction)
        if commit:
            await self._unit_of_work.commit()
        return transaction

    async def update(
        self, workspace_id: uuid.UUID, transaction_id: uuid.UUID, changes: TransactionChanges
    ) -> Transaction:
        """Correct a transaction. Balances and summaries follow automatically, since they are
        derived from the transactions themselves."""
        transaction = await self.get(workspace_id, transaction_id)
        updated = replace(
            transaction,
            type=transaction.type if changes.type is UNSET else changes.type,
            amount=transaction.amount if changes.amount is UNSET else changes.amount,
            occurred_on=transaction.occurred_on
            if changes.occurred_on is UNSET
            else changes.occurred_on,
            description=transaction.description
            if changes.description is UNSET
            else changes.description,
            account_id=transaction.account_id
            if changes.account_id is UNSET
            else changes.account_id,
            to_account_id=transaction.to_account_id
            if changes.to_account_id is UNSET
            else changes.to_account_id,
            category_id=transaction.category_id
            if changes.category_id is UNSET
            else changes.category_id,
            notes=transaction.notes if changes.notes is UNSET else changes.notes,
        )
        if updated == transaction:
            # A request that changes nothing leaves `updated_at` alone.
            return transaction
        currency = await self._check(
            workspace_id,
            TransactionDraft(
                type=updated.type,
                amount=updated.amount,
                occurred_on=updated.occurred_on,
                description=updated.description,
                account_id=updated.account_id,
                to_account_id=updated.to_account_id,
                category_id=updated.category_id,
                notes=updated.notes,
            ),
            previous=transaction,
        )
        updated = replace(updated, currency=currency, updated_at=self._clock())
        await self._transactions.save(updated)
        await self._unit_of_work.commit()
        return updated

    async def delete(
        self, workspace_id: uuid.UUID, transaction_id: uuid.UUID, *, commit: bool = True
    ) -> None:
        """Delete a transaction. One that records a commitment payment raises
        `TransactionInUseError`: the database refuses to orphan the payment."""
        try:
            deleted = await self._transactions.delete(workspace_id, transaction_id)
        except ConflictError:
            await self._unit_of_work.rollback()
            raise TransactionInUseError from None
        if not deleted:
            raise TransactionNotFoundError
        if commit:
            await self._unit_of_work.commit()

    async def export(
        self, workspace_id: uuid.UUID, date_from: date | None, date_to: date | None
    ) -> tuple[list[Transaction], list[Account], list[Category]]:
        """Transactions in the inclusive range, oldest first, with the accounts and categories
        they name."""
        transactions = await self._transactions.between(workspace_id, date_from, date_to)
        accounts = [view.account for view in await self._accounts.views(workspace_id)]
        categories = await self._categories.list(workspace_id)
        return transactions, accounts, categories

    # Reports

    async def cash_flow(self, workspace_id: uuid.UUID, currency: Currency, month: date) -> CashFlow:
        """Income and spending in the calendar month containing `month`."""
        start, end = month_bounds(month)
        return await self._transactions.cash_flow(workspace_id, currency, start, end)

    async def monthly_cash_flow(
        self, workspace_id: uuid.UUID, currency: Currency, last_month: date, months: int
    ) -> list[MonthlyCashFlow]:
        """Cash flow for each of the `months` calendar months up to and including `last_month`,
        oldest first. Months without transactions are zero rather than missing."""
        first = add_months(month_bounds(last_month)[0], -(months - 1))
        _, end = month_bounds(last_month)
        found = {
            entry.month: entry
            for entry in await self._transactions.monthly_cash_flow(
                workspace_id, currency, first, end
            )
        }
        empty = CashFlow(income=0, expenses=0, refunds=0, transactions=0)
        result: list[MonthlyCashFlow] = []
        for offset in range(months):
            month = add_months(first, offset)
            result.append(found.get(month, MonthlyCashFlow(month=month, cash_flow=empty)))
        return result

    async def spending_by_category(
        self, workspace_id: uuid.UUID, currency: Currency, start: date, end: date
    ) -> list[CategorySpending]:
        """Net spending per category, largest first. Categories whose refunds cancel their
        spending entirely are left out."""
        spending = await self._transactions.spending_by_category(workspace_id, currency, start, end)
        return sorted(
            (entry for entry in spending if entry.net != 0),
            key=lambda entry: (-entry.net, str(entry.category_id)),
        )

    # Helpers

    async def _get_account(self, workspace_id: uuid.UUID, account_id: uuid.UUID) -> Account:
        account = await self._accounts.get(workspace_id, account_id)
        if account is None:
            raise AccountNotFoundError
        return account

    async def _get_category(self, workspace_id: uuid.UUID, category_id: uuid.UUID) -> Category:
        category = await self._categories.get(workspace_id, category_id)
        if category is None:
            raise CategoryNotFoundError
        return category

    async def _check_name_free(
        self,
        workspace_id: uuid.UUID,
        category_type: CategoryType,
        name: str,
        except_id: uuid.UUID | None,
    ) -> None:
        """Category names are unique per type regardless of case, so "Rent" and "rent" can't
        both exist. The database's constraint, which compares exactly, catches races. The
        built-in categories are seeded first, so a custom category can't take one's place."""
        for category in await self.categories(workspace_id):
            if (
                category.id != except_id
                and category.type == category_type
                and category.name.casefold() == name.casefold()
            ):
                raise _duplicate_category()

    async def _save_account_if_changed(self, account: Account, updated: Account) -> None:
        if updated == account:
            return
        await self._accounts.save(replace(updated, updated_at=self._clock()))
        await self._unit_of_work.commit()

    async def _usable_account(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID, previous_ids: set[uuid.UUID]
    ) -> Account:
        account = await self._accounts.get(workspace_id, account_id)
        if account is None:
            # The same answer whether the account doesn't exist or is in another workspace.
            raise InvalidTransactionError("That account doesn't exist in this workspace.")
        # An archived account takes no new transactions, but one already on it can still be
        # corrected without moving it elsewhere.
        if account.archived_at is not None and account_id not in previous_ids:
            raise InvalidTransactionError(
                f"“{account.name}” is archived. Restore it to record transactions on it."
            )
        return account

    async def _check(
        self, workspace_id: uuid.UUID, draft: TransactionDraft, previous: Transaction | None
    ) -> Currency:
        """The currency of a transaction with these fields, which is its account's, if it
        follows every rule; otherwise raises `InvalidTransactionError`."""
        previous_ids: set[uuid.UUID] = set()
        if previous is not None:
            previous_ids = {previous.account_id}
            if previous.to_account_id is not None:
                previous_ids.add(previous.to_account_id)

        account = await self._usable_account(workspace_id, draft.account_id, previous_ids)

        if draft.type == "transfer":
            if draft.to_account_id is None:
                raise InvalidTransactionError("A transfer needs an account to move money to.")
            if draft.to_account_id == draft.account_id:
                raise InvalidTransactionError("Choose two different accounts for a transfer.")
            if draft.category_id is not None:
                raise InvalidTransactionError(
                    "Transfers aren't income or spending, so they don't have a category."
                )
            destination = await self._usable_account(
                workspace_id, draft.to_account_id, previous_ids
            )
            if destination.currency != account.currency:
                raise InvalidTransactionError(
                    "Both accounts in a transfer must use the same currency."
                )
        else:
            if draft.to_account_id is not None:
                raise InvalidTransactionError("Only transfers move money to a second account.")
            if draft.category_id is not None:
                category = await self._categories.get(workspace_id, draft.category_id)
                if category is None:
                    raise InvalidTransactionError("That category doesn't exist in this workspace.")
                expected: CategoryType = "income" if draft.type == "income" else "expense"
                if category.type != expected:
                    raise InvalidTransactionError(
                        "Choose an income category for income."
                        if expected == "income"
                        else "Choose an expense category for expenses and refunds."
                    )

        return account.currency


def _duplicate_category() -> CategoryConflictError:
    return CategoryConflictError("A category with that name already exists.")


def _category_in_use() -> CategoryConflictError:
    return CategoryConflictError(
        "Transactions use this category. Move them to another category first."
    )
