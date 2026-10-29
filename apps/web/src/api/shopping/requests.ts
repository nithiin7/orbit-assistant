import type {
  BulkChangeResponse,
  CreateShoppingItemRequest,
  ShoppingItem,
  ShoppingItems,
  ShoppingList,
  ShoppingListRequest,
  ShoppingLists,
  UpdateShoppingItemRequest,
} from "@orbit/contracts";

import { request, type Signal, workspacePath } from "../client";

function shoppingPath(workspaceId: string, suffix: string): string {
  return workspacePath(workspaceId, `/shopping${suffix}`);
}

function shoppingListPath(workspaceId: string, listId: string, suffix = ""): string {
  return shoppingPath(workspaceId, `/lists/${encodeURIComponent(listId)}${suffix}`);
}

function shoppingItemPath(workspaceId: string, itemId: string, suffix = ""): string {
  return shoppingPath(workspaceId, `/items/${encodeURIComponent(itemId)}${suffix}`);
}

/** Every list with its item counts. The API creates the default Groceries list on first read. */
export function listShoppingLists(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<ShoppingLists> {
  return request<ShoppingLists>(shoppingPath(workspaceId, "/lists"), { token, signal });
}

export function createShoppingList(
  token: string,
  workspaceId: string,
  body: ShoppingListRequest,
): Promise<ShoppingList> {
  return request<ShoppingList>(shoppingPath(workspaceId, "/lists"), {
    method: "POST",
    body,
    token,
  });
}

export function renameShoppingList(
  token: string,
  workspaceId: string,
  listId: string,
  body: ShoppingListRequest,
): Promise<ShoppingList> {
  return request<ShoppingList>(shoppingListPath(workspaceId, listId), {
    method: "PATCH",
    body,
    token,
  });
}

export function deleteShoppingList(
  token: string,
  workspaceId: string,
  listId: string,
): Promise<void> {
  return request<void>(shoppingListPath(workspaceId, listId), { method: "DELETE", token });
}

/** Mark every purchased item in the list as needed again. */
export function restockShoppingList(
  token: string,
  workspaceId: string,
  listId: string,
): Promise<BulkChangeResponse> {
  return request<BulkChangeResponse>(shoppingListPath(workspaceId, listId, "/restock"), {
    method: "POST",
    token,
  });
}

/** Permanently delete the list's purchased items. */
export function clearPurchasedItems(
  token: string,
  workspaceId: string,
  listId: string,
): Promise<BulkChangeResponse> {
  return request<BulkChangeResponse>(shoppingListPath(workspaceId, listId, "/clear-purchased"), {
    method: "POST",
    token,
  });
}

export function listShoppingItems(
  token: string,
  workspaceId: string,
  listId: string,
  { signal }: Signal = {},
): Promise<ShoppingItems> {
  return request<ShoppingItems>(shoppingListPath(workspaceId, listId, "/items"), {
    token,
    signal,
  });
}

export function addShoppingItem(
  token: string,
  workspaceId: string,
  listId: string,
  body: CreateShoppingItemRequest,
): Promise<ShoppingItem> {
  return request<ShoppingItem>(shoppingListPath(workspaceId, listId, "/items"), {
    method: "POST",
    body,
    token,
  });
}

export function updateShoppingItem(
  token: string,
  workspaceId: string,
  itemId: string,
  body: UpdateShoppingItemRequest,
): Promise<ShoppingItem> {
  return request<ShoppingItem>(shoppingItemPath(workspaceId, itemId), {
    method: "PATCH",
    body,
    token,
  });
}

export function purchaseShoppingItem(
  token: string,
  workspaceId: string,
  itemId: string,
): Promise<ShoppingItem> {
  return request<ShoppingItem>(shoppingItemPath(workspaceId, itemId, "/purchase"), {
    method: "POST",
    token,
  });
}

export function restockShoppingItem(
  token: string,
  workspaceId: string,
  itemId: string,
): Promise<ShoppingItem> {
  return request<ShoppingItem>(shoppingItemPath(workspaceId, itemId, "/restock"), {
    method: "POST",
    token,
  });
}

export function deleteShoppingItem(
  token: string,
  workspaceId: string,
  itemId: string,
): Promise<void> {
  return request<void>(shoppingItemPath(workspaceId, itemId), { method: "DELETE", token });
}
