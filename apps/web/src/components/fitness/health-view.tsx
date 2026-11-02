"use client";

import { Droplets, Dumbbell, Footprints, History, Plus, Ruler, Utensils } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Menu } from "@/components/ui/menu";
import { useActiveWorkspaceId, useViewerTimeZone } from "@/hooks/use-calendar";
import { useTemplates, useUnits } from "@/hooks/use-fitness";
import { todayIn } from "@/lib/calendar";
import { FITNESS_VIEWS, fitnessHref, parseFitnessLocation, viewOf } from "@/lib/fitness";
import { cn } from "@/utils/common";

import { ActivityDialog, ActivityView } from "./activity";
import { BodyView, MeasurementDialog } from "./body";
import { ExerciseDetail, ExercisesView } from "./exercises";
import { GoalDetail, GoalsView } from "./goals";
import { NutritionView } from "./nutrition";
import { OverviewView } from "./overview";
import { ProgressView } from "./progress";
import { SettingsView } from "./settings";
import { TemplatesView } from "./templates";
import { WaterView } from "./water";
import { WorkoutDetail } from "./workout-detail";
import { LogWorkoutDialog, useStartWorkout, WorkoutsView } from "./workouts";

type Dialog = "log-workout" | "measurement" | "activity" | null;

/** The Health & Fitness page: the view or record named in the URL, and its quick-log dialogs. */
export function HealthPanel() {
  const params = useSearchParams();
  const location = parseFitnessLocation(params);
  const workspaceId = useActiveWorkspaceId();
  const timeZone = useViewerTimeZone();
  if (workspaceId === null) return null;
  return <HealthContent workspaceId={workspaceId} timeZone={timeZone} location={location} />;
}

function HealthContent({
  workspaceId,
  timeZone,
  location,
}: {
  workspaceId: string;
  timeZone: string;
  location: ReturnType<typeof parseFitnessLocation>;
}) {
  const today = todayIn(timeZone);
  const units = useUnits(workspaceId);
  const templates = useTemplates(workspaceId);
  const start = useStartWorkout(workspaceId, today, timeZone);
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const current = viewOf(location);
  const firstTemplate =
    templates.state.status === "success"
      ? templates.state.data.templates.find((t) => !t.archived)
      : undefined;

  return (
    <div className="@container space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Health views" className="-mx-1 max-w-full overflow-x-auto px-1">
          <ul className="flex gap-1">
            {FITNESS_VIEWS.map((option) => (
              <li key={option.value}>
                <Link
                  href={fitnessHref({ kind: "view", view: option.value })}
                  aria-current={current === option.value ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    current === option.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {option.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Menu
          align="end"
          items={[
            {
              id: "workout",
              label: firstTemplate ? `Start ${firstTemplate.name}` : "Start a workout",
              description: "Templates and empty workouts are under Workouts.",
              icon: Dumbbell,
              onSelect: () => {
                setError(null);
                start(firstTemplate?.id ?? null).catch((reason: unknown) =>
                  setError(describeApiError(reason, "Couldn’t start the workout.")),
                );
              },
            },
            {
              id: "past",
              label: "Past workout",
              icon: History,
              onSelect: () => setDialog("log-workout"),
            },
            {
              id: "food",
              label: "Food",
              icon: Utensils,
              onSelect: () => router.push(fitnessHref({ kind: "view", view: "nutrition" })),
            },
            {
              id: "water",
              label: "Water",
              icon: Droplets,
              onSelect: () => router.push(fitnessHref({ kind: "view", view: "water" })),
            },
            {
              id: "measurement",
              label: "Measurements",
              icon: Ruler,
              onSelect: () => setDialog("measurement"),
            },
            {
              id: "activity",
              label: "Activity",
              icon: Footprints,
              onSelect: () => setDialog("activity"),
            },
          ]}
        >
          <Plus aria-hidden="true" />
          Log
        </Menu>
      </div>
      <FormAlert message={error} />

      {location.kind === "workout" ? (
        <WorkoutDetail workspaceId={workspaceId} sessionId={location.id} />
      ) : location.kind === "exercise" ? (
        <ExerciseDetail workspaceId={workspaceId} exerciseId={location.id} />
      ) : location.kind === "goal" ? (
        <GoalDetail workspaceId={workspaceId} goalId={location.id} today={today} />
      ) : (
        <View
          view={location.view}
          workspaceId={workspaceId}
          today={today}
          timeZone={timeZone}
          onLogPast={() => setDialog("log-workout")}
        />
      )}

      {dialog === "log-workout" ? (
        <LogWorkoutDialog
          workspaceId={workspaceId}
          today={today}
          timeZone={timeZone}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "measurement" ? (
        <MeasurementDialog
          workspaceId={workspaceId}
          editing={null}
          today={today}
          units={units}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "activity" ? (
        <ActivityDialog
          workspaceId={workspaceId}
          editing={null}
          today={today}
          units={units}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function View({
  view,
  workspaceId,
  today,
  timeZone,
  onLogPast,
}: {
  view: ReturnType<typeof viewOf>;
  workspaceId: string;
  today: string;
  timeZone: string;
  onLogPast: () => void;
}) {
  switch (view) {
    case "overview":
      return <OverviewView workspaceId={workspaceId} today={today} timeZone={timeZone} />;
    case "workouts":
      return (
        <WorkoutsView
          workspaceId={workspaceId}
          today={today}
          timeZone={timeZone}
          onLogPast={onLogPast}
        />
      );
    case "exercises":
      return <ExercisesView workspaceId={workspaceId} />;
    case "templates":
      return <TemplatesView workspaceId={workspaceId} today={today} timeZone={timeZone} />;
    case "body":
      return <BodyView workspaceId={workspaceId} today={today} />;
    case "nutrition":
      return <NutritionView workspaceId={workspaceId} today={today} />;
    case "water":
      return <WaterView workspaceId={workspaceId} today={today} />;
    case "activity":
      return <ActivityView workspaceId={workspaceId} today={today} />;
    case "goals":
      return <GoalsView workspaceId={workspaceId} today={today} />;
    case "progress":
      return <ProgressView workspaceId={workspaceId} today={today} />;
    case "settings":
      return <SettingsView workspaceId={workspaceId} />;
  }
}
