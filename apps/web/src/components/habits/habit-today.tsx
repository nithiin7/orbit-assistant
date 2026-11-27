"use client";

import type { HabitProgress, HabitToday, LogHabitRequest, Routine } from "@orbit/contracts";
import {
  CalendarCheck,
  CalendarDays,
  Check,
  CircleCheck,
  CircleDashed,
  ListChecks,
  type LucideIcon,
  PartyPopper,
  Play,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { EmptyState, StartFromTemplate } from "@/components/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { IconChip, type IconChipTone } from "@/components/ui/icon-chip";
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
import { revealWhenVisible } from "@/utils/reveal";

import { useCelebration } from "./celebration";
import { COLOR_STYLES, HABIT_ICON_COMPONENTS, HabitTile } from "./habit-icon";
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
        description="Habits you track show up here each day, with a one-tap check."
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
            <StartFromTemplate
              template={{ href: habitsHref({ kind: "view", view: "templates" }) }}
            />
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
            "relative overflow-hidden rounded-2xl border bg-linear-to-br via-card to-card p-5 shadow-elevation-1 transition-colors duration-300 @3xl:p-6",
            finished ? "border-success/40 from-success/15" : "from-brand-subtle/80",
          )}
        >
          <Sparkles
            aria-hidden="true"
            className="pointer-events-none absolute -top-6 -right-6 size-40 -rotate-12 text-brand opacity-[0.06]"
          />
          <div className="relative flex flex-wrap items-center gap-5">
            <ProgressRing value={due === 0 ? 0 : done.length / due} finished={finished}>
              <span className="text-lg leading-none font-semibold tabular-nums">
                {done.length}/{due}
              </span>
              <span className="mt-0.5 text-[0.6875rem] text-muted-foreground">done</span>
            </ProgressRing>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p
                className={cn(
                  "text-xs font-medium tracking-wide uppercase",
                  finished ? "text-success" : "text-brand",
                )}
              >
                {longDate(today.day)}
              </p>
              <h2
                id="today-summary"
                className="flex items-center gap-2 text-xl font-semibold tracking-tight @3xl:text-2xl"
              >
                {finished ? (
                  <PartyPopper
                    aria-hidden="true"
                    className="size-5 shrink-0 animate-check-pop text-success"
                  />
                ) : null}
                {encouragement(done.length, due)}
              </h2>
              <p className="text-sm text-muted-foreground tabular-nums">
                {done.length} of {due} done
                {due > 0 ? ` · ${Math.round((done.length / due) * 100)}%` : ""}
              </p>
              {due > 0 ? (
                <ul aria-label="Today at a glance" className="flex flex-wrap gap-2 pt-1">
                  <Pill icon={CircleDashed} className="bg-card/80 text-foreground">
                    {remaining.length} to do
                  </Pill>
                  <Pill icon={CircleCheck} className="bg-success/12 text-success">
                    {done.length} done
                  </Pill>
                </ul>
              ) : null}
            </div>
          </div>
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
        <SideCard id="week-heading" title="This week" icon={CalendarDays} tone="success">
          <ol className="grid grid-cols-7 gap-1.5 text-center">
            {today.week.map((day) => {
              const label = WEEKDAYS[(dayOfWeek(day.day) + 6) % 7]?.label ?? "";
              const future = day.day > today.day;
              const total = day.due;
              return (
                <li key={day.day} className="space-y-1">
                  <span
                    className={cn(
                      "block text-[0.6875rem] text-muted-foreground",
                      day.day === today.day && "font-semibold text-brand",
                    )}
                  >
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
                      "mx-auto block size-7 rounded-full transition-colors duration-300",
                      future ? "border border-dashed" : LEVEL_STYLES[heatLevel(day)],
                      day.day === today.day && "ring-2 ring-brand ring-offset-2 ring-offset-card",
                    )}
                  />
                </li>
              );
            })}
          </ol>
        </SideCard>

        {todaysRoutines.length > 0 ? (
          <SideCard id="routines-heading" title="Today’s routines" icon={ListChecks} tone="brand">
            <ul className="space-y-2">
              {todaysRoutines.map((routine) => (
                <li
                  key={routine.id}
                  className="flex items-center gap-3 rounded-xl border bg-background/60 p-2.5"
                >
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
          </SideCard>
        ) : null}

        <SideCard id="upcoming-heading" title="Coming up" icon={CalendarCheck} tone="blue">
          <ul className="space-y-1 text-sm">
            {today.upcoming.map((day) => (
              <li
                key={day.day}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 odd:bg-muted/50"
              >
                <span className="text-muted-foreground">{formatCalendarDate(day.day)}</span>
                <span
                  className={cn(
                    "tabular-nums",
                    day.habit_ids.length === 0 ? "text-muted-foreground" : "font-medium",
                  )}
                >
                  {day.habit_ids.length === 0
                    ? "Rest day"
                    : `${day.habit_ids.length} habit${day.habit_ids.length === 1 ? "" : "s"}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Weekly targets can be done on any day, so they aren’t counted here.
          </p>
        </SideCard>
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
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {title}{" "}
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
            {items.length}
          </span>
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

function longDate(day: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    // The calendar day itself, whatever the viewer's time zone.
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** The day's progress as a ring, sweeping in from empty unless motion is reduced. */
function ProgressRing({
  value,
  finished,
  children,
}: {
  value: number;
  finished: boolean;
  children: ReactNode;
}) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const offset = 100 - percent;
  const style: CSSProperties & { "--ring-offset": number } = {
    "--ring-offset": offset,
    strokeDashoffset: offset,
  };
  return (
    <div
      role="progressbar"
      aria-label="Today’s progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="relative size-24 shrink-0"
    >
      <svg
        ref={revealWhenVisible}
        viewBox="0 0 100 100"
        aria-hidden="true"
        className="size-full text-success"
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
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 flex flex-col items-center justify-center",
          finished && "text-success",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function Pill({
  icon: Icon,
  className,
  children,
}: {
  icon: LucideIcon;
  className?: string;
  children: ReactNode;
}) {
  return (
    <li
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {children}
    </li>
  );
}

/** A card in the side column, with a tinted icon before its title. */
function SideCard({
  id,
  title,
  icon: Icon,
  tone,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  tone: IconChipTone;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-2xl border bg-card p-4">
      <h2 id={id} className="flex items-center gap-2.5 text-sm font-semibold">
        <IconChip icon={Icon} tone={tone} />
        {title}
      </h2>
      {children}
    </section>
  );
}
