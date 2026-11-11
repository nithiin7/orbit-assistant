"use client";

import type { HabitProgress, HabitToday, LogHabitRequest, Routine } from "@orbit/contracts";
import { CalendarCheck, Check, LayoutTemplate, PartyPopper, Play, Sparkles } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Resource } from "@/hooks/query-resource";
import {
  cheerFor,
  HABIT_TEMPLATES,
  habitsHref,
  type HabitTemplate,
  heatLevel,
  isRemaining,
  routineDoneOn,
  routineMinutes,
  STARTER_TEMPLATE_IDS,
} from "@/lib/habits";
import { WEEKDAYS } from "@/lib/reminders";
import { cn } from "@/utils/common";
import { dayOfWeek, formatCalendarDate } from "@/utils/dates";

import { useCelebration } from "./celebration";
import { COLOR_STYLES, HABIT_ICON_COMPONENTS, HabitTile, ProgressBar } from "./habit-icon";
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
  /** Resolves with the habit's updated day. */
  onLog: (item: HabitProgress, body: LogHabitRequest | null) => Promise<HabitProgress>;
  onCreate: () => void;
  onUseTemplate: (template: HabitTemplate) => void;
  onStartRoutine: (routine: Routine) => void;
};

function isDone(item: Pick<HabitProgress, "state">): boolean {
  return item.state === "completed" || item.state === "bonus";
}

function groups(habits: readonly HabitProgress[]) {
  const remaining: HabitProgress[] = [];
  const done: HabitProgress[] = [];
  const other: HabitProgress[] = [];
  for (const item of habits) {
    if (isDone(item)) done.push(item);
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
  onUseTemplate,
  onStartRoutine,
}: HabitTodayViewProps) {
  const { celebrate, celebration } = useCelebration();

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
        description="Habits you track show up here each day, with a one-tap check. Begin with something easy, or pick a ready-made one."
      >
        <div className="flex w-full flex-col items-center gap-4">
          <ul aria-label="Starter habits" className="flex flex-wrap justify-center gap-2">
            {starters.map((template) => {
              const Icon = HABIT_ICON_COMPONENTS[template.fields.icon];
              return (
                <li key={template.id}>
                  <Button variant="outline" onClick={() => onUseTemplate(template)}>
                    <Icon className={COLOR_STYLES[template.fields.color].text} aria-hidden="true" />
                    {template.fields.name}
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={onCreate}>New habit</Button>
            <Link
              href={habitsHref({ kind: "view", view: "templates" })}
              className={buttonVariants({ variant: "ghost" })}
            >
              <LayoutTemplate aria-hidden="true" />
              Browse templates
            </Link>
          </div>
        </div>
      </EmptyState>
    );
  }

  const { remaining, done, other } = groups(today.habits);

  /** Log the day, and cheer when that met the target. */
  async function log(item: HabitProgress, body: LogHabitRequest | null) {
    const result = await onLog(item, body);
    if (isDone(item) || !isDone(result)) return;
    const othersLeft = remaining.some((other) => other.habit.id !== item.habit.id);
    celebrate(
      cheerFor(result, {
        allDone: isRemaining(item) && !othersLeft,
        doneToday: done.length,
      }),
    );
  }

  const due = remaining.length + done.length;
  const finished = due > 0 && done.length >= due;
  const weekday = WEEKDAYS[(dayOfWeek(today.day) + 6) % 7]?.value;
  const todaysRoutines = routines.filter(
    (routine) =>
      routine.status === "active" &&
      (routine.weekdays.length === 0 || (weekday && routine.weekdays.includes(weekday))),
  );

  return (
    <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-6">
        <section
          aria-labelledby="today-summary"
          className={cn(
            "rounded-xl border bg-card p-4 transition-colors duration-300",
            finished && "border-success/40 bg-success/5",
          )}
        >
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
          <p className="mt-2 text-sm text-muted-foreground">
            {finished ? (
              <PartyPopper
                aria-hidden="true"
                className="mr-1.5 inline-block size-4 animate-check-pop align-[-0.125em] text-success"
              />
            ) : null}
            {encouragement(done.length, due)}
          </p>
        </section>

        <HabitGroup title="To do" items={remaining} onLog={log} />
        <HabitGroup title="Done" items={done} onLog={log} />
        <HabitGroup
          title="Other habits"
          description="Skipped, resting today, paused, or this week’s target already met."
          items={other}
          onLog={log}
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
                  ) : routineDoneOn(routine, today.day) ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                      <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                      Done
                    </span>
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
      {celebration}
    </div>
  );
}

const starters = HABIT_TEMPLATES.filter((template) => STARTER_TEMPLATE_IDS.includes(template.id));

function HabitGroup({
  title,
  description,
  items,
  onLog,
}: {
  title: string;
  description?: string;
  items: readonly HabitProgress[];
  onLog: (item: HabitProgress, body: LogHabitRequest | null) => Promise<unknown>;
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
