"""Financial commitments in a workspace: loans and EMI schedules, subscriptions and bills, their
payments, upcoming payments, and the dashboard summary. Every route authorizes the workspace
through `WorkspaceDep` first.

Payment details are personal data, so routes log nothing about them.
"""

import uuid
from collections.abc import Awaitable
from datetime import date, timedelta
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import CommitmentServiceDep
from orbit_api.schemas.commitments import (
    PAYMENT_RANGE_MAX_DAYS,
    CommitmentSummaryParams,
    CommitmentSummaryResponse,
    CreateLoanRequest,
    CreateRecurringPaymentRequest,
    InstallmentResponse,
    LoanDetailResponse,
    LoanListResponse,
    LoanResponse,
    PayInstallmentRequest,
    PaymentItemResponse,
    PaymentListParams,
    PaymentListResponse,
    RecordRecurringPaymentRequest,
    RecurringListParams,
    RecurringPaymentListResponse,
    RecurringPaymentResponse,
    RescheduleLoanRequest,
    SettledOccurrenceListResponse,
    SettledOccurrenceResponse,
    SkipOccurrenceRequest,
    TodayParams,
    UndoOccurrenceParams,
    UndoPaymentParams,
    UpdateInstallmentRequest,
    UpdateLoanRequest,
    UpdateRecurringPaymentRequest,
)
from orbit_api.services.accounts.models import User
from orbit_api.services.commitments.models import (
    Installment,
    InstallmentNotFoundError,
    InvalidCommitmentError,
    LoanNotFoundError,
    OccurrenceNotFoundError,
    PaymentConflictError,
    PaymentQuery,
    RecurringPaymentNotFoundError,
)
from orbit_api.utils.clock import utc_now

router = APIRouter(
    prefix="/workspaces/{workspace_id}/finance",
    tags=["finance commitments"],
    responses={
        401: {"description": "Not signed in."},
        404: {
            "description": "The workspace, loan, installment, subscription, or bill does not "
            "exist or is not accessible."
        },
    },
)

LoanId = Annotated[uuid.UUID, Path(description="The loan's ID.")]
InstallmentId = Annotated[uuid.UUID, Path(description="The installment's ID.")]
RecurringId = Annotated[uuid.UUID, Path(description="The subscription's or bill's ID.")]
OccurrenceId = Annotated[uuid.UUID, Path(description="The settled occurrence's ID.")]

_RULES: dict[int | str, dict[str, Any]] = {
    409: {"description": "Already paid or skipped, or the transaction pays something else."},
    422: {
        "description": "Invalid input, or a rule broken: an account, category, or transaction "
        "outside this workspace, a currency mismatch, or terms that can't be repaid."
    },
}


def local_today(user: User, given: date | None) -> date:
    """The date the client sent, else today in the user's time zone preference, else UTC."""
    if given is not None:
        return given
    return utc_now().astimezone(ZoneInfo(user.timezone or "UTC")).date()


def invalid(error: InvalidCommitmentError) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message)


def conflict(error: PaymentConflictError) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, error.message)


def loan_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Loan not found.")


def installment_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Installment not found.")


def recurring_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Subscription or bill not found.")


# Loans


@router.get("/loans", summary="List loans")
async def list_loans(
    workspace: WorkspaceDep, commitments: CommitmentServiceDep
) -> LoanListResponse:
    """Every loan with its outstanding principal, derived from its loan account's ledger."""
    return LoanListResponse(
        loans=[LoanResponse.of(view) for view in await commitments.loans(workspace.id)]
    )


