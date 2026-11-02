"use client";

import type { HabitProgress, LogHabitRequest, Routine } from "@orbit/contracts";
import { Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { WidgetBody, WidgetCard, WidgetEmpty } from "@/components/dashboard/widget-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { useActiveWorkspaceId, useViewerTimeZone } from "@/hooks/use-calendar";
import {
  useHabitMutations,
  useHabitToday,
  useRoutineList,
  useRoutineMutations,
} from "@/hooks/use-habits";
import { habitsHref, isRemaining } from "@/lib/habits";
import { WEEKDAYS } from "@/lib/reminders";
import { dayOfWeek } from "@/utils/dates";

import { HabitTile, ProgressBar } from "./habit-icon";
import { HabitRow } from "./habit-row";

const SHOWN = 5;

/** Habits still to do come first, then done ones; others (skipped, unscheduled) are left out. */
function ordered(habits: readonly HabitProgress[]): HabitProgress[] {
  const done = (item: HabitProgress) => item.state === "completed" || item.state === "bonus";
  return [...habits.filter(isRemaining), ...habits.filter(done)];
}

/** Whether a routine is planned for `day`, as on the Habits page: no weekdays is every day. */
function routineToday(routine: Routine, day: string): boolean {
  if (routine.status !== "active") return false;
  if (routine.weekdays.length === 0) return true;
  // `dayOfWeek` counts from Sunday; the weekday list starts on Monday.
  const weekday = WEEKDAYS[(dayOfWeek(day) + 6) % 7]?.value;
  return weekday !== undefined && routine.weekdays.includes(weekday);
}

/**
 * Today's habits with one-tap check-ins (and partial amounts), their streaks, and today's
 * routines, for the dashboard. Check-ins and routine sessions go through the Habits module, so
 * the habit's own log is what changes; nothing is copied.
 */
export function HabitsWidget() {
  const workspaceId = useActiveWorkspaceId();
  const timeZone = useViewerTimeZone();
  const router = useRouter();
  const today = useHabitToday(workspaceId, timeZone);
  const routines = useRoutineList(workspaceId, "active");
  const { log } = useHabitMutations(workspaceId ?? "");
  const { start } = useRoutineMutations(workspaceId ?? "");

  const openRoutine = (routine: Routine) =>
    router.push(habitsHref({ kind: "routine", id: routine.id }));
  const startRoutine = (routine: Routine) =>
    void start
      .mutateAsync(routine.id)
      .then(() => openRoutine(routine))
      .catch(() => openRoutine(routine));

  return (
    <WidgetCard
      title="Habits"
      icon={Sparkles}
      href={habitsHref({ kind: "view", view: "today" })}
      linkLabel="Open habits"
      busy={today.state.status === "loading"}
    >
      <WidgetBody resource={today.state} reload={today.reload} label="today’s habits">
        {(data) => {
          const items = ordered(data.habits);
          const remaining = data.habits.filter(isRemaining).length;
          const done = items.length - remaining;
          const todays =
            routines.state.status === "success"
              ? routines.state.data.routines.filter((routine) => routineToday(routine, data.day))
              : [];
          if (items.length === 0 && todays.length === 0) {
            return (
              <WidgetEmpty>
                No habits due today.{" "}
                <Link
                  href={habitsHref({ kind: "view", view: "all" })}
                  className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Add a habit
                </Link>
              </WidgetEmpty>
            );
          }
          return (
            <div className="space-y-4 p-5">
              {items.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-sm">
                    <span className="font-semibold tabular-nums">
                      {done} of {items.length}
                    </span>{" "}
                    <span className="text-muted-foreground">done today</span>
                  </p>
                  <ProgressBar
                    value={items.length === 0 ? 0 : done / items.length}
                    color="green"
                    label="Today’s habits done"
                  />
                </div>
              ) : null}
              {items.length > 0 ? (
                <ul className="space-y-2">
                  {items.slice(0, SHOWN).map((item) => (
                    <HabitRow
                      key={item.habit.id}
                      item={item}
                      onLog={(body: LogHabitRequest | null) =>
                        log.mutateAsync({ habit: item.habit, day: data.day, body })
                      }
                    />
                  ))}
                </ul>
              ) : null}
              {items.length > SHOWN ? (
                <p className="text-xs text-muted-foreground">
                  And {items.length - SHOWN} more in Habits.
                </p>
              ) : null}
              {todays.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Routines today
                  </h3>
                  <ul className="space-y-2">
                    {todays.map((routine) => (
                      <li
                        key={routine.id}
                        className="flex items-center gap-3 rounded-lg border px-3 py-2"
                      >
                        <HabitTile icon={routine.icon} color={routine.color} />
                        <Link
                          href={habitsHref({ kind: "routine", id: routine.id })}
                          className="min-w-0 flex-1 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="block truncate text-sm font-medium">{routine.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {routine.active_session
                              ? "In progress"
                              : `${routine.steps.length} steps · about ${routine.estimated_minutes} min`}
                          </span>
                        </Link>
                        {routine.active_session ? (
                          <Link
                            href={habitsHref({ kind: "routine", id: routine.id })}
                            className={buttonVariants({ variant: "soft", size: "sm" })}
                          >
                            Continue
                          </Link>
                        ) : (
                          <Button
                            variant="soft"
                            size="sm"
                            disabled={start.isPending}
                            aria-label={`Start ${routine.name}`}
                            onClick={() => startRoutine(routine)}
                          >
                            <Play aria-hidden="true" />
                            Start
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        }}
      </WidgetBody>
    </WidgetCard>
  );
}
