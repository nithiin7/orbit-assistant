"use client";

import type { ShoppingListOverview } from "@orbit/contracts";
import { Plus, ShoppingBasket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/utils/common";

type ListTabsProps = {
  lists: ShoppingListOverview[];
  activeId: string | null;
  onSelect: (list: ShoppingListOverview) => void;
  onCreate: () => void;
};

/**
 * The workspace's lists, each with how many items are still to buy. A sticky side rail when the
 * page has room (see the `shop` container in `ShoppingView`); a row that scrolls sideways when not.
 */
export function ListTabs({ lists, activeId, onSelect, onCreate }: ListTabsProps) {
  return (
    <nav aria-label="Shopping lists" className="min-w-0 space-y-2 @4xl/shop:space-y-3">
      <h2 className="hidden px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase @4xl/shop:block">
        Lists
      </h2>
      <div className="flex items-center gap-2 @4xl/shop:flex-col @4xl/shop:items-stretch">
        <ul className="-mx-1 scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 @4xl/shop:mx-0 @4xl/shop:flex-col @4xl/shop:overflow-visible @4xl/shop:px-0">
          {lists.map((list) => {
            const active = list.id === activeId;
            return (
              <li key={list.id} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={`${list.name}, ${list.needed_count} to buy`}
                  onClick={() => onSelect(list)}
                  className={cn(
                    "flex h-9 max-w-64 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @4xl/shop:w-full @4xl/shop:max-w-none",
                    active
                      ? "bg-brand-subtle text-brand"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <ShoppingBasket className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-left">{list.name}</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "min-w-6 rounded-full px-1.5 text-center text-xs tabular-nums",
                      active ? "bg-brand/15" : "bg-muted",
                    )}
                  >
                    {list.needed_count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <Button
          variant="ghost"
          onClick={onCreate}
          // Icon-only beside the scrolling strip, so it doesn't crowd out the lists.
          className="size-9 shrink-0 px-0 text-muted-foreground @4xl/shop:h-9 @4xl/shop:w-auto @4xl/shop:justify-start @4xl/shop:px-3"
        >
          <Plus aria-hidden="true" />
          <span className="sr-only @4xl/shop:not-sr-only">New list</span>
        </Button>
      </div>
    </nav>
  );
}
