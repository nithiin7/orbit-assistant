"use client";

import type { WatchItem } from "@orbit/contracts";
import { ArrowRight, Clapperboard, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { useWatchlist, useWatchlistMutations } from "@/hooks/use-watchlist";
import { episodeLabel, metaLine, seriesProgress, titlesIn, watchlistHref } from "@/lib/watchlist";

import { WatchPoster } from "./poster";

const SHOWN = 3;

/** The dashboard's watchlist: what's in progress, with one tap for the next episode, and what's
 * next in the queue. */
export function WatchlistWidget() {
  const workspaceId = useActiveWorkspaceId();
  return (
    <section aria-labelledby="watchlist-widget-heading" className="h-full">
      <Card className="h-full shadow-elevation-1">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2
            id="watchlist-widget-heading"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <Clapperboard className="size-4 text-muted-foreground" aria-hidden="true" />
            Watchlist
          </h2>
          <Link href="/watchlist" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Open watchlist
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        {workspaceId === null ? (
          <WidgetSkeleton />
        ) : (
          <WidgetBody key={workspaceId} workspaceId={workspaceId} />
        )}
      </Card>
    </section>
  );
}

function WidgetBody({ workspaceId }: { workspaceId: string }) {
  const { items, reload } = useWatchlist(workspaceId);
  const { nextEpisode } = useWatchlistMutations(workspaceId);
  const [error, setError] = useState<string | null>(null);

  if (items.status === "loading") return <WidgetSkeleton />;
  if (items.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">{items.message}</p>
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          Try again
        </Button>
      </div>
    );
  }

  const watching = titlesIn(items.data, "watching").slice(0, SHOWN);
  const next = titlesIn(items.data, "want")[0] ?? null;

  if (watching.length === 0 && next === null) {
    return (
      <div className="flex flex-col items-start gap-3 p-5">
        <p className="text-sm text-muted-foreground">
          Nothing queued. Save the next movie or series you want to see.
        </p>
        <Link href="/watchlist" className={buttonVariants({ variant: "soft", size: "sm" })}>
          <Plus aria-hidden="true" />
          Add a title
        </Link>
      </div>
    );
  }

  async function logNext(item: WatchItem) {
    setError(null);
    try {
      await nextEpisode.mutateAsync(item);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t log the episode. Try again."));
    }
  }

  return (
    <div className="space-y-4 p-5">
      {watching.length > 0 ? (
        <ul aria-label="Watching" className="space-y-2.5">
          {watching.map((item) => {
            const upcoming = item.kind === "series" ? seriesProgress(item).next : null;
            return (
              <li key={item.id} className="flex items-center gap-3">
                <WatchPoster
                  workspaceId={workspaceId}
                  item={item}
                  compact
                  className="w-9 shrink-0 rounded-md"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.progress ? `Watched ${episodeLabel(item.progress)}` : metaLine(item)}
                  </p>
                </div>
                {upcoming ? (
                  <Button
                    size="sm"
                    variant="soft"
                    disabled={nextEpisode.isPending}
                    onClick={() => void logNext(item)}
                    aria-label={`Watched ${episodeLabel(upcoming)} of ${item.title}`}
                  >
                    <Plus aria-hidden="true" />
                    {episodeLabel(upcoming)}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {next ? (
        <Link
          href={watchlistHref("want")}
          className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-xs font-medium tracking-wide text-brand uppercase">Up next</span>
          <span className="min-w-0 flex-1 truncate text-sm">{next.title}</span>
          <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground" />
        </Link>
      ) : null}
      <FormAlert message={error} />
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div className="space-y-2 p-5">
      <span className="sr-only">Loading your watchlist…</span>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}
