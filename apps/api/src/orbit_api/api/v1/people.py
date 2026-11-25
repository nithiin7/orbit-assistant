"""People in a workspace and their yearly dates. Every route authorizes the workspace through
`WorkspaceDep` first."""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import PeopleLedgerServiceDep, PeopleServiceDep
from orbit_api.schemas.people import (
    CreatePersonLedgerEntryRequest,
    CreatePersonRequest,
    PeopleResponse,
    PersonLedgerEntryResponse,
    PersonLedgerResponse,
    PersonResponse,
    UpdatePersonLedgerEntryRequest,
    UpdatePersonRequest,
)
from orbit_api.services.finance.models import CategoryNotFoundError, InvalidTransactionError
from orbit_api.services.people.models import (
    LedgerEntryNotFoundError,
    LedgerError,
    PersonDateError,
    PersonNotFoundError,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/people",
    tags=["people"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace or person is not accessible."},
    },
)

PersonId = Annotated[uuid.UUID, Path(description="The person's ID.")]
EntryId = Annotated[uuid.UUID, Path(description="The ledger entry's ID.")]


@contextmanager
def _people_errors() -> Generator[None]:
    """Map service errors from people routes to safe HTTP responses."""
    try:
        yield
    except PersonNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Person not found.") from None
    except PersonDateError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message) from None
    except LedgerEntryNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found.") from None
    except LedgerError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message) from None
    except InvalidTransactionError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message) from None
    except CategoryNotFoundError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That category doesn't exist in this workspace."
        ) from None


# Money owed. Declared before `/{person_id}` so `ledger` isn't read as an ID.


@router.get("/ledger", summary="List money owed between you and everyone")
async def get_ledger(
    workspace: WorkspaceDep, ledger: PeopleLedgerServiceDep
) -> PersonLedgerResponse:
    return PersonLedgerResponse.of(await ledger.ledger(workspace.id))


@router.post(
    "/{person_id}/ledger",
    status_code=status.HTTP_201_CREATED,
    summary="Record money owed or repaid",
    responses={422: {"description": "A link or record that doesn't fit the entry."}},
)
async def create_ledger_entry(
    person_id: PersonId,
    body: CreatePersonLedgerEntryRequest,
    workspace: WorkspaceDep,
    ledger: PeopleLedgerServiceDep,
) -> PersonLedgerEntryResponse:
    """A share split from an expense links to it (the expense stays whole in Finance). A
    repayment with `record_in_finance` also records a refund or an expense, in one commit."""
    with _people_errors():
        entry = await ledger.add(workspace.id, person_id, body.to_draft())
    return PersonLedgerEntryResponse.of(entry)


@router.patch(
    "/{person_id}/ledger/{entry_id}",
    summary="Update money owed or repaid",
    responses={422: {"description": "A repayment recorded in Finance keeps its amount."}},
)
async def update_ledger_entry(
    person_id: PersonId,
    entry_id: EntryId,
    body: UpdatePersonLedgerEntryRequest,
    workspace: WorkspaceDep,
    ledger: PeopleLedgerServiceDep,
) -> PersonLedgerEntryResponse:
    with _people_errors():
        entry = await ledger.update(workspace.id, person_id, entry_id, body.to_changes())
    return PersonLedgerEntryResponse.of(entry)


@router.delete(
    "/{person_id}/ledger/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete money owed or repaid",
)
async def delete_ledger_entry(
    person_id: PersonId, entry_id: EntryId, workspace: WorkspaceDep, ledger: PeopleLedgerServiceDep
) -> Response:
    """A Finance transaction recorded with it stays; delete that in Finance if needed."""
    with _people_errors():
        await ledger.delete(workspace.id, person_id, entry_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# People


@router.get("", summary="List people")
async def list_people(workspace: WorkspaceDep, people: PeopleServiceDep) -> PeopleResponse:
    items = await people.people(workspace.id)
    return PeopleResponse(people=[PersonResponse.of(item) for item in items])


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Add a person",
    responses={422: {"description": "A date doesn't exist, or there are two birthdays."}},
)
async def create_person(
    body: CreatePersonRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    people: PeopleServiceDep,
) -> PersonResponse:
    """Dates with `remind_days_before` share one reminder, managed here, that announces the
    soonest one. Reminders carry the name and date only."""
    with _people_errors():
        return PersonResponse.of(await people.add(workspace.id, body.to_draft(user.timezone)))


@router.get("/{person_id}", summary="Get a person")
async def get_person(
    person_id: PersonId, workspace: WorkspaceDep, people: PeopleServiceDep
) -> PersonResponse:
    with _people_errors():
        return PersonResponse.of(await people.get(workspace.id, person_id))


@router.patch(
    "/{person_id}",
    summary="Update a person",
    responses={422: {"description": "A date doesn't exist, or there are two birthdays."}},
)
async def update_person(
    person_id: PersonId,
    body: UpdatePersonRequest,
    workspace: WorkspaceDep,
    people: PeopleServiceDep,
) -> PersonResponse:
    with _people_errors():
        return PersonResponse.of(await people.update(workspace.id, person_id, body.to_changes()))


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a person")
async def delete_person(
    person_id: PersonId, workspace: WorkspaceDep, people: PeopleServiceDep
) -> Response:
    """Deletes their dates and their reminder too; notifications already delivered stay."""
    with _people_errors():
        await people.delete(workspace.id, person_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
