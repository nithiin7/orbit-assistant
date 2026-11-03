import type {
  SearchEntityType,
  SearchFilters,
  SearchSort,
  UniversalSearchHit,
  UniversalSearchModule,
  UniversalSearchQuery,
} from "@orbit/contracts";

import { calendarHref } from "@/lib/calendar";
import { documentsHref } from "@/lib/documents";
import { financeViewHref } from "@/lib/finance-views";
import { fitnessHref } from "@/lib/fitness";
import { habitsHref } from "@/lib/habits";
import { notesHref } from "@/lib/notes";
import { formatCalendarDate } from "@/utils/dates";

/** The page's path. */
export const SEARCH_PATH = "/search";
/** Results per page on the search page. */
export const SEARCH_PAGE_SIZE = 20;

type Labelled<T extends string> = { value: T; label: string };

/** Modules in the API's fixed order, which is also the tab order. */
export const SEARCH_MODULES: readonly Labelled<UniversalSearchModule>[] = [
  { value: "tasks", label: "Tasks" },
  { value: "notes", label: "Notes" },
  { value: "calendar", label: "Calendar" },
  { value: "reminders", label: "Reminders" },
  { value: "finance", label: "Finance" },
  { value: "habits", label: "Habits" },
  { value: "documents", label: "Documents" },
  { value: "health", label: "Health" },
];

export const ENTITY_LABELS: Readonly<Record<SearchEntityType, string>> = {
  task: "Task",
  note: "Note",
  event: "Event",
  reminder: "Reminder",
  account: "Account",
  transaction: "Transaction",
  loan: "Loan",
  subscription: "Subscription",
  bill: "Bill",
  holding: "Holding",
  deposit: "Deposit",
  asset: "Asset",
  budget: "Budget",
  savings_goal: "Savings goal",
  habit: "Habit",
  routine: "Routine",
  document: "Document",
  exercise: "Exercise",
  workout: "Workout",
  workout_template: "Workout template",
  fitness_goal: "Fitness goal",
  measurement: "Body measurement",
};

export function moduleLabel(module: UniversalSearchModule): string {
  return SEARCH_MODULES.find((entry) => entry.value === module)?.label ?? module;
}

/** A hit's title, or a fallback for records that have none. */
export function hitTitle(hit: Pick<UniversalSearchHit, "title" | "entity_type">): string {
  if (hit.title.trim()) return hit.title;
  return hit.entity_type === "note" ? "Untitled note" : ENTITY_LABELS[hit.entity_type];
}

/**
 * Where a hit opens: the record in its own module, through the module's existing pages,
 * drawers, and dialogs. Finance records without their own page open their view.
 */
export function searchResultHref(
  hit: Pick<UniversalSearchHit, "entity_type" | "id" | "day">,
): string {
  const id = encodeURIComponent(hit.id);
  switch (hit.entity_type) {
    case "task":
      return `/tasks?task=${id}`;
    case "note":
      return notesHref({ noteId: hit.id });
    case "event":
      return calendarHref({ view: "day", date: hit.day ?? undefined });
    case "reminder":
      return `/reminders?reminder=${id}`;
    case "transaction":
      return `${financeViewHref("transactions")}&transaction=${id}`;
    case "account":
      return financeViewHref("accounts");
    case "loan":
      return financeViewHref("loans");
    case "subscription":
      return financeViewHref("subscriptions");
    case "bill":
      return financeViewHref("bills");
    case "holding":
    case "deposit":
      return financeViewHref("investments");
    case "asset":
      return financeViewHref("assets");
    case "budget":
      return financeViewHref("budgets");
    case "savings_goal":
      return financeViewHref("goals");
    case "habit":
      return habitsHref({ kind: "habit", id: hit.id });
    case "routine":
      return habitsHref({ kind: "routine", id: hit.id });
    case "document":
      return documentsHref({ documentId: hit.id });
    case "exercise":
      return fitnessHref({ kind: "exercise", id: hit.id });
    case "workout":
      return fitnessHref({ kind: "workout", id: hit.id });
    case "fitness_goal":
      return fitnessHref({ kind: "goal", id: hit.id });
    case "workout_template":
      return fitnessHref({ kind: "view", view: "templates" });
    case "measurement":
      return fitnessHref({ kind: "view", view: "body" });
  }
}

const DETAIL_LABELS: Readonly<Record<string, string>> = {
  account: "Account",
  category: "Category",
  folder: "Folder",
  task: "Task",
  event: "Event",
  lender: "Lender",
  provider: "Provider",
  institution: "Institution",
  symbol: "Symbol",
};

