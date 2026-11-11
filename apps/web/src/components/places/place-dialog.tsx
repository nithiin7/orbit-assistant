"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { PlaceMatch } from "@orbit/contracts";
import { ChevronRight, LoaderCircle, MapPin, Search, SearchX, X } from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogFormActions, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  COUNTRY_OPTIONS,
  countryName,
  NOTE_MAX_LENGTH,
  placeSchema,
  type PlaceValues,
  STATUS_LABELS,
  STATUSES,
  withMatch,
} from "@/lib/places";
import { cn } from "@/utils/common";

import { CountryFlag } from "./country-flag";

type PlaceDialogProps = {
  mode: "add" | "edit";
  initial: PlaceValues;
  /** Looks places up by name; left out while online maps are off. */
  onSearch?: (query: string) => Promise<PlaceMatch[]>;
  onSave: (values: PlaceValues) => Promise<void>;
  /** Called once the dialog has closed, whether saved or cancelled. */
  onClose: () => void;
};

const STATUS_OPTIONS = STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }));

/** Adds a place or edits one, in a modal `<dialog>`. */
export function PlaceDialog({ mode, initial, onSearch, onSave, onClose }: PlaceDialogProps) {
  const id = useId();
  const adding = mode === "add";
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    reset,
    formState: { errors, isSubmitting: saving },
  } = useForm({ resolver: yupResolver(placeSchema), defaultValues: initial });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });
  const [status, note, location] = useWatch({ control, name: ["status", "note", "location"] });

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<PlaceMatch[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function search() {
    if (!onSearch || query.trim().length < 2 || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      setMatches(await onSearch(query.trim()));
    } catch (reason) {
      setSearchError(describeApiError(reason, "Place search isn’t responding. Try again."));
      setMatches(null);
    } finally {
      setSearching(false);
    }
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    // Enter searches rather than saving the form.
    if (event.key === "Enter") {
      event.preventDefault();
      void search();
    }
  }

  function choose(match: PlaceMatch) {
    reset(withMatch(getValues(), match), { keepDefaultValues: true });
    setMatches(null);
    setQuery("");
  }

  async function save(values: PlaceValues) {
    try {
      await onSave(values);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the place. Try again."),
      });
    }
  }

  return (
    <Dialog {...dialogProps} aria-labelledby={`${id}-heading`} className="mt-[6vh] max-w-lg">
      <form
        noValidate
        // Called here, not during render: `save` closes the dialog through a ref.
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <DialogHeader
          titleId={`${id}-heading`}
          title={adding ? "Add a place" : "Edit place"}
          description={
            adding ? (
              <p className="text-sm text-pretty text-muted-foreground">
                {onSearch ? (
                  "Search for it to drop a pin, or fill it in yourself."
                ) : (
                  <>
                    A name and a country are enough to light up the map.{" "}
                    <Link
                      href="/settings/places"
                      className="rounded-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Turn on online maps
                    </Link>{" "}
                    to search for places and pin them.
                  </>
                )}
              </p>
            ) : null
          }
          onClose={close}
        />

        {onSearch ? (
          <div className="space-y-2">
            <label htmlFor={`${id}-search`} className="block text-sm font-medium">
              Find a place
            </label>
            {/* The button sits inside the field at a fixed size, so typing or searching never
                reflows the row. */}
            <div className="relative">
              {searching ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground motion-safe:animate-spin"
                />
              ) : (
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
              )}
              <Input
                id={`${id}-search`}
                type="search"
                autoComplete="off"
                autoFocus={adding}
                placeholder="A city, landmark, or address"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKey}
                aria-busy={searching || undefined}
                className="h-10 pr-24 pl-9 [&::-webkit-search-cancel-button]:hidden"
              />
              <Button
                variant="soft"
                size="sm"
                disabled={searching || query.trim().length < 2}
                onClick={() => void search()}
                className="absolute top-1/2 right-1 w-20 -translate-y-1/2"
              >
                Search
              </Button>
            </div>
            <p role="status" className="sr-only">
              {searching ? "Searching…" : ""}
            </p>
            <FormAlert message={searchError} />
            {matches !== null ? (
              <SearchResults
                matches={matches}
                onChoose={choose}
                onDismiss={() => setMatches(null)}
              />
            ) : null}
          </div>
        ) : null}

        <FormField
          label="Name"
          autoComplete="off"
          autoFocus={adding && !onSearch}
          placeholder="Kyoto, Machu Picchu, Grandma’s village…"
          {...register("name")}
          error={errors.name?.message}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={control}
            name="countryCode"
            label="Country"
            placeholder="Choose a country"
            options={COUNTRY_OPTIONS}
          />
          <FormField
            label="City or region"
            autoComplete="off"
            {...register("locality")}
            error={errors.locality?.message}
          />
          <SelectField
            control={control}
            name="status"
            label="Status"
            options={STATUS_OPTIONS}
            onValueChange={(value) => {
              if (value !== "visited") setValue("visitedOn", "");
            }}
          />
          {status === "visited" ? (
            <DateField
              control={control}
              name="visitedOn"
              label="When"
              placeholder="Optional"
              clearable
            />
          ) : null}
        </div>

        {location ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
            <span className="flex-1">Pinned on the map</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => setValue("location", "", { shouldDirty: true })}
            >
              Remove pin
            </Button>
          </p>
        ) : null}

        <div className="space-y-1.5">
          <label htmlFor={`${id}-note`} className="block text-sm font-medium">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${id}-note`}
            rows={2}
            placeholder={
              status === "visited"
                ? "Who you went with, what you loved…"
                : "Why you want to go, when’s best…"
            }
            {...register("note")}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={`${id}-note-hint`}
          />
          <p
            id={`${id}-note-hint`}
            className={cn(
              "text-xs",
              errors.note ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {errors.note?.message ?? `${note.trim().length} / ${NOTE_MAX_LENGTH} characters`}
          </p>
        </div>

        <label className="flex items-center gap-2.5 text-sm">
          <Checkbox {...register("favorite")} />
          <span>
            Favorite
            <span className="text-muted-foreground"> — one of the highlights</span>
          </span>
        </label>

        <FormAlert message={errors.root?.server?.message ?? null} />

        <DialogFormActions
          busy={saving}
          onCancel={close}
          submitLabel={adding ? "Add place" : "Save changes"}
        />
      </form>
    </Dialog>
  );
}

/** The place's city and country, without repeating its name. */
function matchSummary(match: PlaceMatch): string {
  const country = match.country_code ? countryName(match.country_code) : "";
  const locality = match.locality.trim() === match.name.trim() ? "" : match.locality.trim();
  return [locality, country].filter(Boolean).join(", ");
}

/** Matches from a place search, in a panel under the search field. */
function SearchResults({
  matches,
  onChoose,
  onDismiss,
}: {
  matches: readonly PlaceMatch[];
  onChoose: (match: PlaceMatch) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-elevation-1">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 py-1 pr-1 pl-3">
        <p role="status" className="text-xs text-muted-foreground">
          {matches.length === 0
            ? "No matches"
            : `${matches.length} ${matches.length === 1 ? "match" : "matches"} · pick one to fill in the details`}
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Clear search results"
          onClick={onDismiss}
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
      {matches.length === 0 ? (
        <div className="flex items-center gap-3 px-3 py-4 text-sm text-muted-foreground">
          <SearchX aria-hidden="true" className="size-4 shrink-0" />
          <span>Try another spelling, or fill it in yourself below.</span>
        </div>
      ) : (
        <ul
          aria-label="Search results"
          className="max-h-64 divide-y overflow-y-auto overscroll-contain"
        >
          {matches.map((match) => {
            const summary = matchSummary(match);
            return (
              <li key={`${match.label}-${match.location.latitude}-${match.location.longitude}`}>
                <button
                  type="button"
                  onClick={() => onChoose(match)}
                  className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    {match.country_code ? (
                      <CountryFlag code={match.country_code} />
                    ) : (
                      <MapPin aria-hidden="true" className="size-4 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{match.name}</span>
                    {summary ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {summary}
                      </span>
                    ) : null}
                    <span
                      className="mt-0.5 line-clamp-1 text-xs break-all text-muted-foreground/70"
                      title={match.label}
                    >
                      {match.label}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-brand group-focus-visible:text-brand"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
