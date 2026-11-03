/** Test data for the agent area, shared by the lib's and the components' tests. */

import type {
  Agent,
  AgentApproval,
  AgentExecution,
  AgentOverview,
  AgentTool,
} from "@orbit/contracts";

export function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "ag1",
    name: "Orbit agent",
    description: "",
    enabled: true,
    instructions: "",
    chat_model: null,
    autonomy: "approval",
    modules: ["tasks", "notes", "calendar", "reminders", "habits"],
    tool_modes: {},
    action_types: ["create", "read", "update"],
    autonomous_triggers: ["manual"],
    limits: {
      max_steps: 8,
      max_tool_calls: 12,
      timeout_seconds: 300,
      max_tokens_per_run: 20000,
      max_runs_per_day: 50,
      max_autonomous_actions_per_day: 10,
      approval_ttl_hours: 24,
      max_retries: 2,
    },
    memory: { preferences: true, conversation: true, workflow: true, retention_days: 90 },
    notifications: { approvals: true, completed: false, failed: true, insights: true },
    monitoring: {
      enabled: false,
      categories: ["overdue_tasks"],
      frequency: "daily",
      days_ahead: 3,
      document_days: 30,
      budget_percent: 80,
    },
    monitored_at: null,
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    ...overrides,
  };
}

export function execution(overrides: Partial<AgentExecution> = {}): AgentExecution {
  return {
    id: "e1",
    workflow_id: null,
    title: "Plan my week",
    trigger_kind: "manual",
    trigger_data: {},
    goal: "Plan my week",
    status: "succeeded",
    summary: "Here's your plan.",
    error: null,
    steps_taken: 2,
    tool_calls: 1,
    attempts: 1,
    input_tokens: 120,
    output_tokens: 30,
    cancel_requested: false,
    created_at: "2026-11-02T09:00:00Z",
    started_at: "2026-11-02T09:00:01Z",
    finished_at: "2026-11-02T09:00:09Z",
    resume_at: null,
    ...overrides,
  };
}

export function overview(overrides: Partial<AgentOverview> = {}): AgentOverview {
  return {
    agent: agent(),
    runtime: {
      server_enabled: true,
      storage_mode: "local",
      worker_embedded: true,
      poll_seconds: 15,
    },
    pending_approvals: 0,
    workflows: 0,
    enabled_workflows: 0,
    recent: [],
    ...overrides,
  };
}

export function approval(overrides: Partial<AgentApproval> = {}): AgentApproval {
  return {
    id: "ap1",
    execution_id: "e1",
    context: "Plan my week",
    tool: "create_task",
    arguments: { title: "Call the bank", priority: "none" },
    arguments_hash: "a".repeat(64),
    summary: "Create task “Call the bank”",
    reason: "You asked for a reminder task.",
    target: null,
    effect: "A new task is added.",
    risk: "low",
    status: "pending",
    from_untrusted_context: false,
    expires_at: "2026-11-03T09:00:00Z",
    created_at: "2026-11-02T09:00:00Z",
    decided_at: null,
    result: null,
    error: null,
    ...overrides,
  };
}

export function tool(
  name: string,
  input_schema: Record<string, unknown>,
  overrides: Partial<AgentTool> = {},
): AgentTool {
  return {
    name,
    title: name.replaceAll("_", " "),
    description: `${name} description`,
    module: "tasks",
    access: name.startsWith("search") ? "read" : "create",
    risk: "low",
    idempotent: name.startsWith("search"),
    approval: name.startsWith("search") ? "never" : "configurable",
    uses_ai: false,
    in_workflows: true,
    input_schema,
    output_schema: {},
    mode: null,
    outcome: "allow",
    reason: "",
    ...overrides,
  };
}
