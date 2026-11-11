"use client";

import type { FitnessSection, Food } from "@orbit/contracts";
import {
  CalendarClock,
  Droplets,
  LayoutTemplate,
  type LucideIcon,
  Play,
  Plus,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { addWater, saveFoodEntry } from "@/api/fitness";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  useFitnessAction,
  useFitnessOverview,
  useFitnessProfile,
  useFoods,
  useTemplates,
} from "@/hooks/use-fitness";
import { hourIn } from "@/lib/dashboard";
import {
  ACTIVITY_KINDS,
  describeActivity,
  fitnessHref,
  type FitnessView,
  formatEnergy,
  formatGrams,
  formatNumber,
  formatWater,
  formatWeight,
  gramsTo,
  labelOf,
  mealAt,
  MEALS,
  METRIC_UNITS,
  share,
} from "@/lib/fitness";

import { GoalCard } from "./goals";
import { FoodEntryDialog } from "./nutrition";
import { RecordTable } from "./progress";
import { LineChart, Loaded, Meter, Section, shortDate } from "./shared";
import { ActiveWorkoutBanner, StartWorkoutMenu, useStartWorkout, WorkoutRow } from "./workouts";

function More({ view, children }: { view: FitnessView; children: ReactNode }) {
  return (
    <Link
      href={fitnessHref({ kind: "view", view })}
      className="text-xs font-medium text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}

/** First steps for someone who hasn't logged a workout yet; it goes away after the first. */
function GettingStarted({ hasTemplates }: { hasTemplates: boolean }) {
  const steps: { view: FitnessView; icon: LucideIcon; title: string; text: string }[] = [
    {
      view: "templates",
      icon: LayoutTemplate,
      title: hasTemplates ? "Check your templates" : "Pick a starter template",
      text: "Full body, push/pull/legs, home workouts, and more. Add one in a tap.",
    },
    {
      view: "workouts",
      icon: Play,
      title: "Start your first workout",
      text: "Tick off each set as you go. Rest timers and last time’s numbers are built in.",
    },
    {
      view: "settings",
      icon: Settings2,
      title: "Set your units and targets",
      text: "Optional. Daily calories, protein, and water, if you want to track them.",
    },
  ];
  return (
    <section
      aria-labelledby="health-start-heading"
      className="space-y-4 rounded-xl border border-brand/30 bg-brand-subtle/40 p-4 @3xl:p-5"
    >
      <div className="space-y-0.5">
        <h2 id="health-start-heading" className="text-sm font-semibold">
          New here? Start with these
        </h2>
        <p className="text-xs text-muted-foreground">
          Everything else is optional. Use only the parts that help you.
        </p>
      </div>
      <ol className="grid gap-3 @3xl:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.view}>
            <Link
              href={fitnessHref({ kind: "view", view: step.view })}
              className="flex h-full gap-3 rounded-lg border bg-card p-3 transition-colors duration-150 outline-none hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-xs font-semibold text-brand tabular-nums"
              >
                {index + 1}
              </span>
              <span className="min-w-0 space-y-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <step.icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  {step.title}
                </span>
                <span className="block text-xs text-pretty text-muted-foreground">{step.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function OverviewView({
  workspaceId,
  today,
  timeZone,
}: {
  workspaceId: string;
  today: string;
  timeZone: string;
}) {
  const overview = useFitnessOverview(workspaceId, today, timeZone);
  const profile = useFitnessProfile(workspaceId);
  const units = profile.state.status === "success" ? profile.state.data : METRIC_UNITS;
  const quick =
    profile.state.status === "success"
      ? profile.state.data.water_quick_amounts_ml.slice(0, 3)
      : [250, 500];
  const templates = useTemplates(workspaceId);
  const start = useStartWorkout(workspaceId, today, timeZone);
  const run = useFitnessAction(workspaceId);
  const foods = useFoods(workspaceId);
  // The API lists saved foods most used first.
  const favorites = foods.state.status === "success" ? foods.state.data.foods.slice(0, 4) : [];
  const [error, setError] = useState<string | null>(null);
  const [addingFood, setAddingFood] = useState(false);
  const [logged, setLogged] = useState("");

  /** Log one serving of a saved food to the meal for this time of day. */
  const logServing = (food: Food) => {
    const meal = mealAt(hourIn(timeZone));
    setError(null);
    setLogged("");
    run((token) =>
      saveFoodEntry(token, workspaceId, null, {
        day: today,
        meal,
        portion: {
          quantity_milli: food.serving_quantity_milli,
          food_id: food.id,
          name: null,
          serving_unit: null,
          nutrients: null,
        },
        note: "",
      }),
    ).then(
      () => setLogged(`Added ${food.name} to ${labelOf(MEALS, meal).toLowerCase()}.`),
      (reason: unknown) => setError(describeApiError(reason, "Couldn’t add the food.")),
    );
  };

  const begin = (templateId: string | null, eventId: string | null = null) => {
    setError(null);
    start(templateId, eventId).catch((reason: unknown) =>
      setError(describeApiError(reason, "Couldn’t start the workout.")),
    );
  };

  return (
    <>
      {addingFood ? (
        <FoodEntryDialog
          workspaceId={workspaceId}
          day={today}
          meal={mealAt(hourIn(timeZone))}
          editing={null}
          units={units}
          onClose={() => setAddingFood(false)}
        />
      ) : null}
      <Loaded resource={overview.state} reload={overview.reload} skeleton="h-96">
        {(data) => {
          const shown = (section: FitnessSection) => !data.hidden_sections.includes(section);
          const weights = data.weight_trend;
          const latest = weights[weights.length - 1];
          const ready =
            templates.state.status === "success"
              ? templates.state.data.templates.filter((t) => !t.archived)
              : [];
          const fresh =
            data.recent_sessions.length === 0 &&
            data.completed_today.length === 0 &&
            data.active_session === null &&
            data.week_workouts === 0;
          return (
            <div className="space-y-4">
              <FormAlert message={error} />
              {fresh ? <GettingStarted hasTemplates={ready.length > 0} /> : null}
              {shown("workout") ? (
                <Section
                  title="Today’s workout"
                  action={
                    data.active_session === null ? (
                      <StartWorkoutMenu
                        workspaceId={workspaceId}
                        templates={ready}
                        onStart={begin}
                      />
                    ) : null
                  }
                >
                  <ActiveWorkoutBanner workspaceId={workspaceId} />
                  {data.scheduled_today.length > 0 ? (
                    <ul className="space-y-2">
                      {data.scheduled_today.map((item) => (
                        <li
                          key={`${item.calendar_event_id}-${item.start_at ?? ""}`}
                          className="flex items-center justify-between gap-2 rounded-lg border p-3"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <CalendarClock
                              aria-hidden="true"
                              className="size-4 text-muted-foreground"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{item.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.start_at
                                  ? new Date(item.start_at).toLocaleTimeString([], {
                                      timeStyle: "short",
                                      timeZone,
                                    })
                                  : "Scheduled"}
                                {item.template_name ? ` · ${item.template_name}` : ""}
                              </p>
                            </div>
                          </div>
                          {item.session_ids.length === 0 && data.active_session === null ? (
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
                  ) : null}
                  {data.completed_today.length > 0 ? (
                    <ul className="-mx-3">
                      {data.completed_today.map((w) => (
                        <WorkoutRow key={w.id} workout={w} units={units} />
                      ))}
                    </ul>
                  ) : data.active_session === null && data.scheduled_today.length === 0 ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Nothing yet today. {data.week_workouts} workout
                        {data.week_workouts === 1 ? "" : "s"} so far this week.
                      </p>
                      {ready.length > 0 ? (
                        <ul aria-label="Quick start" className="flex flex-wrap gap-2">
                          {ready.slice(0, 4).map((template) => (
                            <li key={template.id}>
                              <Button size="sm" variant="soft" onClick={() => begin(template.id)}>
                                <Play aria-hidden="true" />
                                {template.name}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </Section>
              ) : null}

              <div className="grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
                {shown("nutrition") ? (
                  <Section title="Food today" action={<More view="nutrition">Open</More>}>
                    <Meter
                      label="Energy"
                      value={`${formatEnergy(data.nutrition.energy_cal, units.energy_unit)}${data.targets.energy_cal ? ` of ${formatEnergy(data.targets.energy_cal, units.energy_unit)}` : ""}`}
                      fraction={share(data.nutrition.energy_cal, data.targets.energy_cal)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Protein {formatGrams(data.nutrition.protein_mg)} · Carbs{" "}
                      {formatGrams(data.nutrition.carbs_mg)} · Fat{" "}
                      {formatGrams(data.nutrition.fat_mg)}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="soft" onClick={() => setAddingFood(true)}>
                        <Plus aria-hidden="true" />
                        Add food
                      </Button>
                      {favorites.map((food) => (
                        <Button
                          key={food.id}
                          size="sm"
                          variant="ghost"
                          aria-label={`Add one serving of ${food.name}`}
                          onClick={() => logServing(food)}
                        >
                          <Plus aria-hidden="true" />
                          <span className="max-w-32 truncate">{food.name}</span>
                        </Button>
                      ))}
                    </div>
                    <p role="status" className="text-xs text-muted-foreground empty:hidden">
                      {logged}
                    </p>
                  </Section>
                ) : null}
                {shown("water") ? (
                  <Section title="Water today" action={<More view="water">Open</More>}>
                    <Meter
                      label={formatWater(data.water_ml, units.water_unit)}
                      value={
                        data.targets.water_ml
                          ? `of ${formatWater(data.targets.water_ml, units.water_unit)}`
                          : "No target set"
                      }
                      fraction={share(data.water_ml, data.targets.water_ml)}
                      tone={
                        data.targets.water_ml && data.water_ml >= data.targets.water_ml
                          ? "success"
                          : "brand"
                      }
                    />
                    <div className="flex flex-wrap gap-2">
                      {quick.map((ml) => (
                        <Button
                          key={ml}
                          size="sm"
                          variant="soft"
                          onClick={() =>
                            run((token) => addWater(token, workspaceId, today, ml), {
                              touches: ["habits"],
                            }).catch((reason: unknown) =>
                              setError(describeApiError(reason, "Couldn’t add the water.")),
                            )
                          }
                        >
                          <Droplets aria-hidden="true" />+{formatWater(ml, units.water_unit)}
                        </Button>
                      ))}
                    </div>
                  </Section>
                ) : null}
                {shown("weight") ? (
                  <Section title="Weight" action={<More view="body">Body</More>}>
                    {latest ? (
                      <>
                        <p className="text-2xl font-semibold tabular-nums">
                          {formatWeight(latest.weight_g, units.weight_unit)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {shortDate(latest.day)}
                          {weights.length > 1 && weights[0]
                            ? ` · ${latest.weight_g >= weights[0].weight_g ? "+" : ""}${formatWeight(latest.weight_g - weights[0].weight_g, units.weight_unit)} over 90 days`
                            : ""}
                        </p>
                        {weights.length > 1 ? (
                          <LineChart
                            title="Weight, last 90 days"
                            points={weights.map((p) => ({
                              label: shortDate(p.day),
                              value: gramsTo(p.weight_g, units.weight_unit),
                            }))}
                            format={(v) => `${formatNumber(v, 1)} ${units.weight_unit}`}
                          />
                        ) : null}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No weight in the last 90 days.
                      </p>
                    )}
                  </Section>
                ) : null}
                {shown("goals") ? (
                  <Section title="Active goals" action={<More view="goals">All goals</More>}>
                    {data.goals.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No active goals.</p>
                    ) : (
                      <ul className="space-y-2">
                        {data.goals.slice(0, 3).map((goal) => (
                          <li key={goal.id}>
                            <GoalCard goal={goal} units={units} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>
                ) : null}
                {shown("recent_workouts") ? (
                  <Section title="Recent workouts" action={<More view="workouts">History</More>}>
                    {data.recent_sessions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No completed workouts yet.</p>
                    ) : (
                      <ul className="-mx-3">
                        {data.recent_sessions.map((w) => (
                          <WorkoutRow key={w.id} workout={w} units={units} />
                        ))}
                      </ul>
                    )}
                  </Section>
                ) : null}
                {shown("activity") ? (
                  <Section title="Recent activity" action={<More view="activity">Open</More>}>
                    {data.recent_activities.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No activity recorded.</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {data.recent_activities.map((a) => (
                          <li key={a.id} className="flex justify-between gap-2">
                            <span>
                              {labelOf(ACTIVITY_KINDS, a.kind)}{" "}
                              <span className="text-xs text-muted-foreground">
                                {shortDate(a.day)}
                              </span>
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {describeActivity(a, units)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>
                ) : null}
              </div>
              {shown("records") ? (
                <Section
                  title="Latest personal records"
                  action={<More view="progress">All records</More>}
                >
                  <RecordTable records={data.records} units={units} />
                </Section>
              ) : null}
            </div>
          );
        }}
      </Loaded>
    </>
  );
}
