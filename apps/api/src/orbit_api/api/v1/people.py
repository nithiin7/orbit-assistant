"""People in a workspace and their yearly dates. Every route authorizes the workspace through
`WorkspaceDep` first."""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import PeopleServiceDep
from orbit_api.schemas.people import (
    CreatePersonRequest,
    PeopleResponse,
    PersonResponse,
    UpdatePersonRequest,
)
from orbit_api.services.people.models import PersonDateError, PersonNotFoundError

router = APIRouter(
    prefix="/workspaces/{workspace_id}/people",
    tags=["people"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace or person is not accessible."},
    },
)

PersonId = Annotated[uuid.UUID, Path(description="The person's ID.")]


@contextmanager
def _people_errors() -> Generator[None]:
    """Map service errors from people routes to safe HTTP responses."""
    try:
        yield
    except PersonNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Person not found.") from None
    except PersonDateError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message) from None


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
