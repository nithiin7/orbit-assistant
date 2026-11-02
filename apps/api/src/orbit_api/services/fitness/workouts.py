"""Workout sessions: starting (empty, from a template, or from a scheduled calendar event),
pausing, resuming, completing, abandoning, logging a finished workout afterwards, editing
exercises and sets, history, records, and analytics.

- **One unfinished workout** (active or paused) per person and workspace, backed by a partial
  unique index. Every change is saved as it's made, so a refresh or a closed app never loses a
  workout in progress.
- **Snapshots.** Adding an exercise copies its name, type, category, and primary muscles, and
  starting from a template copies the template's exercises and targets into sets, so editing
  the library or the template later never changes this workout.
- **Duration** is the time from start to end minus time spent paused. Ended workouts can have
  their start and end corrected; the duration follows.
- Completing or correcting a workout applies its day to habits that count workouts (see
  `integrations.py`).
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import date, datetime, timedelta

from orbit_api.services.fitness.integrations import Contributions
from orbit_api.services.fitness.models import (
    MAX_SESSION_EXERCISES,
    MAX_SETS_PER_EXERCISE,
    Exercise,
    ExerciseHistory,
    ExerciseSnapshot,
    FitnessConflictError,
    FitnessNotFoundError,
    InvalidFitnessError,
    LoggedSession,
    Owner,
    PersonalRecord,
    PreviousPerformance,
    Session,
    SessionChanges,
    SessionDetail,
    SessionExercise,
    SessionStart,
    SessionStatus,
    SessionSummary,
    SetValues,
    TemplateExercise,
    WorkoutAnalytics,
    WorkoutSet,
)
from orbit_api.services.fitness.records import (
    Performed,
    analytics,
    exercise_point,
    personal_records,
    session_volume_g,
)
from orbit_api.services.fitness.store import FitnessStore
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now

MAX_WORKOUT = timedelta(hours=48)
MAX_ANALYTICS_DAYS = 731


def snapshot(exercise: Exercise) -> ExerciseSnapshot:
    return ExerciseSnapshot(
        name=exercise.details.name,
        exercise_type=exercise.details.exercise_type,
        category=exercise.details.category,
        primary_muscles=exercise.details.primary_muscles,
    )


def planned_sets(item: TemplateExercise) -> tuple[WorkoutSet, ...]:
    """A template exercise's default sets, filled with its targets, not yet done."""
    plan = item.plan
    values = SetValues(
        reps=plan.target_reps_max or plan.target_reps_min,
        weight_g=plan.target_weight_g,
        duration_s=plan.target_duration_s,
        distance_m=plan.target_distance_m,
    )
    return tuple(
        WorkoutSet(id=uuid.uuid4(), position=n, values=values, completed_at=None)
        for n in range(plan.sets)
    )


def _elapsed(session: Session, end: datetime) -> int:
    paused = session.paused_seconds
    if session.paused_at is not None:
        paused += max(0, int((end - session.paused_at).total_seconds()))
    return max(0, int((end - session.started_at).total_seconds()) - paused)


def _check_set(values: SetValues) -> None:
    if values.rpe is not None and (values.rpe * 2) % 1 != 0:
        raise InvalidFitnessError("Effort (RPE) goes in steps of 0.5.")


