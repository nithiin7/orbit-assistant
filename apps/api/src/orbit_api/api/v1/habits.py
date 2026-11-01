"""Habits and routines in a workspace: categories, habits and their log, the Today view, history,
analytics, calendar entries, reminder times, links to tasks and notes, routines, and sessions.
Every route authorizes the workspace through `WorkspaceDep` first."""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import (
    HabitServiceDep,
    NoteServiceDep,
    RoutineServiceDep,
    TaskServiceDep,
)
from orbit_api.schemas.calendar import CalendarDate, LinkedNoteResponse
from orbit_api.schemas.habits import (
    CreateHabitCategoryRequest,
    CreateHabitNoteRequest,
    CreateHabitRequest,
    CreateRoutineRequest,
    CreateSessionNoteRequest,
    HabitAnalyticsParams,
    HabitAnalyticsResponse,
    HabitCalendarEntryResponse,
    HabitCalendarParams,
    HabitCalendarResponse,
    HabitCategoryListResponse,
    HabitCategoryResponse,
    HabitDetailResponse,
    HabitHistoryResponse,
    HabitListParams,
    HabitListResponse,
    HabitProgressResponse,
    HabitRangeParams,
    HabitTodayParams,
    HabitTodayResponse,
    LogHabitRequest,
    RoutineDetailResponse,
    RoutineListParams,
    RoutineListResponse,
    RoutineSessionListParams,
    RoutineSessionListResponse,
    RoutineSessionResponse,
    SetHabitRemindersRequest,
    StartRoutineSessionRequest,
    UpdateHabitCategoryRequest,
    UpdateHabitRequest,
    UpdateRoutineRequest,
    UpdateRoutineSessionRequest,
    UpdateSessionStepRequest,
)
from orbit_api.schemas.tasks import CreateTaskRequest, TaskResponse
from orbit_api.services.calendar.models import LinkedNote
from orbit_api.services.habits.models import (
    ActiveSessionExistsError,
    HabitCategoryNameTakenError,
    HabitCategoryNotFoundError,
    HabitNotFoundError,
    InvalidHabitError,
    InvalidLogError,
    LinkedItemNotFoundError,
    RoutineNotFoundError,
    RoutineSession,
    SessionFinishedError,
    SessionNotFoundError,
    TooManyHabitCategoriesError,
)
from orbit_api.services.notes.models import NoteDraft
from orbit_api.utils.changes import UNSET

_NOT_FOUND = {404: {"description": "The workspace or item does not exist or is not accessible."}}
router = APIRouter(
    prefix="/workspaces/{workspace_id}/habits",
    tags=["habits"],
    responses={401: {"description": "Not signed in."}, **_NOT_FOUND},
)
routines_router = APIRouter(
    prefix="/workspaces/{workspace_id}/routines",
    tags=["habits"],
    responses={401: {"description": "Not signed in."}, **_NOT_FOUND},
)

HabitId = Annotated[uuid.UUID, Path(description="The habit's ID.")]
RoutineId = Annotated[uuid.UUID, Path(description="The routine's ID.")]
SessionId = Annotated[uuid.UUID, Path(description="The session's ID.")]
Day = Annotated[CalendarDate, Path(description="A local date, such as `2026-11-02`.")]
_INVALID: dict[int | str, dict[str, Any]] = {
    422: {"description": "Invalid fields, or a linked item doesn't exist in this workspace."}
}


@contextmanager
def _errors() -> Generator[None]:
    """Map the module's domain errors to safe HTTP errors."""
    try:
        yield
    except HabitNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Habit not found.") from None
    except RoutineNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Routine not found.") from None
    except SessionNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.") from None
    except HabitCategoryNotFoundError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That category doesn't exist in this workspace."
        ) from None
    except LinkedItemNotFoundError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"That {exc.kind} doesn't exist in this workspace.",
        ) from None
    except (InvalidHabitError, InvalidLogError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    except HabitCategoryNameTakenError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Another category already has that name."
        ) from None
    except TooManyHabitCategoriesError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A workspace can have at most 50 habit categories."
        ) from None
    except ActiveSessionExistsError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This routine already has a session in progress."
        ) from None
    except SessionFinishedError:
        raise HTTPException(status.HTTP_409_CONFLICT, "That session has already ended.") from None


