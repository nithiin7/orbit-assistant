"use client";

import type { HabitProgress, HabitToday, LogHabitRequest, Routine } from "@orbit/contracts";
import { CalendarCheck, Play, Sparkles } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Resource } from "@/hooks/query-resource";
import { habitsHref, heatLevel, isRemaining, routineMinutes } from "@/lib/habits";
import { WEEKDAYS } from "@/lib/reminders";
import { cn } from "@/utils/common";
import { dayOfWeek, formatCalendarDate } from "@/utils/dates";

import { HabitTile, ProgressBar } from "./habit-icon";
import { HabitRow } from "./habit-row";
import { ViewError } from "./view-error";

const LEVEL_STYLES = [
  "bg-muted",
  "bg-success/25",
  "bg-success/45",
  "bg-success/70",
  "bg-success",
] as const;

type HabitTodayViewProps = {
  state: Resource<HabitToday>;
  routines: readonly Routine[];
  onReload: () => void;
  onLog: (item: HabitProgress, body: LogHabitRequest | null) => Promise<unknown>;
  onCreate: () => void;
  onStartRoutine: (routine: Routine) => void;
};

function groups(habits: readonly HabitProgress[]) {
  const remaining: HabitProgress[] = [];
  const done: HabitProgress[] = [];
  const other: HabitProgress[] = [];
  for (const item of habits) {
    if (item.state === "completed" || item.state === "bonus") done.push(item);
    else if (isRemaining(item)) remaining.push(item);
    else other.push(item);
  }
  return { remaining, done, other };
}

/** A gentle line about the day: progress is noticed, nothing is scolded. */
function encouragement(done: number, due: number): string {
  if (due === 0) return "Nothing is due today. Enjoy the rest.";
  if (done === 0) return "A fresh start. Pick one to begin with.";
  if (done >= due) return "Everything for today is done. Nicely done.";
  if (done / due >= 0.5) return "More than halfway there.";
  return "Good start. Keep it going.";
}

export function HabitTodayView({
  state,
  routines,
  onReload,
  onLog,
  onCreate,
  onStartRoutine,
}: HabitTodayViewProps) {
  if (state.status === "loading") {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading today’s habits">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (state.status === "error") return <ViewError message={state.message} onRetry={onReload} />;

  const today = state.data;
  if (today.habits.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Start with one small habit"
        description="Habits you track show up here each day, with a one-tap check. Begin with something easy, like a glass of water in the morning."
      >
        <Button onClick={onCreate}>New habit</Button>
      </EmptyState>
    );
  }

  const { remaining, done, other } = groups(today.habits);
  const due = remaining.length + done.length;
  const weekday = WEEKDAYS[(dayOfWeek(today.day) + 6) % 7]?.value;
  const todaysRoutines = routines.filter(
    (routine) =>
      routine.status === "active" &&
      (routine.weekdays.length === 0 || (weekday && routine.weekdays.includes(weekday))),
  );

  return (
    <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-6">
        <section aria-labelledby="today-summary" className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="today-summary" className="text-sm font-semibold">
              {formatCalendarDate(today.day)}
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {done.length} of {due} done
              {due > 0 ? ` · ${Math.round((done.length / due) * 100)}%` : ""}
            </p>
          </div>
          <ProgressBar
            className="mt-3 h-2"
            value={due === 0 ? 0 : done.length / due}
            color="green"
            label="Today’s progress"
          />
          <p className="mt-2 text-sm text-muted-foreground">{encouragement(done.length, due)}</p>
        </section>

        <HabitGroup title="To do" items={remaining} onLog={onLog} />
        <HabitGroup title="Done" items={done} onLog={onLog} />
        <HabitGroup
          title="Other habits"
          description="Skipped, resting today, paused, or this week’s target already met."
          items={other}
          onLog={onLog}
        />
      </div>

      <aside className="space-y-6">
        <section aria-labelledby="week-heading" className="rounded-xl border bg-card p-4">
          <h2 id="week-heading" className="text-sm font-semibold">
            This week
          </h2>
          <ol className="mt-3 grid grid-cols-7 gap-1.5 text-center">
            {today.week.map((day) => {
              const label = WEEKDAYS[(dayOfWeek(day.day) + 6) % 7]?.label ?? "";
              const future = day.day > today.day;
              const total = day.due;
              return (
                <li key={day.day} className="space-y-1">
                  <span className="block text-[0.6875rem] text-muted-foreground">
                    {label.slice(0, 1)}
                  </span>
                  <span
                    aria-label={`${formatCalendarDate(day.day)}: ${
                      future
                        ? `${total} due`
                        : `${day.completed + day.extra} done${total ? ` of ${total} due` : ""}`
                    }`}
                    role="img"
                    className={cn(
                      "mx-auto block size-7 rounded-full",
                      future ? "border border-dashed" : LEVEL_STYLES[heatLevel(day)],
                      day.day === today.day && "ring-2 ring-brand ring-offset-2 ring-offset-card",
                    )}
                  />
                </li>
              );
            })}
          </ol>
        </section>

        {todaysRoutines.length > 0 ? (
          <section aria-labelledby="routines-heading" className="rounded-xl border bg-card p-4">
            <h2 id="routines-heading" className="text-sm font-semibold">
              Today’s routines
            </h2>
            <ul className="mt-3 space-y-2">
              {todaysRoutines.map((routine) => (
                <li key={routine.id} className="flex items-center gap-3">
                  <HabitTile icon={routine.icon} color={routine.color} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={habitsHref({ kind: "routine", id: routine.id })}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {routine.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {[routine.time_of_day?.slice(0, 5), routineMinutes(routine)]
                        .filter(Boolean)
                        .join(" · ") || `${routine.steps.length} steps`}
                    </p>
                  </div>
                  {routine.active_session ? (
                    <Link
                      href={habitsHref({ kind: "routine", id: routine.id })}
                      className={buttonVariants({ variant: "soft", size: "sm" })}
                    >
                      Continue
                    </Link>
                  ) : (
                    <Button
                      variant="soft"
                      size="sm"
                      aria-label={`Start ${routine.name}`}
                      onClick={() => onStartRoutine(routine)}
                    >
                      <Play aria-hidden="true" />
                      Start
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="upcoming-heading" className="rounded-xl border bg-card p-4">
          <h2 id="upcoming-heading" className="flex items-center gap-2 text-sm font-semibold">
            <CalendarCheck className="size-4 text-muted-foreground" aria-hidden="true" />
            Coming up
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {today.upcoming.map((day) => (
              <li key={day.day} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{formatCalendarDate(day.day)}</span>
                <span className="tabular-nums">
                  {day.habit_ids.length === 0
                    ? "Rest day"
                    : `${day.habit_ids.length} habit${day.habit_ids.length === 1 ? "" : "s"}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Weekly targets can be done on any day, so they aren’t counted here.
          </p>
        </section>
      </aside>
    </div>
  );
}

function HabitGroup({
  title,
  description,
  items,
  onLog,
}: {
  title: string;
  description?: string;
  items: readonly HabitProgress[];
  onLog: HabitTodayViewProps["onLog"];
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="@container/rows space-y-2">
      <div>
        <h2 className="text-sm font-semibold">
          {title} <span className="font-normal text-muted-foreground">{items.length}</span>
        </h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <HabitRow key={item.habit.id} item={item} onLog={(body) => onLog(item, body)} />
        ))}
      </ul>
    </section>
  );
}
