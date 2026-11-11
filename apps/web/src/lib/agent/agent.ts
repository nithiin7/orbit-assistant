/**
 * The agent and automation area: labels, where each tab lives in the URL, how triggers and
 * statuses read, workflow templates, and the workflow form's values and validation.
 */

import type {
  Agent,
  AgentApprovalStatus,
  AgentAutonomy,
  AgentCompareOp,
  AgentConditionMetric,
  AgentEventKind,
  AgentExecution,
  AgentExecutionStatus,
  AgentLimits,
  AgentMemorySettings,
  AgentModule,
  AgentMonitorCategory,
  AgentMonitorFrequency,
  AgentMonitorSettings,
  AgentNotificationSettings,
  AgentScheduleFrequency,
  AgentStepKind,
  AgentStepStatus,
  AgentTool,
  AgentToolMode,
  AgentTrigger,
  AgentTriggerKind,
  AgentWorkflow,
  AgentWorkflowRequest,
  AgentWorkflowStep,
  UpdateAgentRequest,
} from "@orbit/contracts";
import { array, boolean, mixed, number, object, string } from "yup";

import { multiLineText, singleLineText } from "@/utils/validation";

// Where things live

export const AGENT_TABS = [
  { value: "overview", label: "Home" },
  { value: "workflows", label: "Workflows" },
  { value: "approvals", label: "Approvals" },
  { value: "activity", label: "History" },
  { value: "settings", label: "Settings" },
] as const;

export type AgentTab = (typeof AGENT_TABS)[number]["value"];

export function parseAgentTab(value: string | null): AgentTab {
  // Templates used to have their own section; they now live with the workflows.
  if (value === "templates") return "workflows";
  return AGENT_TABS.find((tab) => tab.value === value)?.value ?? "overview";
}

export function automationHref(tab: AgentTab = "overview", params: Record<string, string> = {}) {
  const search = new URLSearchParams(tab === "overview" ? params : { tab, ...params });
  const query = search.toString();
  return query ? `/automation?${query}` : "/automation";
}

// Labels

export const AUTONOMY_LEVELS: readonly {
  value: AgentAutonomy;
  label: string;
  description: string;
}[] = [
  {
    value: "read_only",
    label: "Read only",
    description: "Looks things up. Never changes anything.",
  },
  {
    value: "suggest",
    label: "Suggest",
    description: "Prepares changes for you to make yourself.",
  },
  {
    value: "approval",
    label: "Ask first",
    description: "Asks you before every change.",
  },
  {
    value: "limited",
    label: "Limited autonomy",
    description: "Makes small changes you allow on its own. Asks for the rest.",
  },
];

export const MODULE_LABELS: Record<AgentModule, string> = {
  tasks: "Tasks",
  notes: "Notes",
  calendar: "Calendar",
  reminders: "Reminders & notifications",
  habits: "Habits",
  documents: "Documents",
  finance: "Finance (read only)",
  health: "Health",
  mail: "Email (read only)",
};

export const AGENT_MODULES: readonly AgentModule[] = [
  "tasks",
  "notes",
  "calendar",
  "reminders",
  "habits",
  "documents",
  "finance",
  "health",
  "mail",
];

export const SENSITIVE_MODULES: ReadonlySet<AgentModule> = new Set([
  "documents",
  "finance",
  "health",
  "mail",
]);

export const TRIGGER_LABELS: Record<AgentTriggerKind, string> = {
  manual: "Run by you",
  schedule: "Schedule",
  event: "Event",
  condition: "Condition",
  agent: "Started by the agent",
};

export const EXECUTION_STATUS_LABELS: Record<AgentExecutionStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  waiting_approval: "Needs approval",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const ACTIVE_STATUSES: ReadonlySet<AgentExecutionStatus> = new Set([
  "queued",
  "running",
  "waiting",
  "waiting_approval",
]);

export function hasActive(executions: readonly AgentExecution[]): boolean {
  return executions.some((execution) => ACTIVE_STATUSES.has(execution.status));
}

