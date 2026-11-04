/**
 * Ready-made habits and routines. Choosing one fills the New habit or New routine form; nothing
 * is saved until the person creates it, so every field stays editable.
 */

import type { HabitColor, HabitIcon, HabitKind, Weekday } from "@orbit/contracts";

import { type Option } from "@/utils/common";

import {
  describeSchedule,
  describeTarget,
  formatMinutes,
  type HabitFormValues,
  newHabitValues,
  newRoutineValues,
  type RoutineFormValues,
  toSchedule,
} from "./habits";

export type HabitTemplateCategory = "health" | "mind" | "growth" | "life";

export type TemplateFilter = HabitTemplateCategory | "routines";

export const TEMPLATE_FILTERS: readonly Option<TemplateFilter>[] = [
  { value: "health", label: "Health" },
  { value: "mind", label: "Mind" },
  { value: "growth", label: "Learning" },
  { value: "life", label: "Home & money" },
  { value: "routines", label: "Routines" },
];

export type HabitTemplate = {
  id: string;
  category: HabitTemplateCategory;
  /** Why it helps, shown on the card. */
  blurb: string;
  /** The form fields it sets; the rest keep the New habit defaults. */
  fields: Pick<HabitFormValues, "name" | "icon" | "color" | "kind"> &
    Partial<Omit<HabitFormValues, "name" | "icon" | "color" | "kind">>;
};

export type RoutineTemplate = {
  id: string;
  blurb: string;
  name: string;
  icon: HabitIcon;
  color: HabitColor;
  timeOfDay: string;
  weekdays: Weekday[];
  steps: readonly { name: string; minutes: number }[];
};

const WEEKDAYS_ONLY: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

function measured(
  kind: Exclude<HabitKind, "boolean">,
  target: number,
  unit = "",
): Pick<HabitFormValues, "kind" | "target" | "unit"> {
  return { kind, target: String(target), unit };
}

export const HABIT_TEMPLATES: readonly HabitTemplate[] = [
  // Health
  {
    id: "drink-water",
    category: "health",
    blurb: "Small sips add up. Count glasses through the day.",
    fields: {
      name: "Drink water",
      icon: "droplet",
      color: "blue",
      ...measured("numeric", 8, "glasses"),
    },
  },
  {
    id: "walk",
    category: "health",
    blurb: "A daily walk lifts energy and mood.",
    fields: {
      name: "Walk",
      icon: "footprints",
      color: "green",
      ...measured("numeric", 8000, "steps"),
    },
  },
  {
    id: "workout",
    category: "health",
    blurb: "Three sessions a week, on whichever days suit you.",
    fields: {
      name: "Work out",
      icon: "dumbbell",
      color: "orange",
      kind: "boolean",
      scheduleType: "weekly_target",
      timesPerWeek: "3",
    },
  },
  {
    id: "stretch",
    category: "health",
    blurb: "Ten easy minutes to loosen up after waking.",
    fields: {
      name: "Stretch",
      icon: "leaf",
      color: "teal",
      ...measured("duration", 10),
      timeOfDay: "07:30",
    },
  },
  {
    id: "sleep-on-time",
    category: "health",
    blurb: "A steady bedtime is the easiest way to sleep better.",
    fields: {
      name: "In bed by 11",
      icon: "moon",
      color: "violet",
      kind: "boolean",
      timeOfDay: "22:45",
    },
  },
  // Mind
  {
    id: "meditate",
    category: "mind",
    blurb: "A few quiet minutes to start the day calm.",
    fields: {
      name: "Meditate",
      icon: "brain",
      color: "violet",
      ...measured("duration", 10),
      timeOfDay: "07:00",
    },
  },
  {
    id: "journal",
    category: "mind",
    blurb: "Write a few lines about the day before bed.",
    fields: { name: "Journal", icon: "pen", color: "amber", kind: "boolean", timeOfDay: "21:30" },
  },
  {
    id: "gratitude",
    category: "mind",
    blurb: "Note three good things. It trains the mind to notice them.",
    fields: { name: "Three good things", icon: "smile", color: "rose", kind: "boolean" },
  },
  {
    id: "phone-free-morning",
    category: "mind",
    blurb: "Keep the first hour of the day for yourself.",
    fields: {
      name: "Phone-free first hour",
      icon: "sun",
      color: "amber",
      kind: "boolean",
      timeOfDay: "07:00",
    },
  },
  // Learning
  {
    id: "read",
    category: "growth",
    blurb: "Twenty minutes a day is a dozen books a year.",
    fields: { name: "Read", icon: "book", color: "amber", ...measured("duration", 20) },
  },
  {
    id: "language",
    category: "growth",
    blurb: "Short, steady practice beats long weekend sessions.",
    fields: {
      name: "Practise a language",
      icon: "graduation",
      color: "teal",
      ...measured("duration", 15),
      scheduleType: "weekdays",
      weekdays: WEEKDAYS_ONLY,
    },
  },
  {
    id: "instrument",
    category: "growth",
    blurb: "Four sessions a week keeps the progress coming.",
    fields: {
      name: "Practise an instrument",
      icon: "music",
      color: "rose",
      ...measured("duration", 20),
      scheduleType: "weekly_target",
      timesPerWeek: "4",
    },
  },
  {
    id: "deep-work",
    category: "growth",
    blurb: "One focused block on what matters most.",
    fields: {
      name: "Deep work block",
      icon: "briefcase",
      color: "blue",
      ...measured("duration", 90),
      scheduleType: "weekdays",
      weekdays: WEEKDAYS_ONLY,
      timeOfDay: "09:30",
    },
  },
  // Home & money
  {
    id: "log-spending",
    category: "life",
    blurb: "Jot down what you spent while you still remember.",
    fields: {
      name: "Log today’s spending",
      icon: "wallet",
      color: "green",
      kind: "boolean",
      timeOfDay: "21:00",
    },
  },
  {
    id: "tidy",
    category: "life",
    blurb: "Ten minutes each evening keeps the weekend free.",
    fields: {
      name: "Ten-minute tidy",
      icon: "sparkles",
      color: "slate",
      ...measured("duration", 10),
      timeOfDay: "20:00",
    },
  },
  {
    id: "call-someone",
    category: "life",
    blurb: "Stay close to the people who matter.",
    fields: {
      name: "Call someone you love",
      icon: "heart",
      color: "rose",
      kind: "boolean",
      scheduleType: "weekly_target",
      timesPerWeek: "1",
    },
  },
  {
    id: "no-spend-day",
    category: "life",
    blurb: "Two days a week with no spending at all.",
    fields: {
      name: "No-spend day",
      icon: "wallet",
      color: "teal",
      kind: "boolean",
      scheduleType: "weekly_target",
      timesPerWeek: "2",
    },
  },
];

