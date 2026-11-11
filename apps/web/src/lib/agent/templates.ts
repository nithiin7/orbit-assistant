/** Workflow templates: the ready-made automations the gallery offers, and their helpers. */

import type {
  AgentModule,
  AgentTrigger,
  AgentWorkflowRequest,
  AgentWorkflowStep,
} from "@orbit/contracts";

export const TEMPLATE_CATEGORIES = [
  { id: "planning", label: "Plan your days" },
  { id: "tasks", label: "Stay on top of tasks" },
  { id: "money", label: "Money" },
  { id: "documents", label: "Documents" },
  { id: "wellbeing", label: "Habits and health" },
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]["id"];

export type WorkflowTemplate = {
  id: string;
  title: string;
  description: string;
  category: TemplateCategory;
  /** Modules the agent must be allowed to use for every step to run. */
  modules: readonly AgentModule[];
  workflow: (timeZone: string) => AgentWorkflowRequest;
};

export function findTemplate(id: string | null): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id);
}

/** The modules a template needs that the agent isn't allowed to use yet. */
export function missingModules(
  template: WorkflowTemplate,
  allowed: readonly AgentModule[],
): AgentModule[] {
  return template.modules.filter((module) => !allowed.includes(module));
}

function weeklyAt(weekday: number, time: string, timezone: string): AgentTrigger {
  return {
    kind: "schedule",
    schedule: {
      frequency: "weekly",
      time,
      timezone,
      weekdays: [weekday],
      day_of_month: null,
      on_date: null,
    },
  };
}

