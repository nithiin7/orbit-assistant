"use client";

import type { TodayOverview, TodayOverviewSection } from "@orbit/contracts";
import {
  AlarmClock,
  CalendarDays,
  CheckSquare,
  Clock,
  type LucideIcon,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTodayOverview } from "@/hooks/use-today-overview";
import { calendarHref } from "@/lib/calendar";
import { firstName, formatDayHeading, greeting, hourIn } from "@/lib/dashboard";
import { useCurrentUser } from "@/providers/auth";
import { cn } from "@/utils/common";

/**
 * The top of the dashboard: a greeting, today's date in the user's time zone, and what today
 * holds across modules, each linking to where to act on it.
 */
export function TodayWidget() {
  const user = useCurrentUser();
  const { resource, reload, refreshing, timeZone } = useTodayOverview();
  const name = firstName(user.display_name);
  const hello = `${greeting(hourIn(timeZone))}${name ? `, ${name}` : ""}`;

  return (
    <section aria-labelledby="today-heading" className="h-full">
      <Card
        className="h-full bg-gradient-to-br from-brand-subtle/60 via-card to-card p-5 shadow-elevation-1 sm:p-6"
        aria-busy={resource.status === "loading"}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id="today-heading" className="text-xl font-semibold tracking-tight text-balance">
              {hello}
            </h2>
            <p className="text-sm text-muted-foreground">
              {resource.status === "success"
                ? formatDayHeading(resource.data.date)
                : "Here’s your day."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Refresh today’s overview"
            disabled={refreshing || resource.status === "loading"}
            onClick={reload}
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden="true" />
          </Button>
        </div>

        {resource.status === "loading" ? (
          <div className="@container mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <span className="sr-only">Loading today’s overview…</span>
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-16" />
            ))}
          </div>
        ) : resource.status === "error" ? (
          <div role="alert" className="mt-5 flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">{resource.message}</p>
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : (
          <TodayContent overview={resource.data} timeZone={timeZone} />
        )}
      </Card>
    </section>
  );
}

function TodayContent({ overview, timeZone }: { overview: TodayOverview; timeZone: string }) {
  const { tasks, events, reminders, habits } = overview;
  const missing = (section: TodayOverviewSection) => overview.unavailable.includes(section);
  const allDay = events?.today.filter((event) => event.all_day).length ?? 0;
  const next = events?.next;

  return (
    <div className="mt-5 space-y-4">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          icon={CalendarDays}
          label="Events today"
          href={calendarHref({ view: "day", date: overview.date })}
          unavailable={missing("events")}
          value={events?.today.length}
          detail={allDay > 0 ? `${allDay} all day` : undefined}
        />
        <Stat
          icon={CheckSquare}
          label="Tasks due"
          href="/tasks"
          unavailable={missing("tasks")}
          value={tasks?.due_today}
          detail={tasks && tasks.overdue > 0 ? `${tasks.overdue} overdue` : undefined}
          urgent={tasks !== null && tasks.overdue > 0}
        />
        <Stat
          icon={Sparkles}
          label="Habits done"
          href="/habits"
          unavailable={missing("habits")}
          value={habits ? `${habits.done}/${habits.total}` : undefined}
          detail={
            habits && habits.total > 0
              ? habits.remaining === 0
                ? "All done"
                : `${habits.remaining} to go`
              : undefined
          }
        />
        <Stat
          icon={AlarmClock}
          label="Reminders today"
          href="/reminders"
          unavailable={missing("reminders")}
          value={reminders?.pending}
        />
      </ul>
      {next ? (
        <p className="flex items-center gap-2 text-sm">
          <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">Next:</span>
          <Link
            href={calendarHref({ view: "day", date: next.start.slice(0, 10) })}
            className="min-w-0 truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {next.title}
          </Link>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {describeStart(next.start_at, overview.generated_at, timeZone)}
          </span>
        </p>
      ) : null}
      {overview.unavailable.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Some of today couldn’t load just now. The rest is up to date.
        </p>
      ) : null}
    </div>
  );
}

/** "at 15:00, in 2 h" today; a weekday and time later in the week. */
function describeStart(startAt: string, now: string, timeZone: string): string {
  const start = new Date(startAt);
  const minutes = Math.round((start.getTime() - Date.parse(now)) / 60_000);
  const sameDay =
    start.toLocaleDateString("en-CA", { timeZone }) ===
    new Date(now).toLocaleDateString("en-CA", { timeZone });
  const time = start.toLocaleTimeString([], { timeStyle: "short", timeZone });
  if (!sameDay) {
    return start.toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
  }
  if (minutes < 60) return `at ${time}, in ${Math.max(minutes, 1)} min`;
  return `at ${time}, in ${Math.round(minutes / 60)} h`;
}

function Stat({
  icon: Icon,
  label,
  href,
  value,
  detail,
  unavailable,
  urgent = false,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  value: ReactNode;
  detail?: string;
  unavailable: boolean;
  urgent?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className="block h-full rounded-lg border bg-background/70 px-3 py-2.5 transition-colors duration-150 outline-none hover:border-foreground/15 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </span>
        <span className="block text-xl font-semibold tabular-nums">
          {unavailable ? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">Couldn’t load</span>
            </>
          ) : (
            (value ?? 0)
          )}
        </span>
        {detail ? (
          <span
            className={cn("block text-xs", urgent ? "text-destructive" : "text-muted-foreground")}
          >
            {detail}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
