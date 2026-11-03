"use client";

import type { SavedSearch, UniversalSearchHit } from "@orbit/contracts";
import { Bookmark, RefreshCw, Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { SEARCH_MIN_LENGTH } from "@/api/search";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { useDocumentCategories } from "@/hooks/use-documents";
import {
  useDebounced,
  useRecentSearches,
  useSavedSearches,
  useSearchHistoryMutations,
  useUniversalSearch,
} from "@/hooks/use-universal-search";
import {
  activeFilterCount,
  clearFilters,
  fromFilters,
  parseSearchState,
  SEARCH_MODULES,
  SEARCH_PAGE_SIZE,
  searchHref,
  searchResultHref,
  type SearchState,
  toFilters,
  withModule,
} from "@/lib/search";
import { cn } from "@/utils/common";

import { SearchFilters } from "./search-filters";
import { RecentSearches, SavedSearches, SaveSearchForm } from "./search-history";
import { SearchResult } from "./search-result";

/**
 * Universal search: one field across every module, tabs per module with counts, filters that fit
 * the tab, ranked results that open in their own module, "Load more", and recent and saved
 * searches. The query, tab, and filters live in the URL, so a search can be shared or revisited.
 *
 * Keyboard: the field follows the combobox pattern. Arrow keys move through results, Enter
 * opens the highlighted one, and Escape clears the field.
 */
export function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const urlState = parseSearchState(params);
  const workspaceId = useActiveWorkspaceId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const [text, setText] = useState(urlState.q);
  const settled = useDebounced(text);
  // Back, forward, and links change the URL's query; follow them unless the URL is only
  // catching up with what was typed.
  const [seenQ, setSeenQ] = useState(urlState.q);
  if (urlState.q !== seenQ) {
    setSeenQ(urlState.q);
    if (urlState.q !== settled) setText(urlState.q);
  }

  const state: SearchState = { ...urlState, q: text };
  const navigate = (next: SearchState) => router.replace(searchHref(next), { scroll: false });

  // Keep the URL's query in step with the field once typing pauses.
  const settledHref = searchHref({ ...urlState, q: settled });
  const currentHref = searchHref(urlState);
  // Only a settled field writes: a search opened from history while typing was pending must
  // not be overwritten by the stale text.
  const typingSettled = settled === text;
  useEffect(() => {
    if (typingSettled && settledHref !== currentHref)
      router.replace(settledHref, { scroll: false });
  }, [typingSettled, settledHref, currentHref, router]);

  const search = useUniversalSearch(state, { limit: SEARCH_PAGE_SIZE });
  const recent = useRecentSearches();
  const saved = useSavedSearches();
  const history = useSearchHistoryMutations();
  const { categories } = useDocumentCategories(state.module === "documents" ? workspaceId : null);

  const [showFilters, setShowFilters] = useState(activeFilterCount(urlState) > 0);
  const [saving, setSaving] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // A new set of results starts with nothing highlighted.
  const resultsKey = `${search.query}|${currentHref}`;
  const [seenResults, setSeenResults] = useState(resultsKey);
  if (resultsKey !== seenResults) {
    setSeenResults(resultsKey);
    setActiveIndex(-1);
  }

  const hits = search.hits;
  const active = activeIndex < hits.length ? activeIndex : -1;
  const optionId = (hit: UniversalSearchHit) => `${listboxId}-${hit.entity_type}-${hit.id}`;
  const activeHit = active >= 0 ? hits[active] : undefined;

  useEffect(() => {
    if (activeHit)
      document.getElementById(optionId(activeHit))?.scrollIntoView({ block: "nearest" });
    // optionId only depends on the listbox ID and the hit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [activeHit]);

  const open = (hit: UniversalSearchHit) => {
    history.remember(text);
    router.push(searchResultHref(hit));
  };

  const runSearch = (query: string) => {
    setText(query);
    navigate({ ...urlState, q: query });
    history.remember(query);
    inputRef.current?.focus();
  };

  const openSaved = (savedSearch: SavedSearch) => {
    const next = fromFilters(savedSearch.query, savedSearch.filters);
    setText(next.q);
    setShowFilters(activeFilterCount(next) > 0);
    navigate(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = hits.length;
    if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault();
      setActiveIndex((active + 1) % count);
    } else if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault();
      setActiveIndex(active <= 0 ? count - 1 : active - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeHit) open(activeHit);
      else history.remember(text);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (text) setText("");
      else inputRef.current?.blur();
    }
  };

  const typed = text.trim();
  const tooShort = typed.length > 0 && typed.length < SEARCH_MIN_LENGTH;
  const searched = search.query !== "";
  const counts = new Map(search.facets.map((facet) => [facet.module, facet]));
  const allCount = search.facets.reduce((sum, facet) => sum + facet.total, 0);
  const filterCount = activeFilterCount(urlState);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search"
        description="Find anything across tasks, notes, calendar, reminders, finance, habits, documents, and your own health records."
        actions={
          <>
            <Button
              variant="ghost"
              aria-expanded={showFilters}
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal aria-hidden="true" />
              Filters{filterCount > 0 ? ` (${filterCount})` : ""}
            </Button>
            <Button
              variant="soft"
              disabled={typed.length < SEARCH_MIN_LENGTH}
              onClick={() => setSaving(true)}
            >
              <Bookmark aria-hidden="true" />
              Save search
            </Button>
          </>
        }
      />

      <div className="space-y-4">
        <div className="flex h-12 items-center gap-3 rounded-xl border bg-card px-4 shadow-elevation-1 focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search everything"
            aria-expanded={hits.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeHit ? optionId(activeHit) : undefined}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            maxLength={200}
            placeholder="Search everything…"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {text ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Clear search"
              onClick={() => {
                setText("");
                inputRef.current?.focus();
              }}
            >
              <X aria-hidden="true" />
            </Button>
          ) : (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move, <Kbd>↵</Kbd> to open
            </span>
          )}
        </div>

        {saving ? (
          <SaveSearchForm
            onCancel={() => setSaving(false)}
            onSave={(name) =>
              history.save
                .mutateAsync({ name, query: typed, filters: toFilters(urlState) })
                .then(() => setSaving(false))
            }
          />
        ) : null}

        <div role="group" aria-label="Modules" className="flex flex-wrap gap-1.5">
          {[{ value: null, label: "All" }, ...SEARCH_MODULES].map((tab) => {
            const selected = urlState.module === tab.value;
            const facet = tab.value ? counts.get(tab.value) : undefined;
            const count = tab.value === null ? allCount : facet?.total;
            return (
              <button
                key={tab.label}
                type="button"
                aria-pressed={selected}
                onClick={() => navigate(withModule(state, tab.value))}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent",
                )}
              >
                {tab.label}{" "}
                {searched && count !== undefined ? (
                  <span
                    className={cn("text-xs tabular-nums", !selected && "text-muted-foreground")}
                  >
                    {facet?.unavailable ? "–" : count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {showFilters ? (
          <SearchFilters state={state} categories={categories} onChange={navigate} />
        ) : null}
      </div>

      <p role="status" className="sr-only">
        {search.searching
          ? "Searching…"
          : searched
            ? `${search.total} ${search.total === 1 ? "result" : "results"}`
            : ""}
      </p>

      {search.unavailable.length > 0 && !search.failed ? (
        <p
          role="alert"
          className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        >
          Some modules couldn’t be searched just now (
          {search.unavailable
            .map((module) => SEARCH_MODULES.find((m) => m.value === module)?.label ?? module)
            .join(", ")}
          ). Other results are shown.
        </p>
      ) : null}

      {typed.length === 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <RecentSearches searches={recent.searches} onSearch={runSearch} />
          <SavedSearches searches={saved.searches} onOpen={openSaved} />
          {recent.searches.length === 0 && saved.searches.length === 0 ? (
            <div className="lg:col-span-2">
              <EmptyState
                icon={Search}
                title="Search everything"
                description="Type at least two characters. Results are ranked by where they match: titles first, then tags and details, then descriptions and text."
              />
            </div>
          ) : null}
        </div>
      ) : tooShort ? (
        <p className="text-sm text-muted-foreground">Type at least two characters to search.</p>
      ) : search.failed ? (
        <div role="alert" className="space-y-3 rounded-xl border p-6 text-center">
          <p className="text-sm">Couldn’t search just now.</p>
          <Button variant="outline" onClick={search.retry}>
            <RefreshCw aria-hidden="true" />
            Try again
          </Button>
        </div>
      ) : search.loading || !searched ? (
        <div aria-hidden="true" className="space-y-3">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-16 w-full" />
          ))}
        </div>
      ) : hits.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={`No results for “${search.query}”`}
          description={
            filterCount > 0 || urlState.module
              ? "Try another tab, or clear the filters."
              : "Check the spelling, or try fewer or shorter words."
          }
        >
          {filterCount > 0 ? (
            <Button variant="outline" onClick={() => navigate(clearFilters(state))}>
              Clear filters
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Showing {hits.length} of {search.total}
          </p>
          <div
            id={listboxId}
            role="listbox"
            aria-label="Search results"
            className={cn("space-y-1", search.searching && !search.loadingMore && "opacity-70")}
          >
            {hits.map((hit, index) => (
              <SearchResult
                key={`${hit.entity_type}-${hit.id}`}
                id={optionId(hit)}
                hit={hit}
                query={search.query}
                active={index === active}
                showModule={urlState.module === null}
                onOpen={() => open(hit)}
                onPoint={() => setActiveIndex(index)}
              />
            ))}
          </div>
          {search.hasMore ? (
            <div className="flex justify-center">
              <Button variant="outline" disabled={search.loadingMore} onClick={search.loadMore}>
                {search.loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