def _linked(note_id: uuid.UUID, title: str, note_type: str, updated_at: Any) -> LinkedNoteResponse:
    return LinkedNoteResponse.of(
        LinkedNote(
            id=note_id, title=title, note_type=note_type, trashed=False, updated_at=updated_at
        )
    )


# Categories


@router.get("/categories", summary="List habit categories")
async def list_categories(
    workspace: WorkspaceDep, habits: HabitServiceDep
) -> HabitCategoryListResponse:
    """The first call creates the defaults (Health, Fitness, Learning, Productivity, Personal,
    Finance, Lifestyle, Other)."""
    categories = await habits.categories(workspace.id)
    return HabitCategoryListResponse(categories=[HabitCategoryResponse.of(c) for c in categories])


@router.post(
    "/categories",
    status_code=status.HTTP_201_CREATED,
    summary="Create a habit category",
    responses={409: {"description": "The name is taken, or there are too many categories."}},
)
async def create_category(
    body: CreateHabitCategoryRequest, workspace: WorkspaceDep, habits: HabitServiceDep
) -> HabitCategoryResponse:
    with _errors():
        category = await habits.create_category(workspace.id, body.name, body.color, body.icon)
    return HabitCategoryResponse.of(category)


@router.patch("/categories/{category_id}", summary="Rename, recolor, or change a category's icon")
async def update_category(
    category_id: uuid.UUID,
    body: UpdateHabitCategoryRequest,
    workspace: WorkspaceDep,
    habits: HabitServiceDep,
) -> HabitCategoryResponse:
    try:
        category = await habits.update_category(
            workspace.id, category_id, name=body.name, color=body.color, icon=body.icon
        )
    except HabitCategoryNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found.") from None
    except HabitCategoryNameTakenError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Another category already has that name."
        ) from None
    return HabitCategoryResponse.of(category)


@router.delete(
    "/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a category"
)
async def delete_category(
    category_id: uuid.UUID, workspace: WorkspaceDep, habits: HabitServiceDep
) -> Response:
    """Its habits and routines keep no category."""
    try:
        await habits.delete_category(workspace.id, category_id)
    except HabitCategoryNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found.") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Views


@router.get("/today", summary="Today's habits, this week, and the days ahead")
async def today(
    params: Annotated[HabitTodayParams, Query()],
    user: CurrentUserDep,
    workspace: WorkspaceDep,
    habits: HabitServiceDep,
) -> HabitTodayResponse:
    """Every habit that isn't archived, as of `date`, with its state, progress, and streaks."""
    timezone = params.timezone or user.timezone or "UTC"
    return HabitTodayResponse.of(await habits.today(workspace.id, params.date, timezone))


@router.get("/analytics", summary="Habit analytics for a date range", responses=_INVALID)
async def analytics(
    params: Annotated[HabitAnalyticsParams, Query()],
    user: CurrentUserDep,
    workspace: WorkspaceDep,
    habits: HabitServiceDep,
) -> HabitAnalyticsResponse:
    """A heatmap, weekly and monthly trends, each habit's performance, and rates by category,
    from `start` to `end` (inclusive). Rates only count days a habit was due."""
    with _errors():
        result = await habits.analytics(
            workspace.id,
            params.start,
            params.end,
            params.timezone or user.timezone or "UTC",
            params.category_id,
        )
    return HabitAnalyticsResponse.of(result)


@router.get("/calendar", summary="Habits and routines on the calendar", responses=_INVALID)
async def calendar(
    params: Annotated[HabitCalendarParams, Query()],
    user: CurrentUserDep,
    workspace: WorkspaceDep,
    habits: HabitServiceDep,
) -> HabitCalendarResponse:
    """Habits and routines with a time of day, on the days they're due, for local dates
    `[start, end)`. These are schedules, not calendar events; nothing is stored for them."""
    with _errors():
        entries = await habits.calendar(
            workspace.id, params.start, params.end, params.timezone or user.timezone or "UTC"
        )
    return HabitCalendarResponse(entries=[HabitCalendarEntryResponse.of(e) for e in entries])


# Habits


