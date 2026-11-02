"""Health and fitness in a workspace: the dashboard, profile, exercise library, templates,
workouts and sets, records and analytics, body measurements and progress photos, foods, meals,
food and water entries, activity, goals, and links to habits, the calendar, notes, and documents.

Every route authorizes the workspace through `WorkspaceDep` and acts as the signed-in person
(`Owner`): health records are private to whoever made them, and someone else's record behaves
like a missing one (404)."""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import (
    CalendarServiceDep,
    FitnessDep,
    NoteServiceDep,
    SettingsDep,
)
from orbit_api.api.files import download_response, read_body
from orbit_api.schemas.fitness import (
    ActiveSessionResponse,
    ActivityListParams,
    ActivityListResponse,
    ActivityRequest,
    ActivityResponse,
    AddSessionExerciseRequest,
    AddSetRequest,
    AnalyticsParams,
    ArchiveRequest,
    BmiResponse,
    CheckInRequest,
    CreateLinkedNoteRequest,
    DayParams,
    DayTotalResponse,
    ExerciseHistoryResponse,
    ExerciseListResponse,
    ExerciseRequest,
    ExerciseResponse,
    FitnessGoalListResponse,
    FitnessGoalResponse,
    FitnessOverviewResponse,
    FoodEntryListResponse,
    FoodEntryRequest,
    FoodEntryResponse,
    FoodListResponse,
    FoodRequest,
    FoodResponse,
    GoalDateParams,
    GoalListParams,
    GoalRequest,
    GoalStatusRequest,
    HabitLinkListResponse,
    HabitLinkRequest,
    HabitLinkResponse,
    LinkedRecordResponse,
    LinkEventRequest,
    LinkListResponse,
    LogMealRequest,
    LogSessionRequest,
    MealListResponse,
    MealRequest,
    MealResponse,
    MeasurementListParams,
    MeasurementListResponse,
    MeasurementRequest,
    MeasurementResponse,
    NutritionDayResponse,
    NutritionHistoryResponse,
    OverviewParams,
    PersonalRecordResponse,
    PhotoListResponse,
    PhotoResponse,
    PhotoUploadParams,
    ProfileRequest,
    ProfileResponse,
    RangeParams,
    RecordListResponse,
    ReorderRequest,
    ScheduledWorkoutListResponse,
    ScheduledWorkoutResponse,
    ScheduleParams,
    ScheduleWorkoutRequest,
    SessionListParams,
    SessionListResponse,
    SessionResponse,
    SessionSummaryResponse,
    SetRequest,
    StartSessionRequest,
    TemplateListResponse,
    TemplateRequest,
    TemplateResponse,
    UpdateSessionExerciseRequest,
    UpdateSessionRequest,
    WaterDayResponse,
    WaterHistoryResponse,
    WaterRequest,
    WaterTotalResponse,
    WorkoutAnalyticsResponse,
)
from orbit_api.services.calendar.models import EventDraft, InvalidEventTimesError
from orbit_api.services.fitness.models import (
    FitnessConflictError,
    FitnessNotFoundError,
    InvalidFitnessError,
    LinkOwnerKind,
    LinkTargetKind,
    Owner,
    SessionStart,
)
from orbit_api.services.fitness.overview import Fitness
from orbit_api.services.notes.models import NoteDraft
from orbit_api.utils.file_types import FileTypeError

_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"description": "Not signed in."},
    404: {"description": "The workspace or record does not exist or is not yours."},
}
_INVALID: dict[int | str, dict[str, Any]] = {
    422: {"description": "Invalid values, or a reference that doesn't exist."}
}
_CONFLICT: dict[int | str, dict[str, Any]] = {
    409: {"description": "The change conflicts with the record's current state."}
}
_UPLOAD_BODY = {
    "requestBody": {
        "required": True,
        "content": {"application/octet-stream": {"schema": {"type": "string"}}},
    }
}
_FILE: dict[int | str, dict[str, Any]] = {
    200: {"content": {"application/octet-stream": {}}, "description": "The image."}
}

router = APIRouter(
    prefix="/workspaces/{workspace_id}/fitness", tags=["fitness"], responses=_RESPONSES
)

RecordId = Annotated[uuid.UUID, Path(description="The record's ID.")]
SessionId = Annotated[uuid.UUID, Path(description="The workout's ID.")]
ItemId = Annotated[uuid.UUID, Path(description="The exercise's ID within the workout.")]
SetId = Annotated[uuid.UUID, Path(description="The set's ID.")]


def get_owner(workspace: WorkspaceDep, user: CurrentUserDep) -> Owner:
    """The signed-in person in the authorized workspace: whose health records these are."""
    return Owner(workspace_id=workspace.id, user_id=user.id)


OwnerDep = Annotated[Owner, Depends(get_owner)]


@contextmanager
def _errors() -> Generator[None]:
    """Map the module's domain errors to safe HTTP errors."""
    try:
        yield
    except FitnessNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{exc.what} not found.") from None
    except InvalidFitnessError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    except FitnessConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None


def _timezone(requested: str | None, user: CurrentUserDep) -> str:
    return requested or user.timezone or "UTC"


# Overview and profile


