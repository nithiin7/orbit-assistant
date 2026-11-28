"use client";

import type { FitnessOverview, FitnessSection, Food, WorkoutTemplate } from "@orbit/contracts";
import {
  Activity,
  CalendarClock,
  ChartColumn,
  ChevronRight,
  Droplets,
  Dumbbell,
  Flame,
  LayoutTemplate,
  type LucideIcon,
  Play,
  Plus,
  Scale,
  Settings2,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { addWater, saveFoodEntry } from "@/api/fitness";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { HeroSkeleton, Skeleton, SkeletonText } from "@/components/ui/skeleton";
import {
  useFitnessAction,
  useFitnessOverview,
  useFitnessProfile,
  useFoods,
  useNutritionHistory,
  useTemplates,
  useWaterHistory,
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
  type Units,
} from "@/lib/fitness";
import { WEEKDAYS } from "@/lib/reminders";
import { cn } from "@/utils/common";
import { addDays, dayOfWeek } from "@/utils/dates";

import { KIND_ICONS } from "./activity-rings";
import { GoalCard } from "./goals";
import { FoodEntryDialog } from "./nutrition";
import { RecordTable } from "./progress";
import { BarChart, Gauge, type HealthTone, LineChart, Loaded, shortDate } from "./shared";
import { ActiveWorkoutBanner, StartWorkoutMenu, useStartWorkout, WorkoutRow } from "./workouts";

function More({ view, children }: { view: FitnessView; children: ReactNode }) {
  return (
    <Link
      href={fitnessHref({ kind: "view", view })}
      className="group/more -mr-1.5 inline-flex h-7 items-center gap-0.5 rounded-full px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
      <ChevronRight
        aria-hidden="true"
        className="size-3.5 transition-transform duration-150 group-hover/more:translate-x-0.5"
      />
    </Link>
  );
}

/** One card on Today: a tinted icon, a title, and a link through to the full view. */
function Card({
  title,
  icon: Icon,
  tone,
  action,
  children,
  className,
}: {
  title: string;
  icon: LucideIcon;
  tone: HealthTone;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn("flex flex-col gap-4 rounded-2xl border bg-card p-4 @3xl:p-5", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <IconChip icon={Icon} tone={tone} />
          <h2 id={id} className="truncate text-sm font-semibold">
            {title}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A small labelled figure, such as protein eaten today. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/60 px-3 py-2">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/** The day's amount in large type, with what it's measured against below. */
function Figure({ value, caption }: { value: string; caption: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-pretty text-muted-foreground">{caption}</p>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
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
      className="space-y-4 rounded-2xl border border-brand/20 bg-linear-to-br from-brand-subtle/70 to-card p-4 @3xl:p-5"
    >
      <div className="space-y-0.5">
        <h2 id="health-start-heading" className="text-base font-semibold tracking-tight">
          New here? Start with these
        </h2>
        <p className="text-sm text-muted-foreground">
          Everything else is optional. Use only the parts that help you.
        </p>
      </div>
      <ol className="grid gap-3 @3xl:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.view}>
            <Link
              href={fitnessHref({ kind: "view", view: step.view })}
              className="group/step flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-[border-color,translate] duration-150 outline-none hover:-translate-y-0.5 hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
            >
              <span className="flex items-center justify-between">
                <span
                  aria-hidden="true"
                  className="flex size-9 items-center justify-center rounded-xl bg-brand-subtle text-brand"
                >
                  <step.icon className="size-4" />
                </span>
                <span
                  aria-hidden="true"
                  className="text-xs font-semibold text-muted-foreground tabular-nums"
                >
                  Step {index + 1}
                </span>
              </span>
              <span className="min-w-0 space-y-1">
                <span className="block text-sm font-semibold">{step.title}</span>
                <span className="block text-xs text-pretty text-muted-foreground">{step.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function longDate(day: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    // The calendar day itself, whatever the viewer's time zone.
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** What today looks like for training, in a few words. */
function headline(data: FitnessOverview): string {
  if (data.active_session !== null) return "Workout in progress";
  if (data.completed_today.length > 0)
    return `Nice work: ${plural(data.completed_today.length, "workout")} done today`;
  if (data.scheduled_today.length > 0)
    return `${plural(data.scheduled_today.length, "workout")} planned today`;
  return "Ready when you are";
}

/** Today's training: what's planned, what's done, and a quick way to start. */
function TodayHero({
  data,
  workspaceId,
  today,
  timeZone,
  templates,
  units,
  onStart,
}: {
  data: FitnessOverview;
  workspaceId: string;
  today: string;
  timeZone: string;
  templates: readonly WorkoutTemplate[];
  units: Units;
  onStart: (templateId: string | null, eventId?: string | null) => void;
}) {
  const idle =
    data.active_session === null &&
    data.completed_today.length === 0 &&
    data.scheduled_today.length === 0;
  return (
    <section
      aria-labelledby="health-today-heading"
      className="relative overflow-hidden rounded-2xl border bg-linear-to-br from-brand-subtle/80 via-card to-card p-4 @3xl:p-6"
    >
      <Dumbbell
        aria-hidden="true"
        className="pointer-events-none absolute -top-6 -right-6 size-40 -rotate-12 text-brand opacity-[0.06]"
      />
      <div className="relative space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium tracking-wide text-brand uppercase">
              {longDate(today)}
            </p>
            <h2
              id="health-today-heading"
              className="text-xl font-semibold tracking-tight @3xl:text-2xl"
            >
              {headline(data)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {plural(data.week_workouts, "workout")} so far this week.
            </p>
          </div>
          {data.active_session === null ? (
            <StartWorkoutMenu workspaceId={workspaceId} templates={templates} onStart={onStart} />
          ) : null}
        </div>

        <ActiveWorkoutBanner workspaceId={workspaceId} />

        {data.scheduled_today.length > 0 ? (
          <ul aria-label="Planned today" className="grid gap-2 @3xl:grid-cols-2">
            {data.scheduled_today.map((item) => (
              <li
                key={`${item.calendar_event_id}-${item.start_at ?? ""}`}
                className="flex items-center justify-between gap-3 rounded-xl border bg-card/80 p-3 backdrop-blur-sm"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand"
                  >
                    <CalendarClock className="size-4" />
                  </span>
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
                    onClick={() => onStart(item.template_id, item.calendar_event_id)}
                  >
                    <Play aria-hidden="true" />
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
          <ul className="-mx-3 rounded-xl">
            {data.completed_today.map((w) => (
              <WorkoutRow key={w.id} workout={w} units={units} />
            ))}
          </ul>
        ) : null}

        {idle && templates.length > 0 ? (
          <ul aria-label="Quick start" className="grid gap-2 @xl:grid-cols-2 @5xl:grid-cols-4">
            {templates.slice(0, 4).map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  onClick={() => onStart(template.id)}
                  className="group/start flex w-full items-center gap-3 rounded-xl border bg-card/80 p-3 text-left backdrop-blur-sm transition-[border-color,translate] duration-150 outline-none hover:-translate-y-0.5 hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground transition-transform duration-150 group-hover/start:scale-105"
                  >
                    <Play className="size-4 translate-x-px" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{template.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {plural(template.exercises.length, "exercise")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
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
      <Loaded
        resource={overview.state}
        reload={overview.reload}
        fallback={<HealthOverviewSkeleton />}
      >
        {(data) => {
          const shown = (section: FitnessSection) => !data.hidden_sections.includes(section);
          const weights = data.weight_trend;
          const latest = weights[weights.length - 1];
          const first = weights[0];
          const change =
            latest && first && weights.length > 1 ? latest.weight_g - first.weight_g : 0;
          const ready =
            templates.state.status === "success"
              ? templates.state.data.templates.filter((t) => !t.archived)
              : [];
          const fresh =
            data.recent_sessions.length === 0 &&
            data.completed_today.length === 0 &&
            data.active_session === null &&
            data.week_workouts === 0;
          const energyTarget = data.targets.energy_cal;
          const energyText = `${formatEnergy(data.nutrition.energy_cal, units.energy_unit)}${energyTarget ? ` of ${formatEnergy(energyTarget, units.energy_unit)}` : ""}`;
          const waterTarget = data.targets.water_ml;
          const waterDone = Boolean(waterTarget && data.water_ml >= waterTarget);
          return (
            <div className="space-y-4">
              <FormAlert message={error} />
              {fresh ? <GettingStarted hasTemplates={ready.length > 0} /> : null}
              {shown("workout") ? (
                <TodayHero
                  data={data}
                  workspaceId={workspaceId}
                  today={today}
                  timeZone={timeZone}
                  templates={ready}
                  units={units}
                  onStart={begin}
                />
              ) : null}

              <div className="grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
                {shown("nutrition") ? (
                  <Card
                    title="Food today"
                    icon={Flame}
                    tone="orange"
                    action={<More view="nutrition">Open</More>}
                  >
                    <div className="flex items-center gap-4">
                      <Gauge
                        label="Energy"
                        fraction={share(data.nutrition.energy_cal, energyTarget)}
                        tone="orange"
                        valueText={energyText}
                        icon={Flame}
                      />
                      <Figure
                        value={formatEnergy(data.nutrition.energy_cal, units.energy_unit)}
                        caption={
                          energyTarget
                            ? `of ${formatEnergy(energyTarget, units.energy_unit)}`
                            : "No daily target"
                        }
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Stat label="Protein" value={formatGrams(data.nutrition.protein_mg)} />
                      <Stat label="Carbs" value={formatGrams(data.nutrition.carbs_mg)} />
                      <Stat label="Fat" value={formatGrams(data.nutrition.fat_mg)} />
                    </div>
                    <div className="mt-auto flex flex-wrap gap-2">
                      <Button size="sm" variant="soft" onClick={() => setAddingFood(true)}>
                        <Plus aria-hidden="true" />
                        Add food
                      </Button>
                      {favorites.map((food) => (
                        <Button
                          key={food.id}
                          size="sm"
                          variant="ghost"
                          className="rounded-full border"
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
                  </Card>
                ) : null}
                {shown("water") ? (
                  <Card
                    title="Water today"
                    icon={Droplets}
                    tone="blue"
                    action={<More view="water">Open</More>}
                  >
                    <div className="flex items-center gap-4">
                      <Gauge
                        label="Water"
                        fraction={share(data.water_ml, waterTarget)}
                        tone={waterDone ? "success" : "blue"}
                        valueText={`${formatWater(data.water_ml, units.water_unit)}${waterTarget ? ` of ${formatWater(waterTarget, units.water_unit)}` : ""}`}
                        icon={Droplets}
                      />
                      <Figure
                        value={formatWater(data.water_ml, units.water_unit)}
                        caption={
                          waterDone
                            ? "Target reached. Nicely done."
                            : waterTarget
                              ? `${formatWater(waterTarget - data.water_ml, units.water_unit)} to go of ${formatWater(waterTarget, units.water_unit)}`
                              : "No daily target"
                        }
                      />
                    </div>
                    <div className="mt-auto flex flex-wrap gap-2">
                      {quick.map((ml) => (
                        <Button
                          key={ml}
                          size="sm"
                          variant="soft"
                          className="rounded-full"
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
                  </Card>
                ) : null}
                {shown("nutrition") || shown("water") ? (
                  <Card
                    title="Last 7 days"
                    icon={ChartColumn}
                    tone="brand"
                    className="@3xl:col-span-2"
                  >
                    <div className="grid gap-6 @xl:grid-cols-2">
                      {shown("nutrition") ? (
                        <EnergyWeek workspaceId={workspaceId} today={today} units={units} />
                      ) : null}
                      {shown("water") ? (
                        <WaterWeek workspaceId={workspaceId} today={today} units={units} />
                      ) : null}
                    </div>
                  </Card>
                ) : null}
                {shown("weight") ? (
                  <Card
                    title="Weight"
                    icon={Scale}
                    tone="violet"
                    action={<More view="body">Body</More>}
                  >
                    {latest ? (
                      <>
                        <div className="flex flex-wrap items-end justify-between gap-2">
                          <div>
                            <p className="text-3xl font-semibold tracking-tight tabular-nums">
                              {formatWeight(latest.weight_g, units.weight_unit)}
                            </p>
                            <p className="text-xs text-muted-foreground">{shortDate(latest.day)}</p>
                          </div>
                          {weights.length > 1 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium tabular-nums">
                              {change < 0 ? (
                                <TrendingDown aria-hidden="true" className="size-3.5" />
                              ) : (
                                <TrendingUp aria-hidden="true" className="size-3.5" />
                              )}
                              {`${change >= 0 ? "+" : ""}${formatWeight(change, units.weight_unit)} over 90 days`}
                            </span>
                          ) : null}
                        </div>
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
                      <Empty>No weight in the last 90 days.</Empty>
                    )}
                  </Card>
                ) : null}
                {shown("goals") ? (
                  <Card
                    title="Active goals"
                    icon={Target}
                    tone="amber"
                    action={<More view="goals">All goals</More>}
                  >
                    {data.goals.length === 0 ? (
                      <Empty>No active goals.</Empty>
                    ) : (
                      <ul className="space-y-2">
                        {data.goals.slice(0, 3).map((goal) => (
                          <li key={goal.id}>
                            <GoalCard goal={goal} units={units} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                ) : null}
                {shown("recent_workouts") ? (
                  <Card
                    title="Recent workouts"
                    icon={Dumbbell}
                    tone="brand"
                    action={<More view="workouts">History</More>}
                  >
                    {data.recent_sessions.length === 0 ? (
                      <Empty>No completed workouts yet.</Empty>
                    ) : (
                      <ul className="-mx-3 -my-1">
                        {data.recent_sessions.map((w) => (
                          <WorkoutRow key={w.id} workout={w} units={units} />
                        ))}
                      </ul>
                    )}
                  </Card>
                ) : null}
                {shown("activity") ? (
                  <Card
                    title="Recent activity"
                    icon={Activity}
                    tone="green"
                    action={<More view="activity">Open</More>}
                  >
                    {data.recent_activities.length === 0 ? (
                      <Empty>No activity recorded.</Empty>
                    ) : (
                      <ul className="space-y-1">
                        {data.recent_activities.map((a) => {
                          const KindIcon = KIND_ICONS[a.kind];
                          return (
                            <li key={a.id} className="flex items-center gap-3 py-1">
                              <span
                                aria-hidden="true"
                                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                              >
                                <KindIcon className="size-4" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">
                                  {labelOf(ACTIVITY_KINDS, a.kind)}
                                </p>
                                <p className="text-xs text-muted-foreground">{shortDate(a.day)}</p>
                              </div>
                              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                {describeActivity(a, units)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Card>
                ) : null}
              </div>
              {shown("records") ? (
                <Card
                  title="Latest personal records"
                  icon={Trophy}
                  tone="amber"
                  action={<More view="progress">All records</More>}
                >
                  <RecordTable records={data.records} units={units} />
                </Card>
              ) : null}
            </div>
          );
        }}
      </Loaded>
    </>
  );
}

const WEEK_DAYS = 7;

/** The last week of days ending today, each with its value (0 for days with nothing logged). */
function lastWeek(today: string, values: ReadonlyMap<string, number>) {
  const start = addDays(today, -(WEEK_DAYS - 1));
  return Array.from({ length: WEEK_DAYS }, (_, i) => {
    const day = addDays(start, i);
    return {
      label: WEEKDAYS[(dayOfWeek(day) + 6) % 7]?.label ?? day.slice(8),
      value: values.get(day) ?? 0,
    };
  });
}

/** One small chart in the week card: a label, the daily average, and the bars. */
function WeekChart({
  title,
  bars,
  format,
  barClassName,
}: {
  title: string;
  bars: readonly { label: string; value: number }[];
  format: (value: number) => string;
  barClassName: string;
}) {
  const logged = bars.filter((bar) => bar.value > 0);
  const average = logged.length
    ? logged.reduce((sum, bar) => sum + bar.value, 0) / logged.length
    : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground tabular-nums">
          {logged.length ? `${format(Math.round(average))} a day on average` : "Nothing logged"}
        </p>
      </div>
      <BarChart
        title={`${title}, last 7 days`}
        bars={bars}
        format={format}
        barClassName={barClassName}
      />
    </div>
  );
}

function EnergyWeek({
  workspaceId,
  today,
  units,
}: {
  workspaceId: string;
  today: string;
  units: Units;
}) {
  const history = useNutritionHistory(workspaceId, addDays(today, -(WEEK_DAYS - 1)), today);
  return (
    <Loaded resource={history.state} reload={history.reload} skeleton="h-40">
      {({ days }) => (
        <WeekChart
          title="Energy"
          bars={lastWeek(today, new Map(days.map((d) => [d.day, d.nutrients.energy_cal])))}
          format={(cal) => formatEnergy(cal, units.energy_unit)}
          barClassName="bg-event-orange/80"
        />
      )}
    </Loaded>
  );
}

function WaterWeek({
  workspaceId,
  today,
  units,
}: {
  workspaceId: string;
  today: string;
  units: Units;
}) {
  const history = useWaterHistory(workspaceId, addDays(today, -(WEEK_DAYS - 1)), today);
  return (
    <Loaded resource={history.state} reload={history.reload} skeleton="h-40">
      {({ days }) => (
        <WeekChart
          title="Water"
          bars={lastWeek(today, new Map(days.map((d) => [d.day, d.total_ml])))}
          format={(ml) => formatWater(ml, units.water_unit)}
          barClassName="bg-event-blue/80"
        />
      )}
    </Loaded>
  );
}

/**
 * The overview while it loads: the same today card and grid of cards as the real view, so it
 * fills in without moving.
 */
export function HealthOverviewSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <HeroSkeleton className="p-4 shadow-none @3xl:p-6" titleClassName="text-xl @3xl:text-2xl" />
      <div className="grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
        {/* Food and water today, then the wide last-7-days chart card. */}
        {[0, 1, 2].map((card) => (
          <div
            key={card}
            className={cn(
              "flex flex-col gap-4 rounded-2xl border bg-card p-4 @3xl:p-5",
              card === 2 && "@3xl:col-span-2",
            )}
          >
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-8 rounded-xl" />
              <SkeletonText className="w-24 text-sm" />
            </div>
            <Skeleton className={cn("w-full rounded-xl", card === 2 ? "h-40" : "h-24")} />
          </div>
        ))}
      </div>
    </div>
  );
}
