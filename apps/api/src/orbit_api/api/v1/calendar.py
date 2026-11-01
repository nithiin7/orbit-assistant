"""The calendar in a workspace: categories, events and recurring series, their occurrences, links
to notes and tasks, date ranges, and the agenda. Every route authorizes the workspace through
`WorkspaceDep` first; preferences belong to the signed-in user."""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import (
    CalendarPreferenceServiceDep,
    CalendarServiceDep,
    NoteServiceDep,
)
from orbit_api.schemas.calendar import (
    AgendaItemResponse,
    AgendaParams,
    AgendaResponse,
    CalendarCategoryListResponse,
    CalendarCategoryResponse,
    CalendarPreferencesModel,
    CalendarPreferencesResponse,
    CalendarRangeParams,
    CalendarRangeResponse,
    CreateCalendarCategoryRequest,
    CreateEventNoteRequest,
    CreateEventRequest,
    DeleteOccurrenceParams,
    EventDetailResponse,
    EventListParams,
    EventListResponse,
    EventResponse,
    LinkedNoteResponse,
    LocalDateTime,
    UpdateCalendarCategoryRequest,
    UpdateEventRequest,
    UpdateOccurrenceRequest,
)
from orbit_api.services.calendar.models import (
    CategoryNameTakenError,
    CategoryNotFoundError,
    EventNoteNotFoundError,
    EventNotFoundError,
    EventTaskNotFoundError,
    InvalidCursorError,
    InvalidEventTimesError,
    LinkedNote,
    OccurrenceNotFoundError,
    TooManyCategoriesError,
)
from orbit_api.services.calendar.recurrence import InvalidEventRecurrenceError
from orbit_api.services.notes.models import NoteDraft

router = APIRouter(
    prefix="/workspaces/{workspace_id}/calendar",
    tags=["calendar"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace or event does not exist or is not accessible."},
    },
)
preferences_router = APIRouter(
    prefix="/me/calendar-preferences",
    tags=["calendar"],
    responses={401: {"description": "Not signed in."}},
)

EventId = Annotated[uuid.UUID, Path(description="The event's ID.")]
CategoryId = Annotated[uuid.UUID, Path(description="The category's ID.")]
OriginalStart = Annotated[
    LocalDateTime,
    Path(description="The occurrence's original local start, such as `2026-11-02T09:00`."),
]
_INVALID: dict[int | str, dict[str, Any]] = {
    422: {"description": "Invalid times or rule, or a linked item doesn't exist."}
}


@contextmanager
def _errors() -> Generator[None]:
    """Map the calendar's domain errors to safe HTTP errors."""
    try:
        yield
    except EventNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found.") from None
    except OccurrenceNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Occurrence not found.") from None
    except CategoryNotFoundError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That category doesn't exist in this workspace."
        ) from None
    except EventNoteNotFoundError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That note doesn't exist in this workspace."
        ) from None
    except EventTaskNotFoundError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That task doesn't exist in this workspace."
        ) from None
    except CategoryNameTakenError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Another category already has that name."
        ) from None
    except TooManyCategoriesError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A workspace can have at most 50 categories."
        ) from None
    except (InvalidEventTimesError, InvalidEventRecurrenceError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    except InvalidCursorError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That cursor isn't valid."
        ) from None


# Categories


@router.get("/categories", summary="List event categories")
async def list_categories(
    workspace: WorkspaceDep, calendar: CalendarServiceDep
) -> CalendarCategoryListResponse:
    """The first call creates the default categories (Personal, Work, Meeting, Appointment,
    Birthday, Travel, Other)."""
    categories = await calendar.categories(workspace.id)
    return CalendarCategoryListResponse(
        categories=[CalendarCategoryResponse.of(c) for c in categories]
    )


@router.post(
    "/categories",
    status_code=status.HTTP_201_CREATED,
    summary="Create an event category",
    responses={409: {"description": "The name is taken, or there are too many categories."}},
)
async def create_category(
    body: CreateCalendarCategoryRequest, workspace: WorkspaceDep, calendar: CalendarServiceDep
) -> CalendarCategoryResponse:
    with _errors():
        return CalendarCategoryResponse.of(
            await calendar.create_category(workspace.id, body.name, body.color)
        )


