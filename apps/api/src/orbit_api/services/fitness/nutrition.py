"""Foods, saved meals, food entries, daily totals, and water.

- A **portion** is either from a saved food (its nutrients scaled to the quantity and copied) or
  typed in. Entries keep their copy, so editing or deleting a saved food never changes what was
  logged. Logging a saved food counts it as used, for "frequent foods".
- **Saved meals** are named lists of portions; logging one adds an entry per item.
- **Daily totals** are integer sums of entries, per meal and for the day, next to the profile's
  targets.
- **Water** is its own log in millilitres. Food entries never count as water, whatever they
  are; only what's recorded as water does.
"""

import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import date, datetime, timedelta

from orbit_api.services.fitness.calculations import scale_nutrients, sum_nutrients
from orbit_api.services.fitness.integrations import Contributions
from orbit_api.services.fitness.models import (
    MAX_MEAL_ITEMS,
    DayTotal,
    FitnessNotFoundError,
    Food,
    FoodDraft,
    FoodEntry,
    FoodEntryDraft,
    InvalidFitnessError,
    MealDraft,
    MealType,
    Nutrients,
    NutritionDay,
    Owner,
    Portion,
    PortionDraft,
    SavedMeal,
    Targets,
    WaterDay,
    WaterEntry,
)
from orbit_api.services.fitness.store import FitnessStore
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now

MEALS: tuple[MealType, ...] = ("breakfast", "lunch", "dinner", "snack", "other")
MAX_HISTORY_DAYS = 366


