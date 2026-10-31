"use client";

import type { CalendarAgendaItem, CalendarCategory } from "@orbit/contracts";
import { CalendarDays, CalendarPlus } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCalendarAgenda } from "@/hooks/use-calendar";
import {
  agendaDayLabel,
  type CalendarItem,
  describeWhen,
  eventItem,
  groupByDate,
  taskItem,
} from "@/lib/calendar";
import { cn } from "@/utils/common";
import { zonedTimeToInstant } from "@/utils/time-zones";

import { ItemChip } from "./calendar-item";

export function agendaItems(items: readonly CalendarAgendaItem[]): CalendarItem[] {
  return items.flatMap((item) => {
    if (item.occurrence) return [eventItem(item.occurrence)];
    if (item.task) return [taskItem(item.task)];
    return [];
  });
}

type AgendaViewProps = {
  workspaceId: string;
  date: string;
  today: string;
  timeZone: string;
  categories: ReadonlyMap<string, CalendarCategory>;
  onOpenItem: (item: CalendarItem) => void;
  onCreate: () => void;
};

/** Upcoming events and scheduled tasks from `date`, grouped by day, loading more on request. */
export function AgendaView({
  workspaceId,
  date,
  today,
  timeZone,
  categories,
  onOpenItem,
  onCreate,
}: AgendaViewProps) {
  const start = useMemo(
    () => zonedTimeToInstant(date, "00:00", timeZone).toISOString(),
    [date, timeZone],
  );
  const agenda = useCalendarAgenda(workspaceId, start);
  const { resource } = agenda;

  if (resource.status === "loading") {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-5" aria-busy="true">
        <span className="sr-only">Loading agenda…</span>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (resource.status === "error") {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5"
      >
        <p className="text-sm text-muted-foreground">{resource.message}</p>
        <Button variant="outline" size="sm" onClick={agenda.reload}>
          Try again
        </Button>
      </div>
    );
  }
  const groups = groupByDate(agendaItems(resource.data), timeZone);
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nothing coming up"
        description="No events or scheduled tasks in the next year from this date."
      >
        <Button onClick={onCreate}>
          <CalendarPlus aria-hidden="true" />
          New event
        </Button>
      </EmptyState>
    );
  }
  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {groups.map((group) => (
          <li
            key={group.date}
            className="overflow-hidden rounded-xl border bg-card shadow-elevation-1"
          >
            <h3
              className={cn(
                "border-b bg-muted/40 px-4 py-2 text-sm font-semibold",
                group.date === today && "text-brand",
              )}
            >
              {agendaDayLabel(group.date, today)}
            </h3>
            <ul className="divide-y">
              {group.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="w-36 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {describeWhen(item, timeZone)}
                  </span>
                  <ItemChip
                    item={item}
                    timeZone={timeZone}
                    categories={categories}
                    className="py-1 text-sm"
                    onClick={() => onOpenItem(item)}
                  />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {agenda.hasMore ? (
        <div className="flex justify-center">
          <Button variant="outline" disabled={agenda.loadingMore} onClick={agenda.loadMore}>
            {agenda.loadingMore ? "Loading…" : "Show more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