@router.patch(
    "/categories/{category_id}",
    summary="Rename, recolor, show, or hide a category",
    responses={409: {"description": "The name is taken."}},
)
async def update_category(
    category_id: CategoryId,
    body: UpdateCalendarCategoryRequest,
    workspace: WorkspaceDep,
    calendar: CalendarServiceDep,
) -> CalendarCategoryResponse:
    try:
        category = await calendar.update_category(
            workspace.id,
            category_id,
            name=body.name,
            color=body.color,
            is_visible=body.is_visible,
        )
    except CategoryNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found.") from None
    except CategoryNameTakenError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Another category already has that name."
        ) from None
    return CalendarCategoryResponse.of(category)


@router.delete(
    "/categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a category",
)
async def delete_category(
    category_id: CategoryId, workspace: WorkspaceDep, calendar: CalendarServiceDep
) -> Response:
    """Its events keep no category."""
    try:
        await calendar.delete_category(workspace.id, category_id)
    except CategoryNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found.") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Views


@router.get("/range", summary="Occurrences and tasks for a date range")
async def calendar_range(
    params: Annotated[CalendarRangeParams, Query()],
    user: CurrentUserDep,
    workspace: WorkspaceDep,
    calendar: CalendarServiceDep,
) -> CalendarRangeResponse:
    """Local dates `[start, end)` in the viewer's time zone (at most 92 days). Recurring series
    are expanded; events in hidden categories are left out."""
    result = await calendar.range(workspace.id, params.to_window(user.timezone))
    return CalendarRangeResponse.of(result)


@router.get("/agenda", summary="Upcoming occurrences and scheduled tasks")
async def agenda(
    params: Annotated[AgendaParams, Query()],
    workspace: WorkspaceDep,
    calendar: CalendarServiceDep,
) -> AgendaResponse:
    """What hasn't ended by `start`, in order, a page at a time, up to a year ahead. Cancelled
    occurrences and completed tasks are left out."""
    start = params.start or datetime.now(UTC)
    with _errors():
        page = await calendar.agenda(
            workspace.id, start, params.limit, params.cursor, params.include_tasks
        )
    return AgendaResponse(
        items=[AgendaItemResponse.of(item) for item in page.items], next_cursor=page.next_cursor
    )


# Events


@router.get("/events", summary="List or search events")
async def list_events(
    params: Annotated[EventListParams, Query()],
    workspace: WorkspaceDep,
    calendar: CalendarServiceDep,
) -> EventListResponse:
    """Events and series (not their occurrences), most recent first."""
    page = await calendar.find_events(workspace.id, params.to_query())
    return EventListResponse(events=[EventResponse.of(e) for e in page.events], total=page.total)


@router.post(
    "/events", status_code=status.HTTP_201_CREATED, summary="Create an event", responses=_INVALID
)
async def create_event(
    body: CreateEventRequest,
    user: CurrentUserDep,
    workspace: WorkspaceDep,
    calendar: CalendarServiceDep,
) -> EventDetailResponse:
    with _errors():
        detail = await calendar.create_event(
            workspace.id, body.to_draft(), default_timezone=user.timezone
        )
    return EventDetailResponse.of_detail(detail)


@router.get("/events/{event_id}", summary="Get an event")
async def get_event(
    event_id: EventId, workspace: WorkspaceDep, calendar: CalendarServiceDep
) -> EventDetailResponse:
    with _errors():
        return EventDetailResponse.of_detail(await calendar.get_event(workspace.id, event_id))


@router.patch("/events/{event_id}", summary="Update an event or whole series", responses=_INVALID)
async def update_event(
    event_id: EventId,
    body: UpdateEventRequest,
    workspace: WorkspaceDep,
    calendar: CalendarServiceDep,
) -> EventDetailResponse:
    """Changing a series' times, time zone, all-day setting, or rule resets changes made to its
    single occurrences. Setting `status` to `cancelled` cancels every occurrence and its alerts."""
    with _errors():
        detail = await calendar.update_event(workspace.id, event_id, body.to_changes())
    return EventDetailResponse.of_detail(detail)


@router.delete(
    "/events/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an event or whole series",
)
async def delete_event(
    event_id: EventId, workspace: WorkspaceDep, calendar: CalendarServiceDep
) -> Response:
    """Its alerts' pending reminders go with it; delivered notifications stay."""
    with _errors():
        await calendar.delete_event(workspace.id, event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/events/{event_id}/duplicate",
    status_code=status.HTTP_201_CREATED,
    summary="Duplicate an event or series",
)
async def duplicate_event(
    event_id: EventId, workspace: WorkspaceDep, calendar: CalendarServiceDep
) -> EventDetailResponse:
    """Copies the event with its rule, alerts, and links, but not changes to single
    occurrences."""
    with _errors():
        return EventDetailResponse.of_detail(await calendar.duplicate_event(workspace.id, event_id))


