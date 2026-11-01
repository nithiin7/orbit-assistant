"use client";

import type { HabitList, HabitProgress } from "@orbit/contracts";
import { Archive, Flame, Sparkles } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Resource } from "@/hooks/query-resource";
import {
  describeSchedule,
  describeStreak,
  describeTarget,
  formatRate,
  habitsHref,
  STATE_LABELS,
} from "@/lib/habits";

import { HabitTile } from "./habit-icon";
import { ViewError } from "./view-error";

type HabitListViewProps = {
  state: Resource<HabitList>;
  archived: boolean;
  onReload: () => void;
  onCreate: () => void;
};

/** Every habit (or every archived one) as a card with its schedule, streak, and rate. */
export function HabitListView({ state, archived, onReload, onCreate }: HabitListViewProps) {
  if (state.status === "loading") {
    return (
      <div className="grid gap-3 @2xl:grid-cols-2" aria-busy="true" aria-label="Loading habits">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  if (state.status === "error") return <ViewError message={state.message} onRetry={onReload} />;
  const habits = state.data.habits;
  if (habits.length === 0) {
    return archived ? (
      <EmptyState
        icon={Archive}
        title="Nothing archived"
        description="Archive a habit you’ve finished with to keep its history without seeing it every day."
      />
    ) : (
      <EmptyState
        icon={Sparkles}
        title="No habits yet"
        description="Create a habit to track it each day and see how it builds over time."
      >
        <Button onClick={onCreate}>New habit</Button>
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-3 @2xl:grid-cols-2 @6xl:grid-cols-3">
      {habits.map((item) => (
        <HabitCard key={item.habit.id} item={item} />
      ))}
    </ul>
  );
}

function HabitCard({ item }: { item: HabitProgress }) {
  const { habit } = item;
  const target = describeTarget(habit);
  return (
    <li>
      <Link
        href={habitsHref({ kind: "habit", id: habit.id })}
        className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors duration-150 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start gap-3">
          <HabitTile icon={habit.icon} color={habit.color} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{habit.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[describeSchedule(habit.schedule), target].filter(Boolean).join(" · ")}
            </p>
          </div>
          {habit.status === "paused" ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Paused
            </span>
          ) : null}
        </div>
        <dl className="mt-auto grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Streak</dt>
            <dd className="flex items-center gap-1 font-medium tabular-nums">
              {item.current_streak > 0 ? (
                <Flame className="size-3.5 text-event-orange" aria-hidden="true" />
              ) : null}
              {describeStreak(item.current_streak, item.streak_unit)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last 30 days</dt>
            <dd className="font-medium tabular-nums">{formatRate(item.monthly_rate)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Today</dt>
            <dd className="truncate font-medium">{STATE_LABELS[item.state]}</dd>
          </div>
        </dl>
      </Link>
    </li>
  );
}
