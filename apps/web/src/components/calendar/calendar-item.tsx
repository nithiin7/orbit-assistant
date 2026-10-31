"use client";

import type { CalendarCategory } from "@orbit/contracts";
import { CheckCircle2, Circle, Repeat } from "lucide-react";
import type { ComponentProps } from "react";

import { type CalendarItem, CATEGORY_STYLES, describeWhen, itemTitle } from "@/lib/calendar";
import { cn } from "@/utils/common";

/** The look of an item: events are tinted with their category's color; tasks are outlined. */
export function itemClassName(
  item: CalendarItem,
  categories: ReadonlyMap<string, CalendarCategory>,
): string {
  if (item.kind === "task") {
    return cn(
      "border border-dashed border-foreground/30 bg-card text-foreground",
      item.task.status === "completed" && "text-muted-foreground",
    );
  }
  const category = item.occurrence.category_id
    ? categories.get(item.occurrence.category_id)
    : undefined;
  const style = CATEGORY_STYLES[category?.color ?? "slate"];
  return cn(
    "border-l-[3px]",
    style.block,
    item.occurrence.status === "cancelled" && "text-muted-foreground line-through opacity-70",
  );
}

/** The leading mark that tells tasks from events without relying on color. */
export function ItemMark({ item }: { item: CalendarItem }) {
  if (item.kind === "event") {
    return item.occurrence.recurring ? (
      <Repeat className="size-3 shrink-0 opacity-70" aria-hidden="true" />
    ) : null;
  }
  return item.task.status === "completed" ? (
    <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden="true" />
  ) : (
    <Circle className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
  );
}

/** An accessible name for an item: its kind, title, time, and state. */
export function itemLabel(
  item: CalendarItem,
  timeZone: string,
  categories: ReadonlyMap<string, CalendarCategory>,
): string {
  const when = describeWhen(item, timeZone);
  if (item.kind === "task") {
    const state = item.task.status === "completed" ? ", completed" : "";
    return `Task: ${item.task.title}, ${when}${state}`;
  }
  const { occurrence } = item;
  const category = occurrence.category_id ? categories.get(occurrence.category_id) : undefined;
  const parts = [
    `${occurrence.title}, ${when}`,
    category ? category.name : null,
    occurrence.recurring ? "repeats" : null,
    occurrence.status === "cancelled" ? "cancelled" : null,
  ];
  return parts.filter(Boolean).join(", ");
}

type ItemChipProps = Omit<ComponentProps<"button">, "children"> & {
  item: CalendarItem;
  timeZone: string;
  categories: ReadonlyMap<string, CalendarCategory>;
  /** Show the start time before the title (timed items in the month view). */
  showTime?: boolean;
};

/** A one-line item, as the month view and dashboard list them. */
export function ItemChip({
  item,
  timeZone,
  categories,
  showTime,
  className,
  ...props
}: ItemChipProps) {
  const timed =
    showTime &&
    !(item.kind === "event" && item.occurrence.all_day) &&
    !(item.kind === "task" && item.due);
  return (
    <button
      type="button"
      aria-label={itemLabel(item, timeZone, categories)}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        itemClassName(item, categories),
        className,
      )}
      {...props}
    >
      <ItemMark item={item} />
      {timed ? (
        <span className="shrink-0 tabular-nums opacity-80">
          {describeWhen(item, timeZone).split(/\s[–-]\s/)[0]}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0 truncate font-medium",
          item.kind === "task" && item.task.status === "completed" && "line-through",
        )}
      >
        {itemTitle(item)}
      </span>
    </button>
  );
}
