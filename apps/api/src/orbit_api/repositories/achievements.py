"""Achievement records and the metrics behind them, always addressed by the user's ID.

Metrics count only workspaces the user owns, and health records only when they are the user's
own, so one person's data never counts toward another's achievements.
"""

import uuid
from typing import Any

from sqlalchemy import ColumnElement, Select, delete, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    AchievementUnlockModel,
    BookmarkModel,
    CalendarEventModel,
    DocumentModel,
    FinanceBudgetModel,
    FinanceSavingsGoalModel,
    FinanceTransactionModel,
    FitnessFoodEntryModel,
    FitnessGoalModel,
    FitnessSessionModel,
    FitnessWaterEntryModel,
    HabitLogModel,
    HabitModel,
    NoteModel,
    PlaceModel,
    ReminderModel,
    RewardEquipModel,
    RewardPurchaseModel,
    RoutineSessionModel,
    ShoppingItemModel,
    TaskModel,
    WatchItemModel,
    WorkspaceModel,
)
from orbit_api.repositories.transaction import flush
from orbit_api.services.achievements.models import Metrics, Purchase, Slot, Unlock
from orbit_api.services.achievements.service import longest_streak


class SqlAchievementRecords:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def unlocks(self, user_id: uuid.UUID) -> list[Unlock]:
        models = await self._session.scalars(
            select(AchievementUnlockModel).where(AchievementUnlockModel.user_id == user_id)
        )
        return [
            Unlock(key=model.achievement_key, xp=model.xp, unlocked_at=model.unlocked_at)
            for model in models
        ]

    async def add_unlocks(self, user_id: uuid.UUID, unlocks: list[Unlock]) -> None:
        self._session.add_all(
            AchievementUnlockModel(
                user_id=user_id,
                achievement_key=unlock.key,
                xp=unlock.xp,
                unlocked_at=unlock.unlocked_at,
            )
            for unlock in unlocks
        )
        await flush(self._session)

    async def purchases(self, user_id: uuid.UUID) -> list[Purchase]:
        models = await self._session.scalars(
            select(RewardPurchaseModel).where(RewardPurchaseModel.user_id == user_id)
        )
        return [
            Purchase(key=model.item_key, cost=model.cost, purchased_at=model.purchased_at)
            for model in models
        ]

    async def add_purchase(self, user_id: uuid.UUID, purchase: Purchase) -> None:
        self._session.add(
            RewardPurchaseModel(
                user_id=user_id,
                item_key=purchase.key,
                cost=purchase.cost,
                purchased_at=purchase.purchased_at,
            )
        )
        await flush(self._session)

    async def equipped(self, user_id: uuid.UUID) -> dict[str, str]:
        models = await self._session.scalars(
            select(RewardEquipModel).where(RewardEquipModel.user_id == user_id)
        )
        return {model.slot: model.item_key for model in models}

    async def equip(self, user_id: uuid.UUID, slot: Slot, item_key: str) -> None:
        model = await self._session.get(RewardEquipModel, (user_id, slot))
        if model is None:
            self._session.add(RewardEquipModel(user_id=user_id, slot=slot, item_key=item_key))
        else:
            model.item_key = item_key
        await flush(self._session)

    async def unequip(self, user_id: uuid.UUID, slot: Slot) -> None:
        await self._session.execute(
            delete(RewardEquipModel).where(
                RewardEquipModel.user_id == user_id, RewardEquipModel.slot == slot
            )
        )


class SqlAchievementMetrics:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def metrics(self, user_id: uuid.UUID) -> Metrics:
        owned = select(WorkspaceModel.id).where(WorkspaceModel.owner_id == user_id)

        async def count(model: Any, *where: ColumnElement[bool]) -> int:
            return await self._scalar(
                select(func.count()).select_from(model).where(model.workspace_id.in_(owned), *where)
            )

        async def mine(model: Any, *where: ColumnElement[bool]) -> int:
            """Rows of a private health table that belong to the user."""
            return await count(model, model.user_id == user_id, *where)

        async def days(model: Any) -> int:
            return await self._scalar(
                select(func.count(distinct(model.day))).where(
                    model.workspace_id.in_(owned), model.user_id == user_id
                )
            )

        tasks_completed = await count(TaskModel, TaskModel.status == "completed")
        tasks_open = await count(TaskModel, TaskModel.status == "open")
        done_days = await self._session.scalars(
            select(HabitLogModel.day)
            .where(
                HabitLogModel.workspace_id.in_(owned),
                HabitLogModel.skipped.is_(False),
                HabitLogModel.value >= HabitLogModel.target,
            )
            .distinct()
        )
        checkins = await count(
            HabitLogModel,
            HabitLogModel.skipped.is_(False),
            HabitLogModel.value >= HabitLogModel.target,
        )
        metrics: Metrics = {
            "tasks_completed": tasks_completed,
            "inbox_zero": int(tasks_completed >= 10 and tasks_open == 0),
            "habit_checkins": checkins,
            "habit_streak": longest_streak(done_days),
            "routines_completed": await count(
                RoutineSessionModel, RoutineSessionModel.status == "completed"
            ),
            "notes": await count(NoteModel, NoteModel.trashed_at.is_(None)),
            "shopping_purchased": await count(
                ShoppingItemModel, ShoppingItemModel.status == "purchased"
            ),
            "reminders": await count(ReminderModel),
            "events": await count(CalendarEventModel),
            "documents": await count(DocumentModel, DocumentModel.trashed_at.is_(None)),
            "places_visited": await count(PlaceModel, PlaceModel.status == "visited"),
            "countries": await self._scalar(
                select(func.count(distinct(PlaceModel.country_code))).where(
                    PlaceModel.workspace_id.in_(owned), PlaceModel.status == "visited"
                )
            ),
            "watched": await count(WatchItemModel, WatchItemModel.status == "watched"),
            "bookmarks": await count(BookmarkModel),
            "transactions": await count(FinanceTransactionModel),
            "budgets": await count(FinanceBudgetModel),
            "savings_goals_completed": await count(
                FinanceSavingsGoalModel, FinanceSavingsGoalModel.state == "completed"
            ),
            "workouts": await mine(FitnessSessionModel, FitnessSessionModel.status == "completed"),
            "food_days": await days(FitnessFoodEntryModel),
            "water_days": await days(FitnessWaterEntryModel),
            "fitness_goals_completed": await mine(
                FitnessGoalModel, FitnessGoalModel.status == "completed"
            ),
        }
        # The twelve parts of Orbit, each counted once it has anything in it.
        areas = (
            await count(TaskModel) > 0,
            await count(HabitModel) > 0,
            metrics["notes"] > 0,
            await count(ShoppingItemModel) > 0,
            metrics["reminders"] > 0,
            metrics["events"] > 0,
            metrics["documents"] > 0,
            await count(PlaceModel) > 0,
            await count(WatchItemModel) > 0,
            metrics["bookmarks"] > 0,
            metrics["transactions"] > 0,
            metrics["workouts"] + metrics["food_days"] + metrics["water_days"] > 0,
        )
        metrics["areas_used"] = sum(areas)
        return metrics

    async def _scalar(self, statement: Select[int]) -> int:
        return (await self._session.scalar(statement)) or 0
