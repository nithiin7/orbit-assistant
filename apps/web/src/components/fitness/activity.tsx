"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Activity, ActivityKind, FitnessProfile } from "@orbit/contracts";
import {
  ChevronLeft,
  ChevronRight,
  Flame,
  Footprints,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Target,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { deleteActivity, saveActivity, saveFitnessProfile } from "@/api/fitness";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { DialogShell } from "@/components/finance/dialog-shell";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { useCelebration } from "@/components/habits/celebration";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { useActivities, useFitnessAction, useFitnessProfile, useUnits } from "@/hooks/use-fitness";
import {
  ACTIVITY_KINDS,
  activityFields,
  type ActivityFormValues,
  type ActivityGoals,
  activityGoals,
  activitySchema,
  closedRings,
  type DayTotals,
  dayTotals,
  DEFAULT_ACTIVITY_GOALS,
  describeActivity,
  formatDuration,
  formatNumber,
  labelOf,
  newActivityValues,
  type ProfileFormValues,
  profileSchema,
  recentDays,
  RING_KEYS,
  type RingKey,
  ringProgress,
  ringsClosedBySave,
  ringStreak,
  summarizeDays,
  toActivityFormValues,
  toActivityRequest,
  toProfileFormValues,
  toProfileRequest,
  totalsByDay,
  type Units,
} from "@/lib/fitness";
import { cn } from "@/utils/common";
import { addDays, parseCalendarDate } from "@/utils/dates";

import { ActivityRings, describeRings, KIND_ICONS, ringOf, RINGS } from "./activity-rings";
import { Loaded, shortDate } from "./shared";

/** What a new entry starts with when logged from a ring or a quick-log chip. */
type Draft = { kind: ActivityKind; day: string };

/** The kind a ring's "Log" button starts with. */
const RING_KIND: Record<RingKey, ActivityKind> = { active: "walk", steps: "steps", sleep: "sleep" };

function calendarDate(day: string): Date {
  const { year, month, day: date } = parseCalendarDate(day);
  return new Date(year, month - 1, date);
}

function weekday(day: string, style: "short" | "narrow"): string {
  return calendarDate(day).toLocaleDateString(undefined, { weekday: style });
}

function dayName(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return `${weekday(day, "short")}, ${shortDate(day)}`;
}

function hours(seconds: number): string {
  return formatNumber(seconds / 3600, 1);
}

/** "18 of 30 min", "4,200 of 10,000 steps", "6.5 of 8 h". */
function ringValue(key: RingKey, totals: DayTotals, goals: ActivityGoals): string {
  if (key === "active") {
    return `${formatNumber(totals.active_s / 60)} of ${formatNumber(goals.active_s / 60)} min`;
  }
  if (key === "steps") return `${formatNumber(totals.steps)} of ${formatNumber(goals.steps)} steps`;
  return `${hours(totals.sleep_s)} of ${hours(goals.sleep_s)} h`;
}

/** What's left to close a ring, such as "12 min to go". */
function ringRemaining(key: RingKey, totals: DayTotals, goals: ActivityGoals): string {
  if (key === "active") {
    return `${formatNumber(Math.ceil((goals.active_s - totals.active_s) / 60))} active min to go`;
  }
  if (key === "steps") return `${formatNumber(goals.steps - totals.steps)} steps to go`;
  return `${hours(goals.sleep_s - totals.sleep_s)} h of sleep to go`;
}

function headline(closed: number, totals: DayTotals, isToday: boolean): string {
  if (closed === RING_KEYS.length)
    return isToday ? "All rings closed. What a day!" : "All rings closed";
  if (totals.rest && closed === 0) return "Rest day. Recovery counts too.";
  if (closed > 0) return `${closed} of ${RING_KEYS.length} rings closed`;
  if (totals.entries > 0) return isToday ? "Good start. Keep it going." : "Some activity logged";
  return isToday ? "Let’s get moving" : "Nothing logged this day";
}

export function ActivityView({ workspaceId, today }: { workspaceId: string; today: string }) {
  const units = useUnits(workspaceId);
  const profile = useFitnessProfile(workspaceId);
  const activities = useActivities(workspaceId);
  const run = useFitnessAction(workspaceId);
  const { confirm, confirmDialog } = useConfirm();
  const { celebrate, celebration } = useCelebration();
  const [day, setDay] = useState(today);
  const [kind, setKind] = useState<ActivityKind | "all">("all");
  const [editing, setEditing] = useState<Activity | Draft | null>(null);
  const [editingGoals, setEditingGoals] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadedProfile = profile.state.status === "success" ? profile.state.data : null;
  const goals = activityGoals(loadedProfile?.targets);
  const list = activities.state.status === "success" ? activities.state.data.activities : [];

  async function remove(activity: Activity) {
    const ok = await confirm({
      title: "Delete this entry?",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    run((token) => deleteActivity(token, workspaceId, activity.id)).catch((reason: unknown) =>
      setError(describeApiError(reason, "Couldn’t delete it.")),
    );
  }

  function cheer(saved: Activity) {
    const { closed, allClosed } = ringsClosedBySave(list, saved, goals);
    if (closed.length === 0) return;
    if (allClosed) {
      celebrate({
        emoji: "🏆",
        title: "All rings closed!",
        message: "Every goal met for the day. Brilliant.",
        big: true,
      });
      return;
    }
    const names = closed.map((key) => RINGS[key].label).join(" and ");
    celebrate({
      emoji: closed.includes("sleep") ? "🌙" : "🎉",
      title: `${names} ring closed!`,
      message: "Nice work. Keep the others going.",
      big: false,
    });
  }

  return (
    <div className="@container/activity space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DayStepper day={day} today={today} onChange={setDay} />
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={!loadedProfile} onClick={() => setEditingGoals(true)}>
            <Target aria-hidden="true" />
            Goals
          </Button>
          <Button onClick={() => setEditing({ kind: "steps", day })}>
            <Plus aria-hidden="true" />
            Record activity
          </Button>
        </div>
      </div>
      <FormAlert message={error} />
      <Loaded resource={activities.state} reload={activities.reload} skeleton="h-72">
        {({ activities: all }) => {
          const byDay = totalsByDay(all);
          const week = recentDays(today);
          return (
            <>
              <TodayCard
                day={day}
                today={today}
                totals={dayTotals(byDay, day)}
                goals={goals}
                onLog={(draft) => setEditing(draft)}
              />
              <QuickLog onLog={(next) => setEditing({ kind: next, day })} />
              <WeekStrip
                days={week}
                byDay={byDay}
                goals={goals}
                selected={day}
                today={today}
                onSelect={setDay}
              />
              <Stats
                streak={ringStreak(byDay, goals, today)}
                summary={summarizeDays(byDay, goals, week)}
              />
              <History
                activities={all}
                byDay={byDay}
                goals={goals}
                today={today}
                units={units}
                kind={kind}
                onKindChange={setKind}
                onEdit={setEditing}
                onDelete={(activity) => void remove(activity)}
              />
            </>
          );
        }}
      </Loaded>
      <p className="text-xs text-muted-foreground">
        Entered by hand. Orbit doesn’t connect to fitness trackers or estimate activity.
      </p>
      {editing ? (
        <ActivityDialog
          workspaceId={workspaceId}
          editing={"id" in editing ? editing : null}
          initial={"id" in editing ? undefined : editing}
          today={today}
          units={units}
          onClose={() => setEditing(null)}
          onSaved={cheer}
        />
      ) : null}
      {editingGoals && loadedProfile ? (
        <GoalsDialog
          workspaceId={workspaceId}
          profile={loadedProfile}
          onClose={() => setEditingGoals(false)}
        />
      ) : null}
      {confirmDialog}
      {celebration}
    </div>
  );
}

function DayStepper({
  day,
  today,
  onChange,
}: {
  day: string;
  today: string;
  onChange: (day: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous day"
        onClick={() => onChange(addDays(day, -1))}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <p className="min-w-32 text-center text-sm font-semibold" aria-live="polite">
        {dayName(day, today)}
      </p>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next day"
        disabled={day >= today}
        onClick={() => onChange(addDays(day, 1))}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
      {day !== today ? (
        <Button variant="soft" size="sm" onClick={() => onChange(today)}>
          Today
        </Button>
      ) : null}
    </div>
  );
}

function TodayCard({
  day,
  today,
  totals,
  goals,
  onLog,
}: {
  day: string;
  today: string;
  totals: DayTotals;
  goals: ActivityGoals;
  onLog: (draft: Draft) => void;
}) {
  const progress = ringProgress(totals, goals);
  const closed = closedRings(progress);
  const allClosed = closed.length === RING_KEYS.length;
  const next = RING_KEYS.find((key) => progress[key] < 1);
  return (
    <section
      aria-label={`Rings for ${dayName(day, today).toLowerCase()}`}
      className={cn(
        "grid items-center gap-6 rounded-2xl border bg-card p-5 @2xl/activity:grid-cols-[auto_1fr] @2xl/activity:gap-8 @2xl/activity:p-6",
        allClosed && "border-success/40",
      )}
    >
      <div className="relative mx-auto">
        {/* Keyed by day so the rings sweep in again when the day changes. */}
        <ActivityRings
          key={day}
          progress={progress}
          label={describeRings(progress)}
          className="size-44 @2xl/activity:size-52"
        />
        {allClosed ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex animate-check-pop items-center justify-center text-3xl"
          >
            🏆
          </span>
        ) : null}
      </div>
      <div className="min-w-0 space-y-4">
        <div className="space-y-1">
          <p className="text-lg font-semibold">{headline(closed.length, totals, day === today)}</p>
          {next && !allClosed ? (
            <p className="text-sm text-muted-foreground">
              {RINGS[next].label}: {ringRemaining(next, totals, goals)}.
            </p>
          ) : null}
        </div>
        <ul className="space-y-3">
          {RING_KEYS.map((key) => (
            <RingRow
              key={key}
              ring={key}
              value={ringValue(key, totals, goals)}
              share={progress[key]}
              onLog={() => onLog({ kind: RING_KIND[key], day })}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function RingRow({
  ring,
  value,
  share,
  onLog,
}: {
  ring: RingKey;
  value: string;
  share: number;
  onLog: () => void;
}) {
  const style = RINGS[ring];
  const Icon = style.icon;
  const percent = Math.round(share * 100);
  const done = share >= 1;
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={cn("grid size-9 shrink-0 place-items-center rounded-full", style.chip)}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">
            {style.label}
            {done ? <span className="ml-1.5 text-xs text-success">Closed</span> : null}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {value} · {percent}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={style.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, percent)}
          aria-valuetext={value}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", style.bar)}
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Log ${style.label.toLowerCase()}`}
        onClick={onLog}
      >
        <Plus aria-hidden="true" />
      </Button>
    </li>
  );
}

function QuickLog({ onLog }: { onLog: (kind: ActivityKind) => void }) {
  return (
    <section aria-label="Log quickly" className="space-y-2">
      <h2 className="text-xs font-medium text-muted-foreground">Log quickly</h2>
      <div className="flex flex-wrap gap-2">
        {ACTIVITY_KINDS.map((option) => {
          const Icon = KIND_ICONS[option.value];
          const ring = ringOf(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onLog(option.value)}
              className="inline-flex h-9 items-center gap-2 rounded-full border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Icon
                aria-hidden="true"
                className={cn("size-4", ring ? RINGS[ring].text : "text-muted-foreground")}
              />
              {option.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WeekStrip({
  days,
  byDay,
  goals,
  selected,
  today,
  onSelect,
}: {
  days: readonly string[];
  byDay: Map<string, DayTotals>;
  goals: ActivityGoals;
  selected: string;
  today: string;
  onSelect: (day: string) => void;
}) {
  return (
    <section aria-label="Last 7 days" className="rounded-2xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Last 7 days</h2>
      <ul className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const totals = dayTotals(byDay, day);
          const progress = ringProgress(totals, goals);
          const closed = closedRings(progress).length;
          const active = day === selected;
          return (
            <li key={day}>
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${dayName(day, today)}: ${closed} of ${RING_KEYS.length} rings closed`}
                onClick={() => onSelect(day)}
                className={cn(
                  "flex w-full flex-col items-center gap-1.5 rounded-xl py-2 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active && "bg-accent",
                )}
              >
                <span
                  className={cn(
                    "text-xs font-medium text-muted-foreground",
                    day === today && "text-foreground",
                  )}
                >
                  {weekday(day, "narrow")}
                </span>
                <ActivityRings
                  progress={progress}
                  thin
                  className="pointer-events-none size-9 @md/activity:size-11"
                />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {calendarDate(day).getDate()}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stats({ streak, summary }: { streak: number; summary: ReturnType<typeof summarizeDays> }) {
  const tiles = [
    {
      label: "Ring streak",
      value: `${streak} ${streak === 1 ? "day" : "days"}`,
      hint: streak > 0 ? "Close any ring to keep it going" : "Close any ring to start one",
      icon: Flame,
      tone: "bg-event-amber/12 text-event-amber",
    },
    {
      label: "Perfect days",
      value: `${summary.perfectDays} of 7`,
      hint: "All three rings closed",
      icon: Target,
      tone: "bg-brand-subtle text-brand",
    },
    {
      label: "Steps",
      value: formatNumber(summary.steps),
      hint: `${formatNumber(summary.steps / 7)} a day on average`,
      icon: Footprints,
      tone: RINGS.steps.chip,
    },
    {
      label: "Active time",
      value: summary.active_s > 0 ? formatDuration(summary.active_s) : "0 min",
      hint:
        summary.averageSleep_s === null
          ? "No sleep logged this week"
          : `Sleep averaged ${hours(summary.averageSleep_s)} h`,
      icon: Zap,
      tone: RINGS.active.chip,
    },
  ];
  return (
    <section aria-label="This week" className="space-y-2">
      <h2 className="text-xs font-medium text-muted-foreground">Last 7 days at a glance</h2>
      <ul className="grid grid-cols-2 gap-3 @3xl/activity:grid-cols-4">
        {tiles.map((tile) => (
          <li key={tile.label} className="space-y-2 rounded-xl border bg-card p-3">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn("grid size-7 place-items-center rounded-full", tile.tone)}
              >
                <tile.icon className="size-3.5" />
              </span>
              <span className="text-xs text-muted-foreground">{tile.label}</span>
            </div>
            <p className="text-xl font-semibold tabular-nums">{tile.value}</p>
            <p className="text-xs text-muted-foreground">{tile.hint}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function History({
  activities,
  byDay,
  goals,
  today,
  units,
  kind,
  onKindChange,
  onEdit,
  onDelete,
}: {
  activities: readonly Activity[];
  byDay: Map<string, DayTotals>;
  goals: ActivityGoals;
  today: string;
  units: Units;
  kind: ActivityKind | "all";
  onKindChange: (kind: ActivityKind | "all") => void;
  onEdit: (activity: Activity) => void;
  onDelete: (activity: Activity) => void;
}) {
  const shown = activities.filter((a) => kind === "all" || a.kind === kind);
  const days: string[] = [];
  for (const activity of shown) {
    if (!days.includes(activity.day)) days.push(activity.day);
  }
  return (
    <section aria-labelledby="activity-history" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="activity-history" className="text-sm font-semibold">
          History
        </h2>
        <Select
          aria-label="Show"
          className="w-44"
          value={kind}
          onValueChange={onKindChange}
          options={[{ value: "all", label: "All activity" }, ...ACTIVITY_KINDS]}
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon={kind === "sleep" ? Moon : Footprints}
          title="No activity recorded"
          description="Log steps, a walk, a run, a ride, a swim, sleep, or a rest day to fill your rings."
        />
      ) : (
        <ol className="space-y-3">
          {days.map((day) => {
            const progress = ringProgress(dayTotals(byDay, day), goals);
            return (
              <li key={day} className="rounded-xl border bg-card">
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <ActivityRings progress={progress} thin className="size-6" />
                  <h3 className="text-sm font-medium">{dayName(day, today)}</h3>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {closedRings(progress).length} of {RING_KEYS.length} rings
                  </span>
                </div>
                <ul className="divide-y px-3">
                  {shown
                    .filter((activity) => activity.day === day)
                    .map((activity) => (
                      <HistoryRow
                        key={activity.id}
                        activity={activity}
                        units={units}
                        onEdit={() => onEdit(activity)}
                        onDelete={() => onDelete(activity)}
                      />
                    ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function HistoryRow({
  activity,
  units,
  onEdit,
  onDelete,
}: {
  activity: Activity;
  units: Units;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = KIND_ICONS[activity.kind];
  const ring = ringOf(activity.kind);
  const label = labelOf(ACTIVITY_KINDS, activity.kind);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full",
          ring ? RINGS[ring].chip : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {describeActivity(activity, units)}
          {activity.note ? ` · ${activity.note}` : ""}
        </p>
      </div>
      <Menu
        variant="ghost"
        size="icon"
        chevron={false}
        align="end"
        aria-label={`Actions for ${label} on ${shortDate(activity.day)}`}
        items={[
          { id: "edit", label: "Correct", icon: Pencil, onSelect: onEdit },
          {
            id: "delete",
            label: "Delete",
            icon: Trash2,
            destructive: true,
            onSelect: onDelete,
          },
        ]}
      >
        <MoreHorizontal aria-hidden="true" />
      </Menu>
    </li>
  );
}

function GoalsDialog({
  workspaceId,
  profile,
  onClose,
}: {
  workspaceId: string;
  profile: FitnessProfile;
  onClose: () => void;
}) {
  const run = useFitnessAction(workspaceId);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: yupResolver(profileSchema),
    defaultValues: toProfileFormValues(profile),
  });

  async function save(values: ProfileFormValues, close: () => void) {
    try {
      await run((token) => saveFitnessProfile(token, workspaceId, toProfileRequest(values)));
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save your goals.") });
    }
  }

  return (
    <DialogShell
      title="Ring goals"
      description="What closes each ring for a day. Leave one blank to use the default."
      busy={isSubmitting}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel="Save goals"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          label="Active minutes"
          inputMode="numeric"
          placeholder={String(DEFAULT_ACTIVITY_GOALS.active_s / 60)}
          autoFocus
          {...register("activeTarget")}
          error={errors.activeTarget?.message}
        />
        <FormField
          label="Steps"
          inputMode="numeric"
          placeholder={String(DEFAULT_ACTIVITY_GOALS.steps)}
          {...register("stepsTarget")}
          error={errors.stepsTarget?.message}
        />
        <FormField
          label="Sleep (hours)"
          inputMode="decimal"
          placeholder={String(DEFAULT_ACTIVITY_GOALS.sleep_s / 3600)}
          {...register("sleepTarget")}
          error={errors.sleepTarget?.message}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Walks, runs, rides, swims, and other cardio count as active minutes.
      </p>
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

export function ActivityDialog({
  workspaceId,
  editing,
  initial,
  today,
  units,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  editing: Activity | null;
  /** The kind and day a new entry starts with. */
  initial?: Draft;
  today: string;
  units: Units;
  onClose: () => void;
  onSaved?: (activity: Activity) => void;
}) {
  const run = useFitnessAction(workspaceId);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ActivityFormValues>({
    resolver: yupResolver(activitySchema),
    defaultValues: editing
      ? toActivityFormValues(editing, units)
      : newActivityValues(initial?.day ?? today, initial?.kind),
  });
  const kind = useWatch({ control, name: "kind" });
  const fields = activityFields(kind);

  async function save(values: ActivityFormValues, close: () => void) {
    try {
      const saved = await run(
        (token) =>
          saveActivity(token, workspaceId, editing?.id ?? null, toActivityRequest(values, units)),
        { touches: ["habits"] },
      );
      onSaved?.(saved);
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save it.") });
    }
  }

  return (
    <DialogShell
      title={editing ? "Correct activity" : "Record activity"}
      busy={isSubmitting}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel="Save"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField control={control} name="day" label="Date" />
        <SelectField control={control} name="kind" label="Activity" options={ACTIVITY_KINDS} />
      </div>
      {fields.steps ? (
        <FormField
          label="Steps"
          inputMode="numeric"
          autoFocus
          {...register("steps")}
          error={errors.steps?.message}
        />
      ) : null}
      {fields.distance || fields.duration ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.distance ? (
            <FormField
              label={`Distance (${units.distance_unit})`}
              inputMode="decimal"
              {...register("distance")}
              error={errors.distance?.message}
            />
          ) : null}
          {fields.duration ? (
            <FormField
              label={kind === "sleep" ? "Hours" : "Minutes"}
              inputMode="decimal"
              autoFocus={!fields.steps && !fields.distance}
              {...register("duration")}
              error={errors.duration?.message}
            />
          ) : null}
        </div>
      ) : null}
      <FormField
        label="Note"
        autoComplete="off"
        {...register("note")}
        error={errors.note?.message}
      />
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}
