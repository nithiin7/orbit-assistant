"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, CalendarPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { taskSummaryOptions } from "@/api/tasks";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useActiveWorkspaceId,
  useCalendarAgenda,
  useCalendarCategories,
  useCalendarMutations,
  useCalendarRange,
  useViewerTimeZone,
} from "@/hooks/use-calendar";
import {
  agendaDayLabel,
  calendarHref,
  type CalendarItem,
  describeWhen,
  type EventFormValues,
  eventItem,
  groupByDate,
  itemsOnDay,
  minutesNow,
  newEventValues,
  snap,
  taskItem,
  todayIn,
  toEventRequest,
} from "@/lib/calendar";
import { useAuth } from "@/providers/auth";
import { addDays } from "@/utils/dates";
import { zonedTimeToInstant } from "@/utils/time-zones";

import { agendaItems } from "./agenda-view";
import { ItemChip } from "./calendar-item";
import { EventDialog } from "./event-dialog";

const UPCOMING = 5;

/** Today's events and tasks, what's coming up, and quick event creation, for the dashboard. */
export function CalendarWidget() {
  const workspaceId = useActiveWorkspaceId();
  const timeZone = useViewerTimeZone();
  const today = todayIn(timeZone);
  const tomorrow = addDays(today, 1);
  const router = useRouter();
  const { categories, byId } = useCalendarCategories(workspaceId);
  const [creating, setCreating] = useState<EventFormValues | null>(null);
  const todayRange = useCalendarRange(workspaceId, {
    start: today,
    end: tomorrow,
    timezone: timeZone,
    include_completed_tasks: false,
  });
  const tomorrowStart = zonedTimeToInstant(tomorrow, "00:00", timeZone).toISOString();
  const upcoming = useCalendarAgenda(workspaceId, tomorrowStart, UPCOMING);
  const { withToken } = useAuth();
  // Overdue is judged by the viewer's date, as on the Tasks page.
  const { data: summary } = useQuery(taskSummaryOptions(withToken, workspaceId, { today }));

  const todayItems = useMemo<CalendarItem[]>(() => {
    if (todayRange.state.status !== "success") return [];
    const { occurrences, scheduled_tasks, due_tasks } = todayRange.state.data;
    return itemsOnDay(
      [
        ...occurrences.filter((item) => item.status !== "cancelled").map(eventItem),
        ...scheduled_tasks.map((task) => taskItem(task)),
        ...due_tasks.map((task) => taskItem(task, true)),
      ],
      today,
      timeZone,
    );
  }, [todayRange.state, today, timeZone]);

  const open = (item: CalendarItem) => {
    if (item.kind === "task") {
      router.push(`/tasks?task=${item.task.id}`);
      return;
    }
    router.push(calendarHref({ view: "day", date: item.occurrence.start.slice(0, 10) }));
  };

  const loading = todayRange.state.status === "loading";
  const failed = todayRange.state.status === "error";

  return (
    <section aria-labelledby="calendar-widget-heading" className="h-full">
      <Card className="h-full shadow-elevation-1" aria-busy={loading}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <h2
            id="calendar-widget-heading"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
            Today’s agenda
          </h2>
          <div className="flex items-center gap-1">
            <Button
              variant="soft"
              size="sm"
              disabled={!workspaceId}
              onClick={() =>
                setCreating(
                  newEventValues(timeZone, {
                    date: today,
                    minutes: Math.min(snap(minutesNow(timeZone) + 60, 30), 22 * 60),
                  }),
                )
              }
            >
              <CalendarPlus aria-hidden="true" />
              New event
            </Button>
            <Link
              href={calendarHref({ view: "week" })}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Open calendar
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-5">
            <span className="sr-only">Loading today’s agenda…</span>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : failed ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-muted-foreground">Couldn’t load your calendar.</p>
            <Button variant="outline" size="sm" onClick={todayRange.reload}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="@container grid gap-x-6 sm:grid-cols-2">
            <div className="space-y-2 p-5">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Today
              </h3>
              {todayItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled today.</p>
              ) : (
                <ul className="space-y-1">
                  {todayItems.map((item) => (
                    <li key={item.id} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 truncate text-xs text-muted-foreground tabular-nums">
                        {describeWhen(item, timeZone).split(/\s[–-]\s/)[0]}
                      </span>
                      <ItemChip
                        item={item}
                        timeZone={timeZone}
                        categories={byId}
                        onClick={() => open(item)}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {summary && summary.overdue > 0 ? (
                <Link
                  href="/tasks"
                  className="inline-block rounded-sm text-sm font-medium text-destructive underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {summary.overdue === 1 ? "1 overdue task" : `${summary.overdue} overdue tasks`}
                </Link>
              ) : null}
            </div>
            <div className="space-y-2 border-t p-5 sm:border-t-0 sm:border-l">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Coming up
              </h3>
              {upcoming.resource.status === "loading" ? (
                <Skeleton className="h-4 w-1/2" />
              ) : upcoming.resource.status === "error" ? (
                <p className="text-sm text-muted-foreground">{upcoming.resource.message}</p>
              ) : upcoming.resource.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing else in the next year.</p>
              ) : (
                <ul className="space-y-1">
                  {groupByDate(
                    agendaItems(upcoming.resource.data).slice(0, UPCOMING),
                    timeZone,
                  ).flatMap((group) =>
                    group.items.map((item, index) => (
                      <li key={item.id} className="flex items-center gap-3">
                        <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">
                          {index === 0 ? agendaDayLabel(group.date, today) : ""}
                        </span>
                        <ItemChip
                          item={item}
                          timeZone={timeZone}
                          categories={byId}
                          showTime
                          onClick={() => open(item)}
                        />
                      </li>
                    )),
                  )}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>
      {creating && workspaceId ? (
        <QuickCreate
          workspaceId={workspaceId}
          initial={creating}
          categories={categories}
          onClose={() => setCreating(null)}
        />
      ) : null}
    </section>
  );
}

function QuickCreate({
  workspaceId,
  initial,
  categories,
  onClose,
}: {
  workspaceId: string;
  initial: EventFormValues;
  categories: Parameters<typeof EventDialog>[0]["categories"];
  onClose: () => void;
}) {
  const mutations = useCalendarMutations(workspaceId);
  return (
    <EventDialog
      mode="create"
      initial={initial}
      categories={categories}
      onSave={async (values) => {
        await mutations.create.mutateAsync({ ...toEventRequest(values), status: "confirmed" });
      }}
      onClose={onClose}
    />
  );
}
