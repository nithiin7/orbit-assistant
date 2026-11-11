"use client";

import type { CreateWatchItemRequest, WatchItem, WatchSuggestion } from "@orbit/contracts";
import { Check, Loader2, Plus, RotateCw, Sparkles } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAiReady, usePickWatchSuggestions } from "@/hooks/use-ai";
import { useWatchlistLookup, useWatchSuggestions } from "@/hooks/use-watchlist";
import { processingLabel } from "@/lib/ai";
import { becauseLine, KIND_LABELS, type KindFilter, matchesKind } from "@/lib/watchlist";

import { LookupHint } from "./add-title-dialog";
import { SearchPoster } from "./poster";

const keyOf = (suggestion: WatchSuggestion) => `${suggestion.kind}:${suggestion.source_id}`;

/**
 * "For you": TMDB's recommendations for what's on the watchlist, and, with AI allowed to read
 * the watchlist, a few of them picked out with a reason each. Adding puts a title in Want to
 * watch.
 */
export function SuggestionsView({
  workspaceId,
  kind,
  kindFilter,
  onAdd,
  onOpen,
}: {
  workspaceId: string;
  kind: KindFilter;
  /** The type chips, shared with the other views. */
  kindFilter: ReactNode;
  onAdd: (body: CreateWatchItemRequest) => Promise<WatchItem>;
  onOpen: (itemId: string) => void;
}) {
  const id = useId();
  const { lookup } = useWatchlistLookup(workspaceId);
  const enabled = lookup?.enabled === true;
  const { suggestions, reload, isFetching } = useWatchSuggestions(workspaceId, enabled);
  const aiReady = useAiReady("watchlist");
  const pick = usePickWatchSuggestions(workspaceId);
  // Titles added from here, so their rows can open them instead.
  const [added, setAdded] = useState<ReadonlyMap<string, string>>(new Map());
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (lookup === null) return <ListSkeleton />;
  if (!enabled) {
    return (
      <div className="space-y-4">
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Suggestions come from TMDB’s recommendations for the titles you’ve added from a search, so
          they need title lookup.
        </p>
        <LookupHint configured={lookup.configured} />
      </div>
    );
  }

  async function add(suggestion: WatchSuggestion) {
    setError(null);
    setAdding(keyOf(suggestion));
    try {
      const item = await onAdd({
        kind: suggestion.kind,
        source_id: suggestion.source_id,
        status: "want",
        notes: "",
      });
      setAdded((current) => new Map(current).set(keyOf(suggestion), item.id));
    } catch (reason) {
      setError(describeApiError(reason, `Couldn’t add “${suggestion.title}”. Try again.`));
    }
    setAdding(null);
  }

  function row(suggestion: WatchSuggestion, reason?: string) {
    const key = keyOf(suggestion);
    return (
      <SuggestionRow
        key={key}
        workspaceId={workspaceId}
        suggestion={suggestion}
        reason={reason}
        addedId={added.get(key) ?? null}
        adding={adding === key}
        onAdd={() => void add(suggestion)}
        onOpen={onOpen}
      />
    );
  }

  const picks = (pick.data?.picks ?? []).filter((p) => matchesKind(p.suggestion, kind));
  const picked = new Set((pick.data?.picks ?? []).map((p) => keyOf(p.suggestion)));

  let list;
  if (suggestions.status === "loading") list = <ListSkeleton />;
  else if (suggestions.status === "error") {
    list = (
      <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
        <p>{suggestions.message}</p>
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          Try again
        </Button>
      </div>
    );
  } else if (suggestions.data.length === 0) {
    list = (
      <div className="rounded-xl border border-dashed px-4 py-10 text-center">
        <p className="text-sm font-medium">Nothing to suggest yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-pretty text-muted-foreground">
          Suggestions build on titles you add from a TMDB search. Add a few, and rate the ones you
          enjoyed.
        </p>
      </div>
    );
  } else {
    const shown = suggestions.data.filter(
      (suggestion) => matchesKind(suggestion, kind) && !picked.has(keyOf(suggestion)),
    );
    list =
      shown.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No {kind === "series" ? "series" : "movies"} to suggest right now.
        </p>
      ) : (
        <ul aria-labelledby={`${id}-more`} className="divide-y rounded-xl border bg-card">
          {shown.map((suggestion) => row(suggestion))}
        </ul>
      );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {kindFilter}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={isFetching}
            onClick={() => {
              pick.reset();
              void reload();
            }}
          >
            <RotateCw aria-hidden="true" className={isFetching ? "animate-spin" : undefined} />
            Refresh
          </Button>
          {aiReady ? (
            <Button
              variant="soft"
              size="sm"
              disabled={pick.isPending || suggestions.status !== "success"}
              onClick={() => pick.mutate()}
            >
              {pick.isPending ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              {pick.data ? "Pick again" : "Pick for me"}
            </Button>
          ) : null}
        </div>
      </div>

      <FormAlert message={error} />
      <FormAlert
        message={
          pick.error ? describeApiError(pick.error, "Couldn’t pick titles. Try again.") : null
        }
      />

      {pick.isPending ? (
        <section aria-busy="true" className="space-y-3">
          <h3 className="text-sm font-semibold">Picking for you…</h3>
          <ListSkeleton rows={3} />
        </section>
      ) : pick.data ? (
        <section aria-labelledby={`${id}-picks`} className="space-y-3">
          <div>
            <h3 id={`${id}-picks`} className="text-sm font-semibold">
              Picked for you
            </h3>
            <p className="text-xs text-pretty text-muted-foreground">
              Chosen by {pick.data.provider_name} ({processingLabel(pick.data.processing)}) from the
              suggestions below, by what you rated and watched.
            </p>
          </div>
          {picks.length > 0 ? (
            <ul className="divide-y rounded-xl border bg-brand-subtle/30">
              {picks.map((p) => row(p.suggestion, p.reason))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No picks of this type. Try another.
            </p>
          )}
        </section>
      ) : null}

      <section aria-labelledby={`${id}-more`} className="space-y-3">
        <h3 id={`${id}-more`} className="text-sm font-semibold">
          {pick.data ? "More suggestions" : "Based on your watchlist"}
        </h3>
        {list}
      </section>

      <p className="text-xs text-muted-foreground">
        Suggestions from TMDB. This product uses the TMDB API but is not endorsed or certified by
        TMDB.
      </p>
    </div>
  );
}

function SuggestionRow({
  workspaceId,
  suggestion,
  reason,
  addedId,
  adding,
  onAdd,
  onOpen,
}: {
  workspaceId: string;
  suggestion: WatchSuggestion;
  reason?: string;
  addedId: string | null;
  adding: boolean;
  onAdd: () => void;
  onOpen: (itemId: string) => void;
}) {
  const meta = [KIND_LABELS[suggestion.kind], suggestion.release_year].filter(Boolean).join(" · ");
  const because = becauseLine(suggestion.because);
  return (
    <li className="flex items-start gap-3 p-3">
      <SearchPoster
        workspaceId={workspaceId}
        path={suggestion.poster_path}
        title={suggestion.title}
        kind={suggestion.kind}
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{suggestion.title}</p>
        <p className="text-xs text-muted-foreground">{meta}</p>
        {reason ? <p className="text-sm text-pretty">{reason}</p> : null}
        {!reason && because ? <p className="text-xs text-brand">{because}</p> : null}
        {suggestion.overview ? (
          <p className="line-clamp-2 text-xs text-pretty text-muted-foreground/80">
            {suggestion.overview}
          </p>
        ) : null}
      </div>
      {addedId ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Added. Open “${suggestion.title}”`}
          onClick={() => onOpen(addedId)}
        >
          <Check aria-hidden="true" className="text-success" />
          Added
        </Button>
      ) : (
        <Button
          variant="soft"
          size="sm"
          disabled={adding}
          aria-label={`Add “${suggestion.title}” to Want to watch`}
          onClick={onAdd}
        >
          {adding ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          Add
        </Button>
      )}
    </li>
  );
}

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y rounded-xl border">
      <span className="sr-only">Loading suggestions…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-3 p-3">
          <Skeleton className="aspect-[2/3] w-11 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
