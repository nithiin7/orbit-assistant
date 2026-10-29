"""Shopping lists and items. Every query is filtered by workspace, so callers cannot reach other
workspaces' rows."""

import uuid
from datetime import datetime
from typing import cast

from sqlalchemy import ColumnElement, case, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import ShoppingItemModel, ShoppingListModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.shopping.models import (
    ItemStatus,
    ShoppingItem,
    ShoppingItemNotFoundError,
    ShoppingList,
    ShoppingListNotFoundError,
    ShoppingListOverview,
)


def _to_list(model: ShoppingListModel) -> ShoppingList:
    return ShoppingList(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        is_default=model.is_default,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_item(model: ShoppingItemModel) -> ShoppingItem:
    return ShoppingItem(
        id=model.id,
        workspace_id=model.workspace_id,
        list_id=model.list_id,
        name=model.name,
        quantity=model.quantity,
        url=model.url,
        notes=model.notes,
        # The table's CHECK constraint limits `status` to these values.
        status=cast(ItemStatus, model.status),
        purchased_at=model.purchased_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class SqlShoppingListRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, shopping_list: ShoppingList) -> None:
        self._session.add(
            ShoppingListModel(
                id=shopping_list.id,
                workspace_id=shopping_list.workspace_id,
                name=shopping_list.name,
                is_default=shopping_list.is_default,
                created_at=shopping_list.created_at,
                updated_at=shopping_list.updated_at,
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> ShoppingList | None:
        model = await self._get_model(workspace_id, list_id)
        return _to_list(model) if model else None

    async def overview(self, workspace_id: uuid.UUID) -> list[ShoppingListOverview]:
        def count(status: ItemStatus) -> ColumnElement[int]:
            # COUNT skips the NULL that CASE yields for non-matching rows, and for the single
            # all-NULL row the outer join yields for a list without items.
            return func.count(case((ShoppingItemModel.status == status, 1)))

        rows = await self._session.execute(
            select(ShoppingListModel, count("needed"), count("purchased"))
            .outerjoin(
                ShoppingItemModel,
                (ShoppingItemModel.list_id == ShoppingListModel.id)
                & (ShoppingItemModel.workspace_id == ShoppingListModel.workspace_id),
            )
            .where(ShoppingListModel.workspace_id == workspace_id)
            .group_by(ShoppingListModel.id)
            .order_by(
                ShoppingListModel.is_default.desc(),
                ShoppingListModel.created_at,
                ShoppingListModel.id,
            )
        )
        return [
            ShoppingListOverview(shopping_list=_to_list(model), needed=needed, purchased=purchased)
            for model, needed, purchased in rows
        ]

    async def save(self, shopping_list: ShoppingList) -> None:
        model = await self._get_model(shopping_list.workspace_id, shopping_list.id)
        if model is None:
            raise ShoppingListNotFoundError
        model.name = shopping_list.name
        model.updated_at = shopping_list.updated_at
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(ShoppingListModel).where(
                ShoppingListModel.id == list_id, ShoppingListModel.workspace_id == workspace_id
            )
        )

    async def _get_model(
        self, workspace_id: uuid.UUID, list_id: uuid.UUID
    ) -> ShoppingListModel | None:
        return await self._session.scalar(
            select(ShoppingListModel).where(
                ShoppingListModel.id == list_id, ShoppingListModel.workspace_id == workspace_id
            )
        )


class SqlShoppingItemRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, item: ShoppingItem) -> None:
        self._session.add(
            ShoppingItemModel(
                id=item.id,
                workspace_id=item.workspace_id,
                list_id=item.list_id,
                name=item.name,
                quantity=item.quantity,
                url=item.url,
                notes=item.notes,
                status=item.status,
                purchased_at=item.purchased_at,
                created_at=item.created_at,
                updated_at=item.updated_at,
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> ShoppingItem | None:
        model = await self._get_model(workspace_id, item_id)
        return _to_item(model) if model else None

    async def in_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> list[ShoppingItem]:
        models = await self._session.scalars(
            select(ShoppingItemModel)
            .where(*self._in_list(workspace_id, list_id))
            # "needed" sorts before "purchased". Needed items have no purchase time, so within
            # them the creation time decides.
            .order_by(
                ShoppingItemModel.status,
                ShoppingItemModel.purchased_at.desc(),
                ShoppingItemModel.created_at,
                ShoppingItemModel.id,
            )
        )
        return [_to_item(model) for model in models]

    async def save(self, item: ShoppingItem) -> None:
        model = await self._get_model(item.workspace_id, item.id)
        if model is None:
            raise ShoppingItemNotFoundError
        model.name = item.name
        model.quantity = item.quantity
        model.url = item.url
        model.notes = item.notes
        model.status = item.status
        model.purchased_at = item.purchased_at
        model.updated_at = item.updated_at
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> bool:
        deleted = await self._session.scalars(
            delete(ShoppingItemModel)
            .where(ShoppingItemModel.id == item_id, ShoppingItemModel.workspace_id == workspace_id)
            .returning(ShoppingItemModel.id)
        )
        return deleted.first() is not None

    async def restock_purchased(
        self, workspace_id: uuid.UUID, list_id: uuid.UUID, now: datetime
    ) -> int:
        restocked = await self._session.scalars(
            update(ShoppingItemModel)
            .where(*self._in_list(workspace_id, list_id), ShoppingItemModel.status == "purchased")
            .values(status="needed", purchased_at=None, updated_at=now)
            .returning(ShoppingItemModel.id)
        )
        return len(restocked.all())

    async def delete_purchased(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> int:
        deleted = await self._session.scalars(
            delete(ShoppingItemModel)
            .where(*self._in_list(workspace_id, list_id), ShoppingItemModel.status == "purchased")
            .returning(ShoppingItemModel.id)
        )
        return len(deleted.all())

    @staticmethod
    def _in_list(workspace_id: uuid.UUID, list_id: uuid.UUID) -> list[ColumnElement[bool]]:
        return [
            ShoppingItemModel.workspace_id == workspace_id,
            ShoppingItemModel.list_id == list_id,
        ]

    async def _get_model(
        self, workspace_id: uuid.UUID, item_id: uuid.UUID
    ) -> ShoppingItemModel | None:
        return await self._session.scalar(
            select(ShoppingItemModel).where(
                ShoppingItemModel.id == item_id, ShoppingItemModel.workspace_id == workspace_id
            )
        )
