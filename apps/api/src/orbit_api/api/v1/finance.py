"""Finance in a workspace: accounts, categories, transactions, reports, and CSV export. Every
route authorizes the workspace through `WorkspaceDep` first.

Transaction details are personal data, so routes log nothing about them.
"""

import uuid
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import WorkspaceDep
from orbit_api.api.dependencies import FinanceServiceDep
from orbit_api.schemas.finance import (
    AccountListResponse,
    AccountResponse,
    BalanceTotalsResponse,
    CategoryListResponse,
    CategoryResponse,
    CategorySpendingResponse,
    CreateAccountRequest,
    CreateCategoryRequest,
    CreateTransactionRequest,
    CreateTransferRequest,
    DateRangeParams,
    MonthCashFlowResponse,
    MonthlySummaryResponse,
    RenameCategoryRequest,
    ReportParams,
    SpendingResponse,
    TransactionListParams,
    TransactionListResponse,
    TransactionResponse,
    TrendParams,
    TrendResponse,
    UpdateAccountRequest,
    UpdateTransactionRequest,
    format_month,
    parse_month,
)
from orbit_api.services.finance.export import transactions_csv
from orbit_api.services.finance.models import (
    AccountNotFoundError,
    CategoryConflictError,
    CategoryNotFoundError,
    InvalidTransactionError,
    TransactionInUseError,
    TransactionNotFoundError,
    TransactionQuery,
)
from orbit_api.services.finance.money import month_bounds
from orbit_api.services.finance.service import balance_totals

router = APIRouter(
    prefix="/workspaces/{workspace_id}/finance",
    tags=["finance"],
    responses={
        401: {"description": "Not signed in."},
        404: {
            "description": "The workspace, account, category, or transaction does not exist or "
            "is not accessible."
        },
    },
)

AccountId = Annotated[uuid.UUID, Path(description="The account's ID.")]
CategoryId = Annotated[uuid.UUID, Path(description="The category's ID.")]
TransactionId = Annotated[uuid.UUID, Path(description="The transaction's ID.")]

_INVALID_TRANSACTION: dict[int | str, dict[str, Any]] = {
    422: {
        "description": "Invalid input, or a rule broken: an account or category outside this "
        "workspace, an archived account, a transfer between currencies, or a category of the "
        "wrong type."
    }
}
_CATEGORY_CONFLICT: dict[int | str, dict[str, Any]] = {
    409: {"description": "The name is taken, or the category is built in or in use."}
}


def account_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Account not found.")


def category_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Category not found.")


def transaction_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found.")


def invalid(error: InvalidTransactionError) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message)


def conflict(error: CategoryConflictError) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, error.message)


# Accounts


@router.get("/accounts", summary="List accounts with balances")
async def list_accounts(workspace: WorkspaceDep, finance: FinanceServiceDep) -> AccountListResponse:
    """Every account, archived ones included, with balances derived from its transactions."""
    views = await finance.accounts(workspace.id)
    return AccountListResponse(
        accounts=[AccountResponse.of(view) for view in views],
        totals=[BalanceTotalsResponse.of(totals) for totals in balance_totals(views)],
    )


@router.post("/accounts", status_code=status.HTTP_201_CREATED, summary="Create an account")
async def create_account(
    body: CreateAccountRequest, workspace: WorkspaceDep, finance: FinanceServiceDep
) -> AccountResponse:
    """Track an account by hand. Orbit never asks for bank credentials or connects to banks."""
    return AccountResponse.of(await finance.create_account(workspace.id, body.to_draft()))


@router.get("/accounts/{account_id}", summary="Get an account")
async def get_account(
    account_id: AccountId, workspace: WorkspaceDep, finance: FinanceServiceDep
) -> AccountResponse:
    try:
        return AccountResponse.of(await finance.account(workspace.id, account_id))
    except AccountNotFoundError:
        raise account_not_found() from None


@router.patch("/accounts/{account_id}", summary="Update an account")
async def update_account(
    account_id: AccountId,
    body: UpdateAccountRequest,
    workspace: WorkspaceDep,
    finance: FinanceServiceDep,
) -> AccountResponse:
    try:
        return AccountResponse.of(
            await finance.update_account(workspace.id, account_id, body.to_changes())
        )
    except AccountNotFoundError:
        raise account_not_found() from None


