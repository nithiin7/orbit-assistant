import type { AiSettings, Briefing, BriefingContent, BriefingTaskItem } from "@orbit/contracts";

/** A briefing fixture's date and time. */
export const BRIEFING_DAY = "2030-06-11";
export const BRIEFING_AT = "2030-06-11T07:30:00Z";

const empty = { items: [], total: 0 };

/** An empty briefing snapshot; pass the sections a test needs. */
export function briefingContent(overrides: Partial<BriefingContent> = {}): BriefingContent {
  return {
    window: {
      date: BRIEFING_DAY,
      timezone: "UTC",
      start: `${BRIEFING_DAY}T00:00:00Z`,
      end: "2030-06-12T00:00:00Z",
    },
    horizon_days: 7,
    summary: {
      events: 0,
      conflicts: 0,
      tasks_overdue: 0,
      tasks_due_today: 0,
      reminders_due: 0,
      payments_overdue: 0,
      payments_due: 0,
      budgets_exceeded: 0,
      budgets_approaching: 0,
      habits_remaining: 0,
      habits_done: 0,
      workouts: 0,
      attention: [],
    },
    sources: [],
    schedule: { events: [], time_blocks: [], conflicts: [], upcoming: [] },
    tasks: { overdue: empty, due_today: empty, high_priority: empty, completed: empty },
    deadlines: { tasks: empty, savings_goals: [] },
    reminders: { items: [], represented_elsewhere: 0 },
    payments: { items: [], overdue: 0, due_today: 0, upcoming: 0 },
    budgets: { items: [], exceeded: 0, approaching: 0 },
    habits: { habits: [], remaining: 0, done: 0 },
    routines: { routines: [] },
    health: { workouts: [], goals: [] },
    notes: { items: [] },
    documents: { items: [], expired: 0, expiring: 0 },
    shopping: { lists: [], needed: 0 },
    investments: { sips: [], deposits: [] },
    unavailable: [],
    ...overrides,
  };
}

export function briefingFixture(overrides: Partial<Briefing> = {}): Briefing {
  return {
    id: "b1",
    date: BRIEFING_DAY,
    timezone: "UTC",
    status: "complete",
    revision: 1,
    generated_at: BRIEFING_AT,
    created_at: BRIEFING_AT,
    content: briefingContent(),
    narrative: null,
    ...overrides,
  };
}

/** An overdue, high-priority task item. */
export const overdueTask: BriefingTaskItem = {
  ref: { module: "tasks", type: "task", id: "t1", occurrence: null, key: "task:t1" },
  title: "File taxes",
  priority: "high",
  due_date: "2030-06-09",
  completed_at: null,
  scheduled_start: null,
  scheduled_end: null,
  severity: "warning",
  reminder_at: null,
};

/** The tasks section with `overdueTask` overdue. */
export function withOverdueTask(): Partial<BriefingContent> {
  return {
    tasks: {
      overdue: { items: [overdueTask], total: 1 },
      due_today: empty,
      high_priority: empty,
      completed: empty,
    },
  };
}

/** AI settings: on with a local chat model, or (`enabled: false`) off. */
export function aiSettings(enabled: boolean): AiSettings {
  return {
    server_enabled: true,
    enabled,
    chat_provider_id: enabled ? "p1" : null,
    chat_model: enabled ? "llama3" : null,
    embedding_provider_id: null,
    embedding_model: null,
    fallback_provider_id: null,
    fallback_model: null,
    allow_cloud: false,
    modules: ["tasks", "notes", "calendar", "reminders", "habits"],
    response_style: "balanced",
    monthly_token_limit: null,
    indexing_enabled: true,
    auto_capture: false,
  };
}
