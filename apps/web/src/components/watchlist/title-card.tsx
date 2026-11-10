"use client";

import type { WatchItem, WatchStatus } from "@orbit/contracts";
import {
  ArrowUpToLine,
  Check,
  CirclePause,
  CirclePlay,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { episodeLabel, metaLine, seriesProgress } from "@/lib/watchlist";
import { cn } from "@/utils/common";

import { WatchPoster } from "./poster";
import { Stars } from "./star-rating";

export type TitleActions = {
  open: (item: WatchItem) => void;
  setStatus: (item: WatchItem, status: WatchStatus) => void;
  nextEpisode: (item: WatchItem) => void;
  moveToTop: (item: WatchItem) => void;
  remove: (item: WatchItem) => void;
};

/** The quick actions that fit a title's status, for its menu. */
function menuItems(item: WatchItem, actions: TitleActions, first: boolean): MenuItem[] {
  const items: MenuItem[] = [];
  const add = (entry: Omit<MenuItem, "id">) => items.push({ ...entry, id: entry.label });
  switch (item.status) {
    case "want":
      add({
        label: "Start watching",
        icon: CirclePlay,
        onSelect: () => actions.setStatus(item, "watching"),
      });
      add({
        label: "Mark watched",
        icon: Check,
        onSelect: () => actions.setStatus(item, "watched"),
      });
      if (!first) {
        add({
          label: "Watch next",
          description: "Move to the front of the queue",
          icon: ArrowUpToLine,
          onSelect: () => actions.moveToTop(item),
        });
      }
      break;
    case "watching":
      if (item.kind === "series" && seriesProgress(item).next) {
        add({ label: "Log next episode", icon: Plus, onSelect: () => actions.nextEpisode(item) });
      }
      add({
        label: "Mark watched",
        icon: Check,
        onSelect: () => actions.setStatus(item, "watched"),
      });
      add({
        label: "Stop for now",
        description: "Move to Dropped",
        icon: CirclePause,
        onSelect: () => actions.setStatus(item, "dropped"),
      });
      break;
    case "watched":
      add({
        label: "Watch again",
        icon: RotateCcw,
        onSelect: () => actions.setStatus(item, "watching"),
      });
      break;
    case "dropped":
      add({
        label: "Pick back up",
        icon: CirclePlay,
        onSelect: () => actions.setStatus(item, "watching"),
      });
      add({
        label: "Back to Want to watch",
        icon: RotateCcw,
        onSelect: () => actions.setStatus(item, "want"),
      });
      break;
  }
  add({
    label: "Remove",
    icon: Trash2,
    destructive: true,
    group: "danger",
    onSelect: () => actions.remove(item),
  });
  return items;
}

/** A poster card in the grid. The card opens the title; its menu holds quick actions. */
export function TitleCard({
  workspaceId,
  item,
  actions,
  first,
  pending,
}: {
  workspaceId: string;
  item: WatchItem;
  actions: TitleActions;
  /** The front of the queue, marked "Up next". */
  first: boolean;
  pending: boolean;
}) {
  const progress = item.status === "watching" && item.progress ? episodeLabel(item.progress) : null;
  return (
    <li className={cn("group relative", pending && "opacity-60")}>
      <button
        type="button"
        onClick={() => actions.open(item)}
        className="block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <WatchPoster
          workspaceId={workspaceId}
          item={item}
          className="rounded-xl shadow-elevation-1 ring-1 ring-black/5 transition-[translate,box-shadow] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-elevation-2 motion-reduce:transition-none dark:ring-white/10"
        />
        <span className="mt-2 block space-y-0.5 px-0.5">
          <span className="line-clamp-2 text-sm leading-snug font-medium">{item.title}</span>
          <span className="block text-xs text-muted-foreground">{metaLine(item)}</span>
          {item.rating ? <Stars rating={item.rating} className="pt-0.5" /> : null}
        </span>
      </button>

      {/* Badges sit on the poster without taking focus. */}
      <span className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start gap-1">
        {first && item.status === "want" ? (
          <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-brand-foreground shadow-elevation-1">
            Up next
          </span>
        ) : null}
        {progress ? (
          <span className="rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums backdrop-blur-sm">
            {progress}
          </span>
        ) : null}
      </span>
      <div className="absolute top-1.5 right-1.5 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none [@media(hover:hover)]:opacity-0">
        <Menu
          items={menuItems(item, actions, first)}
          variant="ghost"
          size="icon"
          chevron={false}
          align="end"
          aria-label={`Actions for ${item.title}`}
          className="size-7 rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70 hover:text-white"
        >
          <MoreHorizontal aria-hidden="true" />
        </Menu>
      </div>
    </li>
  );
}

/** A wide card on the "Continue watching" shelf, with one big next step. */
export function ContinueCard({
  workspaceId,
  item,
  actions,
  pending,
}: {
  workspaceId: string;
  item: WatchItem;
  actions: TitleActions;
  pending: boolean;
}) {
  const series = item.kind === "series";
  const progress = series ? seriesProgress(item) : null;
  const share =
    progress?.watched !== null && progress?.total ? (progress.watched ?? 0) / progress.total : null;
  let status: string;
  if (!series) status = item.platform ? `Movie · ${item.platform}` : "Movie in progress";
  else if (!item.progress) status = "Not started yet";
  else status = `Watched ${episodeLabel(item.progress)}`;

  return (
    <li className="w-[17.5rem] shrink-0 snap-start">
      <div className="flex h-full gap-3 rounded-xl border bg-card p-2.5 shadow-elevation-1">
        <button
          type="button"
          onClick={() => actions.open(item)}
          className="w-16 shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open ${item.title}`}
        >
          <WatchPoster workspaceId={workspaceId} item={item} compact className="rounded-lg" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-sm font-semibold">{item.title}</p>
          <p className="truncate text-xs text-muted-foreground">{status}</p>
          {share !== null ? (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`${item.title} progress`}
              aria-valuemin={0}
              aria-valuemax={progress?.total ?? 0}
              aria-valuenow={progress?.watched ?? 0}
            >
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </div>
          ) : null}
          <div className="mt-auto pt-2">
            {series && progress?.next ? (
              <Button
                size="sm"
                variant="soft"
                className="w-full"
                disabled={pending}
                onClick={() => actions.nextEpisode(item)}
                aria-label={`Watched ${episodeLabel(progress.next)} of ${item.title}`}
              >
                <Plus aria-hidden="true" />
                {episodeLabel(progress.next)}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="soft"
                className="w-full"
                disabled={pending}
                onClick={() => actions.setStatus(item, "watched")}
                aria-label={`Mark ${item.title} watched`}
              >
                <Check aria-hidden="true" />
                Finished
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