class NutritionService:
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

    # Foods

    async def foods(self, owner: Owner) -> list[Food]:
        """Most used first, then by name."""
        foods = await self._store.foods(owner)
        return sorted(foods, key=lambda f: (-f.use_count, f.details.name.casefold()))

    async def create_food(self, owner: Owner, draft: FoodDraft) -> Food:
        now = self._clock()
        food = Food(
            id=uuid.uuid4(),
            owner=owner,
            details=draft,
            use_count=0,
            last_used_at=None,
            created_at=now,
            updated_at=now,
        )
        await self._store.put_food(food)
        await self._transaction.commit()
        return food

    async def update_food(self, owner: Owner, food_id: uuid.UUID, draft: FoodDraft) -> Food:
        """Entries already logged keep the nutrients they were logged with."""
        food = await self._require_food(owner, food_id)
        updated = replace(food, details=draft, updated_at=self._clock())
        await self._store.put_food(updated)
        await self._transaction.commit()
        return updated

    async def delete_food(self, owner: Owner, food_id: uuid.UUID) -> None:
        if not await self._store.delete_food(owner, food_id):
            raise FitnessNotFoundError("Food")
        await self._transaction.commit()

    # Saved meals

    async def meals(self, owner: Owner) -> list[SavedMeal]:
        return await self._store.meals(owner)

    async def create_meal(self, owner: Owner, draft: MealDraft) -> SavedMeal:
        now = self._clock()
        meal = SavedMeal(
            id=uuid.uuid4(),
            owner=owner,
            name=draft.name,
            items=await self._portions(owner, draft),
            created_at=now,
            updated_at=now,
        )
        await self._store.put_meal(meal)
        await self._transaction.commit()
        return meal

    async def update_meal(self, owner: Owner, meal_id: uuid.UUID, draft: MealDraft) -> SavedMeal:
        meal = await self._require_meal(owner, meal_id)
        updated = replace(
            meal,
            name=draft.name,
            items=await self._portions(owner, draft),
            updated_at=self._clock(),
        )
        await self._store.put_meal(updated)
        await self._transaction.commit()
        return updated

    async def delete_meal(self, owner: Owner, meal_id: uuid.UUID) -> None:
        if not await self._store.delete_meal(owner, meal_id):
            raise FitnessNotFoundError("Meal")
        await self._transaction.commit()

    async def log_meal(
        self, owner: Owner, meal_id: uuid.UUID, day: date, meal_type: MealType
    ) -> list[FoodEntry]:
        """Add an entry for every item of a saved meal."""
        meal = await self._require_meal(owner, meal_id)
        now = self._clock()
        entries = [
            FoodEntry(
                id=uuid.uuid4(),
                owner=owner,
                day=day,
                meal=meal_type,
                portion=item,
                note="",
                created_at=now,
                updated_at=now,
            )
            for item in meal.items
        ]
        for entry in entries:
            await self._store.put_food_entry(entry)
            await self._mark_used(owner, entry.portion.food_id, now)
        await self._transaction.commit()
        return entries

    # Entries

    async def day(self, owner: Owner, day: date) -> NutritionDay:
        entries = await self._store.food_entries(owner, day, day)
        profile = await self._store.get_profile(owner)
        by_meal: dict[MealType, Nutrients] = {
            meal: sum_nutrients([e.portion.nutrients for e in entries if e.meal == meal])
            for meal in MEALS
        }
        return NutritionDay(
            day=day,
            entries=tuple(entries),
            totals=sum_nutrients([e.portion.nutrients for e in entries]),
            by_meal=by_meal,
            targets=profile.settings.targets if profile else Targets(),
        )

    async def history(self, owner: Owner, start: date, end: date) -> list[DayTotal]:
        """Each day's totals, for days with entries."""
        _check_range(start, end)
        entries = await self._store.food_entries(owner, start, end)
        days: dict[date, list[FoodEntry]] = {}
        for entry in entries:
            days.setdefault(entry.day, []).append(entry)
        return [
            DayTotal(
                day=day,
                nutrients=sum_nutrients([e.portion.nutrients for e in items]),
                entries=len(items),
            )
            for day, items in sorted(days.items())
        ]

    async def add_entry(self, owner: Owner, draft: FoodEntryDraft) -> FoodEntry:
        now = self._clock()
        entry = FoodEntry(
            id=uuid.uuid4(),
            owner=owner,
            day=draft.day,
            meal=draft.meal,
            portion=await self._portion(owner, draft.portion),
            note=draft.note,
            created_at=now,
            updated_at=now,
        )
        await self._store.put_food_entry(entry)
        await self._mark_used(owner, entry.portion.food_id, now)
        await self._transaction.commit()
        return entry

    async def update_entry(
        self, owner: Owner, entry_id: uuid.UUID, draft: FoodEntryDraft
    ) -> FoodEntry:
        entry = await self._store.get_food_entry(owner, entry_id)
        if entry is None:
            raise FitnessNotFoundError("Food entry")
        updated = replace(
            entry,
            day=draft.day,
            meal=draft.meal,
            portion=await self._portion(owner, draft.portion),
            note=draft.note,
            updated_at=self._clock(),
        )
        await self._store.put_food_entry(updated)
        await self._transaction.commit()
        return updated

    async def delete_entry(self, owner: Owner, entry_id: uuid.UUID) -> None:
        if not await self._store.delete_food_entry(owner, entry_id):
            raise FitnessNotFoundError("Food entry")
        await self._transaction.commit()

    # Water

    async def water_day(self, owner: Owner, day: date) -> WaterDay:
        entries = await self._store.water_entries(owner, day, day)
        profile = await self._store.get_profile(owner)
        return WaterDay(
            day=day,
            entries=tuple(entries),
            total_ml=sum(e.amount_ml for e in entries),
            target_ml=profile.settings.targets.water_ml if profile else None,
        )

    async def water_history(self, owner: Owner, start: date, end: date) -> list[tuple[date, int]]:
        _check_range(start, end)
        totals: dict[date, int] = {}
        for entry in await self._store.water_entries(owner, start, end):
            totals[entry.day] = totals.get(entry.day, 0) + entry.amount_ml
        return sorted(totals.items())

    async def add_water(self, owner: Owner, day: date, amount_ml: int) -> WaterDay:
        await self._store.add_water_entry(
            WaterEntry(
                id=uuid.uuid4(), owner=owner, day=day, amount_ml=amount_ml, created_at=self._clock()
            )
        )
        await self._contributions.water(owner, day)
        await self._transaction.commit()
        return await self.water_day(owner, day)

    async def delete_water(self, owner: Owner, entry_id: uuid.UUID) -> WaterDay:
        entry = await self._store.get_water_entry(owner, entry_id)
        if entry is None:
            raise FitnessNotFoundError("Water entry")
        await self._store.delete_water_entry(owner, entry_id)
        await self._contributions.water(owner, entry.day)
        await self._transaction.commit()
        return await self.water_day(owner, entry.day)

    # Helpers

    async def _portions(self, owner: Owner, draft: MealDraft) -> tuple[Portion, ...]:
        if not draft.items:
            raise InvalidFitnessError("A meal needs at least one item.")
        if len(draft.items) > MAX_MEAL_ITEMS:
            raise InvalidFitnessError(f"A meal can have at most {MAX_MEAL_ITEMS} items.")
        return tuple([await self._portion(owner, item) for item in draft.items])

    async def _portion(self, owner: Owner, draft: PortionDraft) -> Portion:
        if draft.food_id is not None:
            food = await self._store.get_food(owner, draft.food_id)
            if food is None:
                raise InvalidFitnessError("That food isn't saved.")
            details = food.details
            return Portion(
                food_id=food.id,
                name=draft.name or details.name,
                quantity_milli=draft.quantity_milli,
                serving_unit=details.serving_unit,
                nutrients=scale_nutrients(
                    details.nutrients, draft.quantity_milli, details.serving_quantity_milli
                ),
            )
        if draft.name is None or draft.serving_unit is None or draft.nutrients is None:
            raise InvalidFitnessError("Choose a saved food, or enter a name, unit, and nutrients.")
        return Portion(
            food_id=None,
            name=draft.name,
            quantity_milli=draft.quantity_milli,
            serving_unit=draft.serving_unit,
            nutrients=draft.nutrients,
        )

    async def _mark_used(self, owner: Owner, food_id: uuid.UUID | None, now: datetime) -> None:
        if food_id is None:
            return
        food = await self._store.get_food(owner, food_id)
        if food is not None:
            await self._store.put_food(
                replace(food, use_count=food.use_count + 1, last_used_at=now)
            )

    async def _require_food(self, owner: Owner, food_id: uuid.UUID) -> Food:
        food = await self._store.get_food(owner, food_id)
        if food is None:
            raise FitnessNotFoundError("Food")
        return food

    async def _require_meal(self, owner: Owner, meal_id: uuid.UUID) -> SavedMeal:
        meal = await self._store.get_meal(owner, meal_id)
        if meal is None:
            raise FitnessNotFoundError("Meal")
        return meal


def _check_range(start: date, end: date) -> None:
    if end < start or end - start >= timedelta(days=MAX_HISTORY_DAYS):
        raise InvalidFitnessError("Choose a range of up to a year.")
