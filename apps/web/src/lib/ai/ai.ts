import type {
  AiAssistKind,
  AiModel,
  AiModule,
  AiProcessing,
  AiProviderKind,
  AiRecordRef,
  AiResponseStyle,
} from "@orbit/contracts";
import { object, string } from "yup";

import { calendarHref } from "@/lib/calendar";
import { documentsHref } from "@/lib/documents";
import { financeViewHref } from "@/lib/finance-views";
import { fitnessHref } from "@/lib/fitness";
import { habitsHref } from "@/lib/habits";
import { notesHref } from "@/lib/notes";
import type { Option } from "@/utils/common";
import { singleLineText, tooLongMessage } from "@/utils/validation";

export const AI_MODULES: readonly { value: AiModule; label: string; sensitive: boolean }[] = [
  { value: "tasks", label: "Tasks", sensitive: false },
  { value: "notes", label: "Notes", sensitive: false },
  { value: "calendar", label: "Calendar", sensitive: false },
  { value: "reminders", label: "Reminders", sensitive: false },
  { value: "habits", label: "Habits and routines", sensitive: false },
  { value: "documents", label: "Documents", sensitive: true },
  { value: "finance", label: "Finance", sensitive: true },
  { value: "health", label: "Health and fitness", sensitive: true },
  { value: "watchlist", label: "Watchlist (for suggestions)", sensitive: false },
];

export const PROVIDER_KINDS: readonly {
  value: AiProviderKind;
  label: string;
  needsKey: boolean;
  needsUrl: boolean;
  hint: string;
}[] = [
  {
    value: "ollama",
    label: "Ollama (local)",
    needsKey: false,
    needsUrl: false,
    hint: "Runs models on your computer. Install Ollama, pull a model, and leave the address empty for http://localhost:11434.",
  },
  {
    value: "openai_compatible",
    label: "OpenAI-compatible server",
    needsKey: false,
    needsUrl: true,
    hint: "LM Studio, llama.cpp, vLLM, and similar servers, such as http://localhost:1234/v1.",
  },
  {
    value: "openai",
    label: "OpenAI",
    needsKey: true,
    needsUrl: false,
    hint: "Cloud. Create an API key at platform.openai.com.",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    needsKey: true,
    needsUrl: false,
    hint: "Cloud. Create an API key in the Anthropic Console. Anthropic has no embeddings; pick another provider for semantic search.",
  },
  {
    value: "gemini",
    label: "Google Gemini",
    needsKey: true,
    needsUrl: false,
    hint: "Cloud. Create an API key in Google AI Studio.",
  },
];

export const RESPONSE_STYLES: readonly { value: AiResponseStyle; label: string }[] = [
  { value: "concise", label: "Concise" },
  { value: "balanced", label: "Balanced" },
  { value: "detailed", label: "Detailed" },
];

export function processingLabel(processing: AiProcessing): string {
  return processing === "local" ? "On this device or network" : "Sent to a cloud provider";
}

/** Where a cited record opens. Summaries Orbit calculated open their module. */
export function recordHref(ref: AiRecordRef): string | null {
  const id = ref.id;
  switch (ref.kind) {
    case "task":
      return id ? `/tasks?task=${encodeURIComponent(id)}` : "/tasks";
    case "tasks_summary":
      return "/tasks";
    case "note":
      return id ? notesHref({ noteId: id }) : "/notes";
    case "event":
    case "calendar_summary":
      return calendarHref({ view: "day", date: ref.day ?? undefined });
    case "document":
      return id ? documentsHref({ documentId: id }) : "/documents";
    case "habit":
      return id ? habitsHref({ kind: "habit", id }) : "/habits";
    case "reminder":
      return "/reminders";
    case "transaction":
    case "finance_summary":
      return financeViewHref("transactions");
    case "budget":
      return financeViewHref("budgets");
    case "loan":
      return financeViewHref("loans");
    case "subscription":
      return financeViewHref("subscriptions");
    case "bill":
      return financeViewHref("bills");
    case "workout":
      return id ? fitnessHref({ kind: "workout", id }) : "/health";
    case "health_summary":
      return "/health";
    default:
      return null;
  }
}

const KIND_LABELS: Record<string, string> = {
  task: "Task",
  tasks_summary: "Calculated by Orbit",
  note: "Note",
  event: "Event",
  calendar_summary: "Calculated by Orbit",
  document: "Document",
  habit: "Habit",
  reminder: "Reminder",
  transaction: "Transaction",
  finance_summary: "Calculated by Orbit",
  budget: "Budget",
  loan: "Loan",
  subscription: "Subscription",
  bill: "Bill",
  workout: "Workout",
  health_summary: "Calculated by Orbit",
};

export function recordKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Record";
}

