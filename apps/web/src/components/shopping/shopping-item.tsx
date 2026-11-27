"use client";

import type { ShoppingItem } from "@orbit/contracts";
import { ExternalLink, Gift, Trash2 } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DragHandle, type SortableItem, useSortableItem } from "@/components/ui/sortable";
import { linkLabel } from "@/lib/shopping";
import { cn } from "@/utils/common";

type ShoppingItemRowProps = {
  item: ShoppingItem;
  /** Who it's a gift idea for, when it is one and their name is known. */
  giftFor?: string | null;
  onToggle: (item: ShoppingItem) => void;
  onEdit: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
  /** Set by `SortableShoppingItemRow`: the row can be dragged by a handle. */
  sortable?: SortableItem;
};

export function ShoppingItemRow({
  item,
  giftFor = null,
  onToggle,
  onEdit,
  onDelete,
  sortable,
}: ShoppingItemRowProps) {
  const nameId = useId();
  const purchased = item.status === "purchased";

  return (
    <li
      {...sortable?.row}
      className={cn(
        "group flex items-start gap-3 px-3 py-3 transition-[background-color,opacity] duration-150 hover:bg-accent/40 sm:px-4 @lg/rows:items-center pointer-coarse:py-3.5 compact:py-1.5 compact:pointer-coarse:py-2.5",
        purchased && "bg-muted/20",
        sortable && "pl-1 sm:pl-2",
        sortable?.dragging && "relative z-10 bg-card shadow-elevation-2",
      )}
    >
      {sortable ? (
        <DragHandle
          {...sortable.handle}
          aria-label={`Move “${item.name}”`}
          className="-my-1.5 @lg/rows:my-0"
        />
      ) : null}
      <Checkbox
        shape="round"
        checked={purchased}
        onChange={() => onToggle(item)}
        aria-labelledby={nameId}
        // A bigger target for ticking items off on a phone in the shop.
        className="mt-0.5 @lg/rows:mt-0 pointer-coarse:size-6"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 @lg/rows:flex-row @lg/rows:items-center @lg/rows:gap-4 compact:gap-1">
        <div className="min-w-0 flex-1 space-y-0.5">
          <button
            type="button"
            onClick={() => onEdit(item)}
            aria-label={`Edit “${item.name}”`}
            className="block max-w-full rounded-sm text-left text-sm font-medium break-words outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:text-base"
          >
            <span
              id={nameId}
              data-done={purchased || undefined}
              className={cn("strike-sweep", purchased && "text-muted-foreground")}
            >
              {item.name}
            </span>
          </button>
          {item.notes ? (
            <p className="line-clamp-1 text-sm break-words text-muted-foreground">{item.notes}</p>
          ) : null}
        </div>
        {item.quantity || item.url || giftFor ? (
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 @lg/rows:justify-end">
            {giftFor ? (
              <span className="inline-flex h-6 max-w-40 items-center gap-1 rounded-full bg-brand-subtle px-2 text-xs font-medium text-brand">
                <Gift className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">For {giftFor}</span>
              </span>
            ) : null}
            {item.quantity ? (
              <span
                aria-label={`Quantity ${item.quantity}`}
                className="inline-flex h-6 items-center rounded-full bg-muted/70 px-2 text-xs font-medium tabular-nums"
              >
                {item.quantity}
              </span>
            ) : null}
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                referrerPolicy="no-referrer"
                className="inline-flex h-6 max-w-48 items-center gap-1 rounded-full bg-muted/70 px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-brand-subtle hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{linkLabel(item.url)}</span>
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete “${item.name}”`}
          // Deleting offers Undo in a toast, so it doesn't ask first.
          onClick={() => onDelete(item)}
          // Revealed on hover or focus where there is a mouse; always visible on touch screens.
          className="size-8 text-muted-foreground hover:text-destructive pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

/** An item row that can be dragged into a new place, inside `SortableList`. */
export function SortableShoppingItemRow(props: Omit<ShoppingItemRowProps, "sortable">) {
  const sortable = useSortableItem(props.item.id);
  return <ShoppingItemRow {...props} sortable={sortable} />;
}