export const STEP_STATUS_LABELS: Record<AgentStepStatus, string> = {
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  skipped: "Skipped",
  waiting: "Waiting",
  rejected: "Rejected",
  suggested: "Suggested",
  denied: "Not allowed",
};

export const APPROVAL_STATUS_LABELS: Record<AgentApprovalStatus, string> = {
  pending: "Waiting for you",
  executing: "Running",
  executed: "Approved and done",
  rejected: "Rejected",
  expired: "Expired",
  cancelled: "Cancelled",
  failed: "Couldn’t run",
};

export const STEP_KINDS: readonly AgentStepKind[] = [
  "tool",
  "ai",
  "condition",
  "approval",
  "delay",
];

export const STEP_KIND_LABELS: Record<AgentStepKind, string> = {
  tool: "Action",
  condition: "Only continue if",
  delay: "Wait",
  approval: "Ask me first",
  ai: "Write with AI",
};

export const EVENT_LABELS: Record<AgentEventKind, string> = {
  task_created: "A task is created",
  task_completed: "A task is completed",
  reminder_triggered: "A reminder goes off",
  event_approaching: "A calendar event is coming up",
  document_expiring: "A document is about to expire",
  budget_threshold: "A budget alert is sent",
  habit_missed: "A habit was missed yesterday",
  external_event_changed: "An imported calendar event changes",
};

export const METRIC_LABELS: Record<AgentConditionMetric, string> = {
  overdue_tasks: "Overdue tasks",
  tasks_due_soon: "Tasks due soon",
  upcoming_payments: "Payments due soon",
  budget_used_percent: "Highest budget use (%)",
  documents_expiring: "Documents expiring soon",
  unread_notifications: "Unread notifications",
};

export const COMPARE_LABELS: Record<AgentCompareOp, string> = {
  eq: "is",
  ne: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
  not_contains: "doesn’t contain",
  exists: "has a value",
};

export const NUMERIC_OPS: readonly AgentCompareOp[] = ["gte", "gt", "lte", "lt", "eq", "ne"];

export const FREQUENCY_LABELS: Record<AgentScheduleFrequency, string> = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
  once: "Once",
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const MONITOR_CATEGORIES: readonly AgentMonitorCategory[] = [
  "overdue_tasks",
  "upcoming_deadlines",
  "calendar_conflicts",
  "upcoming_events",
  "upcoming_bills",
  "budget_warnings",
  "unusual_spending",
  "expiring_documents",
  "missing_document_details",
  "missed_habits",
  "workout_consistency",
];

export const MONITOR_LABELS: Record<AgentMonitorCategory, string> = {
  overdue_tasks: "Overdue tasks",
  upcoming_deadlines: "Upcoming deadlines",
  calendar_conflicts: "Calendar conflicts",
  upcoming_events: "Upcoming events",
  upcoming_bills: "Upcoming bills",
  budget_warnings: "Budget warnings",
  unusual_spending: "Unusual spending",
  expiring_documents: "Expiring documents",
  missing_document_details: "Documents missing details",
  missed_habits: "Missed habits",
  workout_consistency: "Workout consistency",
};

export const MONITOR_MODULE: Record<AgentMonitorCategory, AgentModule> = {
  overdue_tasks: "tasks",
  upcoming_deadlines: "tasks",
  calendar_conflicts: "calendar",
  upcoming_events: "calendar",
  upcoming_bills: "finance",
  budget_warnings: "finance",
  unusual_spending: "finance",
  expiring_documents: "documents",
  missing_document_details: "documents",
  missed_habits: "habits",
  workout_consistency: "health",
};

export const MONITOR_FREQUENCY_LABELS: Record<AgentMonitorFrequency, string> = {
  hourly: "Every hour",
  every_6_hours: "Every 6 hours",
  daily: "Once a day",
};