function humanize(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const INACTIVE_LABELS: Readonly<Partial<Record<string, string>>> = {
  completed: "Completed",
  archived: "Archived",
  cancelled: "Cancelled",
  closed: "Closed",
  paused: "Paused",
  abandoned: "Abandoned",
  matured: "Matured",
  disabled: "Off",
};

/** The short facts shown under a hit: its kind, date, and details, never amounts. */
export function describeHit(hit: UniversalSearchHit): string[] {
  const facts: string[] = [ENTITY_LABELS[hit.entity_type]];
  if (hit.entity_type === "transaction") facts.push(humanize(hit.status));
  if (!hit.active) facts.push(INACTIVE_LABELS[hit.status] ?? humanize(hit.status));
  if (hit.day) {
    const date = formatCalendarDate(hit.day);
    facts.push(hit.entity_type === "task" ? `Due ${date}` : date);
  }
  for (const { key, value } of hit.details) {
    if (key === "priority") facts.push(`${humanize(value)} priority`);
    else if (key === "repeats") facts.push("Repeats");
    else if (key === "enabled") continue;
    else if (key === "location") facts.push(value);
    else if (key in DETAIL_LABELS) facts.push(`${DETAIL_LABELS[key]}: ${value}`);
    else facts.push(humanize(value));
  }
  return facts;
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: "title",
  description: "description",
  content: "text",
  tags: "tags",
  folder: "folder",
  category: "category",
  location: "place",
  occurrence: "an occurrence",
  notes: "notes",
  file_name: "file name",
  issuer: "issuer",
  provider: "provider",
  steps: "steps",
  exercises: "exercises",
  instructions: "instructions",
  note: "note",
};

/** "Matched in tags and notes" for fields other than the title. */
export function matchedIn(fields: readonly string[]): string {
  const named = fields
    .filter((field) => field !== "title")
    .map((field) => FIELD_LABELS[field] ?? field.replaceAll("_", " "));
  if (named.length === 0) return "";
  return `Matched in ${named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`}`;
}

// Filters and the URL

export const TASK_STATUSES = [
  { value: "open", label: "Open" },
  { value: "completed", label: "Completed" },
] as const;

export const TASK_PRIORITIES = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "None" },
] as const;

export const TRANSACTION_TYPES = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "refund", label: "Refund" },
  { value: "transfer", label: "Transfer" },
] as const;

export const HABIT_KINDS = [
  { value: "boolean", label: "Yes or no" },
  { value: "numeric", label: "An amount" },
  { value: "duration", label: "Time spent" },
] as const;

export const SORTS: readonly Labelled<SearchSort>[] = [
  { value: "relevance", label: "Best match" },
  { value: "recent", label: "Recently updated" },
];

/** Everything the search page keeps in its address: the query, the module tab, and filters. */
export type SearchState = {
  q: string;
  module: UniversalSearchModule | null;
  dateFrom: string;
  dateTo: string;
  updatedFrom: string;
  updatedTo: string;
  taskStatus: NonNullable<SearchFilters["task_status"]> | null;
  taskPriority: NonNullable<SearchFilters["task_priority"]>;
  documentCategory: string | null;
  transactionType: NonNullable<SearchFilters["transaction_type"]>;
  habitKind: NonNullable<SearchFilters["habit_kind"]>;
  includeArchived: boolean;
  sort: SearchSort;
};

export const EMPTY_SEARCH: SearchState = {
  q: "",
  module: null,
  dateFrom: "",
  dateTo: "",
  updatedFrom: "",
  updatedTo: "",
  taskStatus: null,
  taskPriority: [],
  documentCategory: null,
  transactionType: [],
  habitKind: [],
  includeArchived: false,
  sort: "relevance",
};

/** The filters each module tab offers. Date and update ranges and archived apply everywhere. */
export type ModuleFilter =
  "taskStatus" | "taskPriority" | "documentCategory" | "transactionType" | "habitKind";

const MODULE_FILTERS: Readonly<Record<UniversalSearchModule, readonly ModuleFilter[]>> = {
  tasks: ["taskStatus", "taskPriority"],
  notes: [],
  calendar: [],
  reminders: [],
  finance: ["transactionType"],
  habits: ["habitKind"],
  documents: ["documentCategory"],
  health: [],
};

export function moduleFilters(module: UniversalSearchModule | null): readonly ModuleFilter[] {
  return module ? MODULE_FILTERS[module] : [];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function pick<T extends string>(options: readonly { value: T }[], value: string | null): T | null {
  return options.find((option) => option.value === value)?.value ?? null;
}

function pickAll<T extends string>(options: readonly { value: T }[], values: string[]): T[] {
  return options.filter((option) => values.includes(option.value)).map((option) => option.value);
}

function day(value: string | null): string {
  return value && DATE.test(value) ? value : "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The search page's state from its address. Unknown or malformed values are ignored, and
 * filters the chosen module doesn't offer are dropped, so a shared link can't show
 * irrelevant filters.
 */
export function parseSearchState(params: URLSearchParams): SearchState {
  const chosen = pick(SEARCH_MODULES, params.get("module"));
  const offered = moduleFilters(chosen);
  const category = params.get("category");
  return {
    q: (params.get("q") ?? "").slice(0, 200),
    module: chosen,
    dateFrom: day(params.get("from")),
    dateTo: day(params.get("to")),
    updatedFrom: day(params.get("updated_from")),
    updatedTo: day(params.get("updated_to")),
    taskStatus: offered.includes("taskStatus") ? pick(TASK_STATUSES, params.get("status")) : null,
    taskPriority: offered.includes("taskPriority")
      ? pickAll(TASK_PRIORITIES, params.getAll("priority"))
      : [],
    documentCategory:
      offered.includes("documentCategory") && category && UUID.test(category) ? category : null,
    transactionType: offered.includes("transactionType")
      ? pickAll(TRANSACTION_TYPES, params.getAll("transaction"))
      : [],
    habitKind: offered.includes("habitKind") ? pickAll(HABIT_KINDS, params.getAll("habit")) : [],
    includeArchived: params.get("archived") === "1",
    sort: pick(SORTS, params.get("sort")) ?? "relevance",
  };
}

/** The address of a search page state; defaults are left out. */
export function searchHref(state: Partial<SearchState>): string {
  const full = { ...EMPTY_SEARCH, ...state };
  const params = new URLSearchParams();
  if (full.q.trim()) params.set("q", full.q.trim());
  if (full.module) params.set("module", full.module);
  if (full.dateFrom) params.set("from", full.dateFrom);
  if (full.dateTo) params.set("to", full.dateTo);
  if (full.updatedFrom) params.set("updated_from", full.updatedFrom);
  if (full.updatedTo) params.set("updated_to", full.updatedTo);
  if (full.taskStatus) params.set("status", full.taskStatus);
  for (const priority of full.taskPriority) params.append("priority", priority);
  if (full.documentCategory) params.set("category", full.documentCategory);
  for (const type of full.transactionType) params.append("transaction", type);
  for (const kind of full.habitKind) params.append("habit", kind);
  if (full.includeArchived) params.set("archived", "1");
  if (full.sort !== "relevance") params.set("sort", full.sort);
  const query = params.toString();
  return query ? `${SEARCH_PATH}?${query}` : SEARCH_PATH;
}

/** Switching tabs keeps the query and the filters every module shares, and drops the rest. */
export function withModule(state: SearchState, module: UniversalSearchModule | null): SearchState {
  const offered = moduleFilters(module);
  return {
    ...state,
    module,
    taskStatus: offered.includes("taskStatus") ? state.taskStatus : null,
    taskPriority: offered.includes("taskPriority") ? state.taskPriority : [],
    documentCategory: offered.includes("documentCategory") ? state.documentCategory : null,
    transactionType: offered.includes("transactionType") ? state.transactionType : [],
    habitKind: offered.includes("habitKind") ? state.habitKind : [],
  };
}

/** How many filters are set, besides the module tab and sort. */
export function activeFilterCount(state: SearchState): number {
  return [
    state.dateFrom || state.dateTo,
    state.updatedFrom || state.updatedTo,
    state.taskStatus,
    state.taskPriority.length > 0,
    state.documentCategory,
    state.transactionType.length > 0,
    state.habitKind.length > 0,
    state.includeArchived,
  ].filter(Boolean).length;
}

/** Clears every filter, keeping the query, tab, and sort. */
export function clearFilters(state: SearchState): SearchState {
  return { ...EMPTY_SEARCH, q: state.q, module: state.module, sort: state.sort };
}

/** The filters in the API's shape, as searched and as saved. */
export function toFilters(state: SearchState): Required<SearchFilters> {
  return {
    module: state.module ? [state.module] : [],
    type: [],
    date_from: state.dateFrom || null,
    date_to: state.dateTo || null,
    updated_from: state.updatedFrom || null,
    updated_to: state.updatedTo || null,
    created_from: null,
    created_to: null,
    task_status: state.taskStatus,
    task_priority: state.taskPriority,
    document_category: state.documentCategory,
    transaction_type: state.transactionType,
    habit_kind: state.habitKind,
    include_archived: state.includeArchived,
    sort: state.sort,
  };
}

/** A saved search's query and filters as page state. */
export function fromFilters(q: string, filters: SearchFilters): SearchState {
  const chosen = filters.module?.length === 1 ? (filters.module[0] ?? null) : null;
  return withModule(
    {
      q,
      module: chosen,
      dateFrom: filters.date_from ?? "",
      dateTo: filters.date_to ?? "",
      updatedFrom: filters.updated_from ?? "",
      updatedTo: filters.updated_to ?? "",
      taskStatus: filters.task_status ?? null,
      taskPriority: filters.task_priority ?? [],
      documentCategory: filters.document_category ?? null,
      transactionType: filters.transaction_type ?? [],
      habitKind: filters.habit_kind ?? [],
      includeArchived: filters.include_archived,
      sort: filters.sort,
    },
    chosen,
  );
}

/**
 * The request for a state, without paging. Facets always cover every module, so the tab only
 * narrows which hits come back.
 */
export function toSearchQuery(state: SearchState): Omit<UniversalSearchQuery, "offset" | "limit"> {
  const filters = toFilters(state);
  return {
    q: state.q.trim(),
    module: filters.module,
    date_from: filters.date_from,
    date_to: filters.date_to,
    updated_from: filters.updated_from,
    updated_to: filters.updated_to,
    task_status: filters.task_status,
    task_priority: filters.task_priority,
    document_category: filters.document_category,
    transaction_type: filters.transaction_type,
    habit_kind: filters.habit_kind,
    include_archived: filters.include_archived,
    sort: filters.sort,
  };
}
