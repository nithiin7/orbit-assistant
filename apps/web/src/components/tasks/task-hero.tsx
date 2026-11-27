import type { TaskSummary } from "@orbit/contracts";
import { AlertCircle, CalendarClock, CheckCheck, CircleDashed, ListChecks } from "lucide-react";
import type { CSSProperties } from "react";

import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { cn } from "@/utils/common";
import { revealWhenVisible } from "@/utils/reveal";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** What the workspace's tasks look like now, in a few words. Nothing is scolded. */
function headline({ open, overdue, due_today }: TaskSummary): string {
  if (overdue > 0) return `${plural(overdue, "task")} past due`;
  if (due_today > 0) return `${plural(due_today, "task")} due today`;
  if (open > 0) return "Nothing urgent today";
  return "You’re all caught up";
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

/**
 * The workspace's tasks at a glance: a headline, what needs attention, how much is done, and the
 * counts behind it. Until the summary arrives, the same card holds placeholders for the numbers
 * and words, so nothing moves when they appear.
 */
export function TasksHero({ summary, today }: { summary: TaskSummary | undefined; today: string }) {
  const total = summary ? summary.open + summary.completed : 0;
  const share = !summary || total === 0 ? 0 : summary.completed / total;
  const stats = [
    { label: "Open", value: summary?.open, icon: CircleDashed, tone: "bg-muted text-foreground" },
    {
      label: "Due today",
      value: summary?.due_today,
      icon: CalendarClock,
      tone: "bg-brand-subtle text-brand",
    },
    {
      label: "Overdue",
      value: summary?.overdue,
      icon: AlertCircle,
      tone: summary?.overdue ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground",
    },
    {
      label: "Completed",
      value: summary?.completed,
      icon: CheckCheck,
      tone: "bg-success/12 text-success",
    },
  ];
  return (
    <section
      aria-labelledby={summary ? "tasks-hero-heading" : undefined}
      aria-busy={summary ? undefined : true}
      aria-label={summary ? undefined : "Loading the task summary"}
      className="relative overflow-hidden rounded-2xl border bg-linear-to-br from-brand-subtle/80 via-card to-card p-5 shadow-elevation-1 @3xl/list:p-6"
    >
      <ListChecks
        aria-hidden="true"
        className="pointer-events-none absolute -top-6 -right-6 size-40 -rotate-12 text-brand opacity-[0.06]"
      />
      <div className="relative space-y-5">
        <div className="flex flex-wrap items-center gap-5">
          {summary ? (
            <DoneRing value={share} />
          ) : (
            <Skeleton className="size-24 shrink-0 rounded-full" />
          )}
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-xs font-medium tracking-wide text-brand uppercase">
              {longDate(today)}
            </p>
            {summary ? (
              <>
                <h2
                  id="tasks-hero-heading"
                  className="text-xl font-semibold tracking-tight @3xl/list:text-2xl"
                >
                  {headline(summary)}
                </h2>
                <AttentionSummary overdue={summary.overdue} dueToday={summary.due_today} />
              </>
            ) : (
              <>
                <SkeletonText className="w-56 text-xl @3xl/list:text-2xl" />
                <SkeletonText className="w-48 text-sm" />
              </>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 @2xl/list:grid-cols-4">
          {stats.map(({ label, value, icon: Icon, tone }) => (
            <div
              key={label}
              className="relative min-w-0 rounded-xl border bg-card/80 p-4 backdrop-blur-sm"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-3.5 right-3.5 flex size-8 items-center justify-center rounded-lg",
                  tone,
                )}
              >
                <Icon className="size-4" />
              </span>
              <dt className="pr-10 text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl leading-tight font-semibold tabular-nums">
                {value ?? <SkeletonText className="w-10" />}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** What needs attention now, in words as well as color. Calm words when nothing does. */
function AttentionSummary({ overdue, dueToday }: { overdue: number; dueToday: number }) {
  if (overdue === 0 && dueToday === 0) {
    return <p className="text-sm text-muted-foreground">Nothing overdue or due today.</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      {overdue > 0 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-0.5 font-medium text-destructive">
          <AlertCircle className="size-3.5" aria-hidden="true" />
          {overdue} overdue
        </span>
      ) : null}
      {dueToday > 0 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-2.5 py-0.5 font-medium text-brand">
          <CalendarClock className="size-3.5" aria-hidden="true" />
          {dueToday} due today
        </span>
      ) : null}
    </p>
  );
}

/** The share of tasks completed, as a ring that sweeps in unless motion is reduced. */
function DoneRing({ value }: { value: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const offset = 100 - percent;
  const style: CSSProperties & { "--ring-offset": number } = {
    "--ring-offset": offset,
    strokeDashoffset: offset,
  };
  return (
    <div
      role="progressbar"
      aria-label="Tasks completed"
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
        className="absolute inset-0 flex flex-col items-center justify-center"
      >
        <span className="text-lg leading-none font-semibold tabular-nums">{percent}%</span>
        <span className="mt-0.5 text-[0.6875rem] text-muted-foreground">done</span>
      </div>
    </div>
  );
}