@router.get("/overview", summary="The Health & Fitness dashboard")
async def overview(
    params: Annotated[OverviewParams, Query()],
    owner: OwnerDep,
    user: CurrentUserDep,
    fitness: FitnessDep,
) -> FitnessOverviewResponse:
    result = await fitness.overview(owner, params.date, _timezone(params.timezone, user))
    return FitnessOverviewResponse.of(result)


@router.get("/profile", summary="Units, height, targets, and dashboard preferences")
async def get_profile(owner: OwnerDep, fitness: FitnessDep) -> ProfileResponse:
    """Metric defaults until saved."""
    return ProfileResponse.of(await fitness.library.profile(owner))


@router.put("/profile", summary="Save the profile", responses=_INVALID)
async def put_profile(
    body: ProfileRequest, owner: OwnerDep, fitness: FitnessDep
) -> ProfileResponse:
    with _errors():
        return ProfileResponse.of(await fitness.library.update_profile(owner, body.to_draft()))


# Exercises


@router.get("/exercises", summary="The exercise library")
async def list_exercises(owner: OwnerDep, fitness: FitnessDep) -> ExerciseListResponse:
    """Built-in and custom exercises, archived ones included. The first call adds the
    built-ins."""
    exercises = await fitness.library.exercises(owner)
    return ExerciseListResponse(exercises=[ExerciseResponse.of(e) for e in exercises])


@router.post(
    "/exercises",
    status_code=status.HTTP_201_CREATED,
    summary="Create a custom exercise",
    responses=_INVALID,
)
async def create_exercise(
    body: ExerciseRequest, owner: OwnerDep, fitness: FitnessDep
) -> ExerciseResponse:
    with _errors():
        return ExerciseResponse.of(await fitness.library.create_exercise(owner, body.to_draft()))


@router.get("/exercises/{exercise_id}", summary="Get an exercise")
async def get_exercise(
    exercise_id: RecordId, owner: OwnerDep, fitness: FitnessDep
) -> ExerciseResponse:
    with _errors():
        return ExerciseResponse.of(await fitness.library.exercise(owner, exercise_id))


@router.put(
    "/exercises/{exercise_id}",
    summary="Edit a custom exercise",
    responses={**_INVALID, **_CONFLICT},
)
async def update_exercise(
    exercise_id: RecordId, body: ExerciseRequest, owner: OwnerDep, fitness: FitnessDep
) -> ExerciseResponse:
    """Past workouts keep the name and type they were logged with."""
    with _errors():
        exercise = await fitness.library.update_exercise(owner, exercise_id, body.to_draft())
    return ExerciseResponse.of(exercise)


@router.post("/exercises/{exercise_id}/archive", summary="Archive or restore an exercise")
async def archive_exercise(
    exercise_id: RecordId, body: ArchiveRequest, owner: OwnerDep, fitness: FitnessDep
) -> ExerciseResponse:
    with _errors():
        exercise = await fitness.library.archive_exercise(owner, exercise_id, body.archived)
    return ExerciseResponse.of(exercise)


