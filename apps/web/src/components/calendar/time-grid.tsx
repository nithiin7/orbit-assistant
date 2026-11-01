"use client";

import type { CalendarCategory } from "@orbit/contracts";
import {
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  allDayDates,
  type CalendarItem,
  dayHeading,
  describeWhen,
  isAllDay,
  itemTitle,
  layoutDay,
  MINUTES_PER_DAY,
  minutesNow,
  segmentOn,
  snap,
  SNAP_MINUTES,
  timeOfMinutes,
} from "@/lib/calendar";
import { cn } from "@/utils/common";

import { ItemChip, itemClassName, itemLabel, ItemMark } from "./calendar-item";
import { ITEM_DRAG_TYPE, TASK_DRAG_TYPE } from "./month-view";

/** Pixels per hour on the grid. */
const HOUR_HEIGHT = 48;
const PX_PER_MINUTE = HOUR_HEIGHT / 60;
/** How far the pointer must travel before a press becomes a drag, in pixels. */
const DRAG_THRESHOLD = 4;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

type TimeGridProps = {
  dates: readonly string[];
  today: string;
  timeZone: string;
  items: readonly CalendarItem[];
  categories: ReadonlyMap<string, CalendarCategory>;
  workingHours: { start: number; end: number };
  onOpenItem: (item: CalendarItem) => void;
  onOpenDay?: (date: string) => void;
  /** Create an event for a selected range on `date`, in minutes past midnight. */
  onCreate: (date: string, start: number, end: number) => void;
  /** A timed item dragged to start (`edge: "start"`) or resized to end at `minutes` on `date`. */
  onMoveTimed: (item: CalendarItem, date: string, minutes: number, edge: "start" | "end") => void;
  /** An all-day item dragged to start on `date`. */
  onMoveAllDay: (item: CalendarItem, date: string) => void;
  onDropTask: (taskId: string, date: string, minutes: number) => void;
};

type Drag =
  | {
      mode: "move" | "resize";
      item: CalendarItem;
      originX: number;
      originY: number;
      /** Minutes between the segment's start and where it was grabbed. */
      grab: number;
      length: number;
      dayIndex: number;
      start: number;
      end: number;
      moved: boolean;
    }
  | {
      mode: "select";
      originX: number;
      originY: number;
      dayIndex: number;
      anchor: number;
      start: number;
      end: number;
      moved: boolean;
    };

/**
 * A day or week as a time grid. Overlapping items sit side by side. Items are buttons that open
 * their details; with a mouse or pen they can also be dragged to another time or day, or resized
 * from their bottom edge, and dragging across empty time selects a range for a new event. Touch
 * keeps native scrolling: a tap opens an item or starts an event at that time.
 */
