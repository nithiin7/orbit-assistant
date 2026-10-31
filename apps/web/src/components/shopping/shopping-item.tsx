"use client";

import type { ShoppingItem } from "@orbit/contracts";
import { ExternalLink, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { linkLabel } from "@/lib/shopping";
import { cn } from "@/utils/common";

type ShoppingItemRowProps = {
  item: ShoppingItem;
  /** A status change or deletion is in flight. */
  pending: boolean;
  onToggle: (item: ShoppingItem) => void;
  onEdit: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => Promise<void>;
};

export function ShoppingItemRow({
  item,
  pending,
  onToggle,
  onEdit,
  onDelete,
}: ShoppingItemRowProps) {
  const nameId = useId();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const purchased = item.status === "purchased";

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const cancelDelete = () => {
    setConfirming(false);
    // The confirmation unmounts; put focus back on the button that opened it.
    requestAnimationFrame(() => deleteRef.current?.focus());
  };

  return (
    <li
      className={cn(
        "group flex items-start gap-3 px-3 py-3 transition-[background-color,opacity] duration-150 hover:bg-accent/40 sm:px-4 @lg/rows:items-center pointer-coarse:py-3.5",
        pending && "opacity-70",
        purchased && "bg-muted/20",
      )}
    >
      <Checkbox
        shape="round"
        checked={purchased}
        disabled={pending}
        onChange={() => onToggle(item)}
        aria-labelledby={nameId}
        // A bigger target for ticking items off on a phone in the shop.
        className="mt-0.5 @lg/rows:mt-0 pointer-coarse:size-6"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 @lg/rows:flex-row @lg/rows:items-center @lg/rows:gap-4">
        <div className="min-w-0 flex-1 space-y-0.5">
          <button
            type="button"
            onClick={() => onEdit(item)}
            aria-label={`Edit “${item.name}”`}
            className="block max-w-full rounded-sm text-left text-sm font-medium break-words outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:text-base"
          >
            <span
              id={nameId}
              className={cn(
                "transition-colors duration-150",
                purchased && "text-muted-foreground line-through decoration-1",
              )}
            >
              {item.name}
            </span>
          </button>
          {item.notes ? (
            <p className="line-clamp-1 text-sm break-words text-muted-foreground">{item.notes}</p>
          ) : null}
        </div>
        {item.quantity || item.url ? (
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 @lg/rows:justify-end">
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
        {confirming ? (
          <div
            role="group"
            aria-label={`Delete “${item.name}”?`}
            className="flex items-center gap-1"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                cancelDelete();
              }
            }}
          >
            <Button
              ref={confirmRef}
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => {
                // On success the row unmounts; on failure the page reports the error.
                void onDelete(item).finally(() => setConfirming(false));
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={cancelDelete}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            ref={deleteRef}
            variant="ghost"
            size="icon"
            disabled={pending}
            aria-label={`Delete “${item.name}”`}
            onClick={() => setConfirming(true)}
            // Revealed on hover or focus where there is a mouse; always visible on touch screens.
            className="size-8 text-muted-foreground hover:text-destructive pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        )}
      </div>
    </li>
  );
}
