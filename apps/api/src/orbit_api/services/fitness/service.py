"""Health profile, exercise library, and workout templates.

Every method takes an `Owner` (the signed-in person in a workspace the caller has authorized);
the store filters every query by both, so health records stay private to the person who made
them.

- **Profile**: created with metric defaults on first read; updates replace it whole.
- **Library**: the built-in exercises are created on first read, once per person. Built-ins can
  be archived (hidden) but not edited; custom exercises can be edited, archived, or deleted
  while nothing uses them. Workouts keep a snapshot of each exercise, so edits never rewrite
  history.
- **Templates**: ordered exercises with default sets and targets. Editing a template never
  changes workouts started from it, because starting a workout copies what it needs.
"""

import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime

from orbit_api.services.fitness.catalog import BUILTIN_EXERCISES
from orbit_api.services.fitness.models import (
    MAX_TEMPLATE_EXERCISES,
    Exercise,
    ExerciseDraft,
    FitnessConflictError,
    FitnessNotFoundError,
    InvalidFitnessError,
    Owner,
    Profile,
    ProfileDraft,
    Template,
    TemplateDraft,
    TemplateExercise,
)
from orbit_api.services.fitness.store import FitnessStore
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.clock import utc_now


def normalize_name(name: str) -> str:
    return " ".join(name.split()).casefold()