@router.post("/loans", status_code=status.HTTP_201_CREATED, summary="Add a loan", responses=_RULES)
async def create_loan(
    body: CreateLoanRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> LoanResponse:
    """Creates the loan, its loan account, and the EMI schedule still ahead, in one step."""
    try:
        view = await commitments.create_loan(workspace.id, body.to_draft(user.timezone))
    except InvalidCommitmentError as error:
        raise invalid(error) from None
    return LoanResponse.of(view)


@router.get("/loans/{loan_id}", summary="Get a loan and its EMI schedule")
async def get_loan(
    loan_id: LoanId,
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> LoanDetailResponse:
    today = local_today(user, params.today)
    try:
        view = await commitments.loan(workspace.id, loan_id)
        installments = await commitments.installments(workspace.id, loan_id)
    except LoanNotFoundError:
        raise loan_not_found() from None
    return LoanDetailResponse(
        loan=LoanResponse.of(view),
        installments=[InstallmentResponse.of(entry, today) for entry in installments],
    )


@router.patch("/loans/{loan_id}", summary="Update a loan", responses=_RULES)
async def update_loan(
    loan_id: LoanId,
    body: UpdateLoanRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> LoanResponse:
    try:
        view = await commitments.update_loan(workspace.id, loan_id, body.to_changes(user.timezone))
    except LoanNotFoundError:
        raise loan_not_found() from None
    except InvalidCommitmentError as error:
        raise invalid(error) from None
    return LoanResponse.of(view)


@router.post(
    "/loans/{loan_id}/reschedule", summary="Regenerate unpaid installments", responses=_RULES
)
async def reschedule_loan(
    loan_id: LoanId,
    body: RescheduleLoanRequest,
    workspace: WorkspaceDep,
    commitments: CommitmentServiceDep,
) -> LoanResponse:
    """Replaces the scheduled installments with ones that repay what the ledger says is still
    owed. Paid and skipped installments stay as history."""
    try:
        view = await commitments.reschedule(workspace.id, loan_id, body.to_request())
    except LoanNotFoundError:
        raise loan_not_found() from None
    except InvalidCommitmentError as error:
        raise invalid(error) from None
    except PaymentConflictError as error:
        raise conflict(error) from None
    return LoanResponse.of(view)


async def _installment_call(call: Awaitable[Installment], today: date) -> InstallmentResponse:
    """Run an installment change and map its errors."""
    try:
        return InstallmentResponse.of(await call, today)
    except LoanNotFoundError:
        raise loan_not_found() from None
    except InstallmentNotFoundError:
        raise installment_not_found() from None
    except InvalidCommitmentError as error:
        raise invalid(error) from None
    except PaymentConflictError as error:
        raise conflict(error) from None


@router.patch(
    "/loans/{loan_id}/installments/{installment_id}",
    summary="Adjust a scheduled installment",
    responses=_RULES,
)
async def adjust_installment(
    loan_id: LoanId,
    installment_id: InstallmentId,
    body: UpdateInstallmentRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> InstallmentResponse:
    """Change a scheduled installment's due date or principal and interest split by hand."""
    return await _installment_call(
        commitments.adjust_installment(workspace.id, loan_id, installment_id, body.to_changes()),
        local_today(user, None),
    )


@router.post(
    "/loans/{loan_id}/installments/{installment_id}/pay",
    summary="Record an EMI payment",
    responses=_RULES,
)
async def pay_installment(
    loan_id: LoanId,
    installment_id: InstallmentId,
    body: PayInstallmentRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> InstallmentResponse:
    """The principal becomes a transfer into the loan account (reducing what's owed, never
    spending) and the interest a "Loan interest" expense, or link transactions already
    recorded. Recorded once: paying again is a 409."""
    return await _installment_call(
        commitments.pay_installment(workspace.id, loan_id, installment_id, body.to_payment()),
        local_today(user, None),
    )


@router.post(
    "/loans/{loan_id}/installments/{installment_id}/skip",
    summary="Skip an installment",
    responses=_RULES,
)
async def skip_installment(
    loan_id: LoanId,
    installment_id: InstallmentId,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> InstallmentResponse:
    return await _installment_call(
        commitments.skip_installment(workspace.id, loan_id, installment_id),
        local_today(user, None),
    )


@router.post(
    "/loans/{loan_id}/installments/{installment_id}/undo",
    summary="Undo an installment's payment or skip",
    responses=_RULES,
)
async def undo_installment(
    loan_id: LoanId,
    installment_id: InstallmentId,
    params: Annotated[UndoPaymentParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> InstallmentResponse:
    return await _installment_call(
        commitments.undo_installment(
            workspace.id,
            loan_id,
            installment_id,
            delete_transactions=params.delete_transactions,
        ),
        local_today(user, None),
    )


# Subscriptions and bills


@router.get("/recurring-payments", summary="List subscriptions and bills")
async def list_recurring_payments(
    params: Annotated[RecurringListParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> RecurringPaymentListResponse:
    views = await commitments.recurring_payments(
        workspace.id, params.kind, local_today(user, params.today)
    )
    return RecurringPaymentListResponse(
        recurring_payments=[RecurringPaymentResponse.of(view) for view in views]
    )


@router.post(
    "/recurring-payments",
    status_code=status.HTTP_201_CREATED,
    summary="Add a subscription or bill",
    responses=_RULES,
)
async def create_recurring_payment(
    body: CreateRecurringPaymentRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> RecurringPaymentResponse:
    try:
        view = await commitments.create_recurring(
            workspace.id, body.to_draft(user.timezone), local_today(user, None)
        )
    except InvalidCommitmentError as error:
        raise invalid(error) from None
    return RecurringPaymentResponse.of(view)


@router.get("/recurring-payments/{payment_id}", summary="Get a subscription or bill")
async def get_recurring_payment(
    payment_id: RecurringId,
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> RecurringPaymentResponse:
    try:
        view = await commitments.recurring_payment(
            workspace.id, payment_id, local_today(user, params.today)
        )
    except RecurringPaymentNotFoundError:
        raise recurring_not_found() from None
    return RecurringPaymentResponse.of(view)


@router.patch(
    "/recurring-payments/{payment_id}",
    summary="Update, pause, cancel, or resume a subscription or bill",
    responses=_RULES,
)
async def update_recurring_payment(
    payment_id: RecurringId,
    body: UpdateRecurringPaymentRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> RecurringPaymentResponse:
    """Cancelling keeps every recorded payment; nothing is deleted."""
    try:
        view = await commitments.update_recurring(
            workspace.id, payment_id, body.to_changes(user.timezone), local_today(user, None)
        )
    except RecurringPaymentNotFoundError:
        raise recurring_not_found() from None
    except InvalidCommitmentError as error:
        raise invalid(error) from None
    return RecurringPaymentResponse.of(view)


@router.get("/recurring-payments/{payment_id}/occurrences", summary="Payment and renewal history")
async def list_occurrences(
    payment_id: RecurringId, workspace: WorkspaceDep, commitments: CommitmentServiceDep
) -> SettledOccurrenceListResponse:
    try:
        history = await commitments.history(workspace.id, payment_id)
    except RecurringPaymentNotFoundError:
        raise recurring_not_found() from None
    return SettledOccurrenceListResponse(
        occurrences=[SettledOccurrenceResponse.of(entry) for entry in history]
    )


@router.post(
    "/recurring-payments/{payment_id}/occurrences",
    status_code=status.HTTP_201_CREATED,
    summary="Record a payment or renewal",
    responses=_RULES,
)
async def record_recurring_payment(
    payment_id: RecurringId,
    body: RecordRecurringPaymentRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> SettledOccurrenceResponse:
    """Each due date can be settled once; recording it again is a 409."""
    try:
        occurrence = await commitments.record_payment(
            workspace.id, payment_id, body.to_record(), local_today(user, None)
        )
    except RecurringPaymentNotFoundError:
        raise recurring_not_found() from None
    except InvalidCommitmentError as error:
        raise invalid(error) from None
    except PaymentConflictError as error:
        raise conflict(error) from None
    return SettledOccurrenceResponse.of(occurrence)


@router.post(
    "/recurring-payments/{payment_id}/occurrences/skip",
    status_code=status.HTTP_201_CREATED,
    summary="Skip a payment or renewal",
    responses=_RULES,
)
async def skip_recurring_occurrence(
    payment_id: RecurringId,
    body: SkipOccurrenceRequest,
    workspace: WorkspaceDep,
    commitments: CommitmentServiceDep,
) -> SettledOccurrenceResponse:
    try:
        occurrence = await commitments.skip_occurrence(workspace.id, payment_id, body.due_date)
    except RecurringPaymentNotFoundError:
        raise recurring_not_found() from None
    except InvalidCommitmentError as error:
        raise invalid(error) from None
    except PaymentConflictError as error:
        raise conflict(error) from None
    return SettledOccurrenceResponse.of(occurrence)


@router.delete(
    "/recurring-payments/{payment_id}/occurrences/{occurrence_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Undo a recorded payment or skip",
)
async def undo_recurring_occurrence(
    payment_id: RecurringId,
    occurrence_id: OccurrenceId,
    params: Annotated[UndoOccurrenceParams, Query()],
    workspace: WorkspaceDep,
    commitments: CommitmentServiceDep,
) -> Response:
    """The payment becomes expected again. Its expense stays in the ledger unless
    `delete_transaction` is set."""
    try:
        await commitments.undo_occurrence(
            workspace.id,
            payment_id,
            occurrence_id,
            delete_transaction=params.delete_transaction,
        )
    except RecurringPaymentNotFoundError:
        raise recurring_not_found() from None
    except OccurrenceNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found.") from None
    except PaymentConflictError as error:
        raise conflict(error) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Upcoming payments and the dashboard


@router.get("/payments", summary="Upcoming, due, overdue, and recent payments")
async def list_payments(
    params: Annotated[PaymentListParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> PaymentListResponse:
    """Loan EMIs, subscription renewals, and bills in one list, by due date. Expected payments
    are not spending until recorded."""
    today = local_today(user, params.today)
    date_from = params.date_from or today - timedelta(days=30)
    date_to = params.date_to or today + timedelta(days=30)
    if date_from > date_to:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "date_from must be on or before date_to."
        )
    if (date_to - date_from).days > PAYMENT_RANGE_MAX_DAYS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Choose a range of at most {PAYMENT_RANGE_MAX_DAYS} days.",
        )
    items = await commitments.payments(
        workspace.id,
        PaymentQuery(
            today=today,
            date_from=date_from,
            date_to=date_to,
            kinds=frozenset(params.kind),
            statuses=frozenset(params.status),
            include_overdue=params.include_overdue,
        ),
    )
    return PaymentListResponse(
        today=today,
        date_from=date_from,
        date_to=date_to,
        payments=[PaymentItemResponse.of(item) for item in items],
    )


@router.get("/commitments/summary", summary="Commitment totals for the dashboard")
async def commitment_summary(
    params: Annotated[CommitmentSummaryParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    commitments: CommitmentServiceDep,
) -> CommitmentSummaryResponse:
    """Outstanding loans, monthly EMIs and subscriptions, bills due soon, what's left to pay this
    month, and what's overdue, in one currency."""
    today = local_today(user, params.today)
    summary = await commitments.summary(workspace.id, params.currency, today)
    return CommitmentSummaryResponse.of(summary, today)
