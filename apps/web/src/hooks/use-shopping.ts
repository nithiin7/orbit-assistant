"use client";

import type {
  CreateShoppingItemRequest,
  ShoppingItem,
  ShoppingListOverview,
  UpdateShoppingItemRequest,
} from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import {
  addShoppingItem,
  clearPurchasedItems,
  createShoppingList,
  deleteShoppingItem,
  deleteShoppingList,
  purchaseShoppingItem,
  renameShoppingList,
  replaceCachedItem,
  restockShoppingItem,
  restockShoppingList,
  shoppingItemsOptions,
  shoppingKeys,
  shoppingListsOptions,
  updateCachedItems,
  updateCachedLists,
  updateShoppingItem,
} from "@/api/shopping";
import { useAuth } from "@/components/auth/auth-provider";
import { useWorkspaces } from "@/components/workspace/workspace-provider";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";

const selectLists = (data: { lists: ShoppingListOverview[] }) => data.lists;
const selectItems = (data: { items: ShoppingItem[] }) => data.items;

/**
 * One workspace's shopping lists and the selected list's items. Items and the lists' counts
 * share the query cache, so changes made through `useShoppingMutations` keep both in step.
 */
export function useShopping(workspaceId: string) {
  const { withToken } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listsQuery = useQuery({
    ...shoppingListsOptions(withToken, workspaceId),
    select: selectLists,
  });
  const lists = listsQuery.data ?? null;
  // The chosen list while it exists; otherwise the first (default) list.
  const active = lists?.find((entry) => entry.id === selectedId) ?? lists?.[0] ?? null;
  const itemsQuery = useQuery({
    ...shoppingItemsOptions(withToken, workspaceId, active?.id ?? null),
    select: selectItems,
  });
  useWorkspaceNotFound(listsQuery.error ?? itemsQuery.error);

  const { refetch: refetchLists } = listsQuery;
  const { refetch: refetchItems } = itemsQuery;
  const reloadLists = useCallback(() => void refetchLists(), [refetchLists]);
  const reloadItems = useCallback(() => void refetchItems(), [refetchItems]);

  const items: Resource<ShoppingItem[]> = active
    ? queryResource(itemsQuery, "Couldn’t load this list.")
    : { status: "loading" };

  return {
    lists: queryResource(listsQuery, "Couldn’t load your shopping lists."),
    active,
    items,
    select: setSelectedId,
    reloadLists,
    reloadItems,
  };
}

/** Shopping list and item changes for the workspace. Each updates the cached data to match. */
export function useShoppingMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();

  const createList = useMutation({
    mutationFn: (name: string) =>
      withToken((token) => createShoppingList(token, workspaceId, { name })),
    onSuccess: (created) =>
      updateCachedLists(queryClient, workspaceId, (lists) => [
        ...lists,
        { ...created, needed_count: 0, purchased_count: 0 },
      ]),
  });

  const renameList = useMutation({
    mutationFn: ({ list, name }: { list: ShoppingListOverview; name: string }) =>
      withToken((token) => renameShoppingList(token, workspaceId, list.id, { name })),
    onSuccess: (renamed) =>
      updateCachedLists(queryClient, workspaceId, (lists) =>
        lists.map((entry) => (entry.id === renamed.id ? { ...entry, ...renamed } : entry)),
      ),
  });

  const deleteList = useMutation({
    mutationFn: (list: ShoppingListOverview) =>
      withToken((token) => deleteShoppingList(token, workspaceId, list.id)),
    onSuccess: (_result, list) => {
      updateCachedLists(queryClient, workspaceId, (lists) =>
        lists.filter((entry) => entry.id !== list.id),
      );
      queryClient.removeQueries({ queryKey: shoppingKeys.items(workspaceId, list.id) });
    },
  });

  const restockList = useMutation({
    mutationFn: (list: ShoppingListOverview) =>
      withToken((token) => restockShoppingList(token, workspaceId, list.id)),
    onSuccess: (_result, list) =>
      updateCachedItems(queryClient, workspaceId, list.id, (items) =>
        items.map((item) =>
          item.status === "purchased" ? { ...item, status: "needed", purchased_at: null } : item,
        ),
      ),
  });

  const clearPurchased = useMutation({
    mutationFn: (list: ShoppingListOverview) =>
      withToken((token) => clearPurchasedItems(token, workspaceId, list.id)),
    onSuccess: (_result, list) =>
      updateCachedItems(queryClient, workspaceId, list.id, (items) =>
        items.filter((item) => item.status !== "purchased"),
      ),
  });

  const addItem = useMutation({
    mutationFn: ({ listId, draft }: { listId: string; draft: CreateShoppingItemRequest }) =>
      withToken((token) => addShoppingItem(token, workspaceId, listId, draft)),
    onSuccess: (item) =>
      updateCachedItems(queryClient, workspaceId, item.list_id, (items) => [...items, item]),
  });

  const toggleItem = useMutation({
    mutationFn: (item: ShoppingItem) =>
      withToken((token) =>
        (item.status === "needed" ? purchaseShoppingItem : restockShoppingItem)(
          token,
          workspaceId,
          item.id,
        ),
      ),
    // Show the change immediately; restore the item if the request fails.
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: shoppingKeys.items(workspaceId, item.list_id) });
      const purchasing = item.status === "needed";
      replaceCachedItem(queryClient, workspaceId, {
        ...item,
        status: purchasing ? "purchased" : "needed",
        purchased_at: purchasing ? new Date().toISOString() : null,
      });
    },
    onSuccess: (updated) => replaceCachedItem(queryClient, workspaceId, updated),
    onError: (_error, item) => replaceCachedItem(queryClient, workspaceId, item),
  });

  const updateItem = useMutation({
    mutationFn: ({ item, changes }: { item: ShoppingItem; changes: UpdateShoppingItemRequest }) =>
      withToken((token) => updateShoppingItem(token, workspaceId, item.id, changes)),
    onSuccess: (updated) => replaceCachedItem(queryClient, workspaceId, updated),
  });

  const deleteItem = useMutation({
    mutationFn: (item: ShoppingItem) =>
      withToken((token) => deleteShoppingItem(token, workspaceId, item.id)),
    onSuccess: (_result, item) =>
      updateCachedItems(queryClient, workspaceId, item.list_id, (items) =>
        items.filter((entry) => entry.id !== item.id),
      ),
  });

  return {
    createList,
    renameList,
    deleteList,
    restockList,
    clearPurchased,
    addItem,
    toggleItem,
    updateItem,
    deleteItem,
  };
}

/** The active workspace's shopping lists, for the dashboard. Shares the Shopping page's cache. */
export function useShoppingOverview(): {
  resource: Resource<ShoppingListOverview[]>;
  reload: () => void;
} {
  const { withToken } = useAuth();
  const { state } = useWorkspaces();
  const workspaceId = state.status === "ready" ? state.active.id : null;
  const result = useQuery({ ...shoppingListsOptions(withToken, workspaceId), select: selectLists });
  useWorkspaceNotFound(result.error);
  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  return { resource: queryResource(result, "Couldn’t load this workspace."), reload };
}