class WorkoutService:
    def __init__(
        self,
        store: FitnessStore,
        contributions: Contributions,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._contributions = contributions
        self._transaction = transaction
        self._clock = clock

    # Sessions

    async def active(self, owner: Owner) -> SessionDetail | None:
        session = await self._store.unfinished_session(owner)
        return await self._detail(owner, session) if session else None

    async def start(self, owner: Owner, start: SessionStart) -> SessionDetail:
        if await self._store.unfinished_session(owner) is not None:
            raise FitnessConflictError("You already have a workout in progress. Finish it first.")
        template_id = start.template_id
        name = start.name
        if start.calendar_event_id is not None:
            events = await self._store.workout_events(owner, [start.calendar_event_id])
            if start.calendar_event_id not in events:
                raise InvalidFitnessError("That event isn't a scheduled workout.")
            template_id = template_id or events[start.calendar_event_id]
            name = name or await self._store.event_title(
                owner.workspace_id, start.calendar_event_id
            )
        template = None
        if template_id is not None:
            template = await self._store.get_template(owner, template_id)
            if template is None:
                raise InvalidFitnessError("That template doesn't exist.")
        now = self._clock()
        session = Session(
            id=uuid.uuid4(),
            owner=owner,
            template_id=template.id if template else None,
            calendar_event_id=start.calendar_event_id,
            name=(name or (template.name if template else "Workout"))[:100],
            day=start.day,
            timezone=start.timezone,
            status="active",
            started_at=now,
            ended_at=None,
            paused_at=None,
            paused_seconds=0,
            duration_s=None,
            notes="",
            created_at=now,
            updated_at=now,
        )
        await self._store.add_session(session)
        for item in template.exercises if template else ():
            await self._store.add_session_exercise(
                owner.workspace_id,
                SessionExercise(
                    id=uuid.uuid4(),
                    session_id=session.id,
                    exercise_id=item.exercise.id,
                    position=item.position,
                    snapshot=snapshot(item.exercise),
                    rest_seconds=item.plan.rest_seconds,
                    notes=item.plan.notes,
                    sets=planned_sets(item),
                ),
            )
        try:
            await self._transaction.commit()
        except ConflictError:
            raise FitnessConflictError(
                "You already have a workout in progress. Finish it first."
            ) from None
        return await self._detail(owner, session)

    async def log(self, owner: Owner, logged: LoggedSession) -> SessionDetail:
        """Record a workout that already happened, as completed."""
        if logged.ended_at < logged.started_at:
            raise InvalidFitnessError("A workout can't end before it starts.")
        if logged.ended_at - logged.started_at > MAX_WORKOUT:
            raise InvalidFitnessError("A workout can be at most 48 hours long.")
        if logged.ended_at > self._clock() + timedelta(minutes=5):
            raise InvalidFitnessError("A logged workout can't end in the future.")
        if len(logged.exercises) > MAX_SESSION_EXERCISES:
            raise InvalidFitnessError(
                f"A workout can have at most {MAX_SESSION_EXERCISES} exercises."
            )
        template = None
        if logged.template_id is not None:
            template = await self._store.get_template(owner, logged.template_id)
            if template is None:
                raise InvalidFitnessError("That template doesn't exist.")
        now = self._clock()
        session = Session(
            id=uuid.uuid4(),
            owner=owner,
            template_id=logged.template_id,
            calendar_event_id=None,
            name=logged.name,
            day=logged.day,
            timezone=logged.timezone,
            status="completed",
            started_at=logged.started_at,
            ended_at=logged.ended_at,
            paused_at=None,
            paused_seconds=0,
            duration_s=int((logged.ended_at - logged.started_at).total_seconds()),
            notes=logged.notes,
            created_at=now,
            updated_at=now,
        )
        await self._store.add_session(session)
        for position, item in enumerate(logged.exercises):
            exercise = await self._require_exercise(owner, item.exercise_id)
            if len(item.sets) > MAX_SETS_PER_EXERCISE:
                raise InvalidFitnessError(
                    f"An exercise can have at most {MAX_SETS_PER_EXERCISE} sets."
                )
            for values in item.sets:
                _check_set(values)
            await self._store.add_session_exercise(
                owner.workspace_id,
                SessionExercise(
                    id=uuid.uuid4(),
                    session_id=session.id,
                    exercise_id=exercise.id,
                    position=position,
                    snapshot=snapshot(exercise),
                    rest_seconds=None,
                    notes=item.notes,
                    sets=tuple(
                        WorkoutSet(
                            id=uuid.uuid4(),
                            position=n,
                            values=values,
                            completed_at=logged.ended_at if values.completed else None,
                        )
                        for n, values in enumerate(item.sets)
                    ),
                ),
            )
        await self._contributions.workouts(owner, session.day)
        await self._transaction.commit()
        return await self._detail(owner, session)

    async def get(self, owner: Owner, session_id: uuid.UUID) -> SessionDetail:
        return await self._detail(owner, await self._require(owner, session_id))

    async def find(
        self,
        owner: Owner,
        *,
        start: date | None = None,
        end: date | None = None,
        statuses: Sequence[SessionStatus] = (),
        limit: int | None = None,
        offset: int = 0,
    ) -> list[SessionSummary]:
        sessions = await self._store.sessions(
            owner, start=start, end=end, statuses=statuses, limit=limit, offset=offset
        )
        return await self.summaries(owner, sessions)

    async def summaries(self, owner: Owner, sessions: Sequence[Session]) -> list[SessionSummary]:
        exercises = await self._store.session_exercises(
            owner.workspace_id, [s.id for s in sessions]
        )
        result: list[SessionSummary] = []
        for session in sessions:
            items = exercises.get(session.id, [])
            result.append(
                SessionSummary(
                    session=session,
                    exercise_count=len(items),
                    set_count=sum(1 for e in items for s in e.sets if s.values.completed),
                    volume_g=session_volume_g(items),
                )
            )
        return result

    async def update(
        self, owner: Owner, session_id: uuid.UUID, changes: SessionChanges
    ) -> SessionDetail:
        session = await self._require(owner, session_id)
        timing = changes.started_at is not UNSET or changes.ended_at is not UNSET
        if timing and not session.finished:
            raise FitnessConflictError("Start and end times can be corrected once it has ended.")
        updated = session
        if changes.name is not UNSET:
            updated = replace(updated, name=changes.name)
        if changes.notes is not UNSET:
            updated = replace(updated, notes=changes.notes)
        if changes.day is not UNSET:
            updated = replace(updated, day=changes.day)
        if changes.started_at is not UNSET:
            updated = replace(updated, started_at=changes.started_at)
        if changes.ended_at is not UNSET:
            updated = replace(updated, ended_at=changes.ended_at)
        if timing and updated.ended_at is not None:
            if updated.ended_at < updated.started_at:
                raise InvalidFitnessError("A workout can't end before it starts.")
            if updated.ended_at - updated.started_at > MAX_WORKOUT:
                raise InvalidFitnessError("A workout can be at most 48 hours long.")
            updated = replace(updated, duration_s=_elapsed(updated, updated.ended_at))
        if updated != session:
            await self._store.save_session(replace(updated, updated_at=self._clock()))
            if updated.status == "completed":
                await self._contributions.workouts(owner, updated.day)
            await self._transaction.commit()
        return await self._detail(owner, updated)

    async def pause(self, owner: Owner, session_id: uuid.UUID) -> SessionDetail:
        session = await self._require(owner, session_id)
        if session.status != "active":
            raise FitnessConflictError("Only a workout in progress can be paused.")
        now = self._clock()
        return await self._save(
            owner, replace(session, status="paused", paused_at=now, updated_at=now)
        )

    async def resume(self, owner: Owner, session_id: uuid.UUID) -> SessionDetail:
        session = await self._require(owner, session_id)
        if session.status != "paused" or session.paused_at is None:
            raise FitnessConflictError("Only a paused workout can be resumed.")
        now = self._clock()
        paused = max(0, int((now - session.paused_at).total_seconds()))
        return await self._save(
            owner,
            replace(
                session,
                status="active",
                paused_at=None,
                paused_seconds=session.paused_seconds + paused,
                updated_at=now,
            ),
        )

    async def finish(
        self, owner: Owner, session_id: uuid.UUID, status: SessionStatus
    ) -> SessionDetail:
        """Complete or abandon a workout in progress. Abandoned workouts stay in history but
        don't count toward totals, records, or habits."""
        session = await self._require(owner, session_id)
        if session.finished:
            raise FitnessConflictError("That workout has already ended.")
        now = self._clock()
        ended = replace(
            session,
            status=status,
            ended_at=now,
            duration_s=_elapsed(session, now),
            paused_seconds=session.paused_seconds
            + (int((now - session.paused_at).total_seconds()) if session.paused_at else 0),
            paused_at=None,
            updated_at=now,
        )
        await self._store.save_session(ended)
        if status == "completed":
            await self._contributions.workouts(owner, ended.day)
        await self._transaction.commit()
        return await self._detail(owner, ended)

    async def delete(self, owner: Owner, session_id: uuid.UUID) -> None:
        """Delete a workout and its sets. Habit days it contributed to are kept."""
        if not await self._store.delete_session(owner, session_id):
            raise FitnessNotFoundError("Workout")
        await self._transaction.commit()

    # Exercises in a workout

    async def add_exercise(
        self, owner: Owner, session_id: uuid.UUID, exercise_id: uuid.UUID
    ) -> SessionDetail:
        session = await self._require(owner, session_id)
        exercise = await self._require_exercise(owner, exercise_id)
        items = await self._items(owner, session.id)
        if len(items) >= MAX_SESSION_EXERCISES:
            raise InvalidFitnessError(
                f"A workout can have at most {MAX_SESSION_EXERCISES} exercises."
            )
        await self._store.add_session_exercise(
            owner.workspace_id,
            SessionExercise(
                id=uuid.uuid4(),
                session_id=session.id,
                exercise_id=exercise.id,
                position=max((i.position for i in items), default=-1) + 1,
                snapshot=snapshot(exercise),
                rest_seconds=None,
                notes="",
                sets=(
                    WorkoutSet(id=uuid.uuid4(), position=0, values=SetValues(), completed_at=None),
                ),
            ),
        )
        return await self._touch(owner, session)

    async def update_exercise(
        self,
        owner: Owner,
        session_id: uuid.UUID,
        item_id: uuid.UUID,
        *,
        rest_seconds: int | None,
        notes: str,
    ) -> SessionDetail:
        session = await self._require(owner, session_id)
        item = await self._item(owner, session.id, item_id)
        await self._store.save_session_exercise(
            owner.workspace_id, replace(item, rest_seconds=rest_seconds, notes=notes)
        )
        return await self._touch(owner, session)

    async def remove_exercise(
        self, owner: Owner, session_id: uuid.UUID, item_id: uuid.UUID
    ) -> SessionDetail:
        session = await self._require(owner, session_id)
        await self._item(owner, session.id, item_id)
        await self._store.delete_session_exercise(owner.workspace_id, item_id)
        return await self._touch(owner, session)

    async def reorder(
        self, owner: Owner, session_id: uuid.UUID, item_ids: Sequence[uuid.UUID]
    ) -> SessionDetail:
        """Put the workout's exercises in this order; every exercise must be listed once."""
        session = await self._require(owner, session_id)
        items = {i.id: i for i in await self._items(owner, session.id)}
        if len(item_ids) != len(items) or set(item_ids) != set(items):
            raise InvalidFitnessError("List every exercise in the workout exactly once.")
        for position, item_id in enumerate(item_ids):
            if items[item_id].position != position:
                await self._store.save_session_exercise(
                    owner.workspace_id, replace(items[item_id], position=position)
                )
        return await self._touch(owner, session)

    # Sets

    async def add_set(
        self,
        owner: Owner,
        session_id: uuid.UUID,
        item_id: uuid.UUID,
        values: SetValues | None,
    ) -> SessionDetail:
        """Add a set; without values, copy the last set's values (not yet done)."""
        session = await self._require(owner, session_id)
        item = await self._item(owner, session.id, item_id)
        if len(item.sets) >= MAX_SETS_PER_EXERCISE:
            raise InvalidFitnessError(f"An exercise can have at most {MAX_SETS_PER_EXERCISE} sets.")
        if values is None:
            last = item.sets[-1].values if item.sets else SetValues()
            values = replace(last, completed=False)
        _check_set(values)
        now = self._clock()
        await self._store.add_set(
            owner.workspace_id,
            item.id,
            WorkoutSet(
                id=uuid.uuid4(),
                position=max((s.position for s in item.sets), default=-1) + 1,
                values=values,
                completed_at=now if values.completed else None,
            ),
        )
        return await self._touch(owner, session)

    async def update_set(
        self,
        owner: Owner,
        session_id: uuid.UUID,
        item_id: uuid.UUID,
        set_id: uuid.UUID,
        values: SetValues,
    ) -> SessionDetail:
        session = await self._require(owner, session_id)
        item = await self._item(owner, session.id, item_id)
        current = next((s for s in item.sets if s.id == set_id), None)
        if current is None:
            raise FitnessNotFoundError("Set")
        _check_set(values)
        completed_at = (current.completed_at or self._clock()) if values.completed else None
        await self._store.save_set(
            owner.workspace_id, replace(current, values=values, completed_at=completed_at)
        )
        return await self._touch(owner, session)

    async def delete_set(
        self, owner: Owner, session_id: uuid.UUID, item_id: uuid.UUID, set_id: uuid.UUID
    ) -> SessionDetail:
        session = await self._require(owner, session_id)
        item = await self._item(owner, session.id, item_id)
        if not any(s.id == set_id for s in item.sets):
            raise FitnessNotFoundError("Set")
        await self._store.delete_set(owner.workspace_id, set_id)
        remaining = [s for s in item.sets if s.id != set_id]
        for position, workout_set in enumerate(remaining):
            if workout_set.position != position:
                await self._store.save_set(
                    owner.workspace_id, replace(workout_set, position=position)
                )
        return await self._touch(owner, session)

    # History, records, analytics

    async def exercise_history(self, owner: Owner, exercise_id: uuid.UUID) -> ExerciseHistory:
        exercise = await self._require_exercise(owner, exercise_id)
        performed = [
            Performed(session, item)
            for session, item in await self._store.performed(owner, [exercise_id])
        ]
        return ExerciseHistory(
            exercise=exercise,
            points=tuple(exercise_point(p) for p in performed),
            records=tuple(personal_records(performed)),
        )

    async def records(self, owner: Owner) -> list[PersonalRecord]:
        performed = await self._store.performed(owner)
        return personal_records(Performed(s, i) for s, i in performed)

    async def analytics(
        self, owner: Owner, start: date, end: date, today: date
    ) -> WorkoutAnalytics:
        if end < start or (end - start).days >= MAX_ANALYTICS_DAYS:
            raise InvalidFitnessError("Choose a range of up to two years.")
        # Streaks look further back than the range, so load completed workouts from the
        # earlier of the range's start and a year before today.
        since = min(start, today - timedelta(days=366))
        sessions = await self._store.sessions(
            owner, start=since, end=max(end, today), statuses=("completed",)
        )
        in_range = [s for s in sessions if start <= s.day <= end]
        exercises = await self._store.session_exercises(
            owner.workspace_id, [s.id for s in in_range]
        )
        records = [r for r in await self.records(owner) if start <= r.day <= end]
        return analytics(sessions, exercises, start, end, today, records)

    # Helpers

    async def _require(self, owner: Owner, session_id: uuid.UUID) -> Session:
        session = await self._store.get_session(owner, session_id)
        if session is None:
            raise FitnessNotFoundError("Workout")
        return session

    async def _require_exercise(self, owner: Owner, exercise_id: uuid.UUID) -> Exercise:
        exercise = await self._store.get_exercise(owner, exercise_id)
        if exercise is None:
            raise InvalidFitnessError("That exercise isn't in your library.")
        return exercise

    async def _items(self, owner: Owner, session_id: uuid.UUID) -> list[SessionExercise]:
        return (await self._store.session_exercises(owner.workspace_id, [session_id])).get(
            session_id, []
        )

    async def _item(
        self, owner: Owner, session_id: uuid.UUID, item_id: uuid.UUID
    ) -> SessionExercise:
        item = next((i for i in await self._items(owner, session_id) if i.id == item_id), None)
        if item is None:
            raise FitnessNotFoundError("Exercise in this workout")
        return item

    async def _touch(self, owner: Owner, session: Session) -> SessionDetail:
        """Commit a change to the workout's contents and return it."""
        return await self._save(owner, replace(session, updated_at=self._clock()))

    async def _save(self, owner: Owner, session: Session) -> SessionDetail:
        await self._store.save_session(session)
        await self._transaction.commit()
        return await self._detail(owner, session)

    async def _detail(self, owner: Owner, session: Session) -> SessionDetail:
        items = await self._items(owner, session.id)
        ids = [i.exercise_id for i in items if i.exercise_id is not None]
        previous: dict[uuid.UUID, PreviousPerformance] = {}
        if ids:
            for other, item in await self._store.performed(owner, ids):
                if other.id == session.id or other.started_at >= session.started_at:
                    continue
                if item.exercise_id is None:
                    continue
                # Oldest first, so later workouts replace earlier ones.
                previous[item.exercise_id] = PreviousPerformance(
                    session_id=other.id, day=other.day, sets=item.sets
                )
        template = (
            await self._store.get_template(owner, session.template_id)
            if session.template_id
            else None
        )
        return SessionDetail(
            session=session,
            exercises=tuple(items),
            previous=previous,
            volume_g=session_volume_g(items),
            links=tuple(await self._store.links(owner, "session", session.id)),
            template_name=template.name if template else None,
        )
