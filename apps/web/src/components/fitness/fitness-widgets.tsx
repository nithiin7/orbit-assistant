"use client";

import type { FitnessOverview } from "@orbit/contracts";
import { Droplets, Dumbbell, Ruler, Scale, Target, Utensils } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";

import { describeApiError } from "@/api/client";
import { addWater } from "@/api/fitness";
import { WidgetBody, WidgetCard } from "@/components/dashboard/widget-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { useActiveWorkspaceId, useViewerTimeZone } from "@/hooks/use-calendar";
import { useFitnessAction, useFitnessOverview, useFitnessProfile } from "@/hooks/use-fitness";
import { todayIn } from "@/lib/calendar";
import {
  fitnessHref,
  formatEnergy,
  formatGrams,
  formatNumber,
  formatWater,
  formatWeight,
  gramsTo,
  METRIC_UNITS,
  share,
  type Units,
} from "@/lib/fitness";

import { GoalCard } from "./goals";
import { LineChart, Meter, shortDate } from "./shared";
import { useStartWorkout, WorkoutRow } from "./workouts";

/*
 * Health widgets for the dashboard. They are opt-in (hidden on a new dashboard) because health
 * data is personal. Every widget reads the same Health overview, which the API scopes to the
 * signed-in person, so showing several costs one request.
 */

type HealthContext = {
  workspaceId: string | null;
  today: string;
  timeZone: string;
  units: Units;
};

function useHealth() {
  const workspaceId = useActiveWorkspaceId();
  const timeZone = useViewerTimeZone();
  const today = todayIn(timeZone);
  const overview = useFitnessOverview(workspaceId, today, timeZone);
  const profile = useFitnessProfile(workspaceId);
  const units = profile.state.status === "success" ? profile.state.data : METRIC_UNITS;
  const context: HealthContext = { workspaceId, today, timeZone, units };
  return { overview, profile, context };
}

function HealthCard({
  title,
  icon,
  view,
  linkLabel,
  actions,
  children,
}: {
  title: string;
  icon: typeof Dumbbell;
  view: "overview" | "workouts" | "water" | "nutrition" | "body" | "goals";
  linkLabel: string;
  actions?: ReactNode;
  children: (data: FitnessOverview, context: HealthContext) => ReactNode;
}) {
  const { overview, context } = useHealth();
  return (
    <WidgetCard
      title={title}
      icon={icon}
      href={fitnessHref({ kind: "view", view })}
      linkLabel={linkLabel}
      actions={actions}
      busy={overview.state.status === "loading"}
    >
      <WidgetBody resource={overview.state} reload={overview.reload} label={title.toLowerCase()}>
        {(data) => <div className="space-y-3 p-5">{children(data, context)}</div>}
      </WidgetBody>
    </WidgetCard>
  );
}

