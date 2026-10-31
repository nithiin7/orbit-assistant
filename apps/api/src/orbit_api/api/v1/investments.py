"""Investments in a workspace: investment accounts, holdings and prices, investment transactions,
SIP plans, fixed and recurring deposits, and the portfolio summary. Every route authorizes the
workspace through `WorkspaceDep` first.

Holdings and amounts are personal data, so routes log nothing about them.
"""

import uuid
from collections.abc import Awaitable
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import InvestmentServiceDep
from orbit_api.api.v1.commitments import local_today
from orbit_api.schemas.commitments import TodayParams
from orbit_api.schemas.investments import (
    CloseDepositRequest,
    CreateDepositRequest,
    CreateHoldingRequest,
    CreateInvestmentAccountRequest,
    CreateSipPlanRequest,
    DeleteInvestmentTransactionParams,
    DepositContributionRequest,
    DepositListResponse,
    DepositResponse,
    DepositValueRequest,
    HoldingListResponse,
    HoldingResponse,
    InvestmentAccountListResponse,
    InvestmentAccountResponse,
    InvestmentTransactionListResponse,
    InvestmentTransactionParams,
    InvestmentTransactionResponse,
    PortfolioParams,
    PortfolioResponse,
    PriceListResponse,
    PriceResponse,
    RecordInvestmentTransactionRequest,
    RecordPriceRequest,
    RecordSipInstallmentRequest,
    SipPlanListResponse,
    SipPlanResponse,
    UpdateDepositRequest,
    UpdateHoldingRequest,
    UpdateInvestmentAccountRequest,
    UpdateSipPlanRequest,
)
from orbit_api.services.finance.models import InvalidTransactionError
from orbit_api.services.investments.models import (
    DepositNotFoundError,
    HoldingNotFoundError,
    InvalidInvestmentError,
    InvestmentAccountNotFoundError,
    InvestmentConflictError,
    InvestmentTransactionDraft,
    InvestmentTransactionNotFoundError,
    PriceNotFoundError,
    SipPlanNotFoundError,
)
from orbit_api.services.investments.quantities import parse_price, parse_quantity

router = APIRouter(
    prefix="/workspaces/{workspace_id}/finance",
    tags=["finance investments"],
    responses={
        401: {"description": "Not signed in."},
        404: {
            "description": "The workspace, investment account, holding, transaction, SIP, or "
            "deposit does not exist or is not accessible."
        },
    },
)

AccountId = Annotated[uuid.UUID, Path(description="The investment account's finance account ID.")]
HoldingId = Annotated[uuid.UUID, Path(description="The holding's ID.")]
TransactionId = Annotated[uuid.UUID, Path(description="The investment transaction's ID.")]
PlanId = Annotated[uuid.UUID, Path(description="The SIP plan's ID.")]
DepositId = Annotated[uuid.UUID, Path(description="The deposit's ID.")]

_RULES: dict[int | str, dict[str, Any]] = {
    409: {"description": "A duplicate, or history that depends on it."},
    422: {
        "description": "Invalid input, or a rule broken: an account, holding, or deposit outside "
        "this workspace, a currency mismatch, or selling more units than were held."
    },
}

_NOT_FOUND: dict[type[Exception], str] = {
    InvestmentAccountNotFoundError: "Investment account not found.",
    HoldingNotFoundError: "Holding not found.",
    InvestmentTransactionNotFoundError: "Investment transaction not found.",
    SipPlanNotFoundError: "SIP not found.",
    DepositNotFoundError: "Deposit not found.",
    PriceNotFoundError: "Price not found.",
}


async def _call[T](call: Awaitable[T]) -> T:
    """Await a service call, mapping its errors to safe HTTP responses."""
    try:
        return await call
    except InvalidInvestmentError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message) from None
    except InvalidTransactionError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message) from None
    except InvestmentConflictError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, error.message) from None
    except tuple(_NOT_FOUND) as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, _NOT_FOUND[type(error)]) from None


# Portfolio