/** Questions to start with, limited to modules the person lets AI read. */
export function suggestedQuestions(modules: readonly AiModule[]): string[] {
  const all: [AiModule, string][] = [
    ["calendar", "What do I have scheduled tomorrow?"],
    ["tasks", "What tasks are overdue?"],
    ["finance", "Summarize my spending this month."],
    ["finance", "Which subscriptions are due soon?"],
    ["notes", "Summarize my recent notes."],
    ["habits", "What habits have I been consistent with?"],
    ["health", "Give me an overview of my recent workouts."],
    ["documents", "Which documents expire soon?"],
    ["tasks", "What have I been working on recently?"],
  ];
  const allowed = new Set(modules);
  return all
    .filter(([module]) => allowed.has(module))
    .map(([, question]) => question)
    .slice(0, 4);
}

/** A chat model to pick in the composer: which provider serves it, and the model's name. */
export type ChatModelChoice = { providerId: string; model: string };

/** The picker value for a choice. Provider IDs are UUIDs, so the first "|" splits it again. */
export function chatModelValue(choice: ChatModelChoice): string {
  return `${choice.providerId}|${choice.model}`;
}

export function parseChatModelValue(value: string): ChatModelChoice | null {
  const split = value.indexOf("|");
  if (split <= 0 || split === value.length - 1) return null;
  return { providerId: value.slice(0, split), model: value.slice(split + 1) };
}

/**
 * Picker options: each provider's chat models (grouped by provider when there are several), with
 * the current model kept even when its provider can't list models.
 */
export function chatModelOptions(
  providers: readonly { id: string; name: string; models: readonly AiModel[] }[],
  current: ChatModelChoice | null,
): (Option<string> | { label: string; options: Option<string>[] })[] {
  const groups = providers
    .map((provider) => {
      const names = provider.models.filter((m) => m.chat).map((m) => m.id);
      if (current?.providerId === provider.id) names.unshift(current.model);
      const options = [...new Set(names)].map((model) => ({
        value: chatModelValue({ providerId: provider.id, model }),
        label: model,
      }));
      return { label: provider.name, options };
    })
    .filter((group) => group.options.length > 0);
  return groups.length === 1 ? (groups[0]?.options ?? []) : groups;
}

export type AssistAction = { kind: AiAssistKind; label: string; description: string };

/** Contextual AI actions for each place they appear. */
export const ASSIST_ACTIONS = {
  note: [
    { kind: "note_summary", label: "Summarize", description: "A short summary of this note." },
    { kind: "note_takeaways", label: "Key takeaways", description: "The main points as a list." },
    {
      kind: "note_action_items",
      label: "Extract tasks",
      description: "Action items as task drafts to approve.",
    },
    { kind: "note_tags", label: "Suggest tags", description: "Tags to add, after you approve." },
    {
      kind: "note_rewrite",
      label: "Improve writing",
      description: "A clearer version you can save as a new note.",
    },
    {
      kind: "related_notes",
      label: "Related notes",
      description: "Notes about similar things.",
    },
  ],
  document: [
    {
      kind: "document_summary",
      label: "Summarize",
      description: "What the document says, from its text.",
    },
    {
      kind: "document_extract",
      label: "Extract details",
      description: "Dates, provider, and numbers to fill in, after you approve.",
    },
  ],
  calendar: [
    {
      kind: "schedule_summary",
      label: "Summarize this week",
      description: "Commitments, busy days, and overlaps.",
    },
  ],
  finance: [
    {
      kind: "spending_summary",
      label: "Explain spending",
      description: "Patterns and changes this month.",
    },
    {
      kind: "budget_explain",
      label: "Explain budgets",
      description: "How each budget is doing.",
    },
    {
      kind: "commitments_summary",
      label: "Upcoming payments",
      description: "What's due and what needs attention.",
    },
    {
      kind: "transaction_categories",
      label: "Suggest categories",
      description: "For uncategorized expenses, with confidence.",
    },
  ],
  habits: [
    {
      kind: "habits_summary",
      label: "Summarize habits",
      description: "Consistency and patterns from your logs.",
    },
  ],
  health: [
    {
      kind: "health_summary",
      label: "Summarize trends",
      description: "Recorded workouts and measurements. Not medical advice.",
    },
  ],
} as const satisfies Record<string, readonly AssistAction[]>;

/** The `[S1]`-style citation markers in an answer, split out so they can be rendered as links. */
export type AnswerPart = { type: "text"; text: string } | { type: "cite"; numbers: number[] };

export function splitCitations(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const pattern = /\[(S\d{1,3}(?:\s*,\s*S?\d{1,3})*)\]/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ type: "text", text: text.slice(last, match.index) });
    const numbers = (match[1] ?? "").match(/\d+/g)?.map(Number) ?? [];
    parts.push({ type: "cite", numbers });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}

export const CONVERSATION_TITLE_MAX_LENGTH = 200;

export const conversationTitleSchema = object({
  title: singleLineText(CONVERSATION_TITLE_MAX_LENGTH).required("Enter a title."),
});

/** Mirrors the API: a provider name, an optional address, an optional key, and prices. */
export const providerSchema = object({
  name: singleLineText(100).required("Enter a name."),
  kind: string<AiProviderKind>().required(),
  base_url: string().trim().max(500, tooLongMessage(500)).default(""),
  api_key: string().trim().max(500, tooLongMessage(500)).default(""),
});
