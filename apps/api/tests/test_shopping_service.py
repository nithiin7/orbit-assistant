"""Unit tests for the shopping service, using in-memory repositories and a fixed clock."""

import uuid
from dataclasses import replace
from datetime import datetime

import pytest

from orbit_api.services.shopping.models import (
    DefaultListError,
    ItemChanges,
    ItemDraft,
    ShoppingItem,
    ShoppingItemNotFoundError,
    ShoppingList,
    ShoppingListNotFoundError,
    ShoppingListOverview,
)
from orbit_api.services.shopping.service import DEFAULT_LIST_NAME, ShoppingService
from orbit_api.services.transactions import ConflictError
from tests.test_account_service import FakeTransaction
from tests.test_task_service import Clock

pytestmark = pytest.mark.anyio

WORKSPACE = uuid.uuid4()
OTHER_WORKSPACE = uuid.uuid4()


class FakeLists:
    def __init__(self) -> None:
        self.items: dict[uuid.UUID, ShoppingList] = {}
        # Simulates another request creating the default list between our read and write.
        self.race_default: ShoppingList | None = None

    async def add(self, shopping_list: ShoppingList) -> None:
        if self.race_default is not None:
            self.items[self.race_default.id] = self.race_default
            self.race_default = None
        if shopping_list.is_default and any(
            existing.is_default and existing.workspace_id == shopping_list.workspace_id
            for existing in self.items.values()
        ):
            raise ConflictError
        self.items[shopping_list.id] = shopping_list

    async def get(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> ShoppingList | None:
        found = self.items.get(list_id)
        return found if found and found.workspace_id == workspace_id else None

    async def overview(self, workspace_id: uuid.UUID) -> list[ShoppingListOverview]:
        owned = [entry for entry in self.items.values() if entry.workspace_id == workspace_id]
        owned.sort(key=lambda entry: (not entry.is_default, entry.created_at))
        return [ShoppingListOverview(shopping_list=entry, needed=0, purchased=0) for entry in owned]

    async def save(self, shopping_list: ShoppingList) -> None:
        self.items[shopping_list.id] = shopping_list

    async def delete(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> None:
        del self.items[list_id]


class FakeItems:
    def __init__(self) -> None:
        self.items: dict[uuid.UUID, ShoppingItem] = {}
        self.saves = 0

    async def add(self, item: ShoppingItem) -> None:
        self.items[item.id] = item

    async def get(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> ShoppingItem | None:
        item = self.items.get(item_id)
        return item if item and item.workspace_id == workspace_id else None

    async def in_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> list[ShoppingItem]:
        return [
            item
            for item in self.items.values()
            if item.workspace_id == workspace_id and item.list_id == list_id
        ]

    async def save(self, item: ShoppingItem) -> None:
        self.saves += 1
        self.items[item.id] = item

    async def delete(self, workspace_id: uuid.UUID, item_id: uuid.UUID) -> bool:
        if await self.get(workspace_id, item_id) is None:
            return False
        del self.items[item_id]
        return True

    async def restock_purchased(
        self, workspace_id: uuid.UUID, list_id: uuid.UUID, now: datetime
    ) -> int:
        raise NotImplementedError

    async def delete_purchased(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> int:
        raise NotImplementedError


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def lists() -> FakeLists:
    return FakeLists()


@pytest.fixture
def items() -> FakeItems:
    return FakeItems()


@pytest.fixture
def transaction() -> FakeTransaction:
    return FakeTransaction()


@pytest.fixture
def service(
    lists: FakeLists, items: FakeItems, transaction: FakeTransaction, clock: Clock
) -> ShoppingService:
    return ShoppingService(lists, items, transaction, clock=clock)


async def test_the_default_list_is_created_once(
    service: ShoppingService, transaction: FakeTransaction, clock: Clock
) -> None:
    [first] = await service.overview(WORKSPACE)
    assert first.shopping_list.name == DEFAULT_LIST_NAME
    assert first.shopping_list.is_default
    assert first.shopping_list.created_at == clock.now
    assert transaction.commits == 1

    assert await service.overview(WORKSPACE) == [first]
    assert transaction.commits == 1


async def test_a_concurrently_created_default_list_is_used(
    service: ShoppingService, lists: FakeLists, transaction: FakeTransaction, clock: Clock
) -> None:
    theirs = ShoppingList(
        id=uuid.uuid4(),
        workspace_id=WORKSPACE,
        name=DEFAULT_LIST_NAME,
        is_default=True,
        created_at=clock.now,
        updated_at=clock.now,
    )
    lists.race_default = theirs

    [entry] = await service.overview(WORKSPACE)

    assert entry.shopping_list == theirs
    assert (transaction.commits, transaction.rollbacks) == (0, 1)


async def test_the_default_list_cannot_be_deleted(service: ShoppingService) -> None:
    [entry] = await service.overview(WORKSPACE)

    with pytest.raises(DefaultListError):
        await service.delete_list(WORKSPACE, entry.shopping_list.id)


async def test_renaming_to_the_same_name_writes_nothing(
    service: ShoppingService, transaction: FakeTransaction, clock: Clock
) -> None:
    created = await service.create_list(WORKSPACE, "Electronics")
    clock.advance()

    assert await service.rename_list(WORKSPACE, created.id, "Electronics") == created
    assert transaction.commits == 1

    renamed = await service.rename_list(WORKSPACE, created.id, "Gadgets")
    assert (renamed.name, renamed.updated_at) == ("Gadgets", clock.now)


async def test_items_can_only_be_added_to_lists_in_the_workspace(
    service: ShoppingService,
) -> None:
    other = await service.create_list(OTHER_WORKSPACE, "Theirs")

    with pytest.raises(ShoppingListNotFoundError):
        await service.add_item(WORKSPACE, other.id, ItemDraft(name="Milk"))
    with pytest.raises(ShoppingListNotFoundError):
        await service.items(WORKSPACE, other.id)


async def test_purchase_records_the_time_and_restock_clears_it(
    service: ShoppingService, clock: Clock
) -> None:
    shopping_list = await service.create_list(WORKSPACE, "Groceries")
    item = await service.add_item(WORKSPACE, shopping_list.id, ItemDraft(name="Milk"))
    purchased_at = clock.advance()

    purchased = await service.purchase(WORKSPACE, item.id)
    assert (purchased.status, purchased.purchased_at) == ("purchased", purchased_at)

    clock.advance()
    assert await service.purchase(WORKSPACE, item.id) == purchased

    restocked = await service.restock(WORKSPACE, item.id)
    assert (restocked.status, restocked.purchased_at) == ("needed", None)
    assert restocked.updated_at == clock.now


async def test_an_update_that_changes_nothing_is_not_saved(
    service: ShoppingService, items: FakeItems
) -> None:
    shopping_list = await service.create_list(WORKSPACE, "Groceries")
    item = await service.add_item(
        WORKSPACE, shopping_list.id, ItemDraft(name="Milk", quantity="1 L")
    )

    assert await service.update_item(WORKSPACE, item.id, ItemChanges(quantity="1 L")) == item
    assert items.saves == 0

    cleared = await service.update_item(WORKSPACE, item.id, ItemChanges(quantity=None))
    assert cleared == replace(item, quantity=None, updated_at=cleared.updated_at)


async def test_items_in_other_workspaces_are_not_found(service: ShoppingService) -> None:
    shopping_list = await service.create_list(WORKSPACE, "Groceries")
    item = await service.add_item(WORKSPACE, shopping_list.id, ItemDraft(name="Milk"))

    with pytest.raises(ShoppingItemNotFoundError):
        await service.purchase(OTHER_WORKSPACE, item.id)
    with pytest.raises(ShoppingItemNotFoundError):
        await service.delete_item(OTHER_WORKSPACE, item.id)
