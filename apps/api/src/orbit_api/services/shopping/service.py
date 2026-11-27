"""Shopping lists: named lists of things to buy inside a workspace, each item needed or purchased.

Every workspace has one default list (Groceries), created the first time its lists are read and
never deletable. Other lists are created and deleted freely.

Every method takes a `workspace_id` that the caller has already authorized (the `WorkspaceDep`
API dependency does this), and repositories filter every query by it. A list or item ID alone
never reaches a row: one in another workspace is indistinguishable from one that doesn't exist.
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import datetime
from typing import Protocol

from orbit_api.services.shopping.models import (
    DEFAULT_LIST_ICON,
    DefaultListError,
    GiftPersonNotFoundError,
    ItemChanges,
    ItemDraft,
    ItemOrderError,
    ShoppingItem,
    ShoppingItemNotFoundError,
    ShoppingList,
    ShoppingListIcon,
    ShoppingListNotFoundError,
    ShoppingListOverview,
)
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now

DEFAULT_LIST_NAME = "Groceries"


class ShoppingListRepository(Protocol):
    async def add(self, shopping_list: ShoppingList) -> None: ...

    async def get(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> ShoppingList | None:
        """The list, only if it belongs to `workspace_id`."""
        ...

    async def overview(self, workspace_id: uuid.UUID) -> list[ShoppingListOverview]:
        """Every list in the workspace with its item counts: the default list first, then the
        rest in creation order."""
        ...

    async def save(self, shopping_list: ShoppingList) -> None:
        """Store an existing list's fields. Matches on both its ID and workspace."""
        ...

    async def delete(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> None:
        """Delete the list; its items go with it through `ON DELETE CASCADE`."""
        ...


class ShoppingItemRepository(Protocol):
    async def add(self, item: ShoppingItem) -> None: ...

    async def get(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> ShoppingItem | None:
        """The item, only if it belongs to `workspace_id`."""
        ...

    async def in_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> list[ShoppingItem]:
        """The list's items: needed ones in the order they were added, then purchased ones,
        most recently purchased first."""
        ...

    async def save(self, item: ShoppingItem) -> None:
        """Store an existing item's fields. Matches on both its ID and workspace."""
        ...

    async def delete(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> bool:
        """Delete the item if it belongs to `workspace_id`; report whether it did."""
        ...

    async def restock_purchased(
        self, workspace_id: uuid.UUID, list_id: uuid.UUID, now: datetime
    ) -> int:
        """Mark every purchased item in the list as needed again; return how many changed."""
        ...

    async def gifts(self, workspace_id: uuid.UUID) -> list[ShoppingItem]:
        """Every item that is a gift idea for someone, in any list, newest first."""
        ...

    async def has_person(self, workspace_id: uuid.UUID, person_id: uuid.UUID) -> bool:
        """Whether the person exists in `workspace_id`."""
        ...

    async def delete_purchased(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> int:
        """Delete every purchased item in the list; return how many were deleted."""
        ...

    async def next_position(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> int:
        """The position after the list's last item, so a new item goes last."""
        ...

    async def arrange(
        self, workspace_id: uuid.UUID, list_id: uuid.UUID, item_ids: Sequence[uuid.UUID]
    ) -> None:
        """Number these items of the list in this order."""
        ...


class ShoppingService:
    def __init__(
        self,
        lists: ShoppingListRepository,
        items: ShoppingItemRepository,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._lists = lists
        self._items = items
        self._transaction = transaction
        self._clock = clock

    # Lists

    async def overview(self, workspace_id: uuid.UUID) -> list[ShoppingListOverview]:
        """The workspace's lists, creating the default list if it doesn't exist yet."""
        overview = await self._lists.overview(workspace_id)
        if any(entry.shopping_list.is_default for entry in overview):
            return overview
        try:
            await self._lists.add(self._new_list(workspace_id, DEFAULT_LIST_NAME, is_default=True))
            await self._transaction.commit()
        except ConflictError:
            # A concurrent request created the default list first; use that one.
            await self._transaction.rollback()
        return await self._lists.overview(workspace_id)

    async def create_list(
        self, workspace_id: uuid.UUID, name: str, icon: ShoppingListIcon = DEFAULT_LIST_ICON
    ) -> ShoppingList:
        shopping_list = self._new_list(workspace_id, name, is_default=False, icon=icon)
        await self._lists.add(shopping_list)
        await self._transaction.commit()
        return shopping_list

    async def get_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> ShoppingList:
        shopping_list = await self._lists.get(workspace_id, list_id)
        if shopping_list is None:
            raise ShoppingListNotFoundError
        return shopping_list

    async def update_list(
        self,
        workspace_id: uuid.UUID,
        list_id: uuid.UUID,
        *,
        name: str | None = None,
        icon: ShoppingListIcon | None = None,
    ) -> ShoppingList:
        """Rename a list or change its icon; `None` keeps the current value."""
        shopping_list = await self.get_list(workspace_id, list_id)
        changed = replace(
            shopping_list,
            name=shopping_list.name if name is None else name,
            icon=shopping_list.icon if icon is None else icon,
        )
        if changed == shopping_list:
            return shopping_list
        changed = replace(changed, updated_at=self._clock())
        await self._lists.save(changed)
        await self._transaction.commit()
        return changed

    async def delete_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> None:
        shopping_list = await self.get_list(workspace_id, list_id)
        if shopping_list.is_default:
            raise DefaultListError
        await self._lists.delete(workspace_id, list_id)
        await self._transaction.commit()

    async def restock_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> int:
        """Mark every purchased item as needed again, for lists bought over and over."""
        await self.get_list(workspace_id, list_id)
        count = await self._items.restock_purchased(workspace_id, list_id, self._clock())
        await self._transaction.commit()
        return count

    async def clear_purchased(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> int:
        """Delete every purchased item, for one-off lists."""
        await self.get_list(workspace_id, list_id)
        count = await self._items.delete_purchased(workspace_id, list_id)
        await self._transaction.commit()
        return count

    # Items

    async def items(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> list[ShoppingItem]:
        await self.get_list(workspace_id, list_id)
        return await self._items.in_list(workspace_id, list_id)

    async def add_item(
        self, workspace_id: uuid.UUID, list_id: uuid.UUID, draft: ItemDraft
    ) -> ShoppingItem:
        await self.get_list(workspace_id, list_id)
        await self._check_person(workspace_id, draft.person_id)
        now = self._clock()
        item = ShoppingItem(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            list_id=list_id,
            name=draft.name,
            quantity=draft.quantity,
            url=draft.url,
            notes=draft.notes,
            status="needed",
            purchased_at=None,
            created_at=now,
            updated_at=now,
            person_id=draft.person_id,
            position=await self._items.next_position(workspace_id, list_id),
        )
        await self._items.add(item)
        await self._transaction.commit()
        return item

    async def reorder(
        self, workspace_id: uuid.UUID, list_id: uuid.UUID, item_ids: Sequence[uuid.UUID]
    ) -> list[ShoppingItem]:
        """Put the list's needed items in this order; every needed item must be listed once.
        Purchased items stay newest first below them."""
        items = await self.items(workspace_id, list_id)
        needed = {item.id for item in items if item.status == "needed"}
        if len(item_ids) != len(needed) or set(item_ids) != needed:
            raise ItemOrderError
        await self._items.arrange(workspace_id, list_id, item_ids)
        await self._transaction.commit()
        return await self._items.in_list(workspace_id, list_id)

    async def get_item(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> ShoppingItem:
        item = await self._items.get(workspace_id, item_id)
        if item is None:
            raise ShoppingItemNotFoundError
        return item

    async def update_item(
        self, workspace_id: uuid.UUID, item_id: uuid.UUID, changes: ItemChanges
    ) -> ShoppingItem:
        item = await self.get_item(workspace_id, item_id)
        if changes.person_id is not UNSET:
            await self._check_person(workspace_id, changes.person_id)
        updated = replace(
            item,
            name=item.name if changes.name is UNSET else changes.name,
            quantity=item.quantity if changes.quantity is UNSET else changes.quantity,
            url=item.url if changes.url is UNSET else changes.url,
            notes=item.notes if changes.notes is UNSET else changes.notes,
            person_id=item.person_id if changes.person_id is UNSET else changes.person_id,
        )
        return await self._save_if_changed(item, updated)

    async def gifts(self, workspace_id: uuid.UUID) -> list[ShoppingItem]:
        """Gift ideas for people, across every list, newest first."""
        return await self._items.gifts(workspace_id)

    async def _check_person(self, workspace_id: uuid.UUID, person_id: uuid.UUID | None) -> None:
        if person_id is not None and not await self._items.has_person(workspace_id, person_id):
            raise GiftPersonNotFoundError

    async def purchase(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> ShoppingItem:
        """Mark the item purchased. Purchasing a purchased item keeps its purchase time."""
        item = await self.get_item(workspace_id, item_id)
        if item.status == "purchased":
            return item
        return await self._save_if_changed(
            item, replace(item, status="purchased", purchased_at=self._clock())
        )

    async def restock(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> ShoppingItem:
        """Mark the item needed again."""
        item = await self.get_item(workspace_id, item_id)
        return await self._save_if_changed(item, replace(item, status="needed", purchased_at=None))

    async def delete_item(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> None:
        if not await self._items.delete(workspace_id, item_id):
            raise ShoppingItemNotFoundError
        await self._transaction.commit()

    def _new_list(
        self,
        workspace_id: uuid.UUID,
        name: str,
        *,
        is_default: bool,
        icon: ShoppingListIcon = DEFAULT_LIST_ICON,
    ) -> ShoppingList:
        now = self._clock()
        return ShoppingList(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=name,
            icon=icon,
            is_default=is_default,
            created_at=now,
            updated_at=now,
        )

    async def _save_if_changed(self, item: ShoppingItem, updated: ShoppingItem) -> ShoppingItem:
        # A request that changes nothing leaves `updated_at` alone.
        if updated == item:
            return item
        updated = replace(updated, updated_at=self._clock())
        await self._items.save(updated)
        await self._transaction.commit()
        return updated
