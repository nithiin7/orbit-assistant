"use client";

import type {
  CreateWatchItemRequest,
  UpdateWatchItemRequest,
  WatchItem,
  WatchStatus,
} from "@orbit/contracts";
import { Clapperboard, Dices, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { useCelebration } from "@/components/habits/celebration";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchlist, useWatchlistMutations } from "@/hooks/use-watchlist";
import {
  countByStatus,
  finishedCheer,
  type KindFilter,
  parseWatchView,
  platformsOf,
  sortOptions,
  STATUS_LABELS,
  titlesIn,
  type TitleSort,
  WATCH_VIEWS,
  watchlistHref,
  type WatchView,
} from "@/lib/watchlist";
import { useWorkspaces } from "@/providers/workspace";
import { isEditableTarget } from "@/utils/keyboard";

import { AddTitleDialog } from "./add-title-dialog";
import { ChoiceChips } from "./choice-chips";
import { SuggestionsView } from "./suggestions-view";
import { ContinueCard, type TitleActions, TitleCard } from "./title-card";
import { TitleSheet } from "./title-sheet";
import { TonightDialog } from "./tonight-dialog";
import { VIEW_ICONS, WatchlistNav } from "./watchlist-nav";

const ALL_PLATFORMS = "__all";

const KIND_FILTERS: readonly { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "series", label: "Series" },
];

const EMPTY_VIEWS: Record<WatchStatus, { title: string; description: string }> = {
  want: {
    title: "Nothing queued",
    description: "Add the next thing you want to see, and it waits here until movie night.",
  },
  watching: {
    title: "Nothing in progress",
    description: "Start something from Want to watch, and log episodes as you go.",
  },
  watched: {
    title: "Nothing watched yet",
    description: "Finished titles land here with your rating and notes.",
  },
  dropped: {
    title: "Nothing dropped",
    description: "Titles you stop partway through rest here until you pick them back up.",
  },
};

const DESCRIPTION =
  "Movies and series to watch, the ones you’re in the middle of, and what you thought of them.";

/** The Watchlist page for the active workspace. Remounts (and resets) when the workspace changes. */
export function WatchlistPanel() {
  const { state, refresh } = useWorkspaces();

  if (state.status === "error") {
    return (
      <Shell>
        <LoadError message={state.message} onRetry={refresh} />
      </Shell>
    );
  }
  if (state.status === "loading") {
    return (
      <Shell>
        <GridSkeleton />
      </Shell>
    );
  }
  return <WatchlistView key={state.active.id} workspaceId={state.active.id} />;
}

type Dialog = { kind: "add" } | { kind: "tonight" } | { kind: "title"; id: string };