export const ROUTINE_TEMPLATES: readonly RoutineTemplate[] = [
  {
    id: "morning",
    blurb: "Wake up, hydrate, move, and plan before the day starts.",
    name: "Morning routine",
    icon: "sun",
    color: "amber",
    timeOfDay: "07:00",
    weekdays: [],
    steps: [
      { name: "Drink a glass of water", minutes: 1 },
      { name: "Stretch", minutes: 5 },
      { name: "Make the bed", minutes: 2 },
      { name: "Plan the day", minutes: 5 },
    ],
  },
  {
    id: "wind-down",
    blurb: "Slow down screens and set up tomorrow for a better night.",
    name: "Evening wind-down",
    icon: "moon",
    color: "violet",
    timeOfDay: "21:30",
    weekdays: [],
    steps: [
      { name: "Tidy up", minutes: 10 },
      { name: "Lay out tomorrow’s things", minutes: 3 },
      { name: "Journal", minutes: 5 },
      { name: "Read", minutes: 15 },
    ],
  },
  {
    id: "workday-start",
    blurb: "Know your priorities before the inbox decides them.",
    name: "Start the workday",
    icon: "briefcase",
    color: "blue",
    timeOfDay: "09:00",
    weekdays: WEEKDAYS_ONLY,
    steps: [
      { name: "Check today’s calendar", minutes: 5 },
      { name: "Pick the top three tasks", minutes: 5 },
      { name: "Clear the inbox", minutes: 15 },
    ],
  },
  {
    id: "weekly-reset",
    blurb: "An hour on Sunday so the week starts clean.",
    name: "Weekly reset",
    icon: "leaf",
    color: "teal",
    timeOfDay: "17:00",
    weekdays: ["sun"],
    steps: [
      { name: "Review the week", minutes: 15 },
      { name: "Plan meals and shopping", minutes: 15 },
      { name: "Do the laundry", minutes: 30 },
      { name: "Reset the home", minutes: 20 },
    ],
  },
];

/** The New habit form, filled from a template. */
export function habitTemplateValues(
  template: HabitTemplate,
  today: string,
  timeZone: string,
): HabitFormValues {
  return { ...newHabitValues(today, timeZone), ...template.fields };
}

/** The New routine form, filled from a template. */
export function routineTemplateValues(
  template: RoutineTemplate,
  timeZone: string,
): RoutineFormValues {
  return {
    ...newRoutineValues(timeZone),
    name: template.name,
    icon: template.icon,
    color: template.color,
    timeOfDay: template.timeOfDay,
    weekdays: template.weekdays,
    steps: template.steps.map((step) => ({
      id: "",
      name: step.name,
      duration: String(step.minutes),
      habitId: "",
    })),
  };
}

/** "8 glasses · Every day", "Work out: 3 times a week". */
export function describeHabitTemplate(template: HabitTemplate): string {
  const values = habitTemplateValues(template, "2000-01-01", "UTC");
  const target = describeTarget({
    kind: values.kind,
    target: values.target ? Number(values.target) : null,
    unit: values.unit,
  });
  return [target, describeSchedule(toSchedule(values))].filter(Boolean).join(" · ");
}

/** "4 steps · 13 min". */
export function describeRoutineTemplate(template: RoutineTemplate): string {
  const minutes = template.steps.reduce((sum, step) => sum + step.minutes, 0);
  return `${template.steps.length} steps · ${formatMinutes(minutes)}`;
}

/** The starter picks offered when someone has no habits yet. */
export const STARTER_TEMPLATE_IDS: readonly string[] = ["drink-water", "read", "meditate"];
