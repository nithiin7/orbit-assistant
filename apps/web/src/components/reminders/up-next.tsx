"use client";

import type { Reminder } from "@orbit/contracts";
import { BellRing, Pencil } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { fireGroupOf, formatCountdown, formatOccurrence } from "@/lib/reminders";

import { RecurrenceChip, TaskChip } from "./reminder-meta";

/** How often the countdown refreshes. */
const TICK_MS = 30_000;

type UpNextProps = {
  /** The view's reminders, soonest first. */
  reminders: readonly Reminder[];
  viewerTimeZone: string;
  onEdit: (reminder: Reminder) => void;
};

/**
 * The next reminder to fire, with a live countdown, and how busy the coming week is. Renders
 * nothing when no reminder is scheduled.
 */
export function UpNext({ reminders, viewerTimeZone, onEdit }: UpNextProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const scheduled = reminders.filter((r) => r.status === "scheduled" && r.next_occurrence_at);
  const next = scheduled[0];
  if (!next?.next_occurrence_at) return null;

  const groups = scheduled.map((r) => fireGroupOf(r, viewerTimeZone, now));
  const stats = [
    { label: "Today", value: groups.filter((g) => g === "today").length },
    {
      label: "Next 7 days",
      value: groups.filter((g) => g === "today" || g === "tomorrow" || g === "week").length,
    },
    { label: "Repeating", value: scheduled.filter((r) => r.recurrence).length },
  ];
  // Finance, Calendar, Habits, Documents, and People keep their own reminders; change them there.
  const editable = !next.commitment;

  return (
    <section
      aria-labelledby="up-next-heading"
      className="@container/next relative overflow-hidden rounded-2xl border border-brand/20 bg-linear-to-br from-brand-subtle via-card to-card shadow-elevation-1"
    >
      {/* A soft glow in the corner; decoration only. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-brand-2/20 blur-3xl"
      />
      <div className="relative flex flex-col gap-5 p-5 @2xl/next:flex-row @2xl/next:items-center @2xl/next:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-brand to-brand-2 text-brand-foreground shadow-elevation-2"
          >
            <BellRing className="size-5" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <p
              id="up-next-heading"
              className="text-xs font-semibold tracking-wide text-brand uppercase"
            >
              Up next
            </p>
            <p className="text-lg leading-snug font-semibold break-words">{next.title}</p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <time dateTime={next.next_occurrence_at} className="font-medium text-foreground">
                {formatOccurrence(next.next_occurrence_at, next.timezone, now)}
              </time>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{formatCountdown(next.next_occurrence_at, now)}</span>
            </p>
            {next.recurrence || next.task ? (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <RecurrenceChip reminder={next} />
                {next.task ? <TaskChip task={next.task} /> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 @2xl/next:flex-nowrap">
          <dl className="flex gap-6">
            {stats.map((stat) => (
              <div key={stat.label} className="min-w-0">
                <dt className="text-xs whitespace-nowrap text-muted-foreground">{stat.label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
          {editable ? (
            <Button
              variant="soft"
              size="sm"
              onClick={() => onEdit(next)}
              aria-label={`Edit up next: “${next.title}”`}
            >
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