@router.get("", summary="List habits with their progress")
async def list_habits(
    params: Annotated[HabitListParams, Query()], workspace: WorkspaceDep, habits: HabitServiceDep
) -> HabitListResponse:
    result = await habits.find(workspace.id, params.statuses())
    return HabitListResponse(habits=[HabitProgressResponse.of(h) for h in result])


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a habit", responses=_INVALID)
async def create_habit(
    body: CreateHabitRequest,
    user: CurrentUserDep,
    workspace: WorkspaceDep,
    habits: HabitServiceDep,
) -> HabitDetailResponse:
    with _errors():
        detail = await habits.create(workspace.id, body.to_draft(), default_timezone=user.timezone)
    return HabitDetailResponse.of_detail(detail)


@router.get("/{habit_id}", summary="Get a habit with its progress and links")
async def get_habit(
    habit_id: HabitId, workspace: WorkspaceDep, habits: HabitServiceDep
) -> HabitDetailResponse:
    with _errors():
        return HabitDetailResponse.of_detail(await habits.get(workspace.id, habit_id))


@router.patch(
    "/{habit_id}", summary="Update, pause, archive, or reschedule a habit", responses=_INVALID
)
async def update_habit(
    habit_id: HabitId, body: UpdateHabitRequest, workspace: WorkspaceDep, habits: HabitServiceDep
) -> HabitDetailResponse:
    """A new schedule applies from `schedule_from` (today by default); earlier days keep theirs.
    Pausing or archiving cancels the habit's reminders until it's active again."""
    with _errors():
        detail = await habits.update(workspace.id, habit_id, body.to_changes())
    return HabitDetailResponse.of_detail(detail)


