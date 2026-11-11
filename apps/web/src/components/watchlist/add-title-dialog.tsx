"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type {
  CreateWatchItemRequest,
  TitleMatch,
  WatchItem,
  WatchKind,
  WatchStatus,
} from "@orbit/contracts";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  PenLine,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, useId, useState } from "react";
import { useForm } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { useTitleSearch, useWatchlistLookup } from "@/hooks/use-watchlist";
import {
  ANY_LANGUAGE,
  KIND_LABELS,
  type KindFilter,
  languageName,
  manualTitleSchema,
  optionalNumber,
  SEARCH_LANGUAGES,
  STATUS_LABELS,
} from "@/lib/watchlist";
import { cn } from "@/utils/common";

import { ChoiceChips } from "./choice-chips";
import { SearchPoster } from "./poster";

const ADD_AS: readonly { value: WatchStatus; label: string }[] = [
  { value: "want", label: STATUS_LABELS.want },
  { value: "watching", label: STATUS_LABELS.watching },
  { value: "watched", label: STATUS_LABELS.watched },
];

const KINDS: readonly { value: WatchKind; label: string }[] = [
  { value: "movie", label: KIND_LABELS.movie },
  { value: "series", label: KIND_LABELS.series },
];

type AddTitleDialogProps = {
  workspaceId: string;
  /** Add a title; resolves with the new title. */
  onAdd: (body: CreateWatchItemRequest) => Promise<WatchItem>;
  /** Open a title that's already on the watchlist. */
  onOpen: (itemId: string) => void;
  /** Called once the dialog has closed. */
  onClose: () => void;
};

/**
 * Adds titles. With lookup on, it starts with a search: type, then Enter adds the highlighted
 * match, and the dialog stays open for more. Without lookup, or when nothing fits, a title is
 * entered by hand, starting from what was typed.
 */
