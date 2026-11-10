"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { UpdateWatchItemRequest, WatchItem, WatchStatus } from "@orbit/contracts";
import { Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  episodeLabel,
  metaLine,
  NOTES_MAX_LENGTH,
  optionalNumber,
  seriesProgress,
  STATUS_LABELS,
  STATUSES,
  titleDetailsSchema,
} from "@/lib/watchlist";
import { cn } from "@/utils/common";

import { ChoiceChips } from "./choice-chips";
import { WatchPoster } from "./poster";
import { StarRating } from "./star-rating";

const STATUS_OPTIONS = STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }));

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

type TitleSheetProps = {
  workspaceId: string;
  item: WatchItem;
  /** Apply a change; rejects with the API's error. */
  onUpdate: (item: WatchItem, changes: UpdateWatchItemRequest) => Promise<WatchItem>;
  onNextEpisode: (item: WatchItem) => Promise<void>;
  onRefresh: (item: WatchItem) => Promise<void>;
  onRemove: (item: WatchItem) => void;
  onClose: () => void;
};

/**
 * Everything about one title. Status, episodes, and rating apply at once; the details below save
 * together.
 */
export function TitleSheet({
  workspaceId,
  item,
  onUpdate,
  onNextEpisode,
  onRefresh,
  onRemove,
  onClose,
}: TitleSheetProps) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      setError(describeApiError(reason, fallback));
    }
    setBusy(false);
  }

  const dates = [
    `Added ${DATE_FORMAT.format(new Date(item.created_at))}`,
    item.started_at && item.status !== "watched"
      ? `Started ${DATE_FORMAT.format(new Date(item.started_at))}`
      : null,
    item.finished_at ? `Finished ${DATE_FORMAT.format(new Date(item.finished_at))}` : null,
  ].filter(Boolean);

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[6vh] mb-[6vh] w-[calc(100%-2rem)] max-w-3xl rounded-2xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <div className="@container/sheet">
        <div className="relative grid gap-5 p-5 @xl/sheet:grid-cols-[11rem_1fr] @xl/sheet:gap-6">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-3 right-3 size-8"
            aria-label="Close"
            onClick={close}
          >
            <X aria-hidden="true" />
          </Button>

          <div className="mx-auto w-36 @xl/sheet:mx-0 @xl/sheet:w-auto">
            <WatchPoster
              workspaceId={workspaceId}
              item={item}
              className="rounded-xl shadow-elevation-2 ring-1 ring-black/5 dark:ring-white/10"
            />
            <p className="mt-3 hidden text-xs leading-relaxed text-muted-foreground @xl/sheet:block">
              {dates.join(" · ")}
            </p>
          </div>

          <div className="min-w-0 space-y-5">
            <header className="space-y-2 pr-8">
              <h2
                id={`${id}-heading`}
                className="text-xl font-semibold tracking-tight text-balance"
              >
                {item.title}
              </h2>
              <p className="text-sm text-muted-foreground">
                {metaLine(item)}
                {item.platform ? ` · ${item.platform}` : ""}
              </p>
              {item.genres.length > 0 ? (
                <ul aria-label="Genres" className="flex flex-wrap gap-1.5">
                  {item.genres.map((genre) => (
                    <li key={genre}>
                      <Badge variant="outline">{genre}</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </header>

            <ChoiceChips
              label="Status"
              value={item.status}
              options={STATUS_OPTIONS}
              disabled={busy}
              onChange={(status: WatchStatus) =>
                void run(() => onUpdate(item, { status }), "Couldn’t change the status. Try again.")
              }
            />

            {item.kind === "series" ? (
              <EpisodeProgress
                item={item}
                busy={busy}
                onNext={() =>
                  void run(() => onNextEpisode(item), "Couldn’t log the episode. Try again.")
                }
                onSet={(progress) =>
                  run(() => onUpdate(item, { progress }), "Couldn’t save your progress. Try again.")
                }
              />
            ) : null}

            <div className="space-y-1.5">
              <span className="block text-sm font-medium">Your rating</span>
              <StarRating
                value={item.rating}
                disabled={busy}
                onChange={(rating) =>
                  void run(() => onUpdate(item, { rating }), "Couldn’t save the rating. Try again.")
                }
              />
            </div>

            <FormAlert message={error} />

            {item.overview ? (
              <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                {item.overview}
              </p>
            ) : null}

            <TitleDetailsForm key={item.id} item={item} onUpdate={onUpdate} />

            <p className="text-xs text-muted-foreground @xl/sheet:hidden">{dates.join(" · ")}</p>

            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              {item.looked_up ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(() => onRefresh(item), "Couldn’t refresh the details. Try again.")
                  }
                >
                  <RefreshCw aria-hidden="true" />
                  Refresh details
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onRemove(item)}
              >
                <Trash2 aria-hidden="true" />
                Remove
              </Button>
              {item.looked_up ? (
                <p className="ml-auto text-[11px] text-muted-foreground">Details from TMDB</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function EpisodeProgress({
  item,
  busy,
  onNext,
  onSet,
}: {
  item: WatchItem;
  busy: boolean;
  onNext: () => void;
  onSet: (progress: { season: number; episode: number } | null) => Promise<void>;
}) {
  const id = useId();
  const progress = seriesProgress(item);
  const [editing, setEditing] = useState(false);
  const [season, setSeason] = useState(String(item.progress?.season ?? 1));
  const [episode, setEpisode] = useState(String(item.progress?.episode ?? 1));
  const share =
    progress.watched !== null && progress.total ? progress.watched / progress.total : null;
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode);
  const valid =
    Number.isInteger(seasonNumber) &&
    Number.isInteger(episodeNumber) &&
    seasonNumber >= 1 &&
    episodeNumber >= 1;

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="space-y-3 rounded-xl border bg-card p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${id}-heading`} className="text-sm font-medium">
            Episodes
          </h3>
          <p className="text-sm text-muted-foreground">
            {item.progress ? `Watched up to ${episodeLabel(item.progress)}` : "Not started"}
            {progress.watched !== null && progress.total
              ? ` · ${progress.watched} of ${progress.total}`
              : ""}
          </p>
        </div>
        {progress.next ? (
          <Button variant="soft" size="sm" disabled={busy} onClick={onNext}>
            <Plus aria-hidden="true" />
            Watched {episodeLabel(progress.next)}
          </Button>
        ) : (
          <Badge variant="brand">All caught up</Badge>
        )}
      </div>
      {share !== null ? (
        <div
          role="progressbar"
          aria-label="Episodes watched"
          aria-valuemin={0}
          aria-valuemax={progress.total ?? 0}
          aria-valuenow={progress.watched ?? 0}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-brand" style={{ width: `${share * 100}%` }} />
        </div>
      ) : null}
      {editing ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            void onSet({ season: seasonNumber, episode: episodeNumber }).then(() =>
              setEditing(false),
            );
          }}
        >
          <label className="space-y-1 text-xs font-medium">
            <span className="block">Season</span>
            <Input
              inputMode="numeric"
              value={season}
              onChange={(event) => setSeason(event.target.value)}
              className="h-8 w-20"
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="block">Episode</span>
            <Input
              inputMode="numeric"
              value={episode}
              onChange={(event) => setEpisode(event.target.value)}
              className="h-8 w-20"
            />
          </label>
          <Button type="submit" size="sm" disabled={busy || !valid}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            onClick={() => {
              setSeason(String(item.progress?.season ?? 1));
              setEpisode(String(item.progress?.episode ?? 1));
              setEditing(true);
            }}
          >
            Set where you are
          </Button>
          {item.progress ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onSet(null)}>
              Start over
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function TitleDetailsForm({
  item,
  onUpdate,
}: {
  item: WatchItem;
  onUpdate: (item: WatchItem, changes: UpdateWatchItemRequest) => Promise<WatchItem>;
}) {
  const id = useId();
  const {
    register,
    handleSubmit,
    setError,
    control,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: yupResolver(titleDetailsSchema),
    defaultValues: {
      title: item.title,
      year: item.release_year ? String(item.release_year) : "",
      runtime: item.runtime_minutes ? String(item.runtime_minutes) : "",
      platform: item.platform ?? "",
      recommendedBy: item.recommended_by ?? "",
      notes: item.notes,
    },
  });
  const notes = useWatch({ control, name: "notes" });

  async function save(values: InferType<typeof titleDetailsSchema>) {
    const changes: UpdateWatchItemRequest = {};
    const year = optionalNumber(values.year);
    const runtime = optionalNumber(values.runtime);
    if (values.title !== item.title) changes.title = values.title;
    if (year !== item.release_year) changes.release_year = year;
    if (runtime !== item.runtime_minutes) changes.runtime_minutes = runtime;
    if ((values.platform || null) !== item.platform) changes.platform = values.platform || null;
    if ((values.recommendedBy || null) !== item.recommended_by) {
      changes.recommended_by = values.recommendedBy || null;
    }
    if (values.notes !== item.notes) changes.notes = values.notes;
    if (Object.keys(changes).length === 0) {
      reset(values);
      return;
    }
    try {
      await onUpdate(item, changes);
      reset(values);
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the details. Try again."),
      });
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(save)(event)}
      className="space-y-4"
      aria-label="Details"
    >
      {/* Looked-up titles take these from TMDB; titles entered by hand edit them here. */}
      {item.looked_up ? null : (
        <div className="grid gap-4 @md/sheet:grid-cols-[1fr_6rem_7rem]">
          <FormField
            label="Title"
            autoComplete="off"
            {...register("title")}
            error={errors.title?.message}
          />
          <FormField
            label="Year"
            inputMode="numeric"
            autoComplete="off"
            {...register("year")}
            error={errors.year?.message}
          />
          <FormField
            label={item.kind === "series" ? "Episode (min)" : "Length (min)"}
            inputMode="numeric"
            autoComplete="off"
            {...register("runtime")}
            error={errors.runtime?.message}
          />
        </div>
      )}
      <div className="grid gap-4 @md/sheet:grid-cols-2">
        <FormField
          label="Where to watch"
          autoComplete="off"
          placeholder="Netflix"
          {...register("platform")}
          error={errors.platform?.message}
        />
        <FormField
          label="Recommended by"
          autoComplete="off"
          placeholder="Who told you about it"
          {...register("recommendedBy")}
          error={errors.recommendedBy?.message}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-notes`} className="block text-sm font-medium">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id={`${id}-notes`}
          rows={3}
          placeholder="What you thought, a favorite scene, who to watch it with…"
          {...register("notes")}
          aria-invalid={errors.notes ? true : undefined}
          aria-describedby={`${id}-notes-hint`}
        />
        <p
          id={`${id}-notes-hint`}
          className={cn(
            "text-xs",
            errors.notes ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {errors.notes?.message ?? `${notes.trim().length} / ${NOTES_MAX_LENGTH} characters`}
        </p>
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
      {isDirty ? (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={isSubmitting} onClick={() => reset()}>
            Discard
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save details"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