export function TimeGrid({
  dates,
  today,
  timeZone,
  items,
  categories,
  workingHours,
  onOpenItem,
  onOpenDay,
  onCreate,
  onMoveTimed,
  onMoveAllDay,
  onDropTask,
}: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // A drag ends with a click on the item; this swallows it.
  const suppressClick = useRef(false);
  const [now, setNow] = useState(() => minutesNow(timeZone));
  const [allDayTarget, setAllDayTarget] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(minutesNow(timeZone)), 60_000);
    return () => window.clearInterval(timer);
  }, [timeZone]);

  // Start scrolled to the working day.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = Math.max(0, (workingHours.start - 30) * PX_PER_MINUTE);
  }, [workingHours.start]);

  const allDayItems = items.filter(isAllDay);
  const timedItems = items.filter((item) => !isAllDay(item));
  const columns = dates.map((date) => ({
    date,
    placed: layoutDay(
      timedItems.flatMap((item) => {
        const segment = segmentOn(item, date, timeZone);
        return segment ? [segment] : [];
      }),
    ),
  }));

  function pointAt(clientX: number, clientY: number): { dayIndex: number; minutes: number } {
    const rect = columnsRef.current?.getBoundingClientRect();
    if (!rect) return { dayIndex: 0, minutes: 0 };
    const width = rect.width / dates.length;
    const dayIndex = Math.max(
      0,
      Math.min(dates.length - 1, Math.floor((clientX - rect.left) / width)),
    );
    const minutes = Math.max(0, Math.min(MINUTES_PER_DAY, (clientY - rect.top) / PX_PER_MINUTE));
    return { dayIndex, minutes };
  }

  function update(next: Drag | null) {
    dragRef.current = next;
    setDrag(next);
  }

  // Follow the pointer anywhere on the page while dragging.
  const onPointerMove = useEffectEvent((event: PointerEvent) => {
    const current = dragRef.current;
    if (!current) return;
    const travelled =
      Math.abs(event.clientX - current.originX) + Math.abs(event.clientY - current.originY);
    const moved = current.moved || travelled > DRAG_THRESHOLD;
    const { dayIndex, minutes } = pointAt(event.clientX, event.clientY);
    if (current.mode === "select") {
      const point = snap(minutes);
      update({
        ...current,
        moved,
        start: Math.min(current.anchor, point),
        end: Math.max(current.anchor + (point === current.anchor ? SNAP_MINUTES : 0), point),
      });
    } else if (current.mode === "move") {
      const start = snap(Math.min(minutes - current.grab, MINUTES_PER_DAY - SNAP_MINUTES));
      update({ ...current, moved, dayIndex, start, end: start + current.length });
    } else {
      const end = Math.max(current.start + SNAP_MINUTES, snap(minutes));
      update({ ...current, moved, end });
    }
  });

  const onPointerUp = useEffectEvent(() => {
    const current = dragRef.current;
    update(null);
    if (!current) return;
    const date = dates[current.dayIndex];
    if (!date) return;
    if (current.mode === "select") {
      if (current.moved)
        onCreate(date, current.start, Math.max(current.end, current.start + SNAP_MINUTES));
      else onCreate(date, current.anchor, current.anchor + 60);
      return;
    }
    if (!current.moved) return;
    // The click that ends a drag lands in this task; later clicks are real.
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (current.mode === "move") onMoveTimed(current.item, date, current.start, "start");
    else onMoveTimed(current.item, date, current.end, "end");
  });

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") update(null);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", cancel);
    };
  }, [dragging]);

  const startItemDrag = (
    event: ReactPointerEvent,
    item: CalendarItem,
    dayIndex: number,
    segment: { start: number; end: number },
    mode: "move" | "resize",
  ) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    event.stopPropagation();
    const { minutes } = pointAt(event.clientX, event.clientY);
    update({
      mode,
      item,
      originX: event.clientX,
      originY: event.clientY,
      grab: minutes - segment.start,
      length: segment.end - segment.start,
      dayIndex,
      start: segment.start,
      end: segment.end,
      moved: false,
    });
  };

  const startSelect = (event: ReactPointerEvent, dayIndex: number) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const { minutes } = pointAt(event.clientX, event.clientY);
    const anchor = Math.floor(minutes / 30) * 30;
    if (event.pointerType === "touch") {
      const date = dates[dayIndex];
      if (date) onCreate(date, anchor, anchor + 60);
      return;
    }
    update({
      mode: "select",
      originX: event.clientX,
      originY: event.clientY,
      dayIndex,
      anchor,
      start: anchor,
      end: anchor + SNAP_MINUTES,
      moved: false,
    });
  };

  const dropTask = (event: DragEvent) => {
    const taskId = event.dataTransfer.getData(TASK_DRAG_TYPE);
    if (!taskId) return;
    event.preventDefault();
    const { dayIndex, minutes } = pointAt(event.clientX, event.clientY);
    const date = dates[dayIndex];
    if (date) onDropTask(taskId, date, snap(minutes, 30));
  };

  const columnTemplate = { gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))` };
  const wide = dates.length > 1;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-elevation-1">
      <div className="overflow-x-auto">
        <div className={cn(wide && "min-w-[40rem]")}>
          {/* Day headings */}
          <div className="flex border-b bg-muted/40">
            <div className="w-14 shrink-0" aria-hidden="true" />
            <div className="grid flex-1" style={columnTemplate}>
              {dates.map((date) => {
                const { weekday, day } = dayHeading(date);
                const isToday = date === today;
                const content = (
                  <>
                    <span className="text-xs text-muted-foreground">{weekday}</span>
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                        isToday && "bg-primary text-primary-foreground",
                      )}
                    >
                      {day}
                    </span>
                  </>
                );
                return onOpenDay ? (
                  <button
                    key={date}
                    type="button"
                    onClick={() => onOpenDay(date)}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={`Open ${weekday} ${day}${isToday ? ", today" : ""}`}
                    className="flex flex-col items-center gap-0.5 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    key={date}
                    className="flex flex-col items-center gap-0.5 py-2"
                    aria-current={isToday ? "date" : undefined}
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          </div>

          {/* All-day row */}
          <div className="flex border-b">
            <div className="flex w-14 shrink-0 items-start justify-end px-2 py-1.5 text-[11px] text-muted-foreground">
              All day
            </div>
            <div className="grid flex-1" style={columnTemplate}>
              {dates.map((date) => {
                const dayItems = allDayItems.filter((item) => {
                  const range = allDayDates(item);
                  return range.start <= date && date < range.end;
                });
                return (
                  <ul
                    key={date}
                    aria-label={`All day, ${date}`}
                    onDragOver={(event) => {
                      if (!event.dataTransfer.types.includes(ITEM_DRAG_TYPE)) return;
                      event.preventDefault();
                      setAllDayTarget(date);
                    }}
                    onDragLeave={() => setAllDayTarget(null)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setAllDayTarget(null);
                      const item = allDayItems.find(
                        (candidate) => candidate.id === event.dataTransfer.getData(ITEM_DRAG_TYPE),
                      );
                      if (item) onMoveAllDay(item, date);
                    }}
                    className={cn(
                      "flex min-h-9 min-w-0 flex-col gap-0.5 border-l p-1 first:border-l-0",
                      allDayTarget === date && "bg-brand-subtle",
                    )}
                  >
                    {dayItems.map((item) => (
                      <li key={item.id} className="min-w-0">
                        <ItemChip
                          item={item}
                          timeZone={timeZone}
                          categories={categories}
                          draggable={item.kind === "event"}
                          onDragStart={(event) => {
                            event.dataTransfer.setData(ITEM_DRAG_TYPE, item.id);
                            event.dataTransfer.effectAllowed = "move";
                          }}
                          onClick={() => onOpenItem(item)}
                        />
                      </li>
                    ))}
                  </ul>
                );
              })}
            </div>
          </div>

          {/* Time grid */}
          <div ref={scrollRef} className="max-h-[70vh] overflow-y-auto">
            <div className="relative flex" style={{ height: 24 * HOUR_HEIGHT }}>
              <div className="relative w-14 shrink-0" aria-hidden="true">
                {HOURS.slice(1).map((hour) => (
                  <span
                    key={hour}
                    className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums"
                    style={{ top: hour * HOUR_HEIGHT }}
                  >
                    {timeOfMinutes(hour * 60)}
                  </span>
                ))}
              </div>
              <div
                ref={columnsRef}
                className="relative grid flex-1"
                style={columnTemplate}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes(TASK_DRAG_TYPE)) event.preventDefault();
                }}
                onDrop={dropTask}
              >
                {columns.map(({ date, placed }, dayIndex) => (
                  <div
                    key={date}
                    data-testid={`column-${date}`}
                    onPointerDown={(event) => startSelect(event, dayIndex)}
                    className="relative border-l select-none first:border-l-0"
                    style={{
                      backgroundImage: `linear-gradient(to bottom, var(--border) 1px, transparent 1px)`,
                      backgroundSize: `100% ${HOUR_HEIGHT}px`,
                    }}
                  >
                    {/* Outside working hours */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 top-0 bg-muted/50"
                      style={{ height: workingHours.start * PX_PER_MINUTE }}
                    />
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 bottom-0 bg-muted/50"
                      style={{ top: workingHours.end * PX_PER_MINUTE }}
                    />
                    {date === today ? (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-destructive"
                        style={{ top: now * PX_PER_MINUTE }}
                      >
                        <span className="absolute -top-[5px] -left-1 size-2 rounded-full bg-destructive" />
                      </div>
                    ) : null}
                    {placed.map((segment) => {
                      const { item } = segment;
                      const dragging =
                        drag && drag.mode !== "select" && drag.item.id === item.id && drag.moved;
                      const height = Math.max(segment.end - segment.start, 20) * PX_PER_MINUTE;
                      const draggable = !(
                        item.kind === "event" && item.occurrence.status === "cancelled"
                      );
                      return (
                        <div
                          key={`${item.id}:${date}`}
                          className={cn("absolute z-10 px-px", dragging && "opacity-40")}
                          style={{
                            top: segment.start * PX_PER_MINUTE,
                            height,
                            left: `${(segment.column / segment.columns) * 100}%`,
                            width: `${100 / segment.columns}%`,
                          }}
                        >
                          <button
                            type="button"
                            aria-label={itemLabel(item, timeZone, categories)}
                            onPointerDown={(event) =>
                              draggable && startItemDrag(event, item, dayIndex, segment, "move")
                            }
                            onClick={() => {
                              if (suppressClick.current) {
                                suppressClick.current = false;
                                return;
                              }
                              onOpenItem(item);
                            }}
                            className={cn(
                              "flex size-full flex-col overflow-hidden rounded-md px-1.5 py-0.5 text-left text-xs shadow-elevation-1 outline-none focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-ring",
                              draggable && "cursor-grab active:cursor-grabbing",
                              itemClassName(item, categories),
                              segment.continuesBefore && "rounded-t-none",
                              segment.continuesAfter && "rounded-b-none",
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-1 font-medium">
                              <ItemMark item={item} />
                              <span
                                className={cn(
                                  "truncate",
                                  item.kind === "task" &&
                                    item.task.status === "completed" &&
                                    "line-through",
                                )}
                              >
                                {itemTitle(item)}
                              </span>
                            </span>
                            {height >= 32 ? (
                              <span className="truncate opacity-80">
                                {describeWhen(item, timeZone)}
                              </span>
                            ) : null}
                          </button>
                          {draggable && !segment.continuesAfter ? (
                            <span
                              aria-hidden="true"
                              onPointerDown={(event) =>
                                startItemDrag(event, item, dayIndex, segment, "resize")
                              }
                              className="absolute inset-x-1 bottom-0 h-1.5 cursor-ns-resize rounded-b-md"
                            />
                          ) : null}
                        </div>
                      );
                    })}
                    {drag && drag.moved && drag.dayIndex === dayIndex ? (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-1 z-30 rounded-md border-2 border-dashed border-brand bg-brand-subtle/70 px-1.5 text-xs font-medium"
                        style={{
                          top: drag.start * PX_PER_MINUTE,
                          height: Math.max(drag.end - drag.start, SNAP_MINUTES) * PX_PER_MINUTE,
                        }}
                      >
                        {timeOfMinutes(drag.start)} –{" "}
                        {timeOfMinutes(Math.min(drag.end, MINUTES_PER_DAY - 1))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <p role="status" className="sr-only">
        {drag?.moved
          ? `${timeOfMinutes(drag.start)} to ${timeOfMinutes(Math.min(drag.end, MINUTES_PER_DAY - 1))}`
          : ""}
      </p>
    </div>
  );
}