/** Today's scheduled workout, the last one done, and how many this week. */
export function WorkoutsWidget() {
  const { context } = useHealth();
  const start = useStartWorkout(context.workspaceId ?? "", context.today, context.timeZone);
  const [error, setError] = useState<string | null>(null);
  const begin = (templateId: string | null, eventId: string | null = null) => {
    setError(null);
    start(templateId, eventId).catch((reason: unknown) =>
      setError(describeApiError(reason, "Couldn’t start the workout.")),
    );
  };

  return (
    <HealthCard title="Workouts" icon={Dumbbell} view="workouts" linkLabel="Open workouts">
      {(data, { units, timeZone }) => {
        const last = data.recent_sessions[0];
        return (
          <>
            <p className="text-sm">
              <span className="text-lg font-semibold tabular-nums">{data.week_workouts}</span>{" "}
              <span className="text-muted-foreground">
                {data.week_workouts === 1 ? "workout" : "workouts"} this week
              </span>
            </p>
            {data.active_session ? (
              <Link
                href={fitnessHref({ kind: "workout", id: data.active_session.id })}
                className={buttonVariants({ variant: "default", size: "sm" })}
              >
                Continue {data.active_session.name}
              </Link>
            ) : data.scheduled_today.length > 0 ? (
              <ul className="space-y-2">
                {data.scheduled_today.map((item) => (
                  <li
                    key={`${item.calendar_event_id}-${item.start_at ?? ""}`}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.start_at
                          ? new Date(item.start_at).toLocaleTimeString([], {
                              timeStyle: "short",
                              timeZone,
                            })
                          : "Scheduled today"}
                      </span>
                    </span>
                    {item.session_ids.length === 0 ? (
                      <Button
                        size="sm"
                        variant="soft"
                        onClick={() => begin(item.template_id, item.calendar_event_id)}
                      >
                        Start
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Started</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Button size="sm" variant="soft" onClick={() => begin(null)}>
                <Dumbbell aria-hidden="true" />
                Log a workout
              </Button>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {last ? (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground">Last workout</h3>
                <ul className="-mx-3">
                  <WorkoutRow workout={last} units={units} />
                </ul>
              </div>
            ) : null}
          </>
        );
      }}
    </HealthCard>
  );
}

const QUICK_WATER = [250, 500];

/** Today's water against the target, with quick add. */
export function WaterWidget() {
  const { profile, context } = useHealth();
  const run = useFitnessAction(context.workspaceId ?? "");
  const [error, setError] = useState<string | null>(null);
  const quick =
    profile.state.status === "success" && profile.state.data.water_quick_amounts_ml.length > 0
      ? profile.state.data.water_quick_amounts_ml.slice(0, 3)
      : QUICK_WATER;

  return (
    <HealthCard title="Water" icon={Droplets} view="water" linkLabel="Open water">
      {(data, { units, workspaceId, today }) => (
        <>
          <Meter
            label={formatWater(data.water_ml, units.water_unit)}
            value={
              data.targets.water_ml
                ? `of ${formatWater(data.targets.water_ml, units.water_unit)}`
                : "No target set"
            }
            fraction={share(data.water_ml, data.targets.water_ml)}
            tone={
              data.targets.water_ml && data.water_ml >= data.targets.water_ml ? "success" : "brand"
            }
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Add water">
            {quick.map((ml) => (
              <Button
                key={ml}
                size="sm"
                variant="soft"
                disabled={workspaceId === null}
                onClick={() => {
                  if (workspaceId === null) return;
                  setError(null);
                  run((token) => addWater(token, workspaceId, today, ml), {
                    touches: ["habits"],
                  }).catch((reason: unknown) =>
                    setError(describeApiError(reason, "Couldn’t add the water.")),
                  );
                }}
              >
                <Droplets aria-hidden="true" />+{formatWater(ml, units.water_unit)}
              </Button>
            ))}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </>
      )}
    </HealthCard>
  );
}

/** Today's energy and protein against targets, and a way to log a meal. */
export function NutritionWidget() {
  return (
    <HealthCard title="Nutrition" icon={Utensils} view="nutrition" linkLabel="Log food">
      {(data, { units }) => (
        <>
          <Meter
            label="Energy"
            value={`${formatEnergy(data.nutrition.energy_cal, units.energy_unit)}${
              data.targets.energy_cal
                ? ` of ${formatEnergy(data.targets.energy_cal, units.energy_unit)}`
                : ""
            }`}
            fraction={share(data.nutrition.energy_cal, data.targets.energy_cal)}
          />
          <Meter
            label="Protein"
            value={`${formatGrams(data.nutrition.protein_mg)}${
              data.targets.protein_mg ? ` of ${formatGrams(data.targets.protein_mg)}` : ""
            }`}
            fraction={share(data.nutrition.protein_mg, data.targets.protein_mg)}
            tone="chart"
          />
          <p className="text-xs text-muted-foreground">
            Carbs {formatGrams(data.nutrition.carbs_mg)} · Fat {formatGrams(data.nutrition.fat_mg)}
          </p>
        </>
      )}
    </HealthCard>
  );
}

/** The latest weight and its trend over the last 90 days. */
export function WeightWidget() {
  return (
    <HealthCard
      title="Weight"
      icon={Scale}
      view="body"
      linkLabel="Open body"
      actions={
        <Link
          href={fitnessHref({ kind: "view", view: "body" })}
          className={buttonVariants({ variant: "soft", size: "sm" })}
        >
          <Ruler aria-hidden="true" />
          Add measurement
        </Link>
      }
    >
      {(data, { units }) => {
        const weights = data.weight_trend;
        const latest = weights[weights.length - 1];
        const first = weights[0];
        if (!latest) {
          return <p className="text-sm text-muted-foreground">No weight in the last 90 days.</p>;
        }
        const change = first ? latest.weight_g - first.weight_g : 0;
        return (
          <>
            <p className="text-2xl font-semibold tabular-nums">
              {formatWeight(latest.weight_g, units.weight_unit)}
            </p>
            <p className="text-xs text-muted-foreground">
              {shortDate(latest.day)}
              {weights.length > 1
                ? ` · ${change >= 0 ? "+" : ""}${formatWeight(change, units.weight_unit)} over 90 days`
                : ""}
            </p>
            {weights.length > 1 ? (
              <LineChart
                title="Weight, last 90 days"
                points={weights.map((point) => ({
                  label: shortDate(point.day),
                  value: gramsTo(point.weight_g, units.weight_unit),
                }))}
                format={(value) => `${formatNumber(value, 1)} ${units.weight_unit}`}
              />
            ) : null}
          </>
        );
      }}
    </HealthCard>
  );
}

const GOALS_SHOWN = 3;

/** Progress toward active fitness goals. */
export function FitnessGoalsWidget() {
  return (
    <HealthCard title="Fitness goals" icon={Target} view="goals" linkLabel="All goals">
      {(data, { units }) =>
        data.goals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active goals.</p>
        ) : (
          <ul className="space-y-2">
            {data.goals.slice(0, GOALS_SHOWN).map((goal) => (
              <li key={goal.id}>
                <GoalCard goal={goal} units={units} />
              </li>
            ))}
          </ul>
        )
      }
    </HealthCard>
  );
}
