"use client";

import type {
  CreateShoppingItemRequest,
  ShoppingItem,
  ShoppingListOverview,
  UpdateShoppingItemRequest,
} from "@orbit/contracts";
import { type LucideIcon, PartyPopper, RotateCcw } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { TemplatePickerDialog } from "@/components/template-picker-dialog";
import { Button } from "@/components/ui/button";
import { HeroSkeleton, Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { SortableList, type SortableMove } from "@/components/ui/sortable";
import { usePeople } from "@/hooks/use-people";
import { useDeleteItemWithUndo, useShopping, useShoppingMutations } from "@/hooks/use-shopping";
import {
  DEFAULT_LIST_ICON,
  SHOPPING_TEMPLATES,
  type ShoppingTemplate,
  shoppingTemplateRequests,
} from "@/lib/shopping";
import { useWorkspaces } from "@/providers/workspace";
import { cn } from "@/utils/common";
import { isEditableTarget } from "@/utils/keyboard";
import { animateListChanges } from "@/utils/list-motion";
import { revealWhenVisible } from "@/utils/reveal";

import { ItemComposer } from "./item-composer";
import { ItemEditDialog } from "./item-edit-dialog";
import { ListActions } from "./list-actions";
import { SHOPPING_LIST_ICON_COMPONENTS } from "./list-icon";
import { type ListDetails, ListNameDialog } from "./list-name-dialog";
import { ListTabs } from "./list-tabs";
import { ShoppingItemRow, SortableShoppingItemRow } from "./shopping-item";

/** The Shopping page for the active workspace. Remounts (and resets) when the workspace changes. */
export function ShoppingPanel() {
  const { state, refresh } = useWorkspaces();

  if (state.status === "error") {
    return <LoadError message={state.message} onRetry={refresh} />;
  }
  if (state.status === "loading") return <ShoppingSkeleton />;
  return <ShoppingView key={state.active.id} workspaceId={state.active.id} />;
}

type NameDialog = { mode: "create" } | { mode: "edit"; list: ShoppingListOverview };

function ShoppingView({ workspaceId }: { workspaceId: string }) {
  const shopping = useShopping(workspaceId);
  const { active, items, select } = shopping;
  const mutations = useShoppingMutations(workspaceId);
  // Gift ideas name their person; People is optional, so a failed load only hides names.
  const { people } = usePeople(workspaceId);
  const everyone = people.status === "success" ? people.data : [];
  const names = new Map(everyone.map((person) => [person.id, person.name]));
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sectionId = useId();

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

  // Lists

  const saveListName = useCallback(
    async (dialog: NameDialog, details: ListDetails) => {
      if (dialog.mode === "create") {
        const created = await mutations.createList.mutateAsync(details);
        select(created.id);
        setAnnouncement(`Created “${created.name}”.`);
      } else {
        const { list } = dialog;
        const renamed = details.name !== list.name;
        const updated = await mutations.updateList.mutateAsync({
          list,
          // Send only what changed, so a stale form can't undo another change.
          changes: {
            ...(renamed ? { name: details.name } : {}),
            ...(details.icon !== list.icon ? { icon: details.icon } : {}),
          },
        });
        setAnnouncement(renamed ? `Renamed to “${updated.name}”.` : "Saved the list.");
      }
      setActionError(null);
    },
    [mutations.createList, mutations.updateList, select],
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

  /** Adds a template's items, in order, to the list in view. */
  const applyTemplate = async (template: ShoppingTemplate) => {
    if (!active) return;
    for (const draft of shoppingTemplateRequests(template)) {
      await mutations.addItem.mutateAsync({ listId: active.id, draft });
    }
    setActionError(null);
    setAnnouncement(`Added ${template.items.length} items from “${template.name}”.`);
  };

  const toggle = useCallback(
    async (item: ShoppingItem) => {
      const purchasing = item.status === "needed";
      setActionError(null);
      // The row flips at once (see `useShoppingMutations`), so it isn't dimmed meanwhile.
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
    },
    [mutations.toggleItem],
  );

  const save = useCallback(
    async (item: ShoppingItem, changes: UpdateShoppingItemRequest) => {
      const updated = await mutations.updateItem.mutateAsync({ item, changes });
      setActionError(null);
      setAnnouncement(`Saved “${updated.name}”.`);
    },
    [mutations.updateItem],
  );

  const deleteWithUndo = useDeleteItemWithUndo(workspaceId, mutations.deleteItem.mutateAsync);
  const remove = (item: ShoppingItem) => {
    setActionError(null);
    deleteWithUndo(item);
    // The row and its focused button are gone; keep focus in the list.
    listRef.current?.focus();
  };

  if (shopping.lists.status === "loading") return <ShoppingSkeleton />;
  if (shopping.lists.status === "error") {
    return <LoadError message={shopping.lists.message} onRetry={shopping.reloadLists} />;
  }

  const needed = items.status === "success" ? items.data.filter((i) => i.status === "needed") : [];
  const purchased =
    items.status === "success" ? items.data.filter((i) => i.status === "purchased") : [];

  // Needed items can be dragged into a new order; purchased ones stay newest first.
  const move = ({ order }: SortableMove<ShoppingItem>) => {
    if (!active) return;
    setActionError(null);
    mutations.reorderItems.mutateAsync({ listId: active.id, order }).catch((reason: unknown) => {
      setActionError(describeApiError(reason, "Couldn’t move the item. Try again."));
    });
  };

  const renderItems = (
    group: ShoppingItem[],
    label: string,
    { sortable = false, className }: { sortable?: boolean; className?: string } = {},
  ) => {
    const Row = sortable ? SortableShoppingItemRow : ShoppingItemRow;
    const list = (
      <ul
        ref={animateListChanges}
        aria-label={label}
        className={cn(
          "@container/rows relative divide-y overflow-hidden rounded-2xl border bg-card shadow-elevation-1",
          className,
        )}
      >
        {group.map((item) => (
          <Row
            key={item.id}
            item={item}
            giftFor={item.person_id ? (names.get(item.person_id) ?? null) : null}
            onToggle={(entry) => void toggle(entry)}
            onEdit={setEditing}
            onDelete={remove}
          />
        ))}
      </ul>
    );
    return sortable ? (
      <SortableList items={group} itemLabel={(item) => item.name} onMove={move}>
        {list}
      </SortableList>
    ) : (
      list
    );
  };

  // Layout follows the space the page actually gets (which depends on the app sidebar), not the
  // screen: container queries place the lists rail, the composer, and the bought column.
  return (
    <div className="@container/shop">
      <div className="grid gap-6 @4xl/shop:grid-cols-[13rem_minmax(0,1fr)] @4xl/shop:gap-8 @7xl/shop:grid-cols-[15rem_minmax(0,1fr)] @7xl/shop:gap-12">
        <aside className="min-w-0 @4xl/shop:sticky @4xl/shop:top-6 @4xl/shop:self-start">
          <ListTabs
            lists={shopping.lists.data}
            activeId={active?.id ?? null}
            onSelect={(list) => {
              setActionError(null);
              select(list.id);
            }}
            onCreate={() => setNameDialog({ mode: "create" })}
          />
        </aside>

        {active ? (
          <section
            aria-labelledby="shopping-list-heading"
            className="@container/list min-w-0 space-y-5"
          >
            <ListHero
              icon={SHOPPING_LIST_ICON_COMPONENTS[active.icon]}
              name={active.name}
              needed={active.needed_count}
              purchased={active.purchased_count}
              actions={
                <ListActions
                  key={active.id}
                  list={active}
                  onEdit={() => setNameDialog({ mode: "edit", list: active })}
                  onDelete={removeList}
                />
              }
            />

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
              className="rounded-xl outline-none"
            >
              {items.status === "loading" ? (
                <ItemsSkeleton />
              ) : items.status === "error" ? (
                <LoadError message={items.message} onRetry={shopping.reloadItems} />
              ) : items.data.length === 0 ? (
                <EmptyState
                  icon={SHOPPING_LIST_ICON_COMPONENTS[active.icon]}
                  title="Nothing on this list yet"
                  description="Add what you need above, and check items off as you buy them."
                  template={{ onClick: () => setTemplatesOpen(true) }}
                />
              ) : (
                // Bought items sit beside the list when there's room, below it when not.
                <div
                  className={cn(
                    "grid gap-6",
                    purchased.length > 0 &&
                      "@5xl/list:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] @min-[100rem]/list:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]",
                  )}
                >
                  <section aria-labelledby={`${sectionId}-needed`} className="min-w-0 space-y-2">
                    <SectionHeading id={`${sectionId}-needed`} count={needed.length}>
                      To buy
                    </SectionHeading>
                    {needed.length > 0 ? (
                      // One column, so a dragged item moves straight up or down.
                      renderItems(
                        needed,
                        `${needed.length} ${needed.length === 1 ? "item" : "items"} to buy`,
                        { sortable: needed.length > 1 },
                      )
                    ) : (
                      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-success/40 bg-success/5 px-4 py-6 text-sm text-muted-foreground">
                        <span
                          aria-hidden="true"
                          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-success/12 text-success"
                        >
                          <PartyPopper className="size-4 animate-check-pop" />
                        </span>
                        You’ve got everything on this list.
                      </div>
                    )}
                  </section>

                  {purchased.length > 0 ? (
                    <section aria-labelledby={`${sectionId}-bought`} className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <SectionHeading id={`${sectionId}-bought`} count={purchased.length}>
                          Bought
                        </SectionHeading>
                        <div className="flex gap-1">
                          <Button
                            variant="soft"
                            size="sm"
                            onClick={() => void bulkChange(active, "restock")}
                          >
                            <RotateCcw aria-hidden="true" />
                            Restock all
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            onClick={() => void bulkChange(active, "clear")}
                          >
                            Clear bought
                          </Button>
                        </div>
                      </div>
                      {renderItems(purchased, `${purchased.length} bought`)}
                    </section>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        ) : null}
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      {editing ? (
        <ItemEditDialog
          item={editing}
          people={everyone}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {templatesOpen && active ? (
        <TemplatePickerDialog
          title="Start from a template"
          description={`Pick a list. Its items are added to ${active.name}, ready to edit.`}
          templates={SHOPPING_TEMPLATES.map((template) => ({
            ...template,
            preview: template.items,
            actionLabel: `Add ${template.items.length} items`,
          }))}
          onUse={applyTemplate}
          errorMessage="Couldn’t add every item from that template. Check the list and try again."
          onClose={() => setTemplatesOpen(false)}
        />
      ) : null}
      {nameDialog ? (
        <ListNameDialog
          title={nameDialog.mode === "create" ? "New shopping list" : "Edit list"}
          submitLabel={nameDialog.mode === "create" ? "Create list" : "Save"}
          initial={
            nameDialog.mode === "edit"
              ? { name: nameDialog.list.name, icon: nameDialog.list.icon }
              : { name: "", icon: DEFAULT_LIST_ICON }
          }
          onSave={(details) => saveListName(nameDialog, details)}
          onClose={() => setNameDialog(null)}
        />
      ) : null}
    </div>
  );
}

function SectionHeading({ id, count, children }: { id: string; count: number; children: string }) {
  return (
    <h3
      id={id}
      className="flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {children}
      <span
        aria-hidden="true"
        className="rounded-full bg-muted px-1.5 font-medium text-muted-foreground tabular-nums"
      >
        {count}
      </span>
    </h3>
  );
}

/** What's left to buy, in a few words. */
function listHeadline(needed: number, purchased: number): string {
  if (needed + purchased === 0) return "Add what you need below";
  if (needed === 0) return "Everything’s in the basket";
  return `${needed} ${needed === 1 ? "item" : "items"} to buy`;
}

/**
 * The open list as a card: its icon and name, what's left to buy, and how much is bought as a
 * ring. The list's own actions sit in the corner.
 */
function ListHero({
  icon: Icon,
  name,
  needed,
  purchased,
  actions,
}: {
  icon: LucideIcon;
  name: string;
  needed: number;
  purchased: number;
  actions: ReactNode;
}) {
  const total = needed + purchased;
  const done = total > 0 && needed === 0;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-linear-to-br via-card to-card p-5 shadow-elevation-1 transition-colors duration-300 @3xl/list:p-6",
        done ? "border-success/40 from-success/15" : "from-brand-subtle/80",
      )}
    >
      <Icon
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -bottom-8 size-40 -rotate-12 text-brand opacity-[0.06]"
      />
      <div className="relative flex flex-wrap items-center gap-5">
        <BoughtRing purchased={purchased} total={total} icon={Icon} done={done} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p
            className={cn(
              "text-xs font-medium tracking-wide uppercase",
              done ? "text-success" : "text-brand",
            )}
          >
            Shopping list
          </p>
          <h2
            id="shopping-list-heading"
            className="text-xl font-semibold tracking-tight break-words @3xl/list:text-2xl"
          >
            {name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {listHeadline(needed, purchased)}
            {total > 0 ? (
              <>
                {" · "}
                <span className="tabular-nums">
                  {purchased} of {total} bought
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="self-start">{actions}</div>
      </div>
    </div>
  );
}

/** How much of the list is bought, as a ring that sweeps in unless motion is reduced. */
function BoughtRing({
  purchased,
  total,
  icon: Icon,
  done,
}: {
  purchased: number;
  total: number;
  icon: LucideIcon;
  done: boolean;
}) {
  const percent = total === 0 ? 0 : Math.round((purchased / total) * 100);
  const offset = 100 - percent;
  const style: CSSProperties & { "--ring-offset": number } = {
    "--ring-offset": offset,
    strokeDashoffset: offset,
  };
  return (
    <div
      role="progressbar"
      aria-label="Bought"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="relative size-20 shrink-0"
    >
      <svg
        ref={revealWhenVisible}
        viewBox="0 0 100 100"
        aria-hidden="true"
        className={cn("size-full", done ? "text-success" : "text-brand")}
      >
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          strokeWidth="9"
          stroke="currentColor"
          className="opacity-15"
        />
        {percent > 0 ? (
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            strokeWidth="9"
            stroke="currentColor"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100"
            transform="rotate(-90 50 50)"
            style={style}
            className="progress-arc"
          />
        ) : null}
      </svg>
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
        <span
          className={cn(
            "flex size-11 items-center justify-center rounded-full",
            done ? "bg-success/12 text-success" : "bg-brand-subtle text-brand",
          )}
        >
          <Icon className="size-5" />
        </span>
      </div>
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

/**
 * The Shopping page while its lists load: the same rail, list hero, composer, and item list
 * frame as the real page, so it fills in without moving.
 */
function ShoppingSkeleton() {
  return (
    <div className="@container/shop" aria-busy="true">
      <span className="sr-only">Loading shopping lists…</span>
      <div className="grid gap-6 @4xl/shop:grid-cols-[13rem_minmax(0,1fr)] @4xl/shop:gap-8 @7xl/shop:grid-cols-[15rem_minmax(0,1fr)] @7xl/shop:gap-12">
        <div aria-hidden="true" className="min-w-0 space-y-2 @4xl/shop:space-y-3">
          <SkeletonText className="hidden w-16 px-3 text-xs @4xl/shop:flex" />
          <div className="flex gap-1 @4xl/shop:flex-col">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-9 w-28 rounded-lg @4xl/shop:w-full" />
            ))}
          </div>
        </div>
        <div className="@container/list min-w-0 space-y-5">
          <HeroSkeleton
            ring
            className="@3xl/list:p-6"
            titleClassName="text-xl @3xl/list:text-2xl"
          />
          <Skeleton className="h-15 rounded-2xl" />
          <ItemsSkeleton />
        </div>
      </div>
    </div>
  );
}

function ItemsSkeleton() {
  return (
    <div className="space-y-2">
      <span className="sr-only">Loading items…</span>
      <SkeletonText aria-hidden="true" className="w-20 px-1 text-xs" />
      <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-elevation-1">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="flex items-center gap-3 px-3 py-3 sm:px-4 pointer-coarse:py-3.5 compact:py-1.5"
          >
            <Skeleton className="size-5 rounded-full" />
            <SkeletonText className={cn("text-sm", row === 1 ? "w-1/3" : "w-1/2")} />
          </div>
        ))}
      </div>
    </div>
  );
}
