"use client";

import type {
  CreateShoppingItemRequest,
  ShoppingItem,
  ShoppingListOverview,
  UpdateShoppingItemRequest,
} from "@orbit/contracts";
import { ShoppingBasket } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import {
  addShoppingItem,
  clearPurchasedItems,
  createShoppingList,
  deleteShoppingItem,
  deleteShoppingList,
  purchaseShoppingItem,
  renameShoppingList,
  restockShoppingItem,
  restockShoppingList,
  updateShoppingItem,
} from "@/api/shopping";
import { useAuth } from "@/components/auth/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaces } from "@/components/workspace/workspace-provider";
import { useShopping } from "@/hooks/use-shopping";
import { isEditableTarget } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

import { ItemComposer } from "./item-composer";
import { ItemEditDialog } from "./item-edit-dialog";
import { ListActions } from "./list-actions";
import { ListNameDialog } from "./list-name-dialog";
import { ListTabs } from "./list-tabs";
import { ShoppingItemRow } from "./shopping-item";

/** The Shopping page for the active workspace. Remounts (and resets) when the workspace changes. */
export function ShoppingPanel() {
  const { state, refresh } = useWorkspaces();

  if (state.status === "error") {
    return <LoadError message={state.message} onRetry={refresh} />;
  }
  if (state.status === "loading") return <ShoppingSkeleton />;
  return <ShoppingView key={state.active.id} workspaceId={state.active.id} />;
}

type NameDialog = { mode: "create" } | { mode: "rename"; list: ShoppingListOverview };