@router.delete(
    "/exercises/{exercise_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an unused custom exercise",
    responses=_CONFLICT,
)
async def delete_exercise(exercise_id: RecordId, owner: OwnerDep, fitness: FitnessDep) -> Response:
    with _errors():
        await fitness.library.delete_exercise(owner, exercise_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/exercises/{exercise_id}/history", summary="An exercise's history and records")
async def exercise_history(
    exercise_id: RecordId, owner: OwnerDep, fitness: FitnessDep
) -> ExerciseHistoryResponse:
    """Each completed workout's best values, oldest first, and the exercise's records."""
    with _errors():
        return ExerciseHistoryResponse.of(
            await fitness.workouts.exercise_history(owner, exercise_id)
        )


# Templates


@router.get("/templates", summary="Workout templates")
async def list_templates(owner: OwnerDep, fitness: FitnessDep) -> TemplateListResponse:
    templates = await fitness.library.templates(owner)
    return TemplateListResponse(templates=[TemplateResponse.of(t) for t in templates])


@router.post(
    "/templates",
    status_code=status.HTTP_201_CREATED,
    summary="Create a template",
    responses=_INVALID,
)
async def create_template(
    body: TemplateRequest, owner: OwnerDep, fitness: FitnessDep
) -> TemplateResponse:
    with _errors():
        return TemplateResponse.of(await fitness.library.create_template(owner, body.to_draft()))


@router.get("/templates/{template_id}", summary="Get a template")
async def get_template(
    template_id: RecordId, owner: OwnerDep, fitness: FitnessDep
) -> TemplateResponse:
    with _errors():
        return TemplateResponse.of(await fitness.library.template(owner, template_id))


@router.put("/templates/{template_id}", summary="Replace a template", responses=_INVALID)
async def update_template(
    template_id: RecordId, body: TemplateRequest, owner: OwnerDep, fitness: FitnessDep
) -> TemplateResponse:
    """Workouts already started from it don't change."""
    with _errors():
        template = await fitness.library.update_template(owner, template_id, body.to_draft())
    return TemplateResponse.of(template)


@router.post(
    "/templates/{template_id}/duplicate",
    status_code=status.HTTP_201_CREATED,
    summary="Duplicate a template",
)
async def duplicate_template(
    template_id: RecordId, owner: OwnerDep, fitness: FitnessDep
) -> TemplateResponse:
    with _errors():
        return TemplateResponse.of(await fitness.library.duplicate_template(owner, template_id))


@router.post("/templates/{template_id}/archive", summary="Archive or restore a template")
async def archive_template(
    template_id: RecordId, body: ArchiveRequest, owner: OwnerDep, fitness: FitnessDep
) -> TemplateResponse:
    with _errors():
        template = await fitness.library.archive_template(owner, template_id, body.archived)
    return TemplateResponse.of(template)


@router.delete(
    "/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a template"
)
async def delete_template(template_id: RecordId, owner: OwnerDep, fitness: FitnessDep) -> Response:
    with _errors():
        await fitness.library.delete_template(owner, template_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Workouts


@router.get("/sessions", summary="Workout history")
async def list_sessions(
    params: Annotated[SessionListParams, Query()], owner: OwnerDep, fitness: FitnessDep
) -> SessionListResponse:
    """Newest first."""
    summaries = await fitness.workouts.find(
        owner,
        start=params.start,
        end=params.end,
        statuses=params.statuses(),
        limit=params.limit,
        offset=params.offset,
    )
    return SessionListResponse(sessions=[SessionSummaryResponse.of(s) for s in summaries])


@router.post(
    "/sessions",
    status_code=status.HTTP_201_CREATED,
    summary="Start a workout",
    responses={**_INVALID, **_CONFLICT},
)
async def start_session(
    body: StartSessionRequest, owner: OwnerDep, user: CurrentUserDep, fitness: FitnessDep
) -> SessionResponse:
    """Empty, from a template, or from a scheduled workout's calendar event. Only one workout
    can be in progress (409)."""
    start = SessionStart(
        day=body.day,
        timezone=_timezone(body.timezone, user),
        name=body.name,
        template_id=body.template_id,
        calendar_event_id=body.calendar_event_id,
    )
    with _errors():
        return SessionResponse.of(await fitness.workouts.start(owner, start))


@router.post(
    "/sessions/log",
    status_code=status.HTTP_201_CREATED,
    summary="Log a finished workout",
    responses=_INVALID,
)
async def log_session(
    body: LogSessionRequest, owner: OwnerDep, user: CurrentUserDep, fitness: FitnessDep
) -> SessionResponse:
    with _errors():
        detail = await fitness.workouts.log(owner, body.to_logged(_timezone(body.timezone, user)))
    return SessionResponse.of(detail)


@router.get("/sessions/active", summary="The workout in progress, if any")
async def active_session(owner: OwnerDep, fitness: FitnessDep) -> ActiveSessionResponse:
    detail = await fitness.workouts.active(owner)
    return ActiveSessionResponse(session=SessionResponse.of(detail) if detail else None)


@router.get("/sessions/{session_id}", summary="Get a workout")
async def get_session(
    session_id: SessionId, owner: OwnerDep, fitness: FitnessDep
) -> SessionResponse:
    with _errors():
        return SessionResponse.of(await fitness.workouts.get(owner, session_id))


@router.patch(
    "/sessions/{session_id}",
    summary="Rename, add notes, or correct a workout's times",
    responses={**_INVALID, **_CONFLICT},
)
async def update_session(
    session_id: SessionId, body: UpdateSessionRequest, owner: OwnerDep, fitness: FitnessDep
) -> SessionResponse:
    with _errors():
        detail = await fitness.workouts.update(owner, session_id, body.to_changes())
    return SessionResponse.of(detail)


@router.post("/sessions/{session_id}/pause", summary="Pause a workout", responses=_CONFLICT)
async def pause_session(
    session_id: SessionId, owner: OwnerDep, fitness: FitnessDep
) -> SessionResponse:
    with _errors():
        return SessionResponse.of(await fitness.workouts.pause(owner, session_id))


@router.post("/sessions/{session_id}/resume", summary="Resume a workout", responses=_CONFLICT)
async def resume_session(
    session_id: SessionId, owner: OwnerDep, fitness: FitnessDep
) -> SessionResponse:
    with _errors():
        return SessionResponse.of(await fitness.workouts.resume(owner, session_id))


@router.post("/sessions/{session_id}/complete", summary="Complete a workout", responses=_CONFLICT)
async def complete_session(
    session_id: SessionId, owner: OwnerDep, fitness: FitnessDep
) -> SessionResponse:
    """Applies the day to habits that count workouts."""
    with _errors():
        return SessionResponse.of(await fitness.workouts.finish(owner, session_id, "completed"))


@router.post("/sessions/{session_id}/abandon", summary="Abandon a workout", responses=_CONFLICT)
async def abandon_session(
    session_id: SessionId, owner: OwnerDep, fitness: FitnessDep
) -> SessionResponse:
    """Kept in history, but not counted toward totals, records, or habits."""
    with _errors():
        return SessionResponse.of(await fitness.workouts.finish(owner, session_id, "abandoned"))


@router.delete(
    "/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a workout"
)
async def delete_session(session_id: SessionId, owner: OwnerDep, fitness: FitnessDep) -> Response:
    with _errors():
        await fitness.workouts.delete(owner, session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/sessions/{session_id}/exercises",
    status_code=status.HTTP_201_CREATED,
    summary="Add an exercise to a workout",
    responses=_INVALID,
)
async def add_session_exercise(
    session_id: SessionId, body: AddSessionExerciseRequest, owner: OwnerDep, fitness: FitnessDep
) -> SessionResponse:
    with _errors():
        detail = await fitness.workouts.add_exercise(owner, session_id, body.exercise_id)
    return SessionResponse.of(detail)


@router.patch(
    "/sessions/{session_id}/exercises/{item_id}", summary="Set an exercise's rest and notes"
)
async def update_session_exercise(
    session_id: SessionId,
    item_id: ItemId,
    body: UpdateSessionExerciseRequest,
    owner: OwnerDep,
    fitness: FitnessDep,
) -> SessionResponse:
    with _errors():
        detail = await fitness.workouts.update_exercise(
            owner, session_id, item_id, rest_seconds=body.rest_seconds, notes=body.notes
        )
    return SessionResponse.of(detail)


@router.delete(
    "/sessions/{session_id}/exercises/{item_id}", summary="Remove an exercise from a workout"
)
async def remove_session_exercise(
    session_id: SessionId, item_id: ItemId, owner: OwnerDep, fitness: FitnessDep
) -> SessionResponse:
    with _errors():
        return SessionResponse.of(
            await fitness.workouts.remove_exercise(owner, session_id, item_id)
        )


@router.put(
    "/sessions/{session_id}/order", summary="Reorder a workout's exercises", responses=_INVALID
)
async def reorder_session(
    session_id: SessionId, body: ReorderRequest, owner: OwnerDep, fitness: FitnessDep
) -> SessionResponse:
    with _errors():
        detail = await fitness.workouts.reorder(owner, session_id, body.exercise_ids)
    return SessionResponse.of(detail)


@router.post(
    "/sessions/{session_id}/exercises/{item_id}/sets",
    status_code=status.HTTP_201_CREATED,
    summary="Add a set",
    responses=_INVALID,
)
async def add_set(
    session_id: SessionId,
    item_id: ItemId,
    body: AddSetRequest,
    owner: OwnerDep,
    fitness: FitnessDep,
) -> SessionResponse:
    values = body.values.to_values() if body.values else None
    with _errors():
        detail = await fitness.workouts.add_set(owner, session_id, item_id, values)
    return SessionResponse.of(detail)


@router.put(
    "/sessions/{session_id}/exercises/{item_id}/sets/{set_id}",
    summary="Record a set",
    responses=_INVALID,
)
async def update_set(
    session_id: SessionId,
    item_id: ItemId,
    set_id: SetId,
    body: SetRequest,
    owner: OwnerDep,
    fitness: FitnessDep,
) -> SessionResponse:
    with _errors():
        detail = await fitness.workouts.update_set(
            owner, session_id, item_id, set_id, body.to_values()
        )
    return SessionResponse.of(detail)


@router.delete("/sessions/{session_id}/exercises/{item_id}/sets/{set_id}", summary="Remove a set")
async def delete_set(
    session_id: SessionId, item_id: ItemId, set_id: SetId, owner: OwnerDep, fitness: FitnessDep
) -> SessionResponse:
    with _errors():
        detail = await fitness.workouts.delete_set(owner, session_id, item_id, set_id)
    return SessionResponse.of(detail)


@router.post(
    "/sessions/{session_id}/note",
    status_code=status.HTTP_201_CREATED,
    summary="Write a training note for a workout",
)
async def create_session_note(
    session_id: SessionId,
    body: CreateLinkedNoteRequest,
    owner: OwnerDep,
    fitness: FitnessDep,
    notes: NoteServiceDep,
) -> LinkListResponse:
    """Creates an ordinary note in the Inbox and links it to the workout."""
    with _errors():
        session = (await fitness.workouts.get(owner, session_id)).session
    title = body.title or f"{session.name} · {session.day:%d %b %Y}"
    note = (await notes.create(owner.workspace_id, NoteDraft(title=title[:200]))).note
    with _errors():
        links = await fitness.integrations.link(owner, "session", session_id, "note", note.id)
    return LinkListResponse(links=[LinkedRecordResponse.of(link) for link in links])


async def _link(
    fitness: Fitness,
    owner: Owner,
    kind: LinkOwnerKind,
    owner_id: uuid.UUID,
    target: LinkTargetKind,
    target_id: uuid.UUID,
) -> LinkListResponse:
    with _errors():
        links = await fitness.integrations.link(owner, kind, owner_id, target, target_id)
    return LinkListResponse(links=[LinkedRecordResponse.of(link) for link in links])


@router.put(
    "/sessions/{session_id}/links/{target}/{target_id}",
    summary="Link a note or document to a workout",
    responses=_INVALID,
)
async def link_session(
    session_id: SessionId,
    target: LinkTargetKind,
    target_id: uuid.UUID,
    owner: OwnerDep,
    fitness: FitnessDep,
) -> LinkListResponse:
    return await _link(fitness, owner, "session", session_id, target, target_id)


@router.delete(
    "/sessions/{session_id}/links/{target}/{target_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unlink a note or document from a workout",
)
async def unlink_session(
    session_id: SessionId,
    target: LinkTargetKind,
    target_id: uuid.UUID,
    owner: OwnerDep,
    fitness: FitnessDep,
) -> Response:
    with _errors():
        await fitness.integrations.unlink(owner, "session", session_id, target, target_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Records and analytics


@router.get("/records", summary="Personal records")
async def records(owner: OwnerDep, fitness: FitnessDep) -> RecordListResponse:
    """Every applicable record per exercise. One-rep maxes are estimates (`estimated`)."""
    result = await fitness.workouts.records(owner)
    return RecordListResponse(records=[PersonalRecordResponse.of(r) for r in result])


@router.get("/analytics", summary="Workout analytics for a date range", responses=_INVALID)
async def analytics(
    params: Annotated[AnalyticsParams, Query()], owner: OwnerDep, fitness: FitnessDep
) -> WorkoutAnalyticsResponse:
    with _errors():
        result = await fitness.workouts.analytics(owner, params.start, params.end, params.date)
    return WorkoutAnalyticsResponse.of(result)


# Body


@router.get("/measurements", summary="Body measurements and BMI")
async def list_measurements(
    params: Annotated[MeasurementListParams, Query()], owner: OwnerDep, fitness: FitnessDep
) -> MeasurementListResponse:
    measurements = await fitness.body.measurements(owner, params.start, params.end)
    bmi = await fitness.body.bmi(owner)
    return MeasurementListResponse(
        measurements=[MeasurementResponse.of(m) for m in measurements],
        bmi=BmiResponse.of(bmi) if bmi else None,
    )


@router.post(
    "/measurements",
    status_code=status.HTTP_201_CREATED,
    summary="Record measurements",
    responses=_INVALID,
)
async def create_measurement(
    body: MeasurementRequest, owner: OwnerDep, fitness: FitnessDep
) -> MeasurementResponse:
    with _errors():
        return MeasurementResponse.of(await fitness.body.add_measurement(owner, body.to_draft()))


@router.put("/measurements/{measurement_id}", summary="Correct measurements", responses=_INVALID)
async def update_measurement(
    measurement_id: RecordId, body: MeasurementRequest, owner: OwnerDep, fitness: FitnessDep
) -> MeasurementResponse:
    with _errors():
        measurement = await fitness.body.update_measurement(owner, measurement_id, body.to_draft())
    return MeasurementResponse.of(measurement)


@router.delete(
    "/measurements/{measurement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete measurements",
)
async def delete_measurement(
    measurement_id: RecordId, owner: OwnerDep, fitness: FitnessDep
) -> Response:
    with _errors():
        await fitness.body.delete_measurement(owner, measurement_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/photos", summary="Progress photos")
async def list_photos(owner: OwnerDep, fitness: FitnessDep) -> PhotoListResponse:
    return PhotoListResponse(photos=[PhotoResponse.of(p) for p in await fitness.body.photos(owner)])


@router.post(
    "/photos",
    status_code=status.HTTP_201_CREATED,
    summary="Upload a progress photo",
    openapi_extra=_UPLOAD_BODY,
    responses={
        413: {"description": "The image is larger than the server accepts."},
        415: {"description": "Not a PNG, JPEG, or WebP image."},
    },
)
async def upload_photo(
    params: Annotated[PhotoUploadParams, Query()],
    request: Request,
    owner: OwnerDep,
    fitness: FitnessDep,
    settings: SettingsDep,
) -> PhotoResponse:
    """The body is the image. Its type comes from the file name and must match its bytes. It's
    kept in the attachment store and served only to you."""
    data = await read_body(request, limit=settings.attachment_max_bytes, what="Photos")
    try:
        photo = await fitness.body.add_photo(
            owner, day=params.day, note=params.note, filename=params.filename, data=data
        )
    except FileTypeError as exc:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, str(exc)) from None
    return PhotoResponse.of(photo)


@router.get(
    "/photos/{photo_id}/file",
    summary="Download a progress photo",
    response_class=Response,
    responses=_FILE,
)
async def photo_file(photo_id: RecordId, owner: OwnerDep, fitness: FitnessDep) -> Response:
    with _errors():
        photo, path = await fitness.body.photo_file(owner, photo_id)
    extension = photo.content_type.removeprefix("image/").replace("jpeg", "jpg")
    return download_response(path, photo.content_type, f"progress-{photo.day}.{extension}")


@router.delete(
    "/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a progress photo"
)
async def delete_photo(photo_id: RecordId, owner: OwnerDep, fitness: FitnessDep) -> Response:
    with _errors():
        await fitness.body.delete_photo(owner, photo_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Nutrition


@router.get("/foods", summary="Saved foods")
async def list_foods(owner: OwnerDep, fitness: FitnessDep) -> FoodListResponse:
    return FoodListResponse(
        foods=[FoodResponse.of(f) for f in await fitness.nutrition.foods(owner)]
    )


@router.post(
    "/foods", status_code=status.HTTP_201_CREATED, summary="Save a food", responses=_INVALID
)
async def create_food(body: FoodRequest, owner: OwnerDep, fitness: FitnessDep) -> FoodResponse:
    return FoodResponse.of(await fitness.nutrition.create_food(owner, body.to_draft()))


@router.put("/foods/{food_id}", summary="Edit a saved food", responses=_INVALID)
async def update_food(
    food_id: RecordId, body: FoodRequest, owner: OwnerDep, fitness: FitnessDep
) -> FoodResponse:
    """Entries already logged keep their nutrients."""
    with _errors():
        return FoodResponse.of(await fitness.nutrition.update_food(owner, food_id, body.to_draft()))


@router.delete(
    "/foods/{food_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a saved food"
)
async def delete_food(food_id: RecordId, owner: OwnerDep, fitness: FitnessDep) -> Response:
    with _errors():
        await fitness.nutrition.delete_food(owner, food_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/meals", summary="Saved meals")
async def list_meals(owner: OwnerDep, fitness: FitnessDep) -> MealListResponse:
    return MealListResponse(
        meals=[MealResponse.of(m) for m in await fitness.nutrition.meals(owner)]
    )


@router.post(
    "/meals", status_code=status.HTTP_201_CREATED, summary="Save a meal", responses=_INVALID
)
async def create_meal(body: MealRequest, owner: OwnerDep, fitness: FitnessDep) -> MealResponse:
    with _errors():
        return MealResponse.of(await fitness.nutrition.create_meal(owner, body.to_draft()))


@router.put("/meals/{meal_id}", summary="Edit a saved meal", responses=_INVALID)
async def update_meal(
    meal_id: RecordId, body: MealRequest, owner: OwnerDep, fitness: FitnessDep
) -> MealResponse:
    with _errors():
        return MealResponse.of(await fitness.nutrition.update_meal(owner, meal_id, body.to_draft()))


@router.delete(
    "/meals/{meal_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a saved meal"
)
async def delete_meal(meal_id: RecordId, owner: OwnerDep, fitness: FitnessDep) -> Response:
    with _errors():
        await fitness.nutrition.delete_meal(owner, meal_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/meals/{meal_id}/log",
    status_code=status.HTTP_201_CREATED,
    summary="Log a saved meal",
)
async def log_meal(
    meal_id: RecordId, body: LogMealRequest, owner: OwnerDep, fitness: FitnessDep
) -> FoodEntryListResponse:
    """Adds an entry for each item."""
    with _errors():
        entries = await fitness.nutrition.log_meal(owner, meal_id, body.day, body.meal)
    return FoodEntryListResponse(entries=[FoodEntryResponse.of(e) for e in entries])


@router.get("/nutrition", summary="A day's food entries and totals")
async def nutrition_day(
    params: Annotated[DayParams, Query()], owner: OwnerDep, fitness: FitnessDep
) -> NutritionDayResponse:
    return NutritionDayResponse.of(await fitness.nutrition.day(owner, params.date))


@router.get("/nutrition/history", summary="Daily nutrition totals", responses=_INVALID)
async def nutrition_history(
    params: Annotated[RangeParams, Query()], owner: OwnerDep, fitness: FitnessDep
) -> NutritionHistoryResponse:
    with _errors():
        days = await fitness.nutrition.history(owner, params.start, params.end)
    return NutritionHistoryResponse(days=[DayTotalResponse.of(d) for d in days])


@router.post(
    "/food-entries",
    status_code=status.HTTP_201_CREATED,
    summary="Log food",
    responses=_INVALID,
)
async def create_food_entry(
    body: FoodEntryRequest, owner: OwnerDep, fitness: FitnessDep
) -> FoodEntryResponse:
    with _errors():
        return FoodEntryResponse.of(await fitness.nutrition.add_entry(owner, body.to_draft()))


@router.put("/food-entries/{entry_id}", summary="Edit a food entry", responses=_INVALID)
async def update_food_entry(
    entry_id: RecordId, body: FoodEntryRequest, owner: OwnerDep, fitness: FitnessDep
) -> FoodEntryResponse:
    with _errors():
        entry = await fitness.nutrition.update_entry(owner, entry_id, body.to_draft())
    return FoodEntryResponse.of(entry)


@router.delete(
    "/food-entries/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a food entry",
)
async def delete_food_entry(entry_id: RecordId, owner: OwnerDep, fitness: FitnessDep) -> Response:
    with _errors():
        await fitness.nutrition.delete_entry(owner, entry_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/water", summary="A day's water")
async def water_day(
    params: Annotated[DayParams, Query()], owner: OwnerDep, fitness: FitnessDep
) -> WaterDayResponse:
    return WaterDayResponse.of(await fitness.nutrition.water_day(owner, params.date))


@router.get("/water/history", summary="Daily water totals", responses=_INVALID)
async def water_history(
    params: Annotated[RangeParams, Query()], owner: OwnerDep, fitness: FitnessDep
) -> WaterHistoryResponse:
    with _errors():
        days = await fitness.nutrition.water_history(owner, params.start, params.end)
    return WaterHistoryResponse(days=[WaterTotalResponse(day=d, total_ml=t) for d, t in days])


@router.post("/water", status_code=status.HTTP_201_CREATED, summary="Add water", responses=_INVALID)
async def add_water(body: WaterRequest, owner: OwnerDep, fitness: FitnessDep) -> WaterDayResponse:
    """Applies the day to habits that count water."""
    return WaterDayResponse.of(await fitness.nutrition.add_water(owner, body.day, body.amount_ml))


@router.delete("/water/{entry_id}", summary="Remove a water entry")
async def delete_water(
    entry_id: RecordId, owner: OwnerDep, fitness: FitnessDep
) -> WaterDayResponse:
    with _errors():
        return WaterDayResponse.of(await fitness.nutrition.delete_water(owner, entry_id))


# Activity


@router.get("/activities", summary="Activity entries")
async def list_activities(
    params: Annotated[ActivityListParams, Query()], owner: OwnerDep, fitness: FitnessDep
) -> ActivityListResponse:
    activities = await fitness.tracking.activities(
        owner, params.start, params.end, params.kind, params.limit
    )
    return ActivityListResponse(activities=[ActivityResponse.of(a) for a in activities])


@router.post(
    "/activities",
    status_code=status.HTTP_201_CREATED,
    summary="Record activity",
    responses=_INVALID,
)
async def create_activity(
    body: ActivityRequest, owner: OwnerDep, fitness: FitnessDep
) -> ActivityResponse:
    """Applies the day to habits that count this kind of activity."""
    with _errors():
        return ActivityResponse.of(await fitness.tracking.add_activity(owner, body.to_draft()))


@router.put("/activities/{activity_id}", summary="Correct an activity entry", responses=_INVALID)
async def update_activity(
    activity_id: RecordId, body: ActivityRequest, owner: OwnerDep, fitness: FitnessDep
) -> ActivityResponse:
    with _errors():
        activity = await fitness.tracking.update_activity(owner, activity_id, body.to_draft())
    return ActivityResponse.of(activity)


@router.delete(
    "/activities/{activity_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an activity entry",
)
async def delete_activity(activity_id: RecordId, owner: OwnerDep, fitness: FitnessDep) -> Response:
    with _errors():
        await fitness.tracking.delete_activity(owner, activity_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Goals


@router.get("/goals", summary="Fitness goals with their progress")
async def list_goals(
    params: Annotated[GoalListParams, Query()], owner: OwnerDep, fitness: FitnessDep
) -> FitnessGoalListResponse:
    statuses = () if params.status == "all" else (params.status,)
    goals = await fitness.tracking.goals(owner, params.date, statuses)
    return FitnessGoalListResponse(goals=[FitnessGoalResponse.of(g) for g in goals])


@router.post(
    "/goals", status_code=status.HTTP_201_CREATED, summary="Create a goal", responses=_INVALID
)
async def create_goal(
    body: GoalRequest,
    params: Annotated[GoalDateParams, Query()],
    owner: OwnerDep,
    fitness: FitnessDep,
) -> FitnessGoalResponse:
    with _errors():
        goal = await fitness.tracking.create_goal(owner, body.to_draft(), params.date)
    return FitnessGoalResponse.of(goal)


@router.get("/goals/{goal_id}", summary="Get a goal with its history and milestones")
async def get_goal(
    goal_id: RecordId,
    params: Annotated[GoalDateParams, Query()],
    owner: OwnerDep,
    fitness: FitnessDep,
) -> FitnessGoalResponse:
    with _errors():
        return FitnessGoalResponse.of(await fitness.tracking.goal(owner, goal_id, params.date))


@router.put("/goals/{goal_id}", summary="Edit a goal", responses=_INVALID)
async def update_goal(
    goal_id: RecordId,
    body: GoalRequest,
    params: Annotated[GoalDateParams, Query()],
    owner: OwnerDep,
    fitness: FitnessDep,
) -> FitnessGoalResponse:
    with _errors():
        goal = await fitness.tracking.update_goal(owner, goal_id, body.to_draft(), params.date)
    return FitnessGoalResponse.of(goal)


@router.post("/goals/{goal_id}/status", summary="Pause, resume, complete, or reopen a goal")
async def set_goal_status(
    goal_id: RecordId,
    body: GoalStatusRequest,
    params: Annotated[GoalDateParams, Query()],
    owner: OwnerDep,
    fitness: FitnessDep,
) -> FitnessGoalResponse:
    with _errors():
        goal = await fitness.tracking.set_status(owner, goal_id, body.status, params.date)
    return FitnessGoalResponse.of(goal)


@router.delete("/goals/{goal_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a goal")
async def delete_goal(goal_id: RecordId, owner: OwnerDep, fitness: FitnessDep) -> Response:
    with _errors():
        await fitness.tracking.delete_goal(owner, goal_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/goals/{goal_id}/check-ins",
    status_code=status.HTTP_201_CREATED,
    summary="Record progress on a goal",
    responses={**_INVALID, **_CONFLICT},
)
async def check_in(
    goal_id: RecordId,
    body: CheckInRequest,
    params: Annotated[GoalDateParams, Query()],
    owner: OwnerDep,
    fitness: FitnessDep,
) -> FitnessGoalResponse:
    """Auto-tracked goals read their records instead (409)."""
    with _errors():
        goal = await fitness.tracking.check_in(
            owner, goal_id, body.day, body.value, body.note, params.date
        )
    return FitnessGoalResponse.of(goal)


@router.delete("/goals/{goal_id}/check-ins/{check_in_id}", summary="Delete a check-in")
async def delete_check_in(
    goal_id: RecordId,
    check_in_id: uuid.UUID,
    params: Annotated[GoalDateParams, Query()],
    owner: OwnerDep,
    fitness: FitnessDep,
) -> FitnessGoalResponse:
    with _errors():
        goal = await fitness.tracking.delete_check_in(owner, goal_id, check_in_id, params.date)
    return FitnessGoalResponse.of(goal)


@router.put(
    "/goals/{goal_id}/links/{target}/{target_id}",
    summary="Link a note or document to a goal",
    responses=_INVALID,
)
async def link_goal(
    goal_id: RecordId,
    target: LinkTargetKind,
    target_id: uuid.UUID,
    owner: OwnerDep,
    fitness: FitnessDep,
) -> LinkListResponse:
    return await _link(fitness, owner, "goal", goal_id, target, target_id)


@router.delete(
    "/goals/{goal_id}/links/{target}/{target_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unlink a note or document from a goal",
)
async def unlink_goal(
    goal_id: RecordId,
    target: LinkTargetKind,
    target_id: uuid.UUID,
    owner: OwnerDep,
    fitness: FitnessDep,
) -> Response:
    with _errors():
        await fitness.integrations.unlink(owner, "goal", goal_id, target, target_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Habits


@router.get("/habit-links", summary="Habits linked to health records")
async def list_habit_links(owner: OwnerDep, fitness: FitnessDep) -> HabitLinkListResponse:
    links = await fitness.integrations.habit_links(owner)
    return HabitLinkListResponse(links=[HabitLinkResponse.of(link) for link in links])


@router.put("/habit-links", summary="Link a habit to a kind of record", responses=_INVALID)
async def put_habit_link(
    body: HabitLinkRequest, owner: OwnerDep, fitness: FitnessDep
) -> HabitLinkResponse:
    """One link per habit; sending another replaces it. With `contributes`, matching records
    saved from now on record progress on the habit. Completing a habit never creates a health
    record."""
    with _errors():
        return HabitLinkResponse.of(await fitness.integrations.link_habit(owner, body.to_draft()))


@router.delete(
    "/habit-links/{habit_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unlink a habit",
)
async def delete_habit_link(habit_id: uuid.UUID, owner: OwnerDep, fitness: FitnessDep) -> Response:
    with _errors():
        await fitness.integrations.unlink_habit(owner, habit_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Calendar


@router.get("/schedule", summary="Scheduled workouts in a date range")
async def list_scheduled(
    params: Annotated[ScheduleParams, Query()],
    owner: OwnerDep,
    user: CurrentUserDep,
    fitness: FitnessDep,
) -> ScheduledWorkoutListResponse:
    if params.end <= params.start or params.end - params.start > timedelta(days=62):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose a range of up to 62 days."
        )
    workouts = await fitness.integrations.scheduled(
        owner, params.start, params.end, _timezone(params.timezone, user)
    )
    return ScheduledWorkoutListResponse(workouts=[ScheduledWorkoutResponse.of(w) for w in workouts])


@router.post(
    "/schedule",
    status_code=status.HTTP_201_CREATED,
    summary="Schedule a workout on the calendar",
    responses=_INVALID,
)
async def schedule_workout(
    body: ScheduleWorkoutRequest,
    owner: OwnerDep,
    user: CurrentUserDep,
    fitness: FitnessDep,
    calendar: CalendarServiceDep,
) -> ScheduledWorkoutResponse:
    """Creates an ordinary calendar event (alerts notify through the reminder system) and
    links it to the template."""
    title = body.title
    if body.template_id is not None:
        with _errors():
            template = await fitness.library.template(owner, body.template_id)
        title = title or template.name
    draft = EventDraft(
        title=title or "Workout",
        start=body.start,
        end=body.end,
        timezone=body.timezone,
        alerts=tuple(body.alerts),
    )
    try:
        event = await calendar.create_event(
            owner.workspace_id, draft, default_timezone=user.timezone
        )
    except InvalidEventTimesError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    with _errors():
        scheduled = await fitness.integrations.link_event(owner, event.event.id, body.template_id)
    return ScheduledWorkoutResponse.of(scheduled)


@router.get("/schedule/{event_id}", summary="The workout a calendar event schedules")
async def get_scheduled(
    event_id: uuid.UUID, owner: OwnerDep, fitness: FitnessDep
) -> ScheduledWorkoutResponse:
    """404 when the event isn't a scheduled workout."""
    with _errors():
        return ScheduledWorkoutResponse.of(
            await fitness.integrations.scheduled_for_event(owner, event_id)
        )


@router.put(
    "/schedule/{event_id}", summary="Mark a calendar event as a workout", responses=_INVALID
)
async def link_scheduled(
    event_id: uuid.UUID, body: LinkEventRequest, owner: OwnerDep, fitness: FitnessDep
) -> ScheduledWorkoutResponse:
    """Use an existing event rather than creating a second one."""
    with _errors():
        scheduled = await fitness.integrations.link_event(owner, event_id, body.template_id)
    return ScheduledWorkoutResponse.of(scheduled)


@router.delete(
    "/schedule/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Stop treating an event as a workout",
)
async def unlink_scheduled(event_id: uuid.UUID, owner: OwnerDep, fitness: FitnessDep) -> Response:
    """The event stays on the calendar."""
    with _errors():
        await fitness.integrations.unlink_event(owner, event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
