"""Shopping lists in a workspace. Every route authorizes the workspace through `WorkspaceDep`
first."""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Response, status

from orbit_api.api.auth import WorkspaceDep
from orbit_api.api.dependencies import ShoppingServiceDep
from orbit_api.schemas.shopping import (
    BulkChangeResponse,
    CreateItemRequest,
    ShoppingItemResponse,
    ShoppingItemsResponse,
    ShoppingListOverviewResponse,
    ShoppingListRequest,
    ShoppingListResponse,
    ShoppingListsResponse,
    UpdateItemRequest,
)
from orbit_api.services.shopping import (
    DefaultListError,
    ShoppingItemNotFoundError,
    ShoppingListNotFoundError,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/shopping",
    tags=["shopping"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace, list, or item does not exist or is not accessible."},
    },
)

ListId = Annotated[uuid.UUID, Path(description="The shopping list's ID.")]
ItemId = Annotated[uuid.UUID, Path(description="The item's ID.")]


def list_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Shopping list not found.")


def item_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Item not found.")


# Lists


@router.get("/lists", summary="List shopping lists")
async def list_lists(
    workspace: WorkspaceDep, shopping: ShoppingServiceDep
) -> ShoppingListsResponse:
    """Every list with its item counts. The workspace's default Groceries list is created the
    first time its lists are read."""
    overview = await shopping.overview(workspace.id)
    return ShoppingListsResponse(
        lists=[ShoppingListOverviewResponse.of_overview(entry) for entry in overview]
    )


@router.post("/lists", status_code=status.HTTP_201_CREATED, summary="Create a shopping list")
async def create_list(
    body: ShoppingListRequest, workspace: WorkspaceDep, shopping: ShoppingServiceDep
) -> ShoppingListResponse:
    return ShoppingListResponse.of(await shopping.create_list(workspace.id, body.name))


@router.patch("/lists/{list_id}", summary="Rename a shopping list")
async def rename_list(
    list_id: ListId,
    body: ShoppingListRequest,
    workspace: WorkspaceDep,
    shopping: ShoppingServiceDep,
) -> ShoppingListResponse:
    try:
        return ShoppingListResponse.of(await shopping.rename_list(workspace.id, list_id, body.name))
    except ShoppingListNotFoundError:
        raise list_not_found() from None


@router.delete(
    "/lists/{list_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a shopping list",
    responses={409: {"description": "The default list cannot be deleted."}},
)
async def delete_list(
    list_id: ListId, workspace: WorkspaceDep, shopping: ShoppingServiceDep
) -> Response:
    """Permanently delete a list and its items."""
    try:
        await shopping.delete_list(workspace.id, list_id)
    except ShoppingListNotFoundError:
        raise list_not_found() from None
    except DefaultListError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The default shopping list cannot be deleted."
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/lists/{list_id}/restock", summary="Mark purchased items as needed again")
async def restock_list(
    list_id: ListId, workspace: WorkspaceDep, shopping: ShoppingServiceDep
) -> BulkChangeResponse:
    """Start the list over, for things bought again and again, such as groceries."""
    try:
        return BulkChangeResponse(count=await shopping.restock_list(workspace.id, list_id))
    except ShoppingListNotFoundError:
        raise list_not_found() from None


@router.post("/lists/{list_id}/clear-purchased", summary="Delete purchased items")
async def clear_purchased(
    list_id: ListId, workspace: WorkspaceDep, shopping: ShoppingServiceDep
) -> BulkChangeResponse:
    """Permanently delete the list's purchased items, for one-off purchases."""
    try:
        return BulkChangeResponse(count=await shopping.clear_purchased(workspace.id, list_id))
    except ShoppingListNotFoundError:
        raise list_not_found() from None


# Items


@router.get("/lists/{list_id}/items", summary="List a shopping list's items")
async def list_items(
    list_id: ListId, workspace: WorkspaceDep, shopping: ShoppingServiceDep
) -> ShoppingItemsResponse:
    try:
        items = await shopping.items(workspace.id, list_id)
    except ShoppingListNotFoundError:
        raise list_not_found() from None
    return ShoppingItemsResponse(items=[ShoppingItemResponse.of(item) for item in items])


@router.post("/lists/{list_id}/items", status_code=status.HTTP_201_CREATED, summary="Add an item")
async def add_item(
    list_id: ListId,
    body: CreateItemRequest,
    workspace: WorkspaceDep,
    shopping: ShoppingServiceDep,
) -> ShoppingItemResponse:
    try:
        return ShoppingItemResponse.of(
            await shopping.add_item(workspace.id, list_id, body.to_draft())
        )
    except ShoppingListNotFoundError:
        raise list_not_found() from None


@router.patch("/items/{item_id}", summary="Update an item")
async def update_item(
    item_id: ItemId,
    body: UpdateItemRequest,
    workspace: WorkspaceDep,
    shopping: ShoppingServiceDep,
) -> ShoppingItemResponse:
    try:
        return ShoppingItemResponse.of(
            await shopping.update_item(workspace.id, item_id, body.to_changes())
        )
    except ShoppingItemNotFoundError:
        raise item_not_found() from None


@router.post("/items/{item_id}/purchase", summary="Mark an item purchased")
async def purchase_item(
    item_id: ItemId, workspace: WorkspaceDep, shopping: ShoppingServiceDep
) -> ShoppingItemResponse:
    """Idempotent: purchasing a purchased item keeps its original purchase time."""
    try:
        return ShoppingItemResponse.of(await shopping.purchase(workspace.id, item_id))
    except ShoppingItemNotFoundError:
        raise item_not_found() from None


@router.post("/items/{item_id}/restock", summary="Mark an item needed again")
async def restock_item(
    item_id: ItemId, workspace: WorkspaceDep, shopping: ShoppingServiceDep
) -> ShoppingItemResponse:
    try:
        return ShoppingItemResponse.of(await shopping.restock(workspace.id, item_id))
    except ShoppingItemNotFoundError:
        raise item_not_found() from None


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete an item")
async def delete_item(
    item_id: ItemId, workspace: WorkspaceDep, shopping: ShoppingServiceDep
) -> Response:
    """Permanently delete an item."""
    try:
        await shopping.delete_item(workspace.id, item_id)
    except ShoppingItemNotFoundError:
        raise item_not_found() from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
