import type { UniversalSearchModule } from "@orbit/contracts";

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
export const SEARCH_GROUP_LABELS: Record<UniversalSearchModule, string> = {
  tasks: "Matching tasks",
  notes: "Matching notes",
  calendar: "Matching events",
  reminders: "Matching reminders",
  finance: "Matching finance records",
  habits: "Matching habits and routines",
  documents: "Matching documents",
  health: "Matching health records",
  watchlist: "Matching watchlist titles",
  bookmarks: "Matching saved links",
};
