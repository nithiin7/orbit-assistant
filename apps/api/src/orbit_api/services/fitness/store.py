"""The storage operations the health and fitness services need. Every method takes the owner (a
person in a workspace), or a workspace for rows reached through an owned parent, and the
implementation filters by it, so one person's records never reach another."""

import uuid
from collections.abc import Sequence
from datetime import date
from typing import Protocol

from orbit_api.services.fitness.models import (
    Activity,
    ActivityKind,
    Exercise,
    Food,
    FoodEntry,
    Goal,
    GoalCheckIn,
    GoalStatus,
    HabitLink,
    HabitLinkDraft,
    HabitSource,
    LinkedRecord,
    LinkOwnerKind,
    LinkTargetKind,
    Measurement,
    Owner,
    Photo,
    Profile,
    SavedMeal,
    Session,
    SessionExercise,
    SessionStatus,
    Template,
    WaterEntry,
    WorkoutSet,
)


class FitnessStore(Protocol):
    # Profile

    async def get_profile(self, owner: Owner) -> Profile | None: ...

    async def put_profile(self, profile: Profile) -> None: ...

    # Exercises

    async def exercises(self, owner: Owner) -> list[Exercise]: ...

    async def get_exercise(self, owner: Owner, exercise_id: uuid.UUID) -> Exercise | None: ...

    async def add_exercises(self, exercises: Sequence[Exercise]) -> None:
        """Insert exercises. A built-in that a concurrent request already created fails the
        commit with `ConflictError`."""
        ...

    async def save_exercise(self, exercise: Exercise) -> None: ...

    async def delete_exercise(self, owner: Owner, exercise_id: uuid.UUID) -> bool: ...

    async def exercise_in_use(self, owner: Owner, exercise_id: uuid.UUID) -> bool: ...

    # Templates

    async def templates(self, owner: Owner) -> list[Template]: ...

    async def get_template(self, owner: Owner, template_id: uuid.UUID) -> Template | None: ...

    async def put_template(self, template: Template) -> None:
        """Insert or update the template, replacing its exercises."""
        ...

    async def delete_template(self, owner: Owner, template_id: uuid.UUID) -> bool: ...

    # Sessions

    async def unfinished_session(self, owner: Owner) -> Session | None: ...

    async def get_session(self, owner: Owner, session_id: uuid.UUID) -> Session | None: ...

    async def sessions(
        self,
        owner: Owner,
        *,
        start: date | None = None,
        end: date | None = None,
        statuses: Sequence[SessionStatus] = (),
        calendar_event_id: uuid.UUID | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[Session]:
        """Newest first."""
        ...

    async def count_sessions(
        self, owner: Owner, *, start: date | None, end: date | None, statuses: Sequence[str]
    ) -> int: ...

    async def add_session(self, session: Session) -> None: ...

    async def save_session(self, session: Session) -> None: ...

    async def delete_session(self, owner: Owner, session_id: uuid.UUID) -> bool: ...

    async def session_exercises(
        self, workspace_id: uuid.UUID, session_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[SessionExercise]]:
        """Each session's exercises in order, with their sets in order."""
        ...

    async def performed(
        self, owner: Owner, exercise_ids: Sequence[uuid.UUID] | None = None
    ) -> list[tuple[Session, SessionExercise]]:
        """Exercises in completed workouts (all, or only these library exercises), oldest
        first."""
        ...

    async def add_session_exercise(self, workspace_id: uuid.UUID, item: SessionExercise) -> None:
        """Insert the exercise and its sets."""
        ...

    async def save_session_exercise(self, workspace_id: uuid.UUID, item: SessionExercise) -> None:
        """Update position, rest, and notes (not sets)."""
        ...

    async def delete_session_exercise(
        self, workspace_id: uuid.UUID, item_id: uuid.UUID
    ) -> None: ...

    async def add_set(
        self, workspace_id: uuid.UUID, session_exercise_id: uuid.UUID, item: WorkoutSet
    ) -> None: ...

    async def save_set(self, workspace_id: uuid.UUID, item: WorkoutSet) -> None: ...

    async def delete_set(self, workspace_id: uuid.UUID, set_id: uuid.UUID) -> None: ...

    # Body

    async def measurements(
        self, owner: Owner, start: date | None = None, end: date | None = None
    ) -> list[Measurement]:
        """Oldest first."""
        ...

    async def get_measurement(
        self, owner: Owner, measurement_id: uuid.UUID
    ) -> Measurement | None: ...

    async def put_measurement(self, measurement: Measurement) -> None: ...

    async def delete_measurement(self, owner: Owner, measurement_id: uuid.UUID) -> bool: ...

    async def photos(self, owner: Owner) -> list[Photo]:
        """Newest first."""
        ...

    async def get_photo(self, owner: Owner, photo_id: uuid.UUID) -> Photo | None: ...

    async def add_photo(self, photo: Photo) -> None: ...

    async def delete_photo(self, owner: Owner, photo_id: uuid.UUID) -> bool: ...

    # Nutrition

    async def foods(self, owner: Owner) -> list[Food]: ...

    async def get_food(self, owner: Owner, food_id: uuid.UUID) -> Food | None: ...

    async def put_food(self, food: Food) -> None: ...

    async def delete_food(self, owner: Owner, food_id: uuid.UUID) -> bool: ...

    async def meals(self, owner: Owner) -> list[SavedMeal]: ...

    async def get_meal(self, owner: Owner, meal_id: uuid.UUID) -> SavedMeal | None: ...

    async def put_meal(self, meal: SavedMeal) -> None:
        """Insert or update the meal, replacing its items."""
        ...

    async def delete_meal(self, owner: Owner, meal_id: uuid.UUID) -> bool: ...

    async def food_entries(self, owner: Owner, start: date, end: date) -> list[FoodEntry]: ...

    async def get_food_entry(self, owner: Owner, entry_id: uuid.UUID) -> FoodEntry | None: ...

    async def put_food_entry(self, entry: FoodEntry) -> None: ...

    async def delete_food_entry(self, owner: Owner, entry_id: uuid.UUID) -> bool: ...

    async def water_entries(self, owner: Owner, start: date, end: date) -> list[WaterEntry]: ...

    async def get_water_entry(self, owner: Owner, entry_id: uuid.UUID) -> WaterEntry | None: ...

    async def add_water_entry(self, entry: WaterEntry) -> None: ...

    async def delete_water_entry(self, owner: Owner, entry_id: uuid.UUID) -> bool: ...

    # Activity

    async def activities(
        self,
        owner: Owner,
        start: date | None = None,
        end: date | None = None,
        kind: ActivityKind | None = None,
        limit: int | None = None,
    ) -> list[Activity]:
        """Newest first."""
        ...

    async def get_activity(self, owner: Owner, activity_id: uuid.UUID) -> Activity | None: ...

    async def put_activity(self, activity: Activity) -> None: ...

    async def delete_activity(self, owner: Owner, activity_id: uuid.UUID) -> bool: ...

    # Goals

    async def goals(self, owner: Owner, statuses: Sequence[GoalStatus] = ()) -> list[Goal]: ...

    async def get_goal(self, owner: Owner, goal_id: uuid.UUID) -> Goal | None: ...

    async def put_goal(self, goal: Goal) -> None: ...

    async def delete_goal(self, owner: Owner, goal_id: uuid.UUID) -> bool: ...

    async def check_ins(
        self, workspace_id: uuid.UUID, goal_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[GoalCheckIn]]: ...

    async def add_check_in(
        self, workspace_id: uuid.UUID, goal_id: uuid.UUID, check_in: GoalCheckIn
    ) -> None: ...

    async def delete_check_in(
        self, workspace_id: uuid.UUID, goal_id: uuid.UUID, check_in_id: uuid.UUID
    ) -> bool: ...

    # Integrations

    async def habit(self, workspace_id: uuid.UUID, habit_id: uuid.UUID) -> tuple[str, str] | None:
        """A habit's name and kind, if it's in the workspace."""
        ...

    async def habit_links(
        self, owner: Owner, source: HabitSource | None = None
    ) -> list[HabitLink]: ...

    async def put_habit_link(
        self, owner: Owner, link_id: uuid.UUID, draft: HabitLinkDraft
    ) -> None: ...

    async def delete_habit_link(self, owner: Owner, habit_id: uuid.UUID) -> bool: ...

    async def event_title(self, workspace_id: uuid.UUID, event_id: uuid.UUID) -> str | None: ...

    async def workout_events(
        self, owner: Owner, event_ids: Sequence[uuid.UUID] | None = None
    ) -> dict[uuid.UUID, uuid.UUID | None]:
        """Scheduled workouts' calendar events and their templates."""
        ...

    async def put_workout_event(
        self, owner: Owner, event_id: uuid.UUID, template_id: uuid.UUID | None
    ) -> None: ...

    async def delete_workout_event(self, owner: Owner, event_id: uuid.UUID) -> bool: ...

    async def record_title(
        self, workspace_id: uuid.UUID, kind: LinkTargetKind, record_id: uuid.UUID
    ) -> str | None:
        """A note's or document's title, if it's in the workspace (trashed ones aren't)."""
        ...

    async def links(
        self, owner: Owner, kind: LinkOwnerKind, owner_id: uuid.UUID
    ) -> list[LinkedRecord]: ...

    async def put_link(
        self,
        owner: Owner,
        kind: LinkOwnerKind,
        owner_id: uuid.UUID,
        target: LinkTargetKind,
        target_id: uuid.UUID,
    ) -> None:
        """Idempotent."""
        ...

    async def delete_link(
        self,
        owner: Owner,
        kind: LinkOwnerKind,
        owner_id: uuid.UUID,
        target: LinkTargetKind,
        target_id: uuid.UUID,
    ) -> bool: ...