@router.patch(
    "/events/{event_id}/occurrences/{original_start}",
    summary="Change an occurrence, the following ones, or the series",
    responses=_INVALID,
)
async def update_occurrence(
    event_id: EventId,
    original_start: OriginalStart,
    body: UpdateOccurrenceRequest,
    workspace: WorkspaceDep,
    calendar: CalendarServiceDep,
) -> EventDetailResponse:
    """Returns the event that now holds the occurrence: with `following`, a new series that
    continues from it (the original ends before it)."""
    with _errors():
        detail = await calendar.update_occurrence(
            workspace.id, event_id, original_start, body.scope, body.to_changes()
        )
    return EventDetailResponse.of_detail(detail)


@router.delete(
    "/events/{event_id}/occurrences/{original_start}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an occurrence, the following ones, or the series",
)
async def delete_occurrence(
    event_id: EventId,
    original_start: OriginalStart,
    params: Annotated[DeleteOccurrenceParams, Query()],
    workspace: WorkspaceDep,
    calendar: CalendarServiceDep,
) -> Response:
    with _errors():
        await calendar.delete_occurrence(workspace.id, event_id, original_start, params.scope)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Notes and tasks


@router.post(
    "/events/{event_id}/notes",
    status_code=status.HTTP_201_CREATED,
    summary="Create a note for an event",
)
async def create_event_note(
    event_id: EventId,
    body: CreateEventNoteRequest,
    workspace: WorkspaceDep,
    calendar: CalendarServiceDep,
    notes: NoteServiceDep,
) -> LinkedNoteResponse:
    """Creates an ordinary note in the Inbox, such as meeting notes, and links it to the
    event."""
    with _errors():
        event = (await calendar.get_event(workspace.id, event_id)).event
    day = (body.occurrence_start or event.start).date()
    title = body.title or f"{event.title} · {day:%d %b %Y}"
    detail = await notes.create(workspace.id, NoteDraft(title=title[:200]))
    with _errors():
        await calendar.link_note(workspace.id, event_id, detail.note.id)
    note = detail.note
    return LinkedNoteResponse.of(
        LinkedNote(
            id=note.id,
            title=note.title,
            note_type=note.note_type,
            trashed=False,
            updated_at=note.updated_at,
        )
    )


@router.put(
    "/events/{event_id}/notes/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Link a note to an event",
    responses={422: {"description": "The note doesn't exist in this workspace."}},
)
async def link_event_note(
    event_id: EventId, note_id: uuid.UUID, workspace: WorkspaceDep, calendar: CalendarServiceDep
) -> Response:
    """Idempotent."""
    with _errors():
        await calendar.link_note(workspace.id, event_id, note_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/events/{event_id}/notes/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unlink a note from an event",
)
async def unlink_event_note(
    event_id: EventId, note_id: uuid.UUID, workspace: WorkspaceDep, calendar: CalendarServiceDep
) -> Response:
    with _errors():
        await calendar.unlink_note(workspace.id, event_id, note_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/events/{event_id}/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Link a task to an event",
    responses={422: {"description": "The task doesn't exist in this workspace."}},
)
async def link_event_task(
    event_id: EventId, task_id: uuid.UUID, workspace: WorkspaceDep, calendar: CalendarServiceDep
) -> Response:
    """Idempotent."""
    with _errors():
        await calendar.link_task(workspace.id, event_id, task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/events/{event_id}/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unlink a task from an event",
)
async def unlink_event_task(
    event_id: EventId, task_id: uuid.UUID, workspace: WorkspaceDep, calendar: CalendarServiceDep
) -> Response:
    with _errors():
        await calendar.unlink_task(workspace.id, event_id, task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Preferences


@preferences_router.get("", summary="Get the signed-in user's calendar preferences")
async def get_preferences(
    user: CurrentUserDep, preferences: CalendarPreferenceServiceDep
) -> CalendarPreferencesResponse:
    """Defaults until the user saves some (`updated_at` is `null`)."""
    return CalendarPreferencesResponse.of(await preferences.get(user.id))


@preferences_router.put("", summary="Save the signed-in user's calendar preferences")
async def put_preferences(
    body: CalendarPreferencesModel,
    user: CurrentUserDep,
    preferences: CalendarPreferenceServiceDep,
) -> CalendarPreferencesResponse:
    return CalendarPreferencesResponse.of(await preferences.put(user.id, body.to_preferences()))
