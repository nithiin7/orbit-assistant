"use client";

import type { HabitAnalytics, HabitCategory, HabitTrendPoint } from "@orbit/contracts";
import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Resource } from "@/hooks/query-resource";
import { describeStreak, formatRate, habitsHref, heatLevel } from "@/lib/habits";
import { cn } from "@/utils/common";
import { formatCalendarDate, monthLabel } from "@/utils/dates";

import { Heatmap } from "./habit-heatmap";
import { COLOR_STYLES, HabitTile } from "./habit-icon";
import { ViewError } from "./view-error";

export type AnalyticsRange = "30" | "90" | "182" | "365";

export const ANALYTICS_RANGES: readonly { value: AnalyticsRange; label: string }[] = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 3 months" },
  { value: "182", label: "Last 6 months" },
  { value: "365", label: "Last 12 months" },
];

/** A habit needs this many due periods in the range before it's ranked best or declining. */
const MIN_PERIODS = 4;
/** A drop of at least this much between the range's halves counts as declining. */
const DECLINE = -0.15;

type HabitAnalyticsViewProps = {
  state: Resource<HabitAnalytics>;
  refreshing: boolean;
  range: AnalyticsRange;
  onRangeChange: (range: AnalyticsRange) => void;
  categoryId: string;
  categories: readonly HabitCategory[];
  onCategoryChange: (categoryId: string) => void;
  onReload: () => void;
};