@router.delete("/{habit_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a habit")
async def delete_habit(
    habit_id: HabitId, workspace: WorkspaceDep, habits: HabitServiceDep
) -> Response:
    """Deletes its history and reminders. Archive it instead to keep the history."""
    with _errors():
        await habits.delete(workspace.id, habit_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{habit_id}/history", summary="A habit's days and periods", responses=_INVALID)
async def habit_history(
    habit_id: HabitId,
    params: Annotated[HabitRangeParams, Query()],
    workspace: WorkspaceDep,
    habits: HabitServiceDep,
) -> HabitHistoryResponse:
    with _errors():
        result = await habits.history(workspace.id, habit_id, params.start, params.end)
    return HabitHistoryResponse.of(result)


@router.put("/{habit_id}/log/{day}", summary="Record a day", responses=_INVALID)
async def log_day(
    habit_id: HabitId,
    day: Day,
    body: LogHabitRequest,
    workspace: WorkspaceDep,
    habits: HabitServiceDep,
) -> HabitProgressResponse:
    """Complete, record progress on, or skip one local date. Replaces that day's entry; there is
    never more than one. Days in the future or outside the habit's dates are refused."""
    with _errors():
        result = await habits.log(workspace.id, habit_id, day, body.to_draft())
    return HabitProgressResponse.of(result)


@router.delete("/{habit_id}/log/{day}", summary="Undo a day")
async def unlog_day(
    habit_id: HabitId, day: Day, workspace: WorkspaceDep, habits: HabitServiceDep
) -> HabitProgressResponse:
    """Idempotent."""
    with _errors():
        result = await habits.unlog(workspace.id, habit_id, day)
    return HabitProgressResponse.of(result)


@router.put("/{habit_id}/reminders", summary="Set a habit's reminder times", responses=_INVALID)
async def set_habit_reminders(
    habit_id: HabitId,
    body: SetHabitRemindersRequest,
    workspace: WorkspaceDep,
    habits: HabitServiceDep,
) -> HabitDetailResponse:
    """Each time notifies on the habit's due days that aren't done yet, through the reminder
    worker. Times left out are removed."""
    with _errors():
        detail = await habits.set_reminders(
            workspace.id, habit_id, [r.to_time() for r in body.reminders]
        )
    return HabitDetailResponse.of_detail(detail)


@router.post(
    "/{habit_id}/tasks",
    status_code=status.HTTP_201_CREATED,
    summary="Create a task related to a habit",
    responses=_INVALID,
)
async def create_habit_task(
    habit_id: HabitId,
    body: CreateTaskRequest,
    workspace: WorkspaceDep,
    habits: HabitServiceDep,
    tasks: TaskServiceDep,
) -> TaskResponse:
    """An ordinary task, linked to the habit."""
    with _errors():
        await habits.get(workspace.id, habit_id)
    task = await tasks.create(workspace.id, body.to_draft())
    with _errors():
        await habits.link_task(workspace.id, habit_id, task.id)
    return TaskResponse.of(task)


@router.put(
    "/{habit_id}/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Link a task to a habit",
    responses=_INVALID,
)
async def link_habit_task(
    habit_id: HabitId, task_id: uuid.UUID, workspace: WorkspaceDep, habits: HabitServiceDep
) -> Response:
    with _errors():
        await habits.link_task(workspace.id, habit_id, task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{habit_id}/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unlink a task from a habit",
)
async def unlink_habit_task(
    habit_id: HabitId, task_id: uuid.UUID, workspace: WorkspaceDep, habits: HabitServiceDep
) -> Response:
    with _errors():
        await habits.unlink_task(workspace.id, habit_id, task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{habit_id}/notes",
    status_code=status.HTTP_201_CREATED,
    summary="Write a reflection on a habit",
)
async def create_habit_note(
    habit_id: HabitId,
    body: CreateHabitNoteRequest,
    workspace: WorkspaceDep,
    habits: HabitServiceDep,
    notes: NoteServiceDep,
) -> LinkedNoteResponse:
    """Creates an ordinary note in the Inbox and links it to the habit."""
    with _errors():
        habit = (await habits.get(workspace.id, habit_id)).progress.habit
    day = body.day or habit.start_date
    title = body.title or (f"{habit.name} · {day:%d %b %Y}" if body.day else habit.name)
    note = (await notes.create(workspace.id, NoteDraft(title=title[:200]))).note
    with _errors():
        await habits.link_note(workspace.id, habit_id, note.id)
    return _linked(note.id, note.title, note.note_type, note.updated_at)


@router.put(
    "/{habit_id}/notes/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Link a note to a habit",
    responses=_INVALID,
)
async def link_habit_note(
    habit_id: HabitId, note_id: uuid.UUID, workspace: WorkspaceDep, habits: HabitServiceDep
) -> Response:
    with _errors():
        await habits.link_note(workspace.id, habit_id, note_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{habit_id}/notes/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unlink a note from a habit",
)
async def unlink_habit_note(
    habit_id: HabitId, note_id: uuid.UUID, workspace: WorkspaceDep, habits: HabitServiceDep
) -> Response:
    with _errors():
        await habits.unlink_note(workspace.id, habit_id, note_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Routines


@routines_router.get("", summary="List routines")
async def list_routines(
    params: Annotated[RoutineListParams, Query()],
    workspace: WorkspaceDep,
    routines: RoutineServiceDep,
) -> RoutineListResponse:
    result = await routines.find(workspace.id, params.statuses())
    return RoutineListResponse(routines=[RoutineDetailResponse.of_detail(r) for r in result])


@routines_router.post(
    "", status_code=status.HTTP_201_CREATED, summary="Create a routine", responses=_INVALID
)
async def create_routine(
    body: CreateRoutineRequest,
    user: CurrentUserDep,
    workspace: WorkspaceDep,
    routines: RoutineServiceDep,
) -> RoutineDetailResponse:
    with _errors():
        detail = await routines.create(
            workspace.id, body.to_draft(), default_timezone=user.timezone
        )
    return RoutineDetailResponse.of_detail(detail)


@routines_router.get("/{routine_id}", summary="Get a routine")
async def get_routine(
    routine_id: RoutineId, workspace: WorkspaceDep, routines: RoutineServiceDep
) -> RoutineDetailResponse:
    with _errors():
        return RoutineDetailResponse.of_detail(await routines.get(workspace.id, routine_id))


@routines_router.patch(
    "/{routine_id}", summary="Update a routine and its steps", responses=_INVALID
)
async def update_routine(
    routine_id: RoutineId,
    body: UpdateRoutineRequest,
    workspace: WorkspaceDep,
    routines: RoutineServiceDep,
) -> RoutineDetailResponse:
    """Sessions already started keep the steps they started with."""
    with _errors():
        detail = await routines.update(workspace.id, routine_id, body.to_changes())
    return RoutineDetailResponse.of_detail(detail)


@routines_router.delete(
    "/{routine_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a routine"
)
async def delete_routine(
    routine_id: RoutineId, workspace: WorkspaceDep, routines: RoutineServiceDep
) -> Response:
    """Deletes its sessions and reminders too. Archive it instead to keep the history."""
    with _errors():
        await routines.delete(workspace.id, routine_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@routines_router.put(
    "/{routine_id}/reminders", summary="Set a routine's reminder times", responses=_INVALID
)
async def set_routine_reminders(
    routine_id: RoutineId,
    body: SetHabitRemindersRequest,
    workspace: WorkspaceDep,
    routines: RoutineServiceDep,
) -> RoutineDetailResponse:
    with _errors():
        detail = await routines.set_reminders(
            workspace.id, routine_id, [r.to_time() for r in body.reminders]
        )
    return RoutineDetailResponse.of_detail(detail)


def _session(session: RoutineSession) -> RoutineSessionResponse:
    response = RoutineSessionResponse.of(session)
    assert response is not None
    return response


@routines_router.get("/{routine_id}/sessions", summary="A routine's sessions, newest first")
async def list_sessions(
    routine_id: RoutineId,
    params: Annotated[RoutineSessionListParams, Query()],
    workspace: WorkspaceDep,
    routines: RoutineServiceDep,
) -> RoutineSessionListResponse:
    with _errors():
        sessions, total = await routines.sessions(
            workspace.id, routine_id, params.limit, params.offset
        )
    return RoutineSessionListResponse(sessions=[_session(s) for s in sessions], total=total)


@routines_router.post(
    "/{routine_id}/sessions",
    status_code=status.HTTP_201_CREATED,
    summary="Start a routine",
    responses={409: {"description": "A session is already in progress."}},
)
async def start_session(
    routine_id: RoutineId,
    body: StartRoutineSessionRequest,
    workspace: WorkspaceDep,
    routines: RoutineServiceDep,
) -> RoutineSessionResponse:
    """Copies the routine's steps into the session, so later edits leave it as it was."""
    with _errors():
        return _session(await routines.start(workspace.id, routine_id, body.day))


@routines_router.get("/{routine_id}/sessions/{session_id}", summary="Get a session")
async def get_session(
    routine_id: RoutineId,
    session_id: SessionId,
    workspace: WorkspaceDep,
    routines: RoutineServiceDep,
) -> RoutineSessionResponse:
    with _errors():
        return _session(await routines.get_session(workspace.id, routine_id, session_id))


@routines_router.patch(
    "/{routine_id}/sessions/{session_id}",
    summary="Finish or abandon a session, or edit its notes",
    responses={409: {"description": "The session has already ended."}, **_INVALID},
)
async def update_session(
    routine_id: RoutineId,
    session_id: SessionId,
    body: UpdateRoutineSessionRequest,
    workspace: WorkspaceDep,
    routines: RoutineServiceDep,
) -> RoutineSessionResponse:
    with _errors():
        session = await routines.update_session(
            workspace.id,
            routine_id,
            session_id,
            status=body.status,
            notes=body.notes,
            note_id=body.note_id if "note_id" in body.model_fields_set else UNSET,
        )
    return _session(session)


@routines_router.patch(
    "/{routine_id}/sessions/{session_id}/steps/{step_id}",
    summary="Complete, skip, or reset a step",
    responses={409: {"description": "The session has already ended."}},
)
async def update_session_step(
    routine_id: RoutineId,
    session_id: SessionId,
    step_id: uuid.UUID,
    body: UpdateSessionStepRequest,
    workspace: WorkspaceDep,
    routines: RoutineServiceDep,
) -> RoutineSessionResponse:
    """Completing a step linked to a yes-or-no habit also completes the habit for the
    session's day."""
    with _errors():
        session = await routines.set_step(
            workspace.id, routine_id, session_id, step_id, body.status
        )
    return _session(session)


@routines_router.post(
    "/{routine_id}/sessions/{session_id}/note",
    status_code=status.HTTP_201_CREATED,
    summary="Write a note for a session",
)
async def create_session_note(
    routine_id: RoutineId,
    session_id: SessionId,
    body: CreateSessionNoteRequest,
    workspace: WorkspaceDep,
    routines: RoutineServiceDep,
    notes: NoteServiceDep,
) -> LinkedNoteResponse:
    """Creates an ordinary note in the Inbox and attaches it to the session."""
    with _errors():
        session = await routines.get_session(workspace.id, routine_id, session_id)
    title = body.title or f"{session.routine_name} · {session.day:%d %b %Y}"
    note = (await notes.create(workspace.id, NoteDraft(title=title[:200]))).note
    with _errors():
        await routines.update_session(workspace.id, routine_id, session_id, note_id=note.id)
    return _linked(note.id, note.title, note.note_type, note.updated_at)
