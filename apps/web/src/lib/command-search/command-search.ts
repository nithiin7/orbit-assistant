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
