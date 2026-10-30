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
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useShopping, useShoppingMutations } from "@/hooks/use-shopping";
import { useWorkspaces } from "@/providers/workspace";
import { cn } from "@/utils/common";
import { isEditableTarget } from "@/utils/keyboard";

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
  const shopping = useShopping(workspaceId);
  const { active, items, select } = shopping;
  const mutations = useShoppingMutations(workspaceId);
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

  // Lists

  const saveListName = useCallback(
    async (dialog: NameDialog, name: string) => {
      if (dialog.mode === "create") {
        const created = await mutations.createList.mutateAsync(name);
        select(created.id);
        setAnnouncement(`Created “${created.name}”.`);
      } else {
        const renamed = await mutations.renameList.mutateAsync({ list: dialog.list, name });
        setAnnouncement(`Renamed to “${renamed.name}”.`);
      }
      setActionError(null);
    },
    [mutations.createList, mutations.renameList, select],
  );

  const removeList = useCallback(
    async (list: ShoppingListOverview) => {
      setActionError(null);
      try {
        await mutations.deleteList.mutateAsync(list);
        select(null);
        setAnnouncement(`Deleted “${list.name}”.`);
      } catch (reason) {
        setActionError(describeApiError(reason, "Couldn’t delete the list. Try again."));
      }
    },
    [mutations.deleteList, select],
  );

  const bulkChange = useCallback(
    async (list: ShoppingListOverview, action: "restock" | "clear") => {
      setActionError(null);
      try {
        await (action === "restock" ? mutations.restockList : mutations.clearPurchased).mutateAsync(
          list,
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
    [mutations.restockList, mutations.clearPurchased],
  );

  // Items

  const add = useCallback(
    async (listId: string, draft: CreateShoppingItemRequest) => {
      const item = await mutations.addItem.mutateAsync({ listId, draft });
      setActionError(null);
      setAnnouncement(`Added “${item.name}”.`);
    },
    [mutations.addItem],
  );

  const toggle = useCallback(
    async (item: ShoppingItem) => {
      const purchasing = item.status === "needed";
      setActionError(null);
      setItemPending(item.id, true);
      try {
        await mutations.toggleItem.mutateAsync(item);
        setAnnouncement(
          purchasing
            ? `Marked “${item.name}” as bought.`
            : `Moved “${item.name}” back to the list.`,
        );
      } catch (reason) {
        setActionError(describeApiError(reason, "Couldn’t update the item. Try again."));
      }
      setItemPending(item.id, false);
    },
    [mutations.toggleItem, setItemPending],
  );

  const save = useCallback(
    async (item: ShoppingItem, changes: UpdateShoppingItemRequest) => {
      const updated = await mutations.updateItem.mutateAsync({ item, changes });
      setActionError(null);
      setAnnouncement(`Saved “${updated.name}”.`);
    },
    [mutations.updateItem],
  );

  const remove = useCallback(
    async (item: ShoppingItem) => {
      setActionError(null);
      setItemPending(item.id, true);
      try {
        await mutations.deleteItem.mutateAsync(item);
        setAnnouncement(`Deleted “${item.name}”.`);
        // The row and its focused button are gone; keep focus in the list.
        listRef.current?.focus();
      } catch (reason) {
        setActionError(describeApiError(reason, "Couldn’t delete the item. Try again."));
      }
      setItemPending(item.id, false);
    },
    [mutations.deleteItem, setItemPending],
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