function WatchlistView({ workspaceId }: { workspaceId: string }) {
  const { items, reload } = useWatchlist(workspaceId);
  const mutations = useWatchlistMutations(workspaceId);
  const { celebrate, celebration } = useCelebration();
  const { confirm, confirmDialog } = useConfirm();
  const params = useSearchParams();
  const router = useRouter();
  const view = parseWatchView(params);
  // Type and sort carry across views.
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<TitleSort>("default");
  const [platform, setPlatform] = useState(ALL_PLATFORMS);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // `?title=<id>` (from search) opens that title's sheet, once per link.
  const linked = params.get("title");
  const [openedLink, setOpenedLink] = useState<string | null>(null);
  if (linked !== openedLink) {
    setOpenedLink(linked);
    if (linked) setDialog({ kind: "title", id: linked });
  }
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // N opens "Add title", unless the user is typing somewhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target) || document.querySelector("dialog[open]")) return;
      if (event.key.toLowerCase() !== "n") return;
      event.preventDefault();
      setDialog({ kind: "add" });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function markPending(itemId: string, isPending: boolean) {
    setPending((current) => {
      const next = new Set(current);
      if (isPending) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  /** Run a change to one title, announcing it and cheering when it finishes the title. */
  async function change(
    item: WatchItem,
    run: () => Promise<WatchItem>,
    describe: (updated: WatchItem) => string,
    fallback: string,
  ): Promise<WatchItem> {
    setError(null);
    markPending(item.id, true);
    try {
      const updated = await run();
      setAnnouncement(describe(updated));
      if (updated.status === "watched" && item.status !== "watched") {
        celebrate(finishedCheer(updated));
      }
      return updated;
    } catch (reason) {
      setError(describeApiError(reason, fallback));
      throw reason;
    } finally {
      markPending(item.id, false);
    }
  }

  function update(item: WatchItem, changes: UpdateWatchItemRequest) {
    return change(
      item,
      () => mutations.update.mutateAsync({ item, changes }),
      (updated) =>
        changes.status
          ? `Moved “${updated.title}” to ${STATUS_LABELS[updated.status]}.`
          : `Saved “${updated.title}”.`,
      "Couldn’t update the title. Try again.",
    );
  }

  function nextEpisode(item: WatchItem) {
    return change(
      item,
      () => mutations.nextEpisode.mutateAsync(item),
      (updated) =>
        updated.progress
          ? `Logged season ${updated.progress.season}, episode ${updated.progress.episode} of “${updated.title}”.`
          : `Logged an episode of “${updated.title}”.`,
      "Couldn’t log the episode. Try again.",
    );
  }

  function remove(item: WatchItem) {
    void confirm({
      title: `Remove “${item.title}”?`,
      description: "Its rating, notes, and progress go with it.",
      confirmLabel: "Remove",
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      setError(null);
      markPending(item.id, true);
      try {
        await mutations.remove.mutateAsync(item);
        setDialog((current) =>
          current?.kind === "title" && current.id === item.id ? null : current,
        );
        setAnnouncement(`Removed “${item.title}”.`);
      } catch (reason) {
        setError(describeApiError(reason, "Couldn’t remove the title. Try again."));
      }
      markPending(item.id, false);
    });
  }

  const actions: TitleActions = {
    open: (item) => setDialog({ kind: "title", id: item.id }),
    setStatus: (item, status) => void update(item, { status }).catch(() => undefined),
    nextEpisode: (item) => void nextEpisode(item).catch(() => undefined),
    moveToTop: (item) =>
      void change(
        item,
        () => mutations.moveToTop.mutateAsync(item),
        (updated) => `“${updated.title}” is up next.`,
        "Couldn’t move the title. Try again.",
      ).catch(() => undefined),
    remove,
  };

  const headerActions = (
    <>
      <Button
        variant="soft"
        disabled={items.status !== "success" || items.data.length === 0}
        onClick={() => setDialog({ kind: "tonight" })}
      >
        <Dices aria-hidden="true" />
        Watch tonight
      </Button>
      <Button onClick={() => setDialog({ kind: "add" })}>
        <Plus aria-hidden="true" />
        Add title
      </Button>
    </>
  );

  const kindFilter = (
    <ChoiceChips
      label="Type"
      hideLabel
      size="sm"
      value={kind}
      options={KIND_FILTERS}
      onChange={setKind}
    />
  );

  async function add(body: CreateWatchItemRequest) {
    const item = await mutations.add.mutateAsync(body);
    setAnnouncement(`Added “${item.title}” to ${STATUS_LABELS[item.status]}.`);
    return item;
  }

  let body;
  if (items.status === "loading") body = <GridSkeleton />;
  else if (items.status === "error") {
    body = <LoadError message={items.message} onRetry={() => void reload()} />;
  } else if (items.data.length === 0) {
    body = (
      <EmptyState
        icon={Clapperboard}
        title="Start your watchlist"
        description="Save the movies and series people recommend, track episodes as you watch, and rate what you finish."
      >
        <Button onClick={() => setDialog({ kind: "add" })}>
          <Plus aria-hidden="true" />
          Add your first title
        </Button>
      </EmptyState>
    );
  } else if (view === "overview") {
    body = (
      <Overview
        workspaceId={workspaceId}
        items={items.data}
        kind={kind}
        kindFilter={kindFilter}
        actions={actions}
        pending={pending}
      />
    );
  } else if (view === "suggestions") {
    body = (
      <SuggestionsView
        workspaceId={workspaceId}
        kind={kind}
        kindFilter={kindFilter}
        onAdd={add}
        onOpen={(itemId) => setDialog({ kind: "title", id: itemId })}
      />
    );
  } else {
    const all = items.data;
    const platforms = platformsOf(all.filter((item) => item.status === view));
    const activePlatform = platforms.includes(platform) ? platform : ALL_PLATFORMS;
    const shown = titlesIn(all, view, {
      kind,
      platform: activePlatform === ALL_PLATFORMS ? null : activePlatform,
      sort,
    });
    const filtered = kind !== "all" || activePlatform !== ALL_PLATFORMS;

    body = (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {kindFilter}
          {platforms.length > 1 ? (
            <ChoiceChips
              label="Platform"
              hideLabel
              size="sm"
              value={activePlatform}
              onChange={setPlatform}
              options={[
                { value: ALL_PLATFORMS, label: "Everywhere" },
                ...platforms.map((name) => ({ value: name, label: name })),
              ]}
            />
          ) : null}
          <Select
            aria-label="Sort titles"
            variant="ghost"
            className="ml-auto w-auto"
            value={sort}
            onValueChange={setSort}
            options={sortOptions(view)}
          />
        </div>
        {shown.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-10 text-center">
            <p className="text-sm font-medium">
              {filtered ? "No titles match these filters" : EMPTY_VIEWS[view].title}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-pretty text-muted-foreground">
              {filtered ? "Try another type or platform." : EMPTY_VIEWS[view].description}
            </p>
          </div>
        ) : (
          <PosterGrid
            label={STATUS_LABELS[view]}
            workspaceId={workspaceId}
            items={shown}
            actions={actions}
            pending={pending}
            markFirst={view === "want" && !filtered && sort === "default"}
          />
        )}
      </div>
    );
  }

  const openItem =
    dialog?.kind === "title" && items.status === "success"
      ? (items.data.find((item) => item.id === dialog.id) ?? null)
      : null;

  return (
    <Shell
      view={view}
      counts={items.status === "success" ? countByStatus(items.data) : null}
      actions={headerActions}
    >
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <FormAlert message={error} />
      {body}

      {dialog?.kind === "add" ? (
        <AddTitleDialog
          workspaceId={workspaceId}
          onAdd={add}
          onOpen={(itemId) => setDialog({ kind: "title", id: itemId })}
          onClose={() => setDialog((current) => (current?.kind === "add" ? null : current))}
        />
      ) : null}
      {dialog?.kind === "tonight" && items.status === "success" ? (
        <TonightDialog
          workspaceId={workspaceId}
          items={items.data}
          onStart={async (item) => {
            if (item.status !== "watching") await update(item, { status: "watching" });
          }}
          onOpen={(item) => setDialog({ kind: "title", id: item.id })}
          onClose={() => setDialog((current) => (current?.kind === "tonight" ? null : current))}
        />
      ) : null}
      {openItem ? (
        <TitleSheet
          key={openItem.id}
          workspaceId={workspaceId}
          item={openItem}
          onUpdate={update}
          onNextEpisode={async (item) => {
            await nextEpisode(item);
          }}
          onRefresh={async (item) => {
            const updated = await mutations.refresh.mutateAsync(item);
            setAnnouncement(`Refreshed “${updated.title}”.`);
          }}
          onRemove={remove}
          onClose={() => {
            setDialog((current) => (current?.kind === "title" ? null : current));
            if (linked) router.replace(watchlistHref(view));
          }}
        />
      ) : null}
      {confirmDialog}
      {celebration}
    </Shell>
  );
}

function Shell({
  view = "overview",
  counts = null,
  actions,
  children,
}: {
  view?: WatchView;
  counts?: Record<WatchStatus, number> | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const Icon = VIEW_ICONS[view];
  return (
    <div className="space-y-8">
      <PageHeader title="Watchlist" description={DESCRIPTION} actions={actions} />
      {/* Layout follows the space the page gets (which depends on the app sidebar), not the screen. */}
      <div className="@container/watchlist">
        <div className="grid gap-6 @5xl/watchlist:grid-cols-[13rem_minmax(0,1fr)] @5xl/watchlist:gap-8 @7xl/watchlist:grid-cols-[15rem_minmax(0,1fr)] @7xl/watchlist:gap-12">
          <aside className="min-w-0 @5xl/watchlist:sticky @5xl/watchlist:top-6 @5xl/watchlist:self-start">
            <WatchlistNav view={view} counts={counts} />
          </aside>
          <div key={view} className="@container/view min-w-0 animate-page-in space-y-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              {WATCH_VIEWS.find((option) => option.value === view)?.label}
            </h2>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A grid of poster cards; `markFirst` labels the front of the queue "Up next". */
function PosterGrid({
  label,
  workspaceId,
  items,
  actions,
  pending,
  markFirst,
}: {
  label: string;
  workspaceId: string;
  items: readonly WatchItem[];
  actions: TitleActions;
  pending: ReadonlySet<string>;
  markFirst: boolean;
}) {
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-6 @3xl/view:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]"
    >
      {items.map((item, index) => (
        <TitleCard
          key={item.id}
          workspaceId={workspaceId}
          item={item}
          actions={actions}
          first={markFirst && index === 0}
          pending={pending.has(item.id)}
        />
      ))}
    </ul>
  );
}

const OVERVIEW_LIMIT = 6;

/** "Up next": what's in progress, the front of the queue, and what was finished lately. */
function Overview({
  workspaceId,
  items,
  kind,
  kindFilter,
  actions,
  pending,
}: {
  workspaceId: string;
  items: readonly WatchItem[];
  kind: KindFilter;
  kindFilter: ReactNode;
  actions: TitleActions;
  pending: ReadonlySet<string>;
}) {
  const id = useId();
  const watching = titlesIn(items, "watching", { kind });
  const queue = titlesIn(items, "want", { kind });
  const recent = titlesIn(items, "watched", { kind });

  function heading(key: string, title: string, view: WatchStatus, total: number) {
    return (
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`${id}-${key}`} className="text-sm font-semibold">
          {title}
        </h3>
        {total > OVERVIEW_LIMIT ? (
          <Link
            href={watchlistHref(view)}
            className="rounded-md text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            See all {total}
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {kindFilter}
      <section aria-labelledby={`${id}-continue`} className="space-y-3">
        <h3 id={`${id}-continue`} className="text-sm font-semibold">
          Continue watching
        </h3>
        {watching.length > 0 ? (
          <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
            {watching.map((item) => (
              <ContinueCard
                key={item.id}
                workspaceId={workspaceId}
                item={item}
                actions={actions}
                pending={pending.has(item.id)}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-pretty text-muted-foreground">
            {kind === "all"
              ? "Nothing in progress. Start something from your queue, or let “Watch tonight” choose."
              : `No ${kind === "movie" ? "movies" : "series"} in progress.`}
          </p>
        )}
      </section>

      {queue.length > 0 ? (
        <section aria-labelledby={`${id}-queue`} className="space-y-3">
          {heading("queue", "Next in your queue", "want", queue.length)}
          <PosterGrid
            label="Next in your queue"
            workspaceId={workspaceId}
            items={queue.slice(0, OVERVIEW_LIMIT)}
            actions={actions}
            pending={pending}
            markFirst
          />
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section aria-labelledby={`${id}-recent`} className="space-y-3">
          {heading("recent", "Recently watched", "watched", recent.length)}
          <PosterGrid
            label="Recently watched"
            workspaceId={workspaceId}
            items={recent.slice(0, OVERVIEW_LIMIT)}
            actions={actions}
            pending={pending}
            markFirst={false}
          />
        </section>
      ) : null}
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="space-y-4">
      <span className="sr-only">Loading your watchlist…</span>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-6">
        {[0, 1, 2, 3, 4, 5].map((card) => (
          <div key={card} className="space-y-2">
            <Skeleton className="aspect-[2/3] w-full rounded-xl" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