@router.post("/accounts/{account_id}/archive", summary="Archive an account")
async def archive_account(
    account_id: AccountId, workspace: WorkspaceDep, finance: FinanceServiceDep
) -> AccountResponse:
    """Stop recording new transactions on the account. Its history and balance stay.
    Idempotent."""
    try:
        return AccountResponse.of(await finance.archive_account(workspace.id, account_id))
    except AccountNotFoundError:
        raise account_not_found() from None


@router.post("/accounts/{account_id}/restore", summary="Restore an archived account")
async def restore_account(
    account_id: AccountId, workspace: WorkspaceDep, finance: FinanceServiceDep
) -> AccountResponse:
    try:
        return AccountResponse.of(await finance.restore_account(workspace.id, account_id))
    except AccountNotFoundError:
        raise account_not_found() from None


# Categories


@router.get("/categories", summary="List categories")
async def list_categories(
    workspace: WorkspaceDep, finance: FinanceServiceDep
) -> CategoryListResponse:
    """The workspace's income and expense categories. Built-in ones are added the first time
    they're read."""
    categories = await finance.categories(workspace.id)
    return CategoryListResponse(categories=[CategoryResponse.of(entry) for entry in categories])


@router.post(
    "/categories",
    status_code=status.HTTP_201_CREATED,
    summary="Create a category",
    responses=_CATEGORY_CONFLICT,
)
async def create_category(
    body: CreateCategoryRequest, workspace: WorkspaceDep, finance: FinanceServiceDep
) -> CategoryResponse:
    try:
        return CategoryResponse.of(
            await finance.create_category(workspace.id, body.name, body.type)
        )
    except CategoryConflictError as error:
        raise conflict(error) from None


@router.patch(
    "/categories/{category_id}", summary="Rename a category", responses=_CATEGORY_CONFLICT
)
async def rename_category(
    category_id: CategoryId,
    body: RenameCategoryRequest,
    workspace: WorkspaceDep,
    finance: FinanceServiceDep,
) -> CategoryResponse:
    try:
        return CategoryResponse.of(
            await finance.rename_category(workspace.id, category_id, body.name)
        )
    except CategoryNotFoundError:
        raise category_not_found() from None
    except CategoryConflictError as error:
        raise conflict(error) from None


@router.delete(
    "/categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a category",
    responses=_CATEGORY_CONFLICT,
)
async def delete_category(
    category_id: CategoryId, workspace: WorkspaceDep, finance: FinanceServiceDep
) -> Response:
    """Delete one of your own categories that no transaction uses."""
    try:
        await finance.delete_category(workspace.id, category_id)
    except CategoryNotFoundError:
        raise category_not_found() from None
    except CategoryConflictError as error:
        raise conflict(error) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Transactions


@router.get("/transactions", summary="List transactions")
async def list_transactions(
    params: Annotated[TransactionListParams, Query()],
    workspace: WorkspaceDep,
    finance: FinanceServiceDep,
) -> TransactionListResponse:
    """Filter by date range, type, account, and category, search descriptions and notes, and
    sort by date or amount."""
    page = await finance.find(workspace.id, params.to_query())
    return TransactionListResponse(
        transactions=[TransactionResponse.of(entry) for entry in page.transactions],
        total=page.total,
    )


@router.post(
    "/transactions",
    status_code=status.HTTP_201_CREATED,
    summary="Record a transaction",
    responses=_INVALID_TRANSACTION,
)
async def create_transaction(
    body: CreateTransactionRequest, workspace: WorkspaceDep, finance: FinanceServiceDep
) -> TransactionResponse:
    try:
        return TransactionResponse.of(await finance.create(workspace.id, body.to_draft()))
    except InvalidTransactionError as error:
        raise invalid(error) from None


@router.get(
    "/transactions/export",
    summary="Export transactions as CSV",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}, "description": "A CSV file."}},
)
async def export_transactions(
    params: Annotated[DateRangeParams, Query()], workspace: WorkspaceDep, finance: FinanceServiceDep
) -> Response:
    """Every transaction in the inclusive date range (or all of them), oldest first. Amounts are
    positive decimal text in the major unit, beside their currency."""
    transactions, accounts, categories = await finance.export(
        workspace.id, params.date_from, params.date_to
    )
    span = "-".join(
        value.isoformat() for value in (params.date_from, params.date_to) if value is not None
    )
    filename = f"orbit-transactions{'-' + span if span else ''}.csv"
    return Response(
        content=transactions_csv(transactions, accounts, categories),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Financial data: never keep a copy in shared or browser caches.
            "Cache-Control": "no-store",
        },
    )


