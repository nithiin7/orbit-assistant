"use client";

import type { CalendarCategory } from "@orbit/contracts";
import { Plus } from "lucide-react";
import { type DragEvent, useState } from "react";

import { type CalendarItem, CATEGORY_STYLES, itemsOnDay, weekdayNames } from "@/lib/calendar";
import { cn } from "@/utils/common";
import { calendarWeeks, parseCalendarDate } from "@/utils/dates";

import { ItemChip } from "./calendar-item";

/** Drag payloads: an item already on the calendar, or a task from the unscheduled list. */
export const ITEM_DRAG_TYPE = "application/x-orbit-calendar-item";
export const TASK_DRAG_TYPE = "application/x-orbit-task";

const VISIBLE_PER_DAY = 3;

type MonthViewProps = {
  date: string;
  weekStart: number;
  today: string;
  timeZone: string;
  items: readonly CalendarItem[];
  categories: ReadonlyMap<string, CalendarCategory>;
  onOpenItem: (item: CalendarItem) => void;
  onOpenDay: (date: string) => void;
  onCreateOn: (date: string) => void;
  /** Move an event or a scheduled task to `date`, keeping its time of day. */
  onMoveItem: (item: CalendarItem, date: string) => void;
  onDropTask: (taskId: string, date: string) => void;
};

const fullDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function labelOf(date: string): string {
  const { year, month, day } = parseCalendarDate(date);
  return fullDate.format(new Date(Date.UTC(year, month - 1, day)));
}

/** The month as a grid of whole weeks. Dates and items are buttons; dragging is optional. */
export function MonthView({
  date,
  weekStart,
  today,
  timeZone,
  items,
  categories,
  onOpenItem,
  onOpenDay,
  onCreateOn,
  onMoveItem,
  onDropTask,
}: MonthViewProps) {
  const month = date.slice(0, 7);
  const weeks = calendarWeeks(month, weekStart);
  const names = weekdayNames(weekStart);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const byId = new Map(items.map((item) => [item.id, item]));

  const acceptsDrop = (event: DragEvent) =>
    event.dataTransfer.types.includes(ITEM_DRAG_TYPE) ||
    event.dataTransfer.types.includes(TASK_DRAG_TYPE);

  const drop = (event: DragEvent, day: string) => {
    event.preventDefault();
    setDropTarget(null);
    const itemId = event.dataTransfer.getData(ITEM_DRAG_TYPE);
    const taskId = event.dataTransfer.getData(TASK_DRAG_TYPE);
    const item = itemId ? byId.get(itemId) : undefined;
    if (item) onMoveItem(item, day);
    else if (taskId) onDropTask(taskId, day);
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-elevation-1">
      <div role="table" aria-label="Month" className="flex flex-col">
        <div role="row" className="grid grid-cols-7 border-b bg-muted/40">
          {names.map((name) => (
            <div
              key={name}
              role="columnheader"
              className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
            >
              {name}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div role="row" key={week[0]} className="grid grid-cols-7 border-b last:border-b-0">
            {week.map((day) => {
              const dayItems = itemsOnDay(items, day, timeZone);
              const inMonth = day.startsWith(month);
              const isToday = day === today;
              const hidden = dayItems.length - VISIBLE_PER_DAY;
              return (
                <div
                  role="cell"
                  key={day}
                  aria-label={labelOf(day)}
                  onDragOver={(event) => {
                    if (!acceptsDrop(event)) return;
                    event.preventDefault();
                    setDropTarget(day);
                  }}
                  onDragLeave={() => setDropTarget((current) => (current === day ? null : current))}
                  onDrop={(event) => drop(event, day)}
                  className={cn(
                    "group relative flex min-h-24 min-w-0 flex-col gap-1 border-r p-1 last:border-r-0 sm:min-h-28",
                    !inMonth && "bg-muted/30",
                    dropTarget === day && "bg-brand-subtle",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => onOpenDay(day)}
                      aria-label={`${labelOf(day)}${isToday ? ", today" : ""}. Open day`}
                      aria-current={isToday ? "date" : undefined}
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full text-xs font-medium tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        !inMonth && "text-muted-foreground",
                        isToday && "bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                    >
                      {parseCalendarDate(day).day}
                    </button>
                    <button
                      type="button"
                      onClick={() => onCreateOn(day)}
                      aria-label={`New event on ${labelOf(day)}`}
                      className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  {/* Small screens: dots; larger screens: titles. */}
                  <div className="flex flex-wrap gap-0.5 px-1 sm:hidden" aria-hidden="true">
                    {dayItems.slice(0, 6).map((item) => (
                      <span
                        key={item.id}
                        className={cn(
                          "size-1.5 rounded-full",
                          item.kind === "task"
                            ? "border border-foreground/50"
                            : CATEGORY_STYLES[
                                (item.occurrence.category_id
                                  ? categories.get(item.occurrence.category_id)?.color
                                  : undefined) ?? "slate"
                              ].dot,
                        )}
                      />
                    ))}
                  </div>
                  <ul className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                    {dayItems.slice(0, VISIBLE_PER_DAY).map((item) => (
                      <li key={item.id} className="min-w-0">
                        <ItemChip
                          item={item}
                          timeZone={timeZone}
                          categories={categories}
                          showTime
                          draggable={!(item.kind === "task" && item.due)}
                          onDragStart={(event) => {
                            event.dataTransfer.setData(ITEM_DRAG_TYPE, item.id);
                            event.dataTransfer.effectAllowed = "move";
                          }}
                          onClick={() => onOpenItem(item)}
                        />
                      </li>
                    ))}
                  </ul>
                  {hidden > 0 ? (
                    <button
                      type="button"
                      onClick={() => onOpenDay(day)}
                      className="hidden rounded-sm px-1.5 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:block"
                    >
                      {hidden} more
                    </button>
                  ) : null}
                  {dayItems.length > 0 ? (
                    <span className="sr-only">
                      {dayItems.length === 1 ? "1 item" : `${dayItems.length} items`}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
