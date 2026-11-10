"use client";

import type { Routine } from "@orbit/contracts";
import {
  AlarmClock,
  CalendarPlus,
  CheckSquare,
  Droplets,
  Dumbbell,
  FileUp,
  type LucideIcon,
  Play,
  Receipt,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { type QuickAction, useQuickActions } from "@/components/quick-actions/quick-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Menu } from "@/components/ui/menu";
import { useActiveWorkspaceId, useViewerTimeZone } from "@/hooks/use-calendar";
import { useUnits, useWaterDay } from "@/hooks/use-fitness";
import { useRoutineList, useRoutineMutations } from "@/hooks/use-habits";
import { todayIn } from "@/lib/calendar";
import { formatWater } from "@/lib/fitness";
import { habitsHref } from "@/lib/habits";
import { cn } from "@/utils/common";

const ACTIONS: readonly { action: QuickAction; label: string; icon: LucideIcon }[] = [
  { action: "task", label: "Task", icon: CheckSquare },
  { action: "note", label: "Note", icon: Zap },
  { action: "event", label: "Event", icon: CalendarPlus },
  { action: "reminder", label: "Reminder", icon: AlarmClock },
  { action: "expense", label: "Expense", icon: Receipt },
  { action: "workout", label: "Workout", icon: Dumbbell },
  { action: "document", label: "Upload", icon: FileUp },
];

/**
 * One-tap creation from the dashboard. Each button opens its module's own dialog in place, or
 * does the job at once (water, a quick note), through the shared quick actions.
 */
export function QuickActionsWidget() {
  const { run, message, messageQuiet, error, waterLabel, waterPending } = useQuickActions();
  const workspaceId = useActiveWorkspaceId();
  const today = todayIn(useViewerTimeZone());
  // Today's total sits on the water button, so every tap visibly adds to it.
  const water = useWaterDay(workspaceId, today);
  const units = useUnits(workspaceId);
  const waterTotal =
    water.state.status === "success" && water.state.data.total_ml > 0
      ? formatWater(water.state.data.total_ml, units.water_unit)
      : null;
  const router = useRouter();
  const routines = useRoutineList(workspaceId, "active");
  const { start } = useRoutineMutations(workspaceId ?? "");
  const active: Routine[] = routines.state.status === "success" ? routines.state.data.routines : [];

  const startRoutine = (routine: Routine) => {
    const open = () => router.push(habitsHref({ kind: "routine", id: routine.id }));
    if (routine.active_session) {
      open();
      return;
    }
    void start.mutateAsync(routine.id).then(open, open);
  };

  return (
    <section aria-labelledby="quick-actions-heading" className="h-full">
      <Card className="h-full p-4 shadow-elevation-1">
        <h2 id="quick-actions-heading" className="sr-only">
          Quick actions
        </h2>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Create">
          {ACTIONS.map(({ action, label, icon: Icon }) => (
            <Button
              key={action}
              variant="soft"
              size="sm"
              disabled={workspaceId === null}
              onClick={() => run(action)}
            >
              <Icon aria-hidden="true" />
              {label}
            </Button>
          ))}
          <Button
            variant="soft"
            size="sm"
            disabled={workspaceId === null}
            aria-label={`Record ${waterLabel} of water`}
            title={waterTotal ? `${waterTotal} of water today` : undefined}
            onClick={() => run("water")}
          >
            <Droplets aria-hidden="true" className={cn(waterPending > 0 && "animate-pulse")} />+
            {waterLabel}
            {waterTotal ? (
              <span
                key={waterTotal}
                aria-hidden="true"
                className="-mr-1 inline-block animate-check-pop rounded-full bg-background/70 px-1.5 py-px text-[11px] font-medium text-muted-foreground tabular-nums"
              >
                {waterTotal} today
              </span>
            ) : null}
          </Button>
          <Menu
            variant="soft"
            size="sm"
            chevron
            items={
              active.length === 0
                ? [
                    {
                      id: "routines",
                      label: "Set up a routine",
                      onSelect: () => router.push(habitsHref({ kind: "view", view: "routines" })),
                    },
                  ]
                : active.map((routine) => ({
                    id: routine.id,
                    label: routine.active_session ? `Continue ${routine.name}` : routine.name,
                    description: `${routine.steps.length} steps`,
                    onSelect: () => startRoutine(routine),
                  }))
            }
          >
            <Play aria-hidden="true" />
            Routine
          </Menu>
        </div>
        <p
          role="status"
          className={cn(
            "mt-2 text-xs text-muted-foreground empty:hidden",
            messageQuiet && "sr-only",
          )}
        >
          {error ? "" : message}
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </Card>
    </section>
  );
}
