"""Shopping list and item models."""

import uuid
from datetime import datetime
from typing import Annotated, Self
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import Name, blank_to_none, multi_line, single_line
from orbit_api.services.shopping.models import (
    ItemChanges,
    ItemDraft,
    ItemStatus,
    ShoppingItem,
    ShoppingList,
    ShoppingListOverview,
)
from orbit_api.utils.changes import UNSET

ITEM_NAME_MAX_LENGTH = 200
QUANTITY_MAX_LENGTH = 50
URL_MAX_LENGTH = 2048
NOTES_MAX_LENGTH = 2000


def _web_url(value: str) -> str:
    # Only http(s) links with a host. Orbit never fetches them; the web app renders them as
    # plain links, so other schemes such as `javascript:` must not get through.
    if any(c.isspace() for c in value):
        raise ValueError("must not contain spaces")
    parts = urlsplit(value)
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        raise ValueError("must be an http or https URL")
    return value


ItemName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=ITEM_NAME_MAX_LENGTH),
    AfterValidator(single_line),
]
# Blank quantities and URLs are stored as none.
Quantity = Annotated[
    Annotated[
        str,
        StringConstraints(strip_whitespace=True, max_length=QUANTITY_MAX_LENGTH),
        AfterValidator(single_line),
    ]
    | None,
    BeforeValidator(blank_to_none),
]
WebUrl = Annotated[
    Annotated[
        str,
        StringConstraints(strip_whitespace=True, max_length=URL_MAX_LENGTH),
        AfterValidator(_web_url),
    ]
    | None,
    BeforeValidator(blank_to_none),
]
Notes = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=NOTES_MAX_LENGTH),
    AfterValidator(multi_line),
]


class ShoppingListResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    is_default: bool = Field(description="The workspace's default list, which cannot be deleted.")
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, shopping_list: ShoppingList) -> "ShoppingListResponse":
        return cls(
            id=shopping_list.id,
            workspace_id=shopping_list.workspace_id,
            name=shopping_list.name,
            is_default=shopping_list.is_default,
            created_at=shopping_list.created_at,
            updated_at=shopping_list.updated_at,
        )


class ShoppingListOverviewResponse(ShoppingListResponse):
    needed_count: int = Field(description="Items still to buy.")
    purchased_count: int

    @classmethod
    def of_overview(cls, entry: ShoppingListOverview) -> "ShoppingListOverviewResponse":
        return cls(
            **ShoppingListResponse.of(entry.shopping_list).model_dump(),
            needed_count=entry.needed,
            purchased_count=entry.purchased,
        )


class ShoppingListsResponse(BaseModel):
    lists: list[ShoppingListOverviewResponse] = Field(
        description="The default list first, then the others in creation order."
    )


class ShoppingListRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name


class BulkChangeResponse(BaseModel):
    count: int = Field(description="How many items changed.")


class ShoppingItemResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    list_id: uuid.UUID
    name: str
    quantity: str | None = Field(description='Free text, such as "2 kg".')
    url: str | None = Field(description="An http or https link.")
    notes: str = Field(description="Empty when the item has no notes.")
    status: ItemStatus
    purchased_at: datetime | None = Field(description="When the item was purchased, if it is.")
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, item: ShoppingItem) -> "ShoppingItemResponse":
        return cls(
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


class ShoppingItemsResponse(BaseModel):
    items: list[ShoppingItemResponse] = Field(
        description="Needed items in the order they were added, then purchased items, most "
        "recently purchased first."
    )


class CreateItemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ItemName
    quantity: Quantity = None
    url: WebUrl = None
    notes: Notes = ""

    def to_draft(self) -> ItemDraft:
        return ItemDraft(name=self.name, quantity=self.quantity, url=self.url, notes=self.notes)


class UpdateItemRequest(BaseModel):
    """Change some of an item's fields. Omitted fields keep their values; `quantity: null` and
    `url: null` clear them. Purchasing has its own endpoints."""

    model_config = ConfigDict(extra="forbid")

    name: ItemName | None = None
    quantity: Quantity = None
    url: WebUrl = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in ("name", "notes"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> ItemChanges:
        provided = self.model_fields_set
        return ItemChanges(
            name=self.name if self.name is not None else UNSET,
            quantity=self.quantity if "quantity" in provided else UNSET,
            url=self.url if "url" in provided else UNSET,
            notes=self.notes if self.notes is not None else UNSET,
        )