// Describing workflows

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function describeTrigger(trigger: AgentTrigger): string {
  switch (trigger.kind) {
    case "manual":
      return "When you run it";
    case "schedule": {
      const s = trigger.schedule;
      if (!s) return "On a schedule";
      const at = `at ${s.time}`;
      switch (s.frequency) {
        case "daily":
          return `Every day ${at}`;
        case "weekly":
          return `Every ${(s.weekdays ?? []).map((d) => WEEKDAYS[d] ?? "").join(", ")} ${at}`;
        case "monthly":
          return `Monthly on day ${s.day_of_month ?? 1} ${at}`;
        case "once":
          return `On ${s.on_date ?? "a date"} ${at}`;
      }
      return "On a schedule";
    }
    case "event":
      return trigger.event
        ? `When ${EVENT_LABELS[trigger.event.event].toLowerCase()}`
        : "On an event";
    case "condition": {
      const c = trigger.condition;
      return c
        ? `When ${METRIC_LABELS[c.metric].toLowerCase()} ${COMPARE_LABELS[c.op]} ${c.value}`
        : "When a condition is met";
    }
  }
}

export function formatDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const seconds = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`;
}

// Tool arguments

export type ArgumentField = {
  name: string;
  label: string;
  description: string;
  kind: "text" | "number" | "boolean" | "choice";
  options: readonly string[];
  required: boolean;
};

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function types(schema: Json): unknown[] {
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function kindOf(schema: Json): { kind: ArgumentField["kind"]; options: string[] } {
  const variants = Array.isArray(schema.anyOf) ? schema.anyOf.filter(isRecord) : [schema];
  for (const variant of variants) {
    if (Array.isArray(variant.enum)) return { kind: "choice", options: variant.enum.map(String) };
    const kinds = types(variant);
    if (kinds.includes("boolean")) return { kind: "boolean", options: [] };
    if (kinds.includes("integer") || kinds.includes("number"))
      return { kind: "number", options: [] };
    if (kinds.includes("string")) return { kind: "text", options: [] };
  }
  return { kind: "text", options: [] };
}

/** The flat fields of a tool's input schema, for the workflow editor. */
export function argumentFields(tool: AgentTool | undefined): ArgumentField[] {
  if (!tool) return [];
  const schema: Json = tool.input_schema;
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return Object.entries(properties).map(([name, raw]) => {
    const property = isRecord(raw) ? raw : {};
    const { kind, options } = kindOf(property);
    return {
      name,
      label: text(property.title) ?? name.replaceAll("_", " "),
      description: text(property.description) ?? "",
      kind,
      options,
      required: required.has(name),
    };
  });
}

const TEMPLATE = /^\{\{\s*[a-z0-9_.]+\s*\}\}$/;

/** A form value as the API takes it: numbers and booleans by type, placeholders as text. */
export function argumentValue(field: ArgumentField | undefined, raw: string) {
  const text = raw.trim();
  if (text === "") return undefined;
  if (TEMPLATE.test(text) || !field) return text;
  if (field.kind === "number" && /^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (field.kind === "boolean") return text === "true";
  return text;
}

// The workflow form

export type StepFormValues = {
  id: string;
  kind: AgentStepKind;
  title: string;
  tool: string;
  arguments: Record<string, string>;
  continueOnError: boolean;
  conditionLeft: string;
  conditionOp: AgentCompareOp;
  conditionRight: string;
  onFalse: string;
  minutes: number;
  prompt: string;
};

export type WorkflowFormValues = {
  name: string;
  description: string;
  enabled: boolean;
  triggerKind: AgentTrigger["kind"];
  frequency: AgentScheduleFrequency;
  time: string;
  timezone: string;
  weekdays: number[];
  dayOfMonth: number;
  onDate: string;
  event: AgentEventKind;
  leadMinutes: number;
  daysAhead: number;
  metric: AgentConditionMetric;
  metricOp: AgentCompareOp;
  metricValue: number;
  checkMinutes: number;
  steps: StepFormValues[];
};

export function newStep(kind: AgentStepKind, taken: readonly string[]): StepFormValues {
  let index = 1;
  while (taken.includes(`${kind}_${index}`)) index += 1;
  return {
    id: `${kind}_${index}`,
    kind,
    title: "",
    tool: "",
    arguments: {},
    continueOnError: false,
    conditionLeft: "",
    conditionOp: "gt",
    conditionRight: "0",
    onFalse: "end",
    minutes: 15,
    prompt: "",
  };
}

function stepValues(step: AgentWorkflowStep): StepFormValues {
  return {
    id: step.id,
    kind: step.kind,
    title: step.title,
    tool: step.tool ?? "",
    arguments: Object.fromEntries(
      Object.entries(step.arguments ?? {}).map(([key, value]) => [
        key,
        value === null ? "" : String(value),
      ]),
    ),
    continueOnError: step.continue_on_error,
    conditionLeft: step.condition?.left ?? "",
    conditionOp: step.condition?.op ?? "gt",
    conditionRight:
      step.condition?.right === null || step.condition?.right === undefined
        ? ""
        : String(step.condition.right),
    onFalse: step.on_false,
    minutes: step.minutes || 15,
    prompt: step.prompt,
  };
}

export function workflowFormValues(
  workflow: AgentWorkflowRequest | AgentWorkflow | null,
  timeZone: string,
): WorkflowFormValues {
  const trigger = workflow?.trigger;
  return {
    name: workflow?.name ?? "",
    description: workflow?.description ?? "",
    enabled: workflow?.enabled ?? true,
    triggerKind: trigger?.kind ?? "manual",
    frequency: trigger?.schedule?.frequency ?? "daily",
    time: trigger?.schedule?.time ?? "08:00",
    timezone: trigger?.schedule?.timezone ?? timeZone,
    weekdays: trigger?.schedule?.weekdays ?? [0],
    dayOfMonth: trigger?.schedule?.day_of_month ?? 1,
    onDate: trigger?.schedule?.on_date ?? "",
    event: trigger?.event?.event ?? "task_created",
    leadMinutes: trigger?.event?.lead_minutes ?? 60,
    daysAhead: trigger?.event?.days_ahead ?? trigger?.condition?.days_ahead ?? 30,
    metric: trigger?.condition?.metric ?? "overdue_tasks",
    metricOp: trigger?.condition?.op ?? "gte",
    metricValue: trigger?.condition?.value ?? 1,
    checkMinutes: trigger?.condition?.check_minutes ?? 60,
    steps: (workflow?.steps ?? []).map(stepValues),
  };
}

function triggerOf(values: WorkflowFormValues): AgentTrigger {
  switch (values.triggerKind) {
    case "manual":
      return { kind: "manual" };
    case "schedule":
      return {
        kind: "schedule",
        schedule: {
          frequency: values.frequency,
          time: values.time,
          timezone: values.timezone,
          weekdays: values.frequency === "weekly" ? values.weekdays : [],
          day_of_month: values.frequency === "monthly" ? values.dayOfMonth : null,
          on_date: values.frequency === "once" ? values.onDate || null : null,
        },
      };
    case "event":
      return {
        kind: "event",
        event: {
          event: values.event,
          lead_minutes: values.leadMinutes,
          days_ahead: values.daysAhead,
        },
      };
    case "condition": {
      return {
        kind: "condition",
        condition: {
          metric: values.metric,
          op: numericOp(values.metricOp),
          value: values.metricValue,
          check_minutes: values.checkMinutes,
          days_ahead: values.daysAhead,
        },
      };
    }
  }
}

type NumericOp = NonNullable<AgentTrigger["condition"]>["op"];

function numericOp(op: AgentCompareOp): NumericOp {
  switch (op) {
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "eq":
    case "ne":
      return op;
    default:
      return "gte";
  }
}

function conditionRight(raw: string): string | number | null {
  const text = raw.trim();
  if (text === "") return null;
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
}

/** The API's workflow from the form, with each tool's arguments typed by its schema. */
export function workflowRequest(
  values: WorkflowFormValues,
  tools: readonly AgentTool[],
): AgentWorkflowRequest {
  return {
    name: values.name,
    description: values.description,
    enabled: values.enabled,
    trigger: triggerOf(values),
    conditions: [],
    max_runs_per_day: 24,
    steps: values.steps.map((step): AgentWorkflowStep => {
      const fields = argumentFields(tools.find((tool) => tool.name === step.tool));
      const args: Record<string, string | number | boolean> = {};
      if (step.kind === "tool") {
        for (const [name, raw] of Object.entries(step.arguments)) {
          const value = argumentValue(
            fields.find((field) => field.name === name),
            raw,
          );
          if (value !== undefined) args[name] = value;
        }
      }
      return {
        id: step.id,
        kind: step.kind,
        title: step.title,
        tool: step.kind === "tool" ? step.tool : null,
        arguments: args,
        continue_on_error: step.continueOnError,
        condition:
          step.kind === "condition"
            ? {
                left: step.conditionLeft,
                op: step.conditionOp,
                right: step.conditionOp === "exists" ? null : conditionRight(step.conditionRight),
              }
            : null,
        on_false: step.kind === "condition" ? step.onFalse : "end",
        minutes: step.kind === "delay" ? step.minutes : 0,
        prompt: step.kind === "approval" || step.kind === "ai" ? step.prompt : "",
      };
    }),
  };
}

const STEP_ID = /^[a-z][a-z0-9_]{0,31}$/;

/** Mirrors the API's basic rules; the API checks references and tools on save. */
export const workflowSchema = object({
  name: singleLineText(100).required("Name the workflow."),
  description: singleLineText(500),
  enabled: boolean().defined(),
  triggerKind: mixed<AgentTrigger["kind"]>().defined(),
  frequency: mixed<AgentScheduleFrequency>().defined(),
  time: string()
    .defined()
    .when("triggerKind", {
      is: "schedule",
      then: (s) => s.matches(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, like 08:00."),
    }),
  timezone: string().defined(),
  weekdays: array(number().defined())
    .defined()
    .when(["triggerKind", "frequency"], {
      is: (kind: string, frequency: string) => kind === "schedule" && frequency === "weekly",
      then: (s) => s.min(1, "Choose at least one day."),
    }),
  dayOfMonth: number().defined().min(1).max(31),
  onDate: string()
    .defined()
    .when(["triggerKind", "frequency"], {
      is: (kind: string, frequency: string) => kind === "schedule" && frequency === "once",
      then: (s) => s.required("Choose the date."),
    }),
  event: mixed<AgentEventKind>().defined(),
  leadMinutes: number().defined().min(5, "At least 5 minutes.").max(10080),
  daysAhead: number().defined().min(1, "At least 1 day.").max(365),
  metric: mixed<AgentConditionMetric>().defined(),
  metricOp: mixed<AgentCompareOp>().defined(),
  metricValue: number().typeError("Enter a number.").defined(),
  checkMinutes: number().defined().min(15, "At least 15 minutes.").max(1440),
  steps: array(
    object({
      id: string().defined().matches(STEP_ID, "Use lowercase letters, digits, and underscores."),
      kind: mixed<AgentStepKind>().defined(),
      title: singleLineText(200),
      tool: string()
        .defined()
        .when("kind", { is: "tool", then: (s) => s.required("Choose a tool.") }),
      arguments: mixed<Record<string, string>>().defined(),
      continueOnError: boolean().defined(),
      conditionLeft: string()
        .defined()
        .when("kind", { is: "condition", then: (s) => s.required("Choose what to check.") }),
      conditionOp: mixed<AgentCompareOp>().defined(),
      conditionRight: string().defined(),
      onFalse: string().defined(),
      minutes: number().defined().min(0).max(10080),
      prompt: multiLineText(4000).when("kind", {
        is: "ai",
        then: (s) => s.required("Write the instruction."),
      }),
    }),
  )
    .defined()
    .min(1, "Add at least one step.")
    .max(20, "A workflow can have up to 20 steps."),
});

export const goalSchema = object({
  goal: multiLineText(2000).required("Say what you’d like the agent to do."),
});

export const memorySchema = object({
  content: singleLineText(300).required("Write the preference."),
});

// Templates

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

// The settings form

export type AgentSettingsValues = {
  name: string;
  instructions: string;
  chatModel: string;
  autonomy: AgentAutonomy;
  modules: AgentModule[];
  canCreate: boolean;
  canUpdate: boolean;
  autonomousTriggers: AgentTriggerKind[];
  toolModes: Record<string, AgentToolMode | "">;
  limits: AgentLimits;
  memory: AgentMemorySettings;
  notifications: AgentNotificationSettings;
  monitoring: Required<AgentMonitorSettings>;
};

export function agentSettingsValues(agent: Agent): AgentSettingsValues {
  return {
    name: agent.name,
    instructions: agent.instructions,
    chatModel: agent.chat_model ?? "",
    autonomy: agent.autonomy,
    modules: [...agent.modules],
    canCreate: agent.action_types.includes("create"),
    canUpdate: agent.action_types.includes("update"),
    autonomousTriggers: [...agent.autonomous_triggers],
    toolModes: { ...agent.tool_modes },
    limits: { ...agent.limits },
    memory: { ...agent.memory },
    notifications: { ...agent.notifications },
    monitoring: { ...agent.monitoring, categories: [...(agent.monitoring.categories ?? [])] },
  };
}

export function agentSettingsRequest(values: AgentSettingsValues): UpdateAgentRequest {
  const toolModes: Record<string, AgentToolMode> = {};
  for (const [name, mode] of Object.entries(values.toolModes)) {
    if (mode !== "") toolModes[name] = mode;
  }
  return {
    name: values.name,
    instructions: values.instructions,
    chat_model: values.chatModel.trim() || null,
    autonomy: values.autonomy,
    modules: values.modules,
    action_types: [
      "read",
      ...(values.canCreate ? (["create"] as const) : []),
      ...(values.canUpdate ? (["update"] as const) : []),
    ],
    autonomous_triggers: values.autonomousTriggers,
    tool_modes: toolModes,
    limits: values.limits,
    memory: values.memory,
    notifications: values.notifications,
    monitoring: values.monitoring,
  };
}

function bounded(min: number, max: number) {
  return number()
    .typeError("Enter a number.")
    .integer("Use a whole number.")
    .min(min, `At least ${min}.`)
    .max(max, `At most ${max}.`)
    .defined();
}

/** Mirrors the API's limits for each setting. */
export const agentSettingsSchema = object({
  name: singleLineText(100).required("Name the agent."),
  instructions: multiLineText(2000),
  chatModel: singleLineText(200),
  autonomy: mixed<AgentAutonomy>().defined(),
  modules: array(mixed<AgentModule>().defined()).defined(),
  canCreate: boolean().defined(),
  canUpdate: boolean().defined(),
  autonomousTriggers: array(mixed<AgentTriggerKind>().defined()).defined(),
  toolModes: mixed<Record<string, AgentToolMode | "">>().defined(),
  limits: object({
    max_steps: bounded(1, 20),
    max_tool_calls: bounded(1, 40),
    timeout_seconds: bounded(30, 3600),
    max_tokens_per_run: bounded(1000, 500_000),
    max_runs_per_day: bounded(1, 1000),
    max_autonomous_actions_per_day: bounded(0, 200),
    approval_ttl_hours: bounded(1, 336),
    max_retries: bounded(0, 5),
  }),
  memory: object({
    preferences: boolean().defined(),
    conversation: boolean().defined(),
    workflow: boolean().defined(),
    retention_days: bounded(1, 3650),
  }),
  notifications: object({
    approvals: boolean().defined(),
    completed: boolean().defined(),
    failed: boolean().defined(),
    insights: boolean().defined(),
  }),
  monitoring: object({
    enabled: boolean().defined(),
    categories: array(mixed<AgentMonitorCategory>().defined()).defined(),
    frequency: mixed<AgentMonitorFrequency>().defined(),
    days_ahead: bounded(1, 30),
    document_days: bounded(1, 365),
    budget_percent: bounded(10, 200),
  }),
});
