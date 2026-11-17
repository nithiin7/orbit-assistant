import type {
  BriefingContent,
  BriefingModule,
  BriefingPaymentItem,
  BriefingSettings,
  BriefingSourceRef,
} from "@orbit/contracts";
import { array, mixed, object, string } from "yup";

import { calendarHref } from "@/lib/calendar";
import { documentsHref } from "@/lib/documents";
import { financeViewHref } from "@/lib/finance-views";
import { fitnessHref } from "@/lib/fitness";
import { habitsHref } from "@/lib/habits";
import { notesHref } from "@/lib/notes";

/** What each source is called in the briefing. */
export const MODULE_LABELS: Record<BriefingModule, string> = {
  tasks: "Tasks",
  calendar: "Calendar",
  reminders: "Reminders",
  payments: "Payments",
  budgets: "Budgets",
  goals: "Savings goals",
  habits: "Habits",
  routines: "Routines",
  health: "Health",
  notes: "Notes",
  documents: "Documents",
  shopping: "Shopping",
  investments: "Investments",
};

/**
 * Where a briefing item lives in Orbit. Events open the calendar on their day (`day`, a local
 * date); payments open their commitment's list, which `kind` names.
 */
export function briefingHref(
  ref: BriefingSourceRef,
  { day, kind }: { day: string; kind?: BriefingPaymentItem["kind"] },
): string {
  const id = encodeURIComponent(ref.id);
  switch (ref.type) {
    case "task":
      return `/tasks?task=${id}`;
    case "event":
      return calendarHref({ view: "day", date: day });
    case "reminder":
      return `/reminders?reminder=${id}`;
    case "commitment":
      return financeViewHref(
        kind === "loan" ? "loans" : kind === "bill" ? "bills" : "subscriptions",
      );
    case "budget":
      return financeViewHref("budgets");
    case "savings_goal":
      return financeViewHref("goals");
    case "habit":
      return habitsHref({ kind: "habit", id: ref.id });
    case "routine":
      return habitsHref({ kind: "routine", id: ref.id });
    case "workout":
      return fitnessHref({ kind: "workout", id: ref.id });
    case "fitness_goal":
      return fitnessHref({ kind: "goal", id: ref.id });
    case "note":
      return notesHref({ noteId: ref.id });
    case "document":
      return documentsHref({ documentId: ref.id });
    case "shopping_list":
      return "/shopping";
    case "sip":
    case "deposit":
      return financeViewHref("investments");
  }
}

/** Every module, in briefing order, for the settings form. */
export const BRIEFING_MODULES = Object.keys(MODULE_LABELS) as BriefingModule[];

/** The settings form: what the person picks, as the form holds it. */
export type BriefingSettingsValues = {
  horizonDays: string;
  /** The modules shown, so a checked box means "included". */
  shown: BriefingModule[];
  /** `HH:MM`, or empty for "only when I open it". */
  prepareAt: string;
};

export const briefingSettingsSchema = object({
  horizonDays: string()
    .defined()
    .test("range", "Choose 1 to 14 days.", (value) => {
      const days = Number(value);
      return Number.isInteger(days) && days >= 1 && days <= 14;
    }),
  shown: array(mixed<BriefingModule>().oneOf(BRIEFING_MODULES).defined())
    .defined()
    .min(1, "Keep at least one module in your briefing."),
  prepareAt: string()
    .defined()
    .matches(/^$|^\d{2}:\d{2}$/, "Choose a time, or leave it empty."),
});

export function settingsToValues(settings: BriefingSettings): BriefingSettingsValues {
  return {
    horizonDays: String(settings.horizon_days),
    shown: BRIEFING_MODULES.filter((module) => !settings.hidden.includes(module)),
    prepareAt: settings.prepare_at ? settings.prepare_at.slice(0, 5) : "",
  };
}

export function valuesToSettings(values: BriefingSettingsValues): BriefingSettings {
  return {
    horizon_days: Number(values.horizonDays),
    hidden: BRIEFING_MODULES.filter((module) => !values.shown.includes(module)),
    prepare_at: values.prepareAt === "" ? null : values.prepareAt,
  };
}

/**
 * Every item's link by its `ref.key`, so a summary's priorities (which name items by key) link to
 * the records they're about. `day` is the briefing's date, where its events are.
 */
export function briefingItemHrefs(content: BriefingContent, day: string): Map<string, string> {
  const index = new Map<string, string>();
  const add = (ref: BriefingSourceRef, kind?: BriefingPaymentItem["kind"]) =>
    index.set(ref.key, briefingHref(ref, { day, kind }));
  for (const event of content.schedule?.events ?? []) add(event.ref);
  for (const event of content.schedule?.upcoming ?? []) add(event.ref);
  for (const bucket of Object.values(content.tasks ?? {})) {
    for (const task of bucket.items) add(task.ref);
  }
  for (const task of content.deadlines?.tasks.items ?? []) add(task.ref);
  for (const goal of content.deadlines?.savings_goals ?? []) add(goal.ref);
  for (const reminder of content.reminders?.items ?? []) add(reminder.ref);
  for (const payment of content.payments?.items ?? []) add(payment.ref, payment.kind);
  for (const budget of content.budgets?.items ?? []) add(budget.ref);
  for (const habit of content.habits?.habits ?? []) add(habit.ref);
  for (const routine of content.routines?.routines ?? []) add(routine.ref);
  for (const workout of content.health?.workouts ?? []) add(workout.ref);
  for (const goal of content.health?.goals ?? []) add(goal.ref);
  for (const note of content.notes?.items ?? []) add(note.ref);
  for (const document of content.documents?.items ?? []) add(document.ref);
  for (const list of content.shopping?.lists ?? []) add(list.ref);
  for (const sip of content.investments?.sips ?? []) add(sip.ref);
  for (const deposit of content.investments?.deposits ?? []) add(deposit.ref);
  return index;
}
