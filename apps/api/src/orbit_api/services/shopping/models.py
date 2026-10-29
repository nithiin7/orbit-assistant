"""Shopping list and item types."""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from orbit_api.services.tasks.models import UNSET, Change

ItemStatus = Literal["needed", "purchased"]


@dataclass(frozen=True, slots=True)
class ShoppingList:
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    is_default: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class ShoppingListOverview:
    shopping_list: ShoppingList
    needed: int
    purchased: int


@dataclass(frozen=True, slots=True)
class ShoppingItem:
    id: uuid.UUID
    workspace_id: uuid.UUID
    list_id: uuid.UUID
    name: str
    # Free text such as "2 kg" or "a dozen".
    quantity: str | None
    url: str | None
    notes: str
    status: ItemStatus
    # Set exactly when the item is purchased.
    purchased_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class ItemDraft:
    """The fields of a new item."""

    name: str
    quantity: str | None = None
    url: str | None = None
    notes: str = ""


@dataclass(frozen=True, slots=True)
class ItemChanges:
    """A partial update. `UNSET` leaves a field as it is; `None` clears quantity or URL."""

    name: Change[str] = UNSET
    quantity: Change[str | None] = UNSET
    url: Change[str | None] = UNSET
    notes: Change[str] = UNSET


class ShoppingListNotFoundError(Exception):
    """The list does not exist in this workspace."""


class ShoppingItemNotFoundError(Exception):
    """The item does not exist in this workspace."""


class DefaultListError(Exception):
    """The default list cannot be deleted; every workspace keeps one."""
