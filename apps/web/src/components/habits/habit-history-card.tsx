"use client";

import type { HabitAnalytics } from "@orbit/contracts";
import { ChevronRight, Grid3x3 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { Skeleton } from "@/components/ui/skeleton";
import type { Resource } from "@/hooks/query-resource";
import { formatRate, habitsHref, heatCells } from "@/lib/habits";

import { Heatmap } from "./habit-heatmap";

/** How many weeks the card on Today looks back over. */
export const HISTORY_WEEKS = 12;

/**
 * The last few weeks of habits as a heatmap on Today, with the share of due days done, and a
 * link through to the full analytics.
 */
export function HabitHistoryCard({
  state,
  onReload,
}: {
  state: Resource<HabitAnalytics>;
  onReload: () => void;
}) {
  return (
    <section aria-labelledby="history-heading" className="space-y-4 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="history-heading" className="flex items-center gap-2.5 text-sm font-semibold">
          <IconChip icon={Grid3x3} tone="success" />
          Last {HISTORY_WEEKS} weeks
        </h2>
        <Link
          href={habitsHref({ kind: "view", view: "analytics" })}
          className="group/more -mr-1.5 inline-flex h-7 items-center gap-0.5 rounded-full px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Analytics
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 transition-transform duration-150 group-hover/more:translate-x-0.5"
          />
        </Link>
      </div>
      {state.status === "loading" ? (
        <Skeleton aria-hidden="true" className="h-28 w-full" />
      ) : state.status === "error" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
          <p>{state.message}</p>
          <Button variant="soft" size="sm" onClick={onReload}>
            Try again
          </Button>
        </div>
      ) : (
        <Loaded analytics={state.data} />
      )}
    </section>
  );
}

function Loaded({ analytics }: { analytics: HabitAnalytics }) {
  const due = analytics.heatmap.reduce((sum, day) => sum + day.due, 0);
  const completed = analytics.heatmap.reduce((sum, day) => sum + day.completed, 0);
  const extra = analytics.heatmap.reduce((sum, day) => sum + day.extra, 0);
  if (completed + extra === 0) {
    return (
      <p className="rounded-xl border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
        Check off a habit and your days start filling in here.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {due > 0 ? (
          <>
            <span className="font-semibold text-foreground tabular-nums">
              {formatRate(completed / due)}
            </span>{" "}
            of due days done
          </>
        ) : (
          `${completed + extra} check-ins`
        )}
      </p>
      <Heatmap cells={heatCells(analytics.heatmap)} label={`Habits, last ${HISTORY_WEEKS} weeks`} />
    </div>
  );
}
