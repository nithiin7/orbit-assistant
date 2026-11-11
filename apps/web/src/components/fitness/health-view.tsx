"use client";

import { Droplets, Dumbbell, Footprints, History, Plus, Ruler, Utensils } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Menu } from "@/components/ui/menu";
import { useActiveWorkspaceId, useViewerTimeZone } from "@/hooks/use-calendar";
import { useTemplates, useUnits } from "@/hooks/use-fitness";
import { todayIn } from "@/lib/calendar";
import { hourIn } from "@/lib/dashboard";
import {
  FITNESS_VIEW_HINTS,
  fitnessHref,
  mealAt,
  parseFitnessLocation,
  viewOf,
} from "@/lib/fitness";

import { ActivityDialog, ActivityView } from "./activity";
import { BodyView, MeasurementDialog } from "./body";
import { ExerciseDetail, ExercisesView } from "./exercises";
import { GoalDetail, GoalsView } from "./goals";
import { HealthNav, VIEW_ICONS, viewLabel } from "./health-nav";
import { FoodEntryDialog, NutritionView } from "./nutrition";
import { OverviewView } from "./overview";
import { ProgressView } from "./progress";
import { SettingsView } from "./settings";
import { TemplatesView } from "./templates";
import { WaterView } from "./water";
import { WorkoutDetail } from "./workout-detail";
import { LogWorkoutDialog, useStartWorkout, WorkoutsView } from "./workouts";

type Dialog = "log-workout" | "food" | "measurement" | "activity" | null;

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
  const firstTemplate =
    templates.state.status === "success"
      ? templates.state.data.templates.find((t) => !t.archived)
      : undefined;

  const view = location.kind === "view" ? location.view : null;
  const ViewIcon = view ? VIEW_ICONS[view] : null;

  return (
    // Layout follows the space the page gets (which depends on the app sidebar), not the screen.
    <div className="@container/health">
      <div className="grid gap-6 @5xl/health:grid-cols-[13rem_minmax(0,1fr)] @5xl/health:gap-8 @7xl/health:grid-cols-[15rem_minmax(0,1fr)] @7xl/health:gap-12">
        <aside className="min-w-0 @5xl/health:sticky @5xl/health:top-6 @5xl/health:self-start">
          <HealthNav section={viewOf(location)} />
        </aside>

        <div
          key={location.kind === "view" ? location.view : location.id}
          className="@container min-w-0 animate-page-in space-y-6"
        >
          {view && ViewIcon ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                  <ViewIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  {viewLabel(view)}
                </h2>
                <p className="max-w-prose text-sm text-pretty text-muted-foreground">
                  {FITNESS_VIEW_HINTS[view]}
                </p>
              </div>
              {view === "overview" ? (
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
                      onSelect: () => setDialog("food"),
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
              ) : null}
            </div>
          ) : null}
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
        </div>
      </div>

      {dialog === "log-workout" ? (
        <LogWorkoutDialog
          workspaceId={workspaceId}
          today={today}
          timeZone={timeZone}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "food" ? (
        <FoodEntryDialog
          workspaceId={workspaceId}
          day={today}
          meal={mealAt(hourIn(timeZone))}
          editing={null}
          units={units}
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
