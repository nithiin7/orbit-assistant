"use client";

import type { WatchItem } from "@orbit/contracts";
import { CirclePlay, Dices, X } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  episodeLabel,
  genresOf,
  metaLine,
  pickTonight,
  seriesProgress,
  TIME_BUDGETS,
  type TimeBudget,
  tonightCandidates,
} from "@/lib/watchlist";

import { ChoiceChips } from "./choice-chips";
import { WatchPoster } from "./poster";

const ANY_GENRE = "__any";

/**
 * "What should I watch tonight?": pick how much time there is and, optionally, a genre, and it
 * suggests one title from the queue. "Something else" moves on without repeating.
 */
export function TonightDialog({
  workspaceId,
  items,
  onStart,
  onOpen,
  onClose,
}: {
  workspaceId: string;
  items: readonly WatchItem[];
  onStart: (item: WatchItem) => Promise<void>;
  onOpen: (item: WatchItem) => void;
  onClose: () => void;
}) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose });
  const [time, setTime] = useState<TimeBudget>("any");
  const [genre, setGenre] = useState(ANY_GENRE);
  const [pick, setPick] = useState<WatchItem | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [starting, setStarting] = useState(false);

  const genres = genresOf(items.filter((item) => item.status === "want"));
  const candidates = tonightCandidates(items, {
    time,
    genre: genre === ANY_GENRE ? null : genre,
  });

  function roll(seen: ReadonlySet<string>) {
    const next = pickTonight(candidates, seen);
    setPick(next);
    if (next) setSkipped(new Set(seen).add(next.id));
  }

  function changeFilters(change: () => void) {
    change();
    setPick(null);
    setSkipped(new Set());
  }

  const next = pick?.kind === "series" ? seriesProgress(pick).next : null;

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[8vh] w-[calc(100%-2rem)] max-w-md rounded-2xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <div className="space-y-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 id={`${id}-heading`} className="text-base font-semibold">
              What should I watch tonight?
            </h2>
            <p className="text-sm text-muted-foreground">
              A pick from your queue, to end the scrolling.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mt-1.5 -mr-1.5 size-8"
            aria-label="Close"
            onClick={close}
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        <ChoiceChips
          label="Time you have"
          value={time}
          options={TIME_BUDGETS}
          onChange={(value) => changeFilters(() => setTime(value))}
        />
        {genres.length > 0 ? (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-genre`} className="block text-sm font-medium">
              Mood
            </label>
            <Select
              id={`${id}-genre`}
              value={genre}
              onValueChange={(value) => changeFilters(() => setGenre(value))}
              options={[
                { value: ANY_GENRE, label: "Anything" },
                ...genres.map((name) => ({ value: name, label: name })),
              ]}
            />
          </div>
        ) : null}

        <div aria-live="polite">
          {pick ? (
            <div
              key={pick.id}
              className="flex animate-celebrate-in gap-4 rounded-xl border bg-card p-3 shadow-elevation-1"
            >
              <button
                type="button"
                className="w-24 shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Open ${pick.title}`}
                onClick={() => {
                  onOpen(pick);
                  close();
                }}
              >
                <WatchPoster workspaceId={workspaceId} item={pick} className="rounded-lg" />
              </button>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs font-medium tracking-wide text-brand uppercase">Tonight</p>
                <p className="text-lg leading-tight font-semibold text-balance">{pick.title}</p>
                <p className="text-sm text-muted-foreground">
                  {next ? `Next: ${episodeLabel(next)}` : metaLine(pick)}
                  {pick.platform ? ` · ${pick.platform}` : ""}
                </p>
                {pick.overview ? (
                  <p className="line-clamp-3 pt-1 text-xs text-pretty text-muted-foreground">
                    {pick.overview}
                  </p>
                ) : null}
              </div>
            </div>
          ) : candidates.length === 0 ? (
            <p className="rounded-xl bg-muted/60 px-4 py-6 text-center text-sm text-pretty text-muted-foreground">
              Nothing in your queue fits. Try another length or mood, or add a few titles first.
            </p>
          ) : (
            <p className="rounded-xl bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">
              {candidates.length} {candidates.length === 1 ? "title fits" : "titles fit"}. Ready
              when you are.
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          {pick ? (
            <>
              <Button variant="ghost" onClick={() => roll(skipped)} disabled={starting}>
                <Dices aria-hidden="true" />
                Something else
              </Button>
              <Button
                disabled={starting}
                onClick={() => {
                  setStarting(true);
                  void onStart(pick)
                    .then(close)
                    .finally(() => setStarting(false));
                }}
              >
                <CirclePlay aria-hidden="true" />
                {pick.status === "watching" ? "Let’s watch" : "Start watching"}
              </Button>
            </>
          ) : (
            <Button disabled={candidates.length === 0} onClick={() => roll(skipped)}>
              <Dices aria-hidden="true" />
              Pick for me
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}