@router.get("/transactions/{transaction_id}", summary="Get a transaction")
async def get_transaction(
    transaction_id: TransactionId, workspace: WorkspaceDep, finance: FinanceServiceDep
) -> TransactionResponse:
    try:
        return TransactionResponse.of(await finance.get(workspace.id, transaction_id))
    except TransactionNotFoundError:
        raise transaction_not_found() from None


@router.patch(
    "/transactions/{transaction_id}",
    summary="Correct a transaction",
    responses=_INVALID_TRANSACTION,
)
async def update_transaction(
    transaction_id: TransactionId,
    body: UpdateTransactionRequest,
    workspace: WorkspaceDep,
    finance: FinanceServiceDep,
) -> TransactionResponse:
    """Balances and reports are derived from transactions, so they follow automatically."""
    try:
        return TransactionResponse.of(
            await finance.update(workspace.id, transaction_id, body.to_changes())
        )
    except TransactionNotFoundError:
        raise transaction_not_found() from None
    except InvalidTransactionError as error:
        raise invalid(error) from None


@router.delete(
    "/transactions/{transaction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a transaction",
    responses={409: {"description": "The transaction records a commitment payment."}},
)
async def delete_transaction(
    transaction_id: TransactionId, workspace: WorkspaceDep, finance: FinanceServiceDep
) -> Response:
    """Permanently delete a transaction, removing it from balances and reports. A transaction
    that records a loan, subscription, or bill payment can't be deleted until that payment is
    undone (409)."""
    try:
        await finance.delete(workspace.id, transaction_id)
    except TransactionNotFoundError:
        raise transaction_not_found() from None
    except TransactionInUseError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This transaction records a loan, subscription, or bill payment. Undo that payment "
            "first.",
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Transfers: transactions of type `transfer`, with request fields named for the movement.


@router.get("/transfers", summary="List transfers")
async def list_transfers(
    params: Annotated[DateRangeParams, Query()],
    workspace: WorkspaceDep,
    finance: FinanceServiceDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> TransactionListResponse:
    """Transfers between accounts, newest first. The same as listing transactions with
    `type=transfer`."""
    page = await finance.find(
        workspace.id,
        TransactionQuery(
            types=frozenset({"transfer"}),
            date_from=params.date_from,
            date_to=params.date_to,
            limit=limit,
            offset=offset,
        ),
    )
    return TransactionListResponse(
        transactions=[TransactionResponse.of(entry) for entry in page.transactions],
        total=page.total,
    )


@router.post(
    "/transfers",
    status_code=status.HTTP_201_CREATED,
    summary="Transfer between accounts",
    responses=_INVALID_TRANSACTION,
)
async def create_transfer(
    body: CreateTransferRequest, workspace: WorkspaceDep, finance: FinanceServiceDep
) -> TransactionResponse:
    try:
        return TransactionResponse.of(await finance.create(workspace.id, body.to_draft()))
    except InvalidTransactionError as error:
        raise invalid(error) from None


# Reports


@router.get("/summary", summary="Monthly income, spending, and savings")
async def monthly_summary(
    params: Annotated[ReportParams, Query()], workspace: WorkspaceDep, finance: FinanceServiceDep
) -> MonthlySummaryResponse:
    """Totals for one calendar month in one currency. Transfers are excluded; refunds reduce
    spending."""
    month = parse_month(params.month)
    cash_flow = await finance.cash_flow(workspace.id, params.currency, month)
    return MonthlySummaryResponse.of(month, params.currency, cash_flow)


@router.get("/trend", summary="Income and spending per month")
async def monthly_trend(
    params: Annotated[TrendParams, Query()], workspace: WorkspaceDep, finance: FinanceServiceDep
) -> TrendResponse:
    months = await finance.monthly_cash_flow(
        workspace.id, params.currency, parse_month(params.month), params.months
    )
    return TrendResponse(
        currency=params.currency, months=[MonthCashFlowResponse.of(entry) for entry in months]
    )


@router.get("/spending", summary="Spending by category")
async def spending_by_category(
    params: Annotated[ReportParams, Query()], workspace: WorkspaceDep, finance: FinanceServiceDep
) -> SpendingResponse:
    """Net spending (expenses minus refunds) per category for one calendar month."""
    month: date = parse_month(params.month)
    start, end = month_bounds(month)
    spending = await finance.spending_by_category(workspace.id, params.currency, start, end)
    return SpendingResponse(
        month=format_month(month),
        currency=params.currency,
        total=sum(entry.net for entry in spending),
        categories=[CategorySpendingResponse.of(entry) for entry in spending],
    )