@router.get("/portfolio", summary="Portfolio summary")
async def portfolio(
    params: Annotated[PortfolioParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> PortfolioResponse:
    """Invested amount, current value, gains, income, fees, and allocation in one currency.
    Values are as of `today`; realized gains, income, and fees cover the date range."""
    summary = await investments.portfolio(
        workspace.id,
        params.currency,
        local_today(user, params.today),
        params.date_from,
        params.date_to,
    )
    return PortfolioResponse.of(summary, params.date_from, params.date_to)


# Investment accounts


@router.get("/investment-accounts", summary="List investment accounts")
async def list_investment_accounts(
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> InvestmentAccountListResponse:
    views = await investments.accounts(workspace.id, local_today(user, params.today))
    return InvestmentAccountListResponse(
        accounts=[InvestmentAccountResponse.of(view) for view in views]
    )


@router.post(
    "/investment-accounts",
    status_code=status.HTTP_201_CREATED,
    summary="Track investments in an account",
    responses=_RULES,
)
async def create_investment_account(
    body: CreateInvestmentAccountRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> InvestmentAccountResponse:
    """Uses an existing `investment` finance account, or creates one."""
    view = await _call(
        investments.create_account(workspace.id, body.to_draft(), local_today(user, None))
    )
    return InvestmentAccountResponse.of(view)


@router.get("/investment-accounts/{account_id}", summary="Get an investment account")
async def get_investment_account(
    account_id: AccountId,
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> InvestmentAccountResponse:
    view = await _call(
        investments.account(workspace.id, account_id, local_today(user, params.today))
    )
    return InvestmentAccountResponse.of(view)


@router.patch(
    "/investment-accounts/{account_id}", summary="Update an investment account", responses=_RULES
)
async def update_investment_account(
    account_id: AccountId,
    body: UpdateInvestmentAccountRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> InvestmentAccountResponse:
    view = await _call(
        investments.update_account(
            workspace.id, account_id, body.to_changes(), local_today(user, None)
        )
    )
    return InvestmentAccountResponse.of(view)


# Holdings


@router.get("/holdings", summary="List holdings")
async def list_holdings(
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
    account_id: Annotated[uuid.UUID | None, Query()] = None,
) -> HoldingListResponse:
    """Holdings with units and cost (FIFO) and value at the latest price on or before `today`."""
    views = await investments.holdings(
        workspace.id, local_today(user, params.today), account_id=account_id
    )
    return HoldingListResponse(holdings=[HoldingResponse.of(view) for view in views])


@router.post(
    "/holdings", status_code=status.HTTP_201_CREATED, summary="Add a holding", responses=_RULES
)
async def create_holding(
    body: CreateHoldingRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> HoldingResponse:
    view = await _call(
        investments.create_holding(workspace.id, body.to_draft(), local_today(user, None))
    )
    return HoldingResponse.of(view)


@router.get("/holdings/{holding_id}", summary="Get a holding")
async def get_holding(
    holding_id: HoldingId,
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> HoldingResponse:
    view = await _call(
        investments.holding(workspace.id, holding_id, local_today(user, params.today))
    )
    return HoldingResponse.of(view)


@router.patch("/holdings/{holding_id}", summary="Update a holding", responses=_RULES)
async def update_holding(
    holding_id: HoldingId,
    body: UpdateHoldingRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> HoldingResponse:
    view = await _call(
        investments.update_holding(
            workspace.id, holding_id, body.to_changes(), local_today(user, None)
        )
    )
    return HoldingResponse.of(view)


@router.delete(
    "/holdings/{holding_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a holding without transactions",
    responses=_RULES,
)
async def delete_holding(
    holding_id: HoldingId, workspace: WorkspaceDep, investments: InvestmentServiceDep
) -> Response:
    await _call(investments.delete_holding(workspace.id, holding_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/holdings/{holding_id}/prices", summary="A holding's price history")
async def list_prices(
    holding_id: HoldingId, workspace: WorkspaceDep, investments: InvestmentServiceDep
) -> PriceListResponse:
    prices = await _call(investments.prices(workspace.id, holding_id))
    return PriceListResponse(prices=[PriceResponse.of(price) for price in prices])


@router.post("/holdings/{holding_id}/prices", summary="Record a price by hand", responses=_RULES)
async def record_price(
    holding_id: HoldingId,
    body: RecordPriceRequest,
    workspace: WorkspaceDep,
    investments: InvestmentServiceDep,
) -> PriceResponse:
    """Replaces any price already recorded on that date."""
    price = await _call(
        investments.record_price(workspace.id, holding_id, body.price_date, parse_price(body.price))
    )
    return PriceResponse.of(price)


@router.delete(
    "/holdings/{holding_id}/prices/{price_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a price",
)
async def delete_price(
    holding_id: HoldingId,
    price_id: Annotated[uuid.UUID, Path()],
    workspace: WorkspaceDep,
    investments: InvestmentServiceDep,
) -> Response:
    await _call(investments.delete_price(workspace.id, holding_id, price_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Transactions


@router.get("/investment-transactions", summary="Investment activity")
async def list_investment_transactions(
    params: Annotated[InvestmentTransactionParams, Query()],
    workspace: WorkspaceDep,
    investments: InvestmentServiceDep,
) -> InvestmentTransactionListResponse:
    page = await investments.transactions(workspace.id, params.to_query())
    return InvestmentTransactionListResponse(
        transactions=[InvestmentTransactionResponse.of(entry) for entry in page.transactions],
        total=page.total,
    )


@router.post(
    "/investment-transactions",
    status_code=status.HTTP_201_CREATED,
    summary="Record an investment transaction",
    responses=_RULES,
)
async def record_investment_transaction(
    body: RecordInvestmentTransactionRequest,
    workspace: WorkspaceDep,
    investments: InvestmentServiceDep,
) -> InvestmentTransactionResponse:
    """Records the transaction and its ledger rows (a transfer, income, or expenses) in one
    step."""
    entry = await _call(investments.record(workspace.id, body.to_draft()))
    return InvestmentTransactionResponse.of(entry)


@router.get("/investment-transactions/{transaction_id}", summary="Get an investment transaction")
async def get_investment_transaction(
    transaction_id: TransactionId, workspace: WorkspaceDep, investments: InvestmentServiceDep
) -> InvestmentTransactionResponse:
    entry = await _call(investments.transaction(workspace.id, transaction_id))
    return InvestmentTransactionResponse.of(entry)


@router.delete(
    "/investment-transactions/{transaction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an investment transaction",
    responses=_RULES,
)
async def delete_investment_transaction(
    transaction_id: TransactionId,
    params: Annotated[DeleteInvestmentTransactionParams, Query()],
    workspace: WorkspaceDep,
    investments: InvestmentServiceDep,
) -> Response:
    """A buy that later sales depend on can't be deleted (409)."""
    await _call(
        investments.delete_transaction(
            workspace.id, transaction_id, delete_ledger=params.delete_ledger
        )
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# SIP plans


@router.get("/sip-plans", summary="List SIP plans")
async def list_sip_plans(
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
    holding_id: Annotated[uuid.UUID | None, Query()] = None,
) -> SipPlanListResponse:
    views = await investments.sip_plans(
        workspace.id, local_today(user, params.today), holding_id=holding_id
    )
    return SipPlanListResponse(plans=[SipPlanResponse.of(view) for view in views])


@router.post(
    "/sip-plans", status_code=status.HTTP_201_CREATED, summary="Schedule a SIP", responses=_RULES
)
async def create_sip_plan(
    body: CreateSipPlanRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> SipPlanResponse:
    """A schedule of expected buys. Nothing is invested until an installment is recorded."""
    view = await _call(
        investments.create_sip(workspace.id, body.to_draft(), local_today(user, None))
    )
    return SipPlanResponse.of(view)


@router.patch("/sip-plans/{plan_id}", summary="Change, pause, or resume a SIP", responses=_RULES)
async def update_sip_plan(
    plan_id: PlanId,
    body: UpdateSipPlanRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> SipPlanResponse:
    view = await _call(
        investments.update_sip(workspace.id, plan_id, body.to_changes(), local_today(user, None))
    )
    return SipPlanResponse.of(view)


@router.post(
    "/sip-plans/{plan_id}/installments",
    status_code=status.HTTP_201_CREATED,
    summary="Record a SIP installment",
    responses=_RULES,
)
async def record_sip_installment(
    plan_id: PlanId,
    body: RecordSipInstallmentRequest,
    workspace: WorkspaceDep,
    investments: InvestmentServiceDep,
) -> InvestmentTransactionResponse:
    """Records a buy for the SIP's next unrecorded date (or `due_date`). Each date is recorded
    once (409 otherwise)."""
    entry = await _call(
        investments.record_sip_installment(
            workspace.id,
            plan_id,
            trade_date=body.trade_date,
            quantity=parse_quantity(body.quantity),
            amount=body.amount,
            due_date=body.due_date,
            settlement=body.settlement,
            cash_account_id=body.cash_account_id,
            fees=body.fees,
            notes=body.notes,
        )
    )
    return InvestmentTransactionResponse.of(entry)


# Deposits


@router.get("/deposits", summary="List fixed and recurring deposits")
async def list_deposits(
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> DepositListResponse:
    views = await investments.deposits(workspace.id, local_today(user, params.today))
    return DepositListResponse(deposits=[DepositResponse.of(view) for view in views])


@router.post(
    "/deposits", status_code=status.HTTP_201_CREATED, summary="Open a deposit", responses=_RULES
)
async def create_deposit(
    body: CreateDepositRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> DepositResponse:
    view = await _call(
        investments.create_deposit(
            workspace.id, body.to_draft(user.timezone), local_today(user, None)
        )
    )
    return DepositResponse.of(view)


@router.get("/deposits/{deposit_id}", summary="Get a deposit")
async def get_deposit(
    deposit_id: DepositId,
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> DepositResponse:
    view = await _call(
        investments.deposit(workspace.id, deposit_id, local_today(user, params.today))
    )
    return DepositResponse.of(view)


@router.patch("/deposits/{deposit_id}", summary="Update a deposit", responses=_RULES)
async def update_deposit(
    deposit_id: DepositId,
    body: UpdateDepositRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> DepositResponse:
    view = await _call(
        investments.update_deposit(
            workspace.id, deposit_id, body.to_changes(user.timezone), local_today(user, None)
        )
    )
    return DepositResponse.of(view)


@router.post(
    "/deposits/{deposit_id}/contributions",
    status_code=status.HTTP_201_CREATED,
    summary="Record money put into a deposit",
    responses=_RULES,
)
async def contribute_to_deposit(
    deposit_id: DepositId,
    body: DepositContributionRequest,
    workspace: WorkspaceDep,
    investments: InvestmentServiceDep,
) -> InvestmentTransactionResponse:
    entry = await _call(
        investments.record(
            workspace.id,
            InvestmentTransactionDraft(
                type="deposit",
                trade_date=body.trade_date,
                amount=body.amount,
                settlement=body.settlement,
                deposit_id=deposit_id,
                cash_account_id=body.cash_account_id,
                notes=body.notes,
            ),
        )
    )
    return InvestmentTransactionResponse.of(entry)


@router.put(
    "/deposits/{deposit_id}/value", summary="Set a deposit's value by hand", responses=_RULES
)
async def value_deposit(
    deposit_id: DepositId,
    body: DepositValueRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> DepositResponse:
    today = local_today(user, None)
    view = await _call(
        investments.value_deposit(
            workspace.id, deposit_id, body.value, body.valued_on or today, today
        )
    )
    return DepositResponse.of(view)


@router.post("/deposits/{deposit_id}/close", summary="Close a deposit", responses=_RULES)
async def close_deposit(
    deposit_id: DepositId,
    body: CloseDepositRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> DepositResponse:
    """Records the principal returned and any interest as income, in one step."""
    view = await _call(
        investments.close_deposit(
            workspace.id, deposit_id, body.to_closure(), local_today(user, None)
        )
    )
    return DepositResponse.of(view)


@router.post("/deposits/{deposit_id}/reopen", summary="Undo a deposit's closure", responses=_RULES)
async def reopen_deposit(
    deposit_id: DepositId,
    params: Annotated[DeleteInvestmentTransactionParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    investments: InvestmentServiceDep,
) -> DepositResponse:
    view = await _call(
        investments.reopen_deposit(
            workspace.id,
            deposit_id,
            delete_ledger=params.delete_ledger,
            today=local_today(user, None),
        )
    )
    return DepositResponse.of(view)