function ShoppingView({ workspaceId }: { workspaceId: string }) {
  const { withToken } = useAuth();
  const shopping = useShopping(workspaceId);
  const { active, items, updateItems, updateLists, select } = shopping;
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // N focuses the new-item field, unless the user is typing somewhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target) || document.querySelector("dialog[open]")) return;
      if (event.key.toLowerCase() !== "n" || !nameRef.current) return;
      event.preventDefault();
      nameRef.current.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const setItemPending = useCallback((itemId: string, isPending: boolean) => {
    setPending((current) => {
      const next = new Set(current);
      if (isPending) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }, []);

  const replaceItem = useCallback(
    (item: ShoppingItem) =>
      updateItems(item.list_id, (current) =>
        current.map((entry) => (entry.id === item.id ? item : entry)),
      ),
    [updateItems],
  );

  // Lists

  const saveListName = useCallback(
    async (dialog: NameDialog, name: string) => {
      if (dialog.mode === "create") {
        const created = await withToken((token) =>
          createShoppingList(token, workspaceId, { name }),
        );
        updateLists((current) => [...current, { ...created, needed_count: 0, purchased_count: 0 }]);
        select(created.id);
        setAnnouncement(`Created “${created.name}”.`);
      } else {
        const renamed = await withToken((token) =>
          renameShoppingList(token, workspaceId, dialog.list.id, { name }),
        );
        updateLists((current) =>
          current.map((entry) => (entry.id === renamed.id ? { ...entry, ...renamed } : entry)),
        );
        setAnnouncement(`Renamed to “${renamed.name}”.`);
      }
      setActionError(null);
    },
    [withToken, workspaceId, updateLists, select],
  );

  const removeList = useCallback(
    async (list: ShoppingListOverview) => {
      setActionError(null);
      try {
        await withToken((token) => deleteShoppingList(token, workspaceId, list.id));
        updateLists((current) => current.filter((entry) => entry.id !== list.id));
        select(null);
        setAnnouncement(`Deleted “${list.name}”.`);
      } catch (reason) {
        setActionError(describeApiError(reason, "Couldn’t delete the list. Try again."));
      }
    },
    [withToken, workspaceId, updateLists, select],
  );

  const bulkChange = useCallback(
    async (list: ShoppingListOverview, action: "restock" | "clear") => {
      setActionError(null);
      try {
        await withToken((token) =>
          (action === "restock" ? restockShoppingList : clearPurchasedItems)(
            token,
            workspaceId,
            list.id,
          ),
        );
        updateItems(list.id, (current) =>
          action === "restock"
            ? current.map((item) =>
                item.status === "purchased"
                  ? { ...item, status: "needed", purchased_at: null }
                  : item,
              )
            : current.filter((item) => item.status !== "purchased"),
        );
        setAnnouncement(
          action === "restock"
            ? "Moved purchased items back to the list."
            : "Removed purchased items.",
        );
      } catch (reason) {
        setActionError(
          describeApiError(
            reason,
            action === "restock"
              ? "Couldn’t restock the list. Try again."
              : "Couldn’t clear purchased items. Try again.",
          ),
        );
      }
    },
    [withToken, workspaceId, updateItems],
  );

  // Items

  const add = useCallback(
    async (listId: string, draft: CreateShoppingItemRequest) => {
      const item = await withToken((token) => addShoppingItem(token, workspaceId, listId, draft));
      updateItems(listId, (current) => [...current, item]);
      setActionError(null);
      setAnnouncement(`Added “${item.name}”.`);
    },
    [withToken, workspaceId, updateItems],
  );

  const toggle = useCallback(
    async (item: ShoppingItem) => {
      const purchasing = item.status === "needed";
      setActionError(null);
      setItemPending(item.id, true);
      // Show the change immediately; restore the item if the request fails.
      replaceItem({
        ...item,
        status: purchasing ? "purchased" : "needed",
        purchased_at: purchasing ? new Date().toISOString() : null,
      });
      try {
        const updated = await withToken((token) =>
          (purchasing ? purchaseShoppingItem : restockShoppingItem)(token, workspaceId, item.id),
        );
        replaceItem(updated);
        setAnnouncement(
          purchasing
            ? `Marked “${item.name}” as bought.`
            : `Moved “${item.name}” back to the list.`,
        );
      } catch (reason) {
        replaceItem(item);
        setActionError(describeApiError(reason, "Couldn’t update the item. Try again."));
      }
      setItemPending(item.id, false);
    },
    [withToken, workspaceId, replaceItem, setItemPending],
  );

  const save = useCallback(
    async (item: ShoppingItem, changes: UpdateShoppingItemRequest) => {
      const updated = await withToken((token) =>
        updateShoppingItem(token, workspaceId, item.id, changes),
      );
      replaceItem(updated);
      setActionError(null);
      setAnnouncement(`Saved “${updated.name}”.`);
    },
    [withToken, workspaceId, replaceItem],
  );

  const remove = useCallback(
    async (item: ShoppingItem) => {
      setActionError(null);
      setItemPending(item.id, true);
      try {
        await withToken((token) => deleteShoppingItem(token, workspaceId, item.id));
        updateItems(item.list_id, (current) => current.filter((entry) => entry.id !== item.id));
        setAnnouncement(`Deleted “${item.name}”.`);
        // The row and its focused button are gone; keep focus in the list.
        listRef.current?.focus();
      } catch (reason) {
        setActionError(describeApiError(reason, "Couldn’t delete the item. Try again."));
      }
      setItemPending(item.id, false);
    },
    [withToken, workspaceId, updateItems, setItemPending],
  );

  if (shopping.lists.status === "loading") return <ShoppingSkeleton />;
  if (shopping.lists.status === "error") {
    return <LoadError message={shopping.lists.message} onRetry={shopping.reloadLists} />;
  }

  const needed = items.status === "success" ? items.data.filter((i) => i.status === "needed") : [];
  const purchased =
    items.status === "success" ? items.data.filter((i) => i.status === "purchased") : [];

  const renderItems = (group: ShoppingItem[], label: string) => (
    <ul
      aria-label={label}
      className="divide-y overflow-hidden rounded-xl border bg-card shadow-elevation-1"
    >
      {group.map((item) => (
        <ShoppingItemRow
          key={item.id}
          item={item}
          pending={pending.has(item.id)}
          onToggle={(entry) => void toggle(entry)}
          onEdit={setEditing}
          onDelete={remove}
        />
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <ListTabs
        lists={shopping.lists.data}
        activeId={active?.id ?? null}
        onSelect={(list) => {
          setActionError(null);
          select(list.id);
        }}
        onCreate={() => setNameDialog({ mode: "create" })}
      />

      {active ? (
        <section aria-labelledby="shopping-list-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="shopping-list-heading" className="text-lg font-semibold break-words">
              {active.name}
            </h2>
            <ListActions
              key={active.id}
              list={active}
              onRename={() => setNameDialog({ mode: "rename", list: active })}
              onDelete={removeList}
            />
          </div>

          <ItemComposer
            key={active.id}
            listName={active.name}
            onAdd={(draft) => add(active.id, draft)}
            nameRef={nameRef}
          />
          <FormAlert message={actionError} />

          <div
            ref={listRef}
            tabIndex={-1}
            aria-busy={items.status === "loading"}
            className="space-y-6 rounded-xl outline-none"
          >
            {items.status === "loading" ? (
              <ItemsSkeleton />
            ) : items.status === "error" ? (
              <LoadError message={items.message} onRetry={shopping.reloadItems} />
            ) : items.data.length === 0 ? (
              <EmptyState
                icon={ShoppingBasket}
                title="Nothing on this list yet"
                description="Add what you need above. Check items off as you buy them."
              />
            ) : (
              <>
                {needed.length > 0 ? (
                  renderItems(
                    needed,
                    `${needed.length} ${needed.length === 1 ? "item" : "items"} to buy`,
                  )
                ) : (
                  <p className="rounded-xl border border-dashed bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
                    You’ve got everything on this list.
                  </p>
                )}

                {purchased.length > 0 ? (
                  <section aria-labelledby="purchased-heading" className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3
                        id="purchased-heading"
                        className="text-sm font-medium text-muted-foreground"
                      >
                        Bought ({purchased.length})
                      </h3>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void bulkChange(active, "restock")}
                        >
                          Restock all
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void bulkChange(active, "clear")}
                        >
                          Clear bought
                        </Button>
                      </div>
                    </div>
                    {renderItems(purchased, `${purchased.length} bought`)}
                  </section>
                ) : null}
              </>
            )}
          </div>
        </section>
      ) : null}

      <p role="status" className="sr-only">
        {announcement}
      </p>

      {editing ? (
        <ItemEditDialog item={editing} onSave={save} onClose={() => setEditing(null)} />
      ) : null}
      {nameDialog ? (
        <ListNameDialog
          title={nameDialog.mode === "create" ? "New shopping list" : "Rename list"}
          submitLabel={nameDialog.mode === "create" ? "Create list" : "Save"}
          initialName={nameDialog.mode === "rename" ? nameDialog.list.name : ""}
          onSave={(name) => saveListName(nameDialog, name)}
          onClose={() => setNameDialog(null)}
        />
      ) : null}
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function ShoppingSkeleton() {
  return (
    <div className="space-y-6">
      <span className="sr-only">Loading shopping lists…</span>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
      </div>
      <ItemsSkeleton />
    </div>
  );
}

function ItemsSkeleton() {
  return (
    <div className="divide-y rounded-xl border bg-card">
      <span className="sr-only">Loading items…</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="size-4 rounded" />
          <Skeleton className={cn("h-4", row === 1 ? "w-1/3" : "w-1/2")} />
        </div>
      ))}
    </div>
  );
}
