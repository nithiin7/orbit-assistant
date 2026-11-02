"""Activity entries and fitness goals.

- **Activity** is recorded by hand (`source = manual`): steps, walks, runs, rides, swims, other
  cardio, sleep, and rest days. Nothing is estimated or imported; external sources are a
  separate, later `source`.
- **Goals** have a start value, a target, dates, and a status (`active`, `paused`,
  `completed`). Progress comes from check-ins, except where an explicit, documented rule tracks
  it automatically (`auto_track`, off by default):
  - body-weight goals read weight measurements from the start date on;
  - strength goals with an exercise read the heaviest completed set (warm-ups excluded) in each
    workout from the start date on, and the current value is the best so far.
  Auto-tracked goals don't take manual check-ins. Nothing else updates a goal on its own, and
  reaching the target doesn't complete it: the person does.
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import date, datetime

from orbit_api.services.fitness.calculations import (
    goal_fraction,
    goal_pace,
    goal_reached,
    milestones,
)
from orbit_api.services.fitness.integrations import Contributions
from orbit_api.services.fitness.models import (
    GOAL_UNITS,
    Activity,
    ActivityDraft,
    ActivityKind,
    FitnessConflictError,
    FitnessNotFoundError,
    Goal,
    GoalCheckIn,
    GoalDraft,
    GoalProgress,
    GoalStatus,
    InvalidFitnessError,
    Owner,
)
from orbit_api.services.fitness.records import counts
from orbit_api.services.fitness.store import FitnessStore
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now

AUTO_TRACKED = frozenset({"body_weight", "strength"})


class TrackingService:
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

    # Activity

    async def activities(
        self,
        owner: Owner,
        start: date | None = None,
        end: date | None = None,
        kind: ActivityKind | None = None,
        limit: int | None = None,
    ) -> list[Activity]:
        return await self._store.activities(owner, start, end, kind, limit)

    async def add_activity(self, owner: Owner, draft: ActivityDraft) -> Activity:
        _check_activity(draft)
        now = self._clock()
        activity = Activity(
            id=uuid.uuid4(),
            owner=owner,
            details=draft,
            source="manual",
            created_at=now,
            updated_at=now,
        )
        await self._store.put_activity(activity)
        await self._contributions.activity(owner, draft.kind, draft.day)
        await self._transaction.commit()
        return activity

    async def update_activity(
        self, owner: Owner, activity_id: uuid.UUID, draft: ActivityDraft
    ) -> Activity:
        _check_activity(draft)
        activity = await self._store.get_activity(owner, activity_id)
        if activity is None:
            raise FitnessNotFoundError("Activity")
        updated = replace(activity, details=draft, updated_at=self._clock())
        await self._store.put_activity(updated)
        await self._contributions.activity(owner, draft.kind, draft.day)
        await self._transaction.commit()
        return updated

    async def delete_activity(self, owner: Owner, activity_id: uuid.UUID) -> None:
        if not await self._store.delete_activity(owner, activity_id):
            raise FitnessNotFoundError("Activity")
        await self._transaction.commit()

    # Goals

    async def goals(
        self, owner: Owner, today: date, statuses: Sequence[GoalStatus] = ()
    ) -> list[GoalProgress]:
        goals = await self._store.goals(owner, statuses)
        check_ins = await self._store.check_ins(owner.workspace_id, [g.id for g in goals])
        return [await self._progress(owner, g, check_ins.get(g.id, []), today) for g in goals]

    async def goal(self, owner: Owner, goal_id: uuid.UUID, today: date) -> GoalProgress:
        goal = await self._require(owner, goal_id)
        check_ins = await self._store.check_ins(owner.workspace_id, [goal.id])
        progress = await self._progress(owner, goal, check_ins.get(goal.id, []), today)
        return replace(progress, links=tuple(await self._store.links(owner, "goal", goal.id)))

    async def create_goal(self, owner: Owner, draft: GoalDraft, today: date) -> GoalProgress:
        draft = await self._checked(owner, draft)
        now = self._clock()
        goal = Goal(
            id=uuid.uuid4(),
            owner=owner,
            details=draft,
            status="active",
            completed_at=None,
            created_at=now,
            updated_at=now,
        )
        await self._store.put_goal(goal)
        await self._transaction.commit()
        return await self.goal(owner, goal.id, today)

    async def update_goal(
        self, owner: Owner, goal_id: uuid.UUID, draft: GoalDraft, today: date
    ) -> GoalProgress:
        goal = await self._require(owner, goal_id)
        draft = await self._checked(owner, draft)
        await self._store.put_goal(replace(goal, details=draft, updated_at=self._clock()))
        await self._transaction.commit()
        return await self.goal(owner, goal_id, today)

    async def set_status(
        self, owner: Owner, goal_id: uuid.UUID, status: GoalStatus, today: date
    ) -> GoalProgress:
        """Pause, resume, complete, or reopen a goal."""
        goal = await self._require(owner, goal_id)
        if goal.status != status:
            now = self._clock()
            await self._store.put_goal(
                replace(
                    goal,
                    status=status,
                    completed_at=now if status == "completed" else None,
                    updated_at=now,
                )
            )
            await self._transaction.commit()
        return await self.goal(owner, goal_id, today)

    async def delete_goal(self, owner: Owner, goal_id: uuid.UUID) -> None:
        if not await self._store.delete_goal(owner, goal_id):
            raise FitnessNotFoundError("Goal")
        await self._transaction.commit()

    async def check_in(
        self, owner: Owner, goal_id: uuid.UUID, day: date, value: float, note: str, today: date
    ) -> GoalProgress:
        goal = await self._require(owner, goal_id)
        if goal.details.auto_track:
            raise FitnessConflictError("This goal tracks itself from your records.")
        if day > today:
            raise InvalidFitnessError("You can't check in on a day that hasn't happened yet.")
        await self._store.add_check_in(
            owner.workspace_id,
            goal.id,
            GoalCheckIn(id=uuid.uuid4(), day=day, value=value, note=note, source="manual"),
        )
        await self._transaction.commit()
        return await self.goal(owner, goal_id, today)

    async def delete_check_in(
        self, owner: Owner, goal_id: uuid.UUID, check_in_id: uuid.UUID, today: date
    ) -> GoalProgress:
        goal = await self._require(owner, goal_id)
        if not await self._store.delete_check_in(owner.workspace_id, goal.id, check_in_id):
            raise FitnessNotFoundError("Check-in")
        await self._transaction.commit()
        return await self.goal(owner, goal_id, today)

    # Helpers

    async def _require(self, owner: Owner, goal_id: uuid.UUID) -> Goal:
        goal = await self._store.get_goal(owner, goal_id)
        if goal is None:
            raise FitnessNotFoundError("Goal")
        return goal

    async def _checked(self, owner: Owner, draft: GoalDraft) -> GoalDraft:
        if draft.target_value == draft.start_value:
            raise InvalidFitnessError("The target must differ from the starting value.")
        if draft.target_date is not None and draft.target_date <= draft.start_date:
            raise InvalidFitnessError("The target date must be after the start date.")
        if draft.auto_track and draft.category not in AUTO_TRACKED:
            raise InvalidFitnessError("Only body-weight and strength goals can track themselves.")
        if draft.category == "strength" and draft.auto_track and draft.exercise_id is None:
            raise InvalidFitnessError("Choose the exercise this strength goal tracks.")
        if (
            draft.exercise_id is not None
            and await self._store.get_exercise(owner, draft.exercise_id) is None
        ):
            raise InvalidFitnessError("That exercise isn't in your library.")
        if (
            draft.habit_id is not None
            and await self._store.habit(owner.workspace_id, draft.habit_id) is None
        ):
            raise InvalidFitnessError("That habit doesn't exist in this workspace.")
        unit = GOAL_UNITS[draft.category] or draft.unit
        if not unit:
            raise InvalidFitnessError("Custom goals need a unit, such as pages or minutes.")
        return replace(draft, unit=unit)

    async def _progress(
        self, owner: Owner, goal: Goal, check_ins: list[GoalCheckIn], today: date
    ) -> GoalProgress:
        details = goal.details
        history = check_ins
        if details.auto_track:
            history = await self._tracked(owner, goal)
        ordered = sorted(history, key=lambda c: c.day)
        current = details.start_value
        if ordered:
            if details.category == "strength":
                best = max if details.target_value > details.start_value else min
                current = best(c.value for c in ordered)
            else:
                current = ordered[-1].value
        fraction = goal_fraction(details.start_value, details.target_value, current)
        reached = goal_reached(details.start_value, details.target_value, current)
        habit = (
            await self._store.habit(owner.workspace_id, details.habit_id)
            if details.habit_id
            else None
        )
        exercise = (
            await self._store.get_exercise(owner, details.exercise_id)
            if details.exercise_id
            else None
        )
        return GoalProgress(
            goal=goal,
            current_value=current,
            fraction=fraction,
            reached=reached,
            pace=goal_pace(fraction, reached, details.start_date, details.target_date, today),
            history=tuple(ordered),
            milestones=milestones(
                details.start_value,
                details.target_value,
                details.start_date,
                details.target_date,
                ordered,
            ),
            habit_name=habit[0] if habit else None,
            exercise_name=exercise.details.name if exercise else None,
        )

    async def _tracked(self, owner: Owner, goal: Goal) -> list[GoalCheckIn]:
        """Check-ins read from records, by the documented auto-tracking rules."""
        details = goal.details
        if details.category == "body_weight":
            return [
                GoalCheckIn(
                    id=m.id,
                    day=m.day,
                    value=float(m.values.weight_g),
                    note="",
                    source="measurement",
                )
                for m in await self._store.measurements(owner, details.start_date)
                if m.values.weight_g is not None
            ]
        if details.category == "strength" and details.exercise_id is not None:
            result: list[GoalCheckIn] = []
            for session, item in await self._store.performed(owner, [details.exercise_id]):
                if session.day < details.start_date:
                    continue
                weights = [
                    s.values.weight_g
                    for s in item.sets
                    if counts(s.values) and s.values.weight_g and s.values.reps
                ]
                if weights:
                    result.append(
                        GoalCheckIn(
                            id=item.id,
                            day=session.day,
                            value=float(max(weights)),
                            note="",
                            source="workout",
                        )
                    )
            return result
        return []


def _check_activity(draft: ActivityDraft) -> None:
    kind = draft.kind
    if kind == "steps":
        if draft.steps is None or draft.distance_m is not None or draft.duration_s is not None:
            raise InvalidFitnessError("A steps entry records a step count only.")
    elif kind == "rest_day":
        if draft.steps is not None or draft.distance_m is not None or draft.duration_s is not None:
            raise InvalidFitnessError("A rest day has no values.")
    elif kind == "sleep":
        if draft.duration_s is None or draft.steps is not None or draft.distance_m is not None:
            raise InvalidFitnessError("A sleep entry records a duration only.")
    else:
        if draft.steps is not None:
            raise InvalidFitnessError("Record steps as their own entry.")
        if draft.distance_m is None and draft.duration_s is None:
            raise InvalidFitnessError("Enter a distance, a duration, or both.")