class FitnessService:
    def __init__(
        self,
        store: FitnessStore,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._transaction = transaction
        self._clock = clock

    # Profile

    async def profile(self, owner: Owner) -> Profile:
        """The person's profile; defaults until they save one."""
        existing = await self._store.get_profile(owner)
        if existing is not None:
            return existing
        now = self._clock()
        return Profile(
            id=uuid.uuid4(), owner=owner, settings=ProfileDraft(), created_at=now, updated_at=now
        )

    async def update_profile(self, owner: Owner, draft: ProfileDraft) -> Profile:
        current = await self.profile(owner)
        targets = draft.targets
        for value in (targets.protein_mg, targets.carbs_mg, targets.fat_mg, targets.fiber_mg):
            if value is not None and not 0 < value <= 2_000_000:
                raise InvalidFitnessError("Nutrient targets must be between 0 and 2,000 g.")
        profile = replace(
            current,
            settings=replace(
                draft,
                water_quick_amounts_ml=tuple(sorted(set(draft.water_quick_amounts_ml))),
                hidden_sections=tuple(dict.fromkeys(draft.hidden_sections)),
            ),
            updated_at=self._clock(),
        )
        await self._store.put_profile(profile)
        await self._commit()
        return profile

    # Exercises

    async def exercises(self, owner: Owner) -> list[Exercise]:
        """Every exercise in the person's library, archived ones included; built-ins are
        created the first time."""
        existing = await self._store.exercises(owner)
        present = {e.builtin_key for e in existing if e.builtin_key is not None}
        missing = [key for key in BUILTIN_EXERCISES if key not in present]
        if not missing:
            return existing
        now = self._clock()
        await self._store.add_exercises(
            [
                Exercise(
                    id=uuid.uuid4(),
                    owner=owner,
                    builtin_key=key,
                    details=BUILTIN_EXERCISES[key],
                    archived_at=None,
                    created_at=now,
                    updated_at=now,
                )
                for key in missing
            ]
        )
        try:
            await self._transaction.commit()
        except ConflictError:
            # A concurrent first request created them; use its rows.
            await self._transaction.rollback()
        return await self._store.exercises(owner)

    async def exercise(self, owner: Owner, exercise_id: uuid.UUID) -> Exercise:
        exercise = await self._store.get_exercise(owner, exercise_id)
        if exercise is None:
            raise FitnessNotFoundError("Exercise")
        return exercise

    async def create_exercise(self, owner: Owner, draft: ExerciseDraft) -> Exercise:
        _check_exercise(draft)
        now = self._clock()
        exercise = Exercise(
            id=uuid.uuid4(),
            owner=owner,
            builtin_key=None,
            details=draft,
            archived_at=None,
            created_at=now,
            updated_at=now,
        )
        await self._store.add_exercises([exercise])
        await self._commit()
        return exercise

    async def update_exercise(
        self, owner: Owner, exercise_id: uuid.UUID, draft: ExerciseDraft
    ) -> Exercise:
        exercise = await self.exercise(owner, exercise_id)
        if not exercise.is_custom:
            raise FitnessConflictError("Built-in exercises can't be edited. Create your own.")
        _check_exercise(draft)
        updated = replace(exercise, details=draft, updated_at=self._clock())
        await self._store.save_exercise(updated)
        await self._commit()
        return updated

    async def archive_exercise(
        self, owner: Owner, exercise_id: uuid.UUID, archived: bool
    ) -> Exercise:
        exercise = await self.exercise(owner, exercise_id)
        now = self._clock()
        updated = replace(
            exercise,
            archived_at=(exercise.archived_at or now) if archived else None,
            updated_at=now,
        )
        await self._store.save_exercise(updated)
        await self._commit()
        return updated

    async def delete_exercise(self, owner: Owner, exercise_id: uuid.UUID) -> None:
        exercise = await self.exercise(owner, exercise_id)
        if not exercise.is_custom:
            raise FitnessConflictError("Built-in exercises can't be deleted. Archive it instead.")
        if await self._store.exercise_in_use(owner, exercise_id):
            raise FitnessConflictError(
                "This exercise is in a template or a workout. Archive it instead."
            )
        await self._store.delete_exercise(owner, exercise_id)
        await self._commit()

    # Templates

    async def templates(self, owner: Owner) -> list[Template]:
        return await self._store.templates(owner)

    async def template(self, owner: Owner, template_id: uuid.UUID) -> Template:
        template = await self._store.get_template(owner, template_id)
        if template is None:
            raise FitnessNotFoundError("Template")
        return template

    async def create_template(self, owner: Owner, draft: TemplateDraft) -> Template:
        now = self._clock()
        template = Template(
            id=uuid.uuid4(),
            owner=owner,
            name=draft.name,
            category=draft.category,
            description=draft.description,
            notes=draft.notes,
            archived_at=None,
            created_at=now,
            updated_at=now,
            exercises=await self._template_exercises(owner, draft),
        )
        await self._store.put_template(template)
        await self._commit()
        return template

    async def update_template(
        self, owner: Owner, template_id: uuid.UUID, draft: TemplateDraft
    ) -> Template:
        """Replace the template's details and exercises. Past workouts are unaffected."""
        template = await self.template(owner, template_id)
        updated = replace(
            template,
            name=draft.name,
            category=draft.category,
            description=draft.description,
            notes=draft.notes,
            exercises=await self._template_exercises(owner, draft),
            updated_at=self._clock(),
        )
        await self._store.put_template(updated)
        await self._commit()
        return updated

    async def duplicate_template(self, owner: Owner, template_id: uuid.UUID) -> Template:
        template = await self.template(owner, template_id)
        now = self._clock()
        copy = replace(
            template,
            id=uuid.uuid4(),
            name=f"{template.name} (copy)"[:100],
            archived_at=None,
            created_at=now,
            updated_at=now,
            exercises=tuple(replace(e, id=uuid.uuid4()) for e in template.exercises),
        )
        await self._store.put_template(copy)
        await self._commit()
        return copy

    async def archive_template(
        self, owner: Owner, template_id: uuid.UUID, archived: bool
    ) -> Template:
        template = await self.template(owner, template_id)
        now = self._clock()
        updated = replace(
            template,
            archived_at=(template.archived_at or now) if archived else None,
            updated_at=now,
        )
        await self._store.put_template(updated)
        await self._commit()
        return updated

    async def delete_template(self, owner: Owner, template_id: uuid.UUID) -> None:
        """Workouts started from it keep everything they copied."""
        if not await self._store.delete_template(owner, template_id):
            raise FitnessNotFoundError("Template")
        await self._commit()

    async def _template_exercises(
        self, owner: Owner, draft: TemplateDraft
    ) -> tuple[TemplateExercise, ...]:
        if len(draft.exercises) > MAX_TEMPLATE_EXERCISES:
            raise InvalidFitnessError(
                f"A template can have at most {MAX_TEMPLATE_EXERCISES} exercises."
            )
        result: list[TemplateExercise] = []
        for position, plan in enumerate(draft.exercises):
            exercise = await self._store.get_exercise(owner, plan.exercise_id)
            if exercise is None:
                raise InvalidFitnessError("That exercise isn't in your library.")
            if (
                plan.target_reps_min is not None
                and plan.target_reps_max is not None
                and plan.target_reps_max < plan.target_reps_min
            ):
                raise InvalidFitnessError("The rep range's maximum is below its minimum.")
            result.append(
                TemplateExercise(id=uuid.uuid4(), position=position, exercise=exercise, plan=plan)
            )
        return tuple(result)

    async def _commit(self) -> None:
        try:
            await self._transaction.commit()
        except ConflictError:
            raise FitnessConflictError(
                "That changed at the same time somewhere else. Try again."
            ) from None


def _check_exercise(draft: ExerciseDraft) -> None:
    if set(draft.primary_muscles) & set(draft.secondary_muscles):
        raise InvalidFitnessError("A muscle can't be both primary and secondary.")
