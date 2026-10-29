"use client";

import type { ShoppingItem, ShoppingListOverview } from "@orbit/contracts";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useWorkspaces } from "@/components/workspace/workspace-provider";
import { ApiError, describeApiError, listShoppingItems, listShoppingLists } from "@/lib/api";
import { countItems, sortItems } from "@/lib/shopping";

export type Load<T> =
  { status: "loading" } | { status: "error"; message: string } | { status: "success"; data: T };

type ItemsLoad = { listId: string; load: Load<ShoppingItem[]> };
type State = { lists: Load<ShoppingListOverview[]>; items: ItemsLoad | null };

const LOADING = { status: "loading" } as const;

/**
 * One workspace's shopping lists and the selected list's items. The caller remounts this per
 * workspace (via `key`), so nothing from another workspace can show. Items and the lists' counts
 * live in one state, so local changes keep both in step without reloading.
 */
export function useShopping(workspaceId: string) {
  const { withToken } = useAuth();
  const { refresh: refreshWorkspaces } = useWorkspaces();
  const [state, setState] = useState<State>({ lists: LOADING, items: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listsVersion, setListsVersion] = useState(0);
  const [itemsVersion, setItemsVersion] = useState(0);

  const onLoadError = useCallback(
    (reason: unknown, fallback: string): Load<never> => {
      // The workspace is gone or no longer accessible: re-validate the workspace list.
      if (
        reason instanceof ApiError &&
        reason.status === 404 &&
        reason.detail === "Workspace not found."
      )
        refreshWorkspaces();
      return { status: "error", message: describeApiError(reason, fallback) };
    },
    [refreshWorkspaces],
  );

  useEffect(() => {
    const controller = new AbortController();
    withToken((token) => listShoppingLists(token, workspaceId, { signal: controller.signal })).then(
      (result) => {
        if (controller.signal.aborted) return;
        setState((current) => ({ ...current, lists: { status: "success", data: result.lists } }));
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        const lists = onLoadError(reason, "Couldn’t load your shopping lists.");
        setState((current) => ({ ...current, lists }));
      },
    );
    return () => controller.abort();
  }, [workspaceId, listsVersion, withToken, onLoadError]);

  const lists = state.lists.status === "success" ? state.lists.data : null;
  // The chosen list while it exists; otherwise the first (default) list.
  const active = lists?.find((entry) => entry.id === selectedId) ?? lists?.[0] ?? null;
  const activeId = active?.id ?? null;

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    withToken((token) =>
      listShoppingItems(token, workspaceId, activeId, { signal: controller.signal }),
    ).then(
      (result) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          items: { listId: activeId, load: { status: "success", data: result.items } },
        }));
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        const load = onLoadError(reason, "Couldn’t load this list.");
        setState((current) => ({ ...current, items: { listId: activeId, load } }));
      },
    );
    return () => controller.abort();
  }, [workspaceId, activeId, itemsVersion, withToken, onLoadError]);

  const reloadLists = useCallback(() => {
    setState({ lists: LOADING, items: null });
    setListsVersion((value) => value + 1);
  }, []);

  const reloadItems = useCallback(() => {
    setState((current) => ({ ...current, items: null }));
    setItemsVersion((value) => value + 1);
  }, []);

  /** Change a loaded list's items in place; re-sorts them and updates that list's counts. */
  const updateItems = useCallback(
    (listId: string, change: (items: ShoppingItem[]) => ShoppingItem[]) => {
      setState((current) => {
        const { items } = current;
        if (items?.listId !== listId || items.load.status !== "success") return current;
        const next = sortItems(change(items.load.data));
        const { needed, purchased } = countItems(next);
        return {
          items: { listId, load: { status: "success", data: next } },
          lists:
            current.lists.status === "success"
              ? {
                  status: "success",
                  data: current.lists.data.map((entry) =>
                    entry.id === listId
                      ? { ...entry, needed_count: needed, purchased_count: purchased }
                      : entry,
                  ),
                }
              : current.lists,
        };
      });
    },
    [],
  );

  /** Change the lists themselves (add, rename, remove). */
  const updateLists = useCallback(
    (change: (lists: ShoppingListOverview[]) => ShoppingListOverview[]) => {
      setState((current) =>
        current.lists.status === "success"
          ? { ...current, lists: { status: "success", data: change(current.lists.data) } }
          : current,
      );
    },
    [],
  );

  const items: Load<ShoppingItem[]> =
    activeId && state.items?.listId === activeId ? state.items.load : LOADING;

  return {
    lists: state.lists,
    active,
    items,
    select: setSelectedId,
    reloadLists,
    reloadItems,
    updateItems,
    updateLists,
  };
}
