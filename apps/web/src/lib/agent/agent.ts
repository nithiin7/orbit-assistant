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
  { value: "overview", label: "Overview" },
  { value: "workflows", label: "Workflows" },
  { value: "approvals", label: "Approvals" },
  { value: "activity", label: "Activity" },
  { value: "settings", label: "Settings" },
] as const;

export type AgentTab = (typeof AGENT_TABS)[number]["value"];

export function parseAgentTab(value: string | null): AgentTab {
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
    description: "Looks things up and answers. Never changes anything.",
  },
  {
    value: "suggest",
    label: "Suggest",
    description: "Prepares actions for you to do yourself. Never runs them.",
  },
  {
    value: "approval",
    label: "Ask first",
    description: "Runs an action only after you approve that exact action.",
  },
  {
    value: "limited",
    label: "Limited autonomy",
    description:
      "Runs low-risk actions you allow on their own, within a daily limit. Everything else asks.",
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
  "condition",
  "delay",
  "approval",
  "ai",
];

export const STEP_KIND_LABELS: Record<AgentStepKind, string> = {
  tool: "Use a tool",
  condition: "Check a condition",
  delay: "Wait",
  approval: "Ask for approval",
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

/** Whether the workflow needs Orbit (the API or a worker) running to start on its own. */
export function runsOnItsOwn(trigger: AgentTrigger): boolean {
  return trigger.kind !== "manual";
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

export type WorkflowTemplate = {
  id: string;
  title: string;
  description: string;
  workflow: (timeZone: string) => AgentWorkflowRequest;
};

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
    description: "Every morning, today’s tasks and events summarized into a notification.",
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
    description: "When a document is 30 days from expiring, propose a task to renew it.",
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
    description: "When three or more tasks are overdue, send a notification listing them.",
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
    description: "An hour before each timed event, a notification with its details.",
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