function step(
  partial: Partial<AgentWorkflowStep> & Pick<AgentWorkflowStep, "id" | "kind">,
): AgentWorkflowStep {
  return {
    title: "",
    tool: null,
    arguments: {},
    continue_on_error: false,
    condition: null,
    on_false: "end",
    minutes: 0,
    prompt: "",
    ...partial,
  };
}

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: "briefing",
    title: "Morning briefing",
    description: "Today’s tasks and events, summarized for you.",
    category: "planning",
    modules: ["tasks", "calendar", "reminders"],
    workflow: (timeZone) => ({
      name: "Morning briefing",
      description: "Today’s tasks and events, summarized.",
      enabled: true,
      trigger: {
        kind: "schedule",
        schedule: {
          frequency: "daily",
          time: "08:00",
          timezone: timeZone,
          weekdays: [],
          day_of_month: null,
          on_date: null,
        },
      },
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "tasks",
          kind: "tool",
          title: "Today’s tasks",
          tool: "search_tasks",
          arguments: { due_within_days: 0 },
        }),
        step({
          id: "calendar",
          kind: "tool",
          title: "Today’s events",
          tool: "search_calendar",
          arguments: { days_ahead: 0 },
        }),
        step({
          id: "brief",
          kind: "ai",
          title: "Write the briefing",
          prompt:
            "Write a short plan for today from {{steps.tasks.text}} and {{steps.calendar.text}}.",
        }),
        step({
          id: "tell",
          kind: "tool",
          title: "Send it to me",
          tool: "send_notification",
          arguments: { title: "Your day", body: "{{steps.brief.text}}" },
        }),
      ],
    }),
  },
  {
    id: "renewal",
    title: "Renewal reminders",
    description: "A renewal task 30 days before a document expires.",
    category: "documents",
    modules: ["documents", "tasks"],
    workflow: () => ({
      name: "Renew expiring documents",
      description: "A renewal task for each document about to expire.",
      enabled: true,
      trigger: {
        kind: "event",
        event: { event: "document_expiring", lead_minutes: 60, days_ahead: 30 },
      },
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "task",
          kind: "tool",
          title: "Create a renewal task",
          tool: "create_task",
          arguments: {
            title: "Renew {{trigger.title}}",
            due_date: "{{trigger.expiry_date}}",
            priority: "high",
          },
        }),
      ],
    }),
  },
  {
    id: "overdue",
    title: "Overdue nudge",
    description: "A nudge when three or more tasks are overdue.",
    category: "tasks",
    modules: ["tasks", "reminders"],
    workflow: () => ({
      name: "Overdue nudge",
      description: "A nudge when tasks pile up.",
      enabled: true,
      trigger: {
        kind: "condition",
        condition: {
          metric: "overdue_tasks",
          op: "gte",
          value: 3,
          check_minutes: 60,
          days_ahead: 7,
        },
      },
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "overdue",
          kind: "tool",
          title: "Find overdue tasks",
          tool: "search_tasks",
          arguments: { overdue_only: true },
        }),
        step({
          id: "tell",
          kind: "tool",
          title: "Notify me",
          tool: "send_notification",
          arguments: {
            title: "{{steps.overdue.count}} tasks are overdue",
            body: "{{steps.overdue.text}}",
          },
        }),
      ],
    }),
  },
  {
    id: "prep",
    title: "Meeting heads-up",
    description: "A heads-up an hour before each event.",
    category: "planning",
    modules: ["calendar", "reminders"],
    workflow: () => ({
      name: "Meeting heads-up",
      description: "A notification before events.",
      enabled: true,
      trigger: {
        kind: "event",
        event: { event: "event_approaching", lead_minutes: 60, days_ahead: 30 },
      },
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "tell",
          kind: "tool",
          title: "Notify me",
          tool: "send_notification",
          arguments: {
            title: "Coming up: {{trigger.title}}",
            body: "Starts in {{trigger.minutes_until}} minutes. {{trigger.location}}",
          },
        }),
      ],
    }),
  },
  {
    id: "week",
    title: "Plan the week",
    description: "The week’s tasks, events, and reminders, planned into a note.",
    category: "planning",
    modules: ["tasks", "calendar", "reminders", "notes"],
    workflow: (timeZone) => ({
      name: "Plan the week",
      description: "A weekly plan in Notes.",
      enabled: true,
      trigger: weeklyAt(6, "18:00", timeZone),
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "tasks",
          kind: "tool",
          title: "Tasks due this week",
          tool: "search_tasks",
          arguments: { due_within_days: 7, limit: 25 },
        }),
        step({
          id: "calendar",
          kind: "tool",
          title: "This week’s events",
          tool: "search_calendar",
          arguments: { days_ahead: 7 },
        }),
        step({
          id: "reminders",
          kind: "tool",
          title: "This week’s reminders",
          tool: "get_reminders",
          arguments: { days_ahead: 7 },
        }),
        step({
          id: "plan",
          kind: "ai",
          title: "Write the plan",
          prompt:
            "Plan my week day by day. Point out busy days and anything that clashes. Tasks: {{steps.tasks.text}} Events: {{steps.calendar.text}} Reminders: {{steps.reminders.text}}",
        }),
        step({
          id: "save",
          kind: "tool",
          title: "Save it to Notes",
          tool: "create_note",
          arguments: { title: "Week plan", text: "{{steps.plan.text}}" },
        }),
      ],
    }),
  },
  {
    id: "busy",
    title: "Busy-day triage",
    description: "What to do first when too much is due.",
    category: "tasks",
    modules: ["tasks", "reminders"],
    workflow: () => ({
      name: "Busy-day triage",
      description: "What to do first when too much is due.",
      enabled: true,
      trigger: {
        kind: "condition",
        condition: {
          metric: "tasks_due_soon",
          op: "gte",
          value: 5,
          check_minutes: 240,
          days_ahead: 1,
        },
      },
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "due",
          kind: "tool",
          title: "Tasks due by tomorrow",
          tool: "search_tasks",
          arguments: { due_within_days: 1, limit: 25 },
        }),
        step({
          id: "triage",
          kind: "ai",
          title: "Suggest an order",
          prompt:
            "These tasks are due by tomorrow: {{steps.due.text}} Suggest the three to do first and which could move later in the week. Keep it short.",
        }),
        step({
          id: "tell",
          kind: "tool",
          title: "Notify me",
          tool: "send_notification",
          arguments: { title: "Busy day ahead", body: "{{steps.triage.text}}" },
        }),
      ],
    }),
  },
  {
    id: "follow-up",
    title: "Interview follow-up",
    description: "A thank-you task after each completed interview.",
    category: "tasks",
    modules: ["tasks"],
    workflow: () => ({
      name: "Interview follow-up",
      description: "A thank-you task after each interview.",
      enabled: true,
      trigger: {
        kind: "event",
        event: { event: "task_completed", lead_minutes: 60, days_ahead: 30 },
      },
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "check",
          kind: "condition",
          title: "Was it an interview?",
          condition: { left: "trigger.title", op: "contains", right: "interview" },
          on_false: "end",
        }),
        step({
          id: "task",
          kind: "tool",
          title: "Add the follow-up",
          tool: "create_task",
          arguments: {
            title: "Send a thank-you note: {{trigger.title}}",
            priority: "medium",
          },
        }),
      ],
    }),
  },
  {
    id: "budget",
    title: "Budget watch",
    description: "What’s driving the spending when a budget runs high.",
    category: "money",
    modules: ["finance", "reminders"],
    workflow: () => ({
      name: "Budget watch",
      description: "What’s behind a budget alert.",
      enabled: true,
      trigger: {
        kind: "event",
        event: { event: "budget_threshold", lead_minutes: 60, days_ahead: 30 },
      },
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "spending",
          kind: "tool",
          title: "Recent transactions",
          tool: "get_transactions",
          arguments: { days_back: 30, limit: 50 },
        }),
        step({
          id: "explain",
          kind: "ai",
          title: "Explain the spending",
          prompt:
            "My “{{trigger.title}}” budget just passed {{trigger.threshold}}%. From these transactions, name the two or three biggest drivers and one easy way to slow down: {{steps.spending.text}}",
        }),
        step({
          id: "tell",
          kind: "tool",
          title: "Notify me",
          tool: "send_notification",
          arguments: {
            title: "{{trigger.title}} is at {{trigger.threshold}}%",
            body: "{{steps.explain.text}}",
          },
        }),
      ],
    }),
  },
  {
    id: "bills",
    title: "Bills due this week",
    description: "The loans, subscriptions, and bills due this week.",
    category: "money",
    modules: ["finance", "reminders"],
    workflow: (timeZone) => ({
      name: "Bills due this week",
      description: "A Monday list of what’s due.",
      enabled: true,
      trigger: weeklyAt(0, "09:00", timeZone),
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "payments",
          kind: "tool",
          title: "Payments due in 7 days",
          tool: "get_upcoming_payments",
          arguments: { days_ahead: 7 },
        }),
        step({
          id: "any",
          kind: "condition",
          title: "Is anything due?",
          condition: { left: "steps.payments.count", op: "gt", right: 0 },
          on_false: "end",
        }),
        step({
          id: "tell",
          kind: "tool",
          title: "Notify me",
          tool: "send_notification",
          arguments: {
            title: "{{steps.payments.count}} payments due this week",
            body: "{{steps.payments.text}}",
          },
        }),
      ],
    }),
  },
  {
    id: "month",
    title: "Monthly spending review",
    description: "Last month’s spending reviewed, then saved to Notes once you agree.",
    category: "money",
    modules: ["finance", "notes"],
    workflow: (timeZone) => ({
      name: "Monthly spending review",
      description: "Last month’s spending, reviewed.",
      enabled: true,
      trigger: {
        kind: "schedule",
        schedule: {
          frequency: "monthly",
          time: "09:00",
          timezone: timeZone,
          weekdays: [],
          day_of_month: 1,
          on_date: null,
        },
      },
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "summary",
          kind: "tool",
          title: "Last month’s summary",
          tool: "get_finance_summary",
          arguments: { period: "last_month" },
        }),
        step({
          id: "review",
          kind: "ai",
          title: "Write the review",
          prompt:
            "Review last month’s spending: what went up, what went down, and one thing to try this month. {{steps.summary.text}}",
        }),
        step({
          id: "confirm",
          kind: "approval",
          title: "Check with me",
          prompt: "Save last month’s spending review to Notes?",
        }),
        step({
          id: "save",
          kind: "tool",
          title: "Save it to Notes",
          tool: "create_note",
          arguments: { title: "Spending review", text: "{{steps.review.text}}" },
        }),
      ],
    }),
  },
  {
    id: "expiring",
    title: "Expiring documents digest",
    description: "Documents expiring in the next 60 days.",
    category: "documents",
    modules: ["documents", "reminders"],
    workflow: (timeZone) => ({
      name: "Expiring documents digest",
      description: "A monthly look at what’s expiring.",
      enabled: true,
      trigger: {
        kind: "schedule",
        schedule: {
          frequency: "monthly",
          time: "09:00",
          timezone: timeZone,
          weekdays: [],
          day_of_month: 1,
          on_date: null,
        },
      },
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "find",
          kind: "tool",
          title: "Documents expiring soon",
          tool: "search_documents",
          arguments: { expiring_within_days: 60, limit: 25 },
        }),
        step({
          id: "any",
          kind: "condition",
          title: "Is anything expiring?",
          condition: { left: "steps.find.count", op: "gt", right: 0 },
          on_false: "end",
        }),
        step({
          id: "tell",
          kind: "tool",
          title: "Notify me",
          tool: "send_notification",
          arguments: {
            title: "{{steps.find.count}} documents expire within 60 days",
            body: "{{steps.find.text}}",
          },
        }),
      ],
    }),
  },
  {
    id: "habit",
    title: "Back on track",
    description: "A kind nudge and one small step after a missed habit.",
    category: "wellbeing",
    modules: ["habits", "reminders"],
    workflow: () => ({
      name: "Back on track",
      description: "A nudge after a missed habit.",
      enabled: true,
      trigger: {
        kind: "event",
        event: { event: "habit_missed", lead_minutes: 60, days_ahead: 30 },
      },
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "progress",
          kind: "tool",
          title: "Habit progress",
          tool: "get_habit_progress",
        }),
        step({
          id: "nudge",
          kind: "ai",
          title: "Write a nudge",
          prompt:
            "I missed “{{trigger.title}}” yesterday. Using my progress, write one kind sentence and one small step for today: {{steps.progress.text}}",
        }),
        step({
          id: "tell",
          kind: "tool",
          title: "Notify me",
          tool: "send_notification",
          arguments: { title: "Back on track: {{trigger.title}}", body: "{{steps.nudge.text}}" },
        }),
      ],
    }),
  },
  {
    id: "fitness",
    title: "Weekly fitness recap",
    description: "The week’s workouts and health, in a short recap.",
    category: "wellbeing",
    modules: ["health", "reminders"],
    workflow: (timeZone) => ({
      name: "Weekly fitness recap",
      description: "The week’s workouts, recapped.",
      enabled: true,
      trigger: weeklyAt(6, "19:00", timeZone),
      conditions: [],
      max_runs_per_day: 24,
      steps: [
        step({
          id: "workouts",
          kind: "tool",
          title: "This week’s workouts",
          tool: "get_workout_history",
          arguments: { days_back: 7 },
        }),
        step({
          id: "health",
          kind: "tool",
          title: "Health summary",
          tool: "get_health_summary",
        }),
        step({
          id: "recap",
          kind: "ai",
          title: "Write the recap",
          prompt:
            "Recap my week in three short lines, with one suggestion for next week. Workouts: {{steps.workouts.text}} Health: {{steps.health.text}}",
        }),
        step({
          id: "tell",
          kind: "tool",
          title: "Notify me",
          tool: "send_notification",
          arguments: { title: "Your week in fitness", body: "{{steps.recap.text}}" },
        }),
      ],
    }),
  },
];

/** `Tue 4 Nov, 08:00` in the viewer's time zone. */
export function formatWhen(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}
