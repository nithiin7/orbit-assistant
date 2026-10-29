"use client";

import { AlarmClock, ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpcomingReminders } from "@/hooks/use-reminders";
import { describeRecurrence } from "@/lib/reminders";

import { ReminderTime } from "./reminder-item";

/** The next few reminders in the active workspace, for the dashboard. */
export function ReminderOverview() {
  const { resource, reload } = useUpcomingReminders();

  return (
    <section aria-labelledby="reminder-overview-heading" className="h-full">
      <Card className="h-full shadow-elevation-1" aria-busy={resource.status === "loading"}>
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2
            id="reminder-overview-heading"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <AlarmClock className="size-4 text-muted-foreground" aria-hidden="true" />
            Upcoming reminders
          </h2>
          <Link href="/reminders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Open reminders
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>

        {resource.status === "loading" ? (
          <div className="space-y-3 p-5">
            <span className="sr-only">Loading reminders…</span>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : resource.status === "error" ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-muted-foreground">{resource.message}</p>
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : resource.data.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            Nothing scheduled.{" "}
            <Link
              href="/reminders"
              className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Create a reminder
            </Link>
          </p>
        ) : (
          <ul className="divide-y">
            {resource.data.map((reminder) => (
              <li
                key={reminder.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{reminder.title}</span>
                {reminder.recurrence ? (
                  <span className="text-xs text-muted-foreground">
                    {describeRecurrence(reminder.recurrence, reminder.start_date)}
                  </span>
                ) : null}
                <ReminderTime reminder={reminder} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
