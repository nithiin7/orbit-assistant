import type {
  ShoppingItem,
  ShoppingItems,
  ShoppingListOverview,
  ShoppingLists,
} from "@orbit/contracts";
import { type QueryClient, queryOptions, skipToken } from "@tanstack/react-query";

import { countItems, sortItems } from "@/lib/shopping";

import type { WithToken } from "../client";
import { listShoppingItems, listShoppingLists } from "./requests";

/**
 * Cache keys for a workspace's shopping data. Every key starts with the workspace ID, so one
 * workspace's results can never be served for another. `null` never fetches.
 */
export const shoppingKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "shopping"] as const,
  lists: (workspaceId: string | null) => [...shoppingKeys.all(workspaceId), "lists"] as const,
  items: (workspaceId: string | null, listId: string | null) =>
    [...shoppingKeys.all(workspaceId), "items", listId] as const,
};

/** Every list with its item counts. Shared by the Shopping page and the dashboard. */
export function shoppingListsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: shoppingKeys.lists(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listShoppingLists(token, workspaceId, { signal })),
  });
}

export function shoppingItemsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  listId: string | null,
) {
  return queryOptions({
    queryKey: shoppingKeys.items(workspaceId, listId),
    queryFn:
      workspaceId === null || listId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listShoppingItems(token, workspaceId, listId, { signal })),
  });
}

/** Change the cached lists themselves (add, rename, remove). */
export function updateCachedLists(
  queryClient: QueryClient,
  workspaceId: string,
  change: (lists: ShoppingListOverview[]) => ShoppingListOverview[],
) {
  queryClient.setQueryData<ShoppingLists>(
    shoppingKeys.lists(workspaceId),
    (current) => current && { ...current, lists: change(current.lists) },
  );
}

/**
 * Change a list's cached items in place. Re-sorts them and updates that list's counts, so the
 * items and the lists (including the dashboard's) stay in step without refetching.
 */
export function updateCachedItems(
  queryClient: QueryClient,
  workspaceId: string,
  listId: string,
  change: (items: ShoppingItem[]) => ShoppingItem[],
) {
  const current = queryClient.getQueryData<ShoppingItems>(shoppingKeys.items(workspaceId, listId));
  if (!current) return;
  const items = sortItems(change(current.items));
  queryClient.setQueryData<ShoppingItems>(shoppingKeys.items(workspaceId, listId), {
    ...current,
    items,
  });
  const { needed, purchased } = countItems(items);
  updateCachedLists(queryClient, workspaceId, (lists) =>
    lists.map((entry) =>
      entry.id === listId ? { ...entry, needed_count: needed, purchased_count: purchased } : entry,
    ),
  );
}

/** Show a changed item in its list, without refetching. */
export function replaceCachedItem(
  queryClient: QueryClient,
  workspaceId: string,
  item: ShoppingItem,
) {
  updateCachedItems(queryClient, workspaceId, item.list_id, (items) =>
    items.map((entry) => (entry.id === item.id ? item : entry)),
  );
}