export function HabitAnalyticsView({
  state,
  refreshing,
  range,
  onRangeChange,
  categoryId,
  categories,
  onCategoryChange,
  onReload,
}: HabitAnalyticsViewProps) {
  return (
    <div className="space-y-6" aria-busy={refreshing || state.status === "loading"}>
      <div className="flex flex-wrap gap-2">
        <Select
          aria-label="Date range"
          value={range}
          onValueChange={onRangeChange}
          options={ANALYTICS_RANGES}
          className="w-44"
        />
        <Select
          aria-label="Category"
          value={categoryId}
          onValueChange={onCategoryChange}
          options={[
            { value: "", label: "All categories" },
            ...categories.map((category) => ({ value: category.id, label: category.name })),
          ]}
          className="w-44"
        />
      </div>
      {state.status === "loading" ? (
        <div className="space-y-3" aria-label="Loading analytics">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : state.status === "error" ? (
        <ViewError message={state.message} onRetry={onReload} />
      ) : (
        <Loaded analytics={state.data} />
      )}
    </div>
  );
}

function Loaded({ analytics }: { analytics: HabitAnalytics }) {
  if (analytics.habits.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Nothing to show yet"
        description="Once you’ve tracked a habit for a few days in this range, its patterns appear here."
      />
    );
  }
  const met = analytics.habits.reduce((sum, h) => sum + h.met, 0);
  const missed = analytics.habits.reduce((sum, h) => sum + h.missed, 0);
  const completions = analytics.habits.reduce((sum, h) => sum + h.completions, 0);
  const ranked = analytics.habits.filter((h) => h.met + h.missed >= MIN_PERIODS && h.rate !== null);
  const best = [...ranked].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)).slice(0, 3);
  const declining = ranked
    .filter((h) => h.trend !== null && h.trend <= DECLINE)
    .sort((a, b) => (a.trend ?? 0) - (b.trend ?? 0));
  const cells = analytics.heatmap.map((day) => ({
    day: day.day,
    level: day.due === 0 && day.extra === 0 ? null : heatLevel(day),
    label:
      day.due === 0
        ? day.extra
          ? `${day.extra} done`
          : "Nothing due"
        : `${day.completed} of ${day.due} due done${day.extra ? `, ${day.extra} more` : ""}`,
  }));

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        <Tile
          label="Completion rate"
          value={formatRate(met + missed ? met / (met + missed) : null)}
        />
        <Tile label="Completions" value={String(completions)} />
        <Tile label="Days or weeks met" value={String(met)} />
        <Tile label="Habits tracked" value={String(analytics.habits.length)} />
      </dl>

      <section
        aria-labelledby="calendar-heading"
        className="space-y-3 rounded-xl border bg-card p-4"
      >
        <h2 id="calendar-heading" className="text-sm font-semibold">
          Completion calendar
        </h2>
        <Heatmap cells={cells} label="Habits completed by day" />
      </section>

      <div className="grid gap-6 @4xl:grid-cols-2">
        <Trend
          title="Weekly"
          points={analytics.weekly}
          label={(p) => `Week of ${formatCalendarDate(p.start)}`}
        />
        <Trend
          title="Monthly"
          points={analytics.monthly}
          label={(p) => monthLabel(p.start.slice(0, 7))}
        />
      </div>

      <div className="grid gap-6 @4xl:grid-cols-2">
        <section aria-labelledby="best-heading" className="rounded-xl border bg-card p-4">
          <h2 id="best-heading" className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="size-4 text-success" aria-hidden="true" />
            Going well
          </h2>
          <HabitRanking items={best} empty="Track a little longer to see what’s working." />
        </section>
        <section aria-labelledby="declining-heading" className="rounded-xl border bg-card p-4">
          <h2 id="declining-heading" className="flex items-center gap-2 text-sm font-semibold">
            <TrendingDown className="size-4 text-muted-foreground" aria-hidden="true" />
            Could use attention
          </h2>
          <HabitRanking
            items={declining}
            empty="Nothing is slipping. Consistency is holding steady."
            note="Done less in the second half of this range than the first."
          />
        </section>
      </div>

      <section aria-labelledby="category-heading" className="rounded-xl border bg-card p-4">
        <h2 id="category-heading" className="text-sm font-semibold">
          By category
        </h2>
        <ul className="mt-3 space-y-2.5">
          {analytics.categories.map((category) => (
            <li key={category.category_id ?? "none"} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>{category.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatRate(category.rate)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div
                  className={cn("h-full rounded-full", COLOR_STYLES[category.color].fill)}
                  style={{ width: `${Math.round((category.rate ?? 0) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="all-heading" className="space-y-2">
        <h2 id="all-heading" className="text-sm font-semibold">
          Every habit
        </h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="px-3 py-2 font-medium">
                  Habit
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Rate
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Done
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Current
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Longest
                </th>
              </tr>
            </thead>
            <tbody>
              {analytics.habits.map((habit) => (
                <tr key={habit.habit_id} className="border-b last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <Link
                      href={habitsHref({ kind: "habit", id: habit.habit_id })}
                      className="hover:underline"
                    >
                      {habit.name}
                    </Link>
                  </th>
                  <td className="px-3 py-2 tabular-nums">{formatRate(habit.rate)}</td>
                  <td className="px-3 py-2 tabular-nums">{habit.completions}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {describeStreak(habit.current_streak, habit.streak_unit)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {describeStreak(habit.longest_streak, habit.streak_unit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Completion rate per week or month, as bars on one 0–100% axis. Periods with nothing due are
 * drawn empty and named so, not shown as 0%. */
function Trend({
  title,
  points,
  label,
}: {
  title: string;
  points: readonly HabitTrendPoint[];
  label: (point: HabitTrendPoint) => string;
}) {
  return (
    <section aria-labelledby={`trend-${title}`} className="rounded-xl border bg-card p-4">
      <h2 id={`trend-${title}`} className="text-sm font-semibold">
        {title} consistency
      </h2>
      {points.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing was due in this range.</p>
      ) : (
        <ul aria-label={`${title} completion rate`} className="mt-3 flex h-36 items-stretch gap-1">
          {points.map((point) => {
            const name = label(point);
            const rate = point.rate;
            return (
              <li
                key={point.start}
                // Focusable so keyboard users get the figures the tooltip shows.
                tabIndex={0}
                title={`${name}: ${formatRate(rate)}`}
                aria-label={`${name}: ${rate === null ? "nothing due" : `${formatRate(rate)}, ${point.met} of ${point.met + point.missed}`}`}
                className="group flex min-w-0 flex-1 items-end rounded-md border-b outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className="w-full rounded-t-[4px] bg-chart-1 transition-[height] duration-300 group-hover:opacity-80"
                  style={{ height: `${rate === null ? 0 : Math.max(2, rate * 100)}%` }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HabitRanking({
  items,
  empty,
  note,
}: {
  items: HabitAnalytics["habits"];
  empty: string;
  note?: string;
}) {
  if (items.length === 0) return <p className="mt-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      <ul className="mt-3 space-y-2">
        {items.map((habit) => (
          <li key={habit.habit_id} className="flex items-center gap-3">
            <HabitTile icon={habit.icon} color={habit.color} className="size-8" />
            <Link
              href={habitsHref({ kind: "habit", id: habit.habit_id })}
              className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
            >
              {habit.name}
            </Link>
            <span className="text-sm text-muted-foreground tabular-nums">
              {formatRate(habit.rate)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
