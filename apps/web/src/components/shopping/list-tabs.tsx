"use client";

import type { ShoppingListOverview } from "@orbit/contracts";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ListTabsProps = {
  lists: ShoppingListOverview[];
  activeId: string | null;
  onSelect: (list: ShoppingListOverview) => void;
  onCreate: () => void;
};

/** The workspace's lists as toggle buttons, each with how many items are still to buy. */
export function ListTabs({ lists, activeId, onSelect, onCreate }: ListTabsProps) {
  return (
    <nav aria-label="Shopping lists" className="flex flex-wrap items-center gap-2">
      <ul className="contents">
        {lists.map((list) => {
          const active = list.id === activeId;
          return (
            <li key={list.id}>
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${list.name}, ${list.needed_count} to buy`}
                onClick={() => onSelect(list)}
                className={cn(
                  "inline-flex h-9 max-w-64 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "border-transparent bg-primary text-primary-foreground shadow-elevation-1"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span className="truncate">{list.name}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    active ? "bg-primary-foreground/15" : "bg-muted",
                  )}
                >
                  {list.needed_count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="ghost" onClick={onCreate}>
        <Plus aria-hidden="true" />
        New list
      </Button>
    </nav>
  );
}