export function AddTitleDialog({ workspaceId, onAdd, onOpen, onClose }: AddTitleDialogProps) {
  const id = useId();
  const { lookup } = useWatchlistLookup(workspaceId);
  // The title to enter by hand, or `null` while searching.
  const [manual, setManual] = useState<string | null>(null);
  const [addAs, setAddAs] = useState<WatchStatus>("want");
  const [busy, setBusy] = useState(false);
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !busy });

  const canSearch = lookup?.enabled === true;
  const searching = canSearch && manual === null;

  async function add(body: CreateWatchItemRequest) {
    setBusy(true);
    try {
      return await onAdd(body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[8vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <h2 id={`${id}-heading`} className="text-base font-semibold">
          Add to watchlist
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1.5 size-8"
          aria-label="Close"
          onClick={close}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      {lookup === null ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : searching ? (
        <TitleSearch
          workspaceId={workspaceId}
          addAs={addAs}
          onAddAs={setAddAs}
          onAdd={add}
          onOpen={(itemId) => {
            onOpen(itemId);
            close();
          }}
          onManual={(title) => setManual(title)}
        />
      ) : (
        <div className="space-y-5 p-5">
          {canSearch ? (
            <button
              type="button"
              onClick={() => setManual(null)}
              className="-mt-1 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to search
            </button>
          ) : (
            <LookupHint configured={lookup.configured} />
          )}
          <ManualTitleForm
            initialTitle={manual ?? ""}
            addAs={addAs}
            onAddAs={setAddAs}
            onAdd={async (body) => {
              await add(body);
              close();
            }}
            onCancel={close}
          />
        </div>
      )}
    </dialog>
  );
}

const SEARCH_KINDS: readonly { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "series", label: "Series" },
];

function TitleSearch({
  workspaceId,
  addAs,
  onAddAs,
  onAdd,
  onOpen,
  onManual,
}: {
  workspaceId: string;
  addAs: WatchStatus;
  onAddAs: (status: WatchStatus) => void;
  onAdd: (body: CreateWatchItemRequest) => Promise<WatchItem>;
  onOpen: (itemId: string) => void;
  onManual: (title: string) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Titles added while the dialog is open, by search result key.
  const [added, setAdded] = useState<ReadonlyMap<string, string>>(new Map());
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [language, setLanguage] = useState(ANY_LANGUAGE);
  const search = useTitleSearch(workspaceId, query, true, {
    kind,
    language: language === ANY_LANGUAGE ? null : language,
  });
  const results = search.data ?? [];
  const phrase = query.trim();

  const keyOf = (match: TitleMatch) => `${match.kind}:${match.source_id}`;
  const existingId = (match: TitleMatch) => added.get(keyOf(match)) ?? match.existing_id;

  async function choose(match: TitleMatch) {
    const existing = existingId(match);
    if (existing) {
      onOpen(existing);
      return;
    }
    setError(null);
    setAdding(keyOf(match));
    try {
      const item = await onAdd({
        kind: match.kind,
        source_id: match.source_id,
        status: addAs,
        notes: "",
      });
      setAdded((current) => new Map(current).set(keyOf(match), item.id));
    } catch (reason) {
      setError(describeApiError(reason, `Couldn’t add “${match.title}”. Try again.`));
    }
    setAdding(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const match = results[Math.min(active, results.length - 1)];
      if (match && adding === null) void choose(match);
    }
  }

  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));

  return (
    <>
      <div className="space-y-3 px-5 pt-4 pb-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            role="combobox"
            aria-label="Search movies and series"
            aria-expanded={results.length > 0}
            aria-controls={`${id}-results`}
            aria-activedescendant={results.length > 0 ? `${id}-result-${activeIndex}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            autoFocus
            placeholder="Search movies and series"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-12 rounded-xl pl-10 text-base"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ChoiceChips
            label="Search for"
            hideLabel
            size="sm"
            value={kind}
            options={SEARCH_KINDS}
            onChange={(next) => {
              setKind(next);
              setActive(0);
            }}
          />
          <Select
            aria-label="Original language"
            variant="ghost"
            className="w-auto"
            value={language}
            options={SEARCH_LANGUAGES}
            onValueChange={(next) => {
              setLanguage(next);
              setActive(0);
            }}
          />
        </div>
        <AddAsChips value={addAs} onChange={onAddAs} />
        <FormAlert message={error} />
      </div>

      <div className="max-h-[min(26rem,52vh)] overflow-y-auto border-t px-2 py-2">
        {!phrase ? (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-brand-subtle text-brand">
              <Search aria-hidden="true" className="size-4.5" />
            </span>
            <p className="text-sm font-medium">Find a movie or series</p>
            <p className="max-w-xs text-xs text-pretty text-muted-foreground">
              Posters, runtimes, and episode counts fill in for you. ↑ ↓ to move, Enter to add.
            </p>
          </div>
        ) : search.isPending ? (
          <ul aria-label="Searching" className="space-y-1">
            {[0, 1, 2].map((row) => (
              <li key={row} className="flex items-center gap-3 px-2.5 py-2">
                <Skeleton className="aspect-[2/3] w-11 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </li>
            ))}
          </ul>
        ) : search.isError ? (
          <p role="alert" className="px-4 py-8 text-center text-sm text-destructive">
            {describeApiError(search.error, "Couldn’t search right now. Try again.")}
          </p>
        ) : (
          <>
            {results.length === 0 ? (
              <p className="px-4 pt-6 pb-2 text-center text-sm text-muted-foreground">
                No matches for “{phrase}”
                {kind !== "all" || language !== ANY_LANGUAGE
                  ? ". Try another type or language."
                  : "."}
              </p>
            ) : (
              <ul id={`${id}-results`} role="listbox" aria-label="Matches" className="space-y-0.5">
                {results.map((match, index) => (
                  <ResultRow
                    key={keyOf(match)}
                    id={`${id}-result-${index}`}
                    workspaceId={workspaceId}
                    match={match}
                    active={index === activeIndex}
                    added={existingId(match) !== null}
                    adding={adding === keyOf(match)}
                    onHover={() => setActive(index)}
                    onChoose={() => adding === null && void choose(match)}
                  />
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => onManual(phrase)}
              className="mt-1 flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex aspect-[2/3] w-11 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                <PenLine aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">Add “{phrase}” by hand</span>
                <span className="block text-xs text-muted-foreground">
                  Not on TMDB? Enter the details yourself.
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
            </button>
          </>
        )}
      </div>

      <p className="border-t bg-muted/30 px-5 py-2.5 text-center text-[11px] text-muted-foreground">
        Details from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </>
  );
}

function ResultRow({
  id,
  workspaceId,
  match,
  active,
  added,
  adding,
  onHover,
  onChoose,
}: {
  id: string;
  workspaceId: string;
  match: TitleMatch;
  active: boolean;
  added: boolean;
  adding: boolean;
  onHover: () => void;
  onChoose: () => void;
}) {
  const meta = [
    KIND_LABELS[match.kind],
    match.release_year,
    match.original_language ? languageName(match.original_language) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onChoose}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <SearchPoster
        workspaceId={workspaceId}
        path={match.poster_path}
        title={match.title}
        kind={match.kind}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{match.title}</p>
        <p className="text-xs text-muted-foreground">{meta}</p>
        {match.overview ? (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/80">{match.overview}</p>
        ) : null}
      </div>
      {/* The whole row is the control; this shows its state. */}
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
          added
            ? "bg-success/15 text-success"
            : active
              ? "bg-brand text-brand-foreground"
              : "bg-brand-subtle text-brand",
        )}
      >
        {added ? (
          <Check aria-hidden="true" className="size-4" />
        ) : adding ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Plus aria-hidden="true" className="size-4" />
        )}
        <span className="sr-only">{added ? "Added" : adding ? "Adding" : "Add"}</span>
      </span>
    </li>
  );
}

function AddAsChips({
  value,
  onChange,
}: {
  value: WatchStatus;
  onChange: (status: WatchStatus) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs font-medium text-muted-foreground" aria-hidden="true">
        Add to
      </span>
      <ChoiceChips
        label="Add to"
        hideLabel
        size="sm"
        value={value}
        options={ADD_AS}
        onChange={onChange}
      />
    </div>
  );
}

export function LookupHint({ configured }: { configured: boolean }) {
  return (
    <Link
      href="/settings/watchlist"
      className="group flex items-center gap-3 rounded-xl border bg-brand-subtle/40 p-3 outline-none hover:bg-brand-subtle/70 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
        <Sparkles aria-hidden="true" className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {configured ? "Title lookup is off" : "Get posters and details automatically"}
        </span>
        <span className="block text-xs text-pretty text-muted-foreground">
          {configured
            ? "Turn it on in Settings → Watchlist to search TMDB."
            : "Add a free TMDB key in Settings → Watchlist."}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}

function ManualTitleForm({
  initialTitle,
  addAs,
  onAddAs,
  onAdd,
  onCancel,
}: {
  initialTitle: string;
  addAs: WatchStatus;
  onAddAs: (status: WatchStatus) => void;
  onAdd: (body: CreateWatchItemRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<WatchKind>("movie");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(manualTitleSchema),
    defaultValues: { title: initialTitle, year: "", platform: "" },
  });

  async function submit(values: InferType<typeof manualTitleSchema>) {
    try {
      await onAdd({
        kind,
        title: values.title,
        release_year: optionalNumber(values.year),
        platform: values.platform || null,
        status: addAs,
        notes: "",
      });
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t add the title. Try again."),
      });
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(submit)(event)} className="space-y-4">
      <FormField
        label="Title"
        autoComplete="off"
        autoFocus
        {...register("title")}
        error={errors.title?.message}
      />
      <ChoiceChips label="Type" value={kind} options={KINDS} onChange={setKind} />
      <ChoiceChips label="Add to" value={addAs} options={ADD_AS} onChange={onAddAs} />
      <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
        <FormField
          label="Year"
          inputMode="numeric"
          autoComplete="off"
          placeholder="2024"
          {...register("year")}
          error={errors.year?.message}
        />
        <FormField
          label="Where to watch"
          autoComplete="off"
          placeholder="Netflix, cinema, a friend’s DVD…"
          {...register("platform")}
          error={errors.platform?.message}
        />
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button variant="ghost" disabled={isSubmitting} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Adding…" : "Add to watchlist"}
        </Button>
      </div>
    </form>
  );
}
