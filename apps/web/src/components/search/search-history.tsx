"use client";

import type { RecentSearch, SavedSearch } from "@orbit/contracts";
import { Bookmark, Clock, MoreHorizontal, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { describeApiError } from "@/api/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { useSearchHistoryMutations } from "@/hooks/use-universal-search";
import { moduleLabel } from "@/lib/search";

type RecentSearchesProps = {
  searches: readonly RecentSearch[];
  onSearch: (query: string) => void;
};

/** The person's last searches here. Only searches they committed to are remembered. */
export function RecentSearches({ searches, onSearch }: RecentSearchesProps) {
  const { forget, clear } = useSearchHistoryMutations();
  if (searches.length === 0) return null;
  return (
    <section aria-labelledby="recent-searches" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="recent-searches" className="text-sm font-medium">
          Recent searches
        </h2>
        <Button variant="ghost" size="sm" onClick={() => clear.mutate()}>
          Clear history
        </Button>
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {searches.map((search) => (
          <li key={search.id} className="flex items-center gap-2 px-3 py-1.5">
            <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onSearch(search.query)}
              className="min-w-0 flex-1 truncate rounded-sm py-1 text-left text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {search.query}
            </button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove “${search.query}” from history`}
              onClick={() => forget.mutate(search.id)}
            >
              <X aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function filterSummary(search: SavedSearch): string {
  const parts: string[] = [];
  const modules = search.filters.module ?? [];
  if (modules.length === 1 && modules[0]) parts.push(moduleLabel(modules[0]));
  if (search.filters.date_from || search.filters.date_to) parts.push("dates");
  if (search.filters.include_archived) parts.push("archived");
  return parts.length ? `“${search.query}” · ${parts.join(", ")}` : `“${search.query}”`;
}

type SavedSearchesProps = {
  searches: readonly SavedSearch[];
  onOpen: (search: SavedSearch) => void;
};

/** Named searches with their filters: open, rename, or delete. */
export function SavedSearches({ searches, onOpen }: SavedSearchesProps) {
  const { update, remove } = useSearchHistoryMutations();
  const [renaming, setRenaming] = useState<SavedSearch | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<SavedSearch | null>(null);

  if (searches.length === 0) return null;

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (!renaming || !name.trim()) return;
    update.mutate(
      { id: renaming.id, body: { name: name.trim() } },
      {
        onSuccess: () => setRenaming(null),
        onError: (failure) => setError(describeApiError(failure, "Couldn’t rename the search.")),
      },
    );
  };

  return (
    <section aria-labelledby="saved-searches" className="space-y-2">
      <h2 id="saved-searches" className="text-sm font-medium">
        Saved searches
      </h2>
      <ul className="divide-y rounded-xl border bg-card">
        {searches.map((search) => (
          <li key={search.id} className="flex items-center gap-2 px-3 py-1.5">
            <Bookmark className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {renaming?.id === search.id ? (
              <form onSubmit={submitRename} className="flex min-w-0 flex-1 items-center gap-2">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-label="Saved search name"
                  maxLength={100}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setRenaming(null);
                  }}
                />
                <Button type="submit" size="sm" disabled={update.isPending}>
                  Rename
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => onOpen(search)}
                className="min-w-0 flex-1 rounded-sm py-1 text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block truncate text-sm font-medium">{search.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {filterSummary(search)}
                </span>
              </button>
            )}
            <Menu
              variant="ghost"
              size="icon"
              chevron={false}
              align="end"
              aria-label={`Actions for ${search.name}`}
              items={[
                {
                  id: "rename",
                  label: "Rename",
                  onSelect: () => {
                    setRenaming(search);
                    setName(search.name);
                    setError("");
                  },
                },
                {
                  id: "delete",
                  label: "Delete",
                  destructive: true,
                  onSelect: () => setDeleting(search),
                },
              ]}
            >
              <MoreHorizontal aria-hidden="true" />
            </Menu>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          description="The saved search is removed. Your records aren’t affected."
          confirmLabel="Delete"
          destructive
          onClose={(confirmed) => {
            if (confirmed) remove.mutate(deleting);
            setDeleting(null);
          }}
        />
      ) : null}
    </section>
  );
}

type SaveSearchFormProps = {
  onSave: (name: string) => Promise<unknown>;
  onCancel: () => void;
};

/** Names the current search and its filters. */
export function SaveSearchForm({ onSave, onCancel }: SaveSearchFormProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Give the search a name.");
      return;
    }
    setSaving(true);
    onSave(name.trim()).then(
      () => setSaving(false),
      (failure: unknown) => {
        setSaving(false);
        setError(describeApiError(failure, "Couldn’t save the search."));
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      aria-label="Save search"
      className="flex flex-wrap items-start gap-2 rounded-xl border bg-card p-3"
    >
      <div className="min-w-48 flex-1 space-y-1">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Name"
          placeholder="Name this search"
          maxLength={100}
          autoFocus
          aria-invalid={error ? true : undefined}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
        />
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={saving}>
        Save
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
