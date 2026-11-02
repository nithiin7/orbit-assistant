import type { SearchHit, SearchModule } from "@orbit/contracts";

import { calendarHref } from "@/lib/calendar";
import { documentsHref } from "@/lib/documents";
import { financeViewHref } from "@/lib/finance-views";
import { habitsHref } from "@/lib/habits";
import { notesHref } from "@/lib/notes";
import { formatCalendarDate } from "@/utils/dates";

export type Searchable = {
  label: string;
  keywords?: readonly string[];
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Filters items whose label or keywords contain every whitespace-separated term in `query`.
 * Items whose label starts with the query rank first; otherwise the original order is kept.
 */
export function filterCommands<T extends Searchable>(items: readonly T[], query: string): T[] {
  const normalized = normalize(query);
  if (!normalized) return [...items];

  const terms = normalized.split(/\s+/);
  const matches = items.filter((item) => {
    const haystack = normalize([item.label, ...(item.keywords ?? [])].join(" "));
    return terms.every((term) => haystack.includes(term));
  });

  const prefixed = matches.filter((item) => normalize(item.label).startsWith(normalized));
  return [...prefixed, ...matches.filter((item) => !prefixed.includes(item))];
}

/** The palette group a module's search hits show under, in the order groups are listed. */
export const SEARCH_GROUP_LABELS: Record<SearchModule, string> = {
  tasks: "Matching tasks",
  notes: "Matching notes",
  events: "Matching events",
  documents: "Matching documents",
  habits: "Matching habits",
  transactions: "Matching transactions",
};

/** Where a search hit opens: the record in its own module. */
export function searchHitHref(module: SearchModule, hit: SearchHit): string {
  switch (module) {
    case "tasks":
      return `/tasks?task=${encodeURIComponent(hit.id)}`;
    case "notes":
      return notesHref({ noteId: hit.id });
    case "events":
      return calendarHref({ view: "day", date: hit.day ?? undefined });
    case "documents":
      return documentsHref({ documentId: hit.id });
    case "habits":
      return habitsHref({ kind: "habit", id: hit.id });
    case "transactions":
      return financeViewHref("transactions");
  }
}

const TRANSACTION_TYPES: Record<string, string> = {
  income: "Income",
  expense: "Expense",
  refund: "Refund",
  transfer: "Transfer",
};

/** The line under a hit's title. Hits carry no amounts, so none is shown. */
export function describeSearchHit(module: SearchModule, hit: SearchHit): string {
  const date = hit.day ? formatCalendarDate(hit.day) : "";
  switch (module) {
    case "tasks":
      return hit.status === "completed" ? "Completed task" : date ? `Task · due ${date}` : "Task";
    case "notes":
      return hit.detail || (hit.status === "journal" ? `Journal · ${date}` : "Note");
    case "events":
      return [date, hit.detail].filter(Boolean).join(" · ") || "Event";
    case "documents":
      return hit.status === "archived" ? "Archived document" : "Document";
    case "habits":
      return hit.status === "active" ? "Habit" : `Habit · ${hit.status}`;
    case "transactions":
      return [TRANSACTION_TYPES[hit.status] ?? "Transaction", date].filter(Boolean).join(" · ");
  }
}
