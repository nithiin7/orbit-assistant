"use client";

import type { Place } from "@orbit/contracts";
import {
  CalendarDays,
  Check,
  Footprints,
  MapPin,
  MoreHorizontal,
  Pencil,
  Search,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { ChoiceChips } from "@/components/watchlist/choice-chips";
import {
  CONTINENT_LABELS,
  type ContinentFilter,
  continentOf,
  continentsIn,
  COUNTRY_SORTS,
  type CountryGroup,
  countryName,
  type CountrySort,
  groupByCountry,
  groupByYear,
  inContinent,
  matchesText,
  sortCountryGroups,
  sortWishes,
  VISITED_LAYOUTS,
  type VisitedLayout,
  WISH_SORTS,
  type WishSort,
} from "@/lib/places";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";

import { CountryFlag } from "./country-flag";

export type PlaceActions = {
  edit: (place: Place) => void;
  markVisited: (place: Place) => void;
  toggleFavorite: (place: Place) => void;
  remove: (place: Place) => void;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function placeMenu(place: Place, actions: PlaceActions): MenuItem[] {
  return [
    { id: "edit", label: "Edit", icon: Pencil, onSelect: () => actions.edit(place) },
    {
      id: "delete",
      label: "Delete",
      icon: Trash2,
      destructive: true,
      onSelect: () => actions.remove(place),
    },
  ];
}

function MoreMenu({ place, actions }: { place: Place; actions: PlaceActions }) {
  return (
    <Menu
      items={placeMenu(place, actions)}
      variant="ghost"
      size="icon"
      chevron={false}
      align="end"
      aria-label={`Actions for ${place.name}`}
      className="size-8 text-muted-foreground"
    >
      <MoreHorizontal aria-hidden="true" />
    </Menu>
  );
}

function FavoriteToggle({ place, actions }: { place: Place; actions: PlaceActions }) {
  return (
    <button
      type="button"
      aria-pressed={place.favorite}
      aria-label={`Favorite ${place.name}`}
      onClick={() => actions.toggleFavorite(place)}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        place.favorite ? "text-amber-500" : "text-muted-foreground/60 hover:text-foreground",
      )}
    >
      <Star aria-hidden="true" className={cn("size-4", place.favorite && "fill-current")} />
    </button>
  );
}

/** Search, continent chips, and sort above a list, with a summary underneath. */
function Toolbar<S extends string>({
  places,
  text,
  onText,
  continent,
  onContinent,
  sort,
  sorts,
  onSort,
  extra,
  summary,
}: {
  places: readonly Place[];
  text: string;
  onText: (value: string) => void;
  continent: ContinentFilter;
  onContinent: (value: ContinentFilter) => void;
  sort: S;
  sorts: readonly { value: S; label: string }[];
  onSort: (value: S) => void;
  extra?: ReactNode;
  summary: string;
}) {
  const searchId = useId();
  const continents = continentsIn(places);
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 @3xl/places:flex-row @3xl/places:items-center">
        <div className="relative flex-1">
          <label htmlFor={searchId} className="sr-only">
            Filter places
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={searchId}
            type="search"
            value={text}
            onChange={(event) => onText(event.target.value)}
            placeholder="Filter by name, city, or country"
            className="rounded-full pl-9"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Select
            aria-label="Sort places"
            variant="ghost"
            className="w-auto"
            value={sort}
            onValueChange={onSort}
            options={sorts}
          />
          {extra}
        </div>
      </div>
      {continents.length > 1 ? (
        <ChoiceChips
          label="Continent"
          hideLabel
          size="sm"
          value={continent}
          onChange={onContinent}
          options={[
            { value: "all", label: "All continents" },
            ...continents.map((value) => ({ value, label: CONTINENT_LABELS[value] })),
          ]}
        />
      ) : null}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {summary}
      </p>
    </div>
  );
}

function NoMatches() {
  return (
    <p
      role="status"
      className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
    >
      Nothing matches. Try another name, or another continent.
    </p>
  );
}

// Visited

/** Places you've been: a card per country, or a timeline by year. */
export function VisitedList({
  places,
  actions,
}: {
  places: readonly Place[];
  actions: PlaceActions;
}) {
  const visited = places.filter((place) => place.status === "visited");
  const [text, setText] = useState("");
  const [continent, setContinent] = useState<ContinentFilter>("all");
  const [sort, setSort] = useState<CountrySort>("places");
  const [layout, setLayout] = useState<VisitedLayout>("countries");

  if (visited.length === 0) {
    return (
      <EmptyState
        icon={Footprints}
        title="No visits yet"
        description="Places you’ve been show up here, grouped by country, with a timeline of your trips."
      />
    );
  }

  const shown = visited.filter(
    (place) => inContinent(place, continent) && matchesText(place, text),
  );
  const groups = sortCountryGroups(groupByCountry(shown, "visited"), sort);

  return (
    <div className="space-y-5">
      <Toolbar
        places={visited}
        text={text}
        onText={setText}
        continent={continent}
        onContinent={setContinent}
        sort={sort}
        sorts={COUNTRY_SORTS}
        onSort={setSort}
        extra={
          <ChoiceChips
            label="Show as"
            hideLabel
            size="sm"
            value={layout}
            onChange={setLayout}
            options={VISITED_LAYOUTS}
          />
        }
        summary={`${plural(shown.length, "place", "places")} in ${plural(groups.length, "country", "countries")}`}
      />
      {shown.length === 0 ? (
        <NoMatches />
      ) : layout === "countries" ? (
        <ul aria-label="Countries" className="grid gap-4 @3xl/places:grid-cols-2">
          {groups.map((group) => (
            <CountryCard key={group.code} group={group} actions={actions} />
          ))}
        </ul>
      ) : (
        <Timeline places={shown} actions={actions} />
      )}
    </div>
  );
}

function CountryCard({ group, actions }: { group: CountryGroup; actions: PlaceActions }) {
  const continent = continentOf(group.code);
  const facts = [
    continent ? CONTINENT_LABELS[continent] : null,
    plural(group.places.length, "place", "places"),
    group.lastVisited ? `last ${formatCalendarDate(group.lastVisited)}` : null,
  ].filter(Boolean);
  return (
    <li
      aria-labelledby={`country-${group.code}`}
      className="overflow-hidden rounded-2xl border bg-card shadow-elevation-1 transition-shadow hover:shadow-elevation-2"
    >
      <div className="flex items-center gap-3 border-b bg-linear-to-r from-brand-subtle/60 to-transparent px-4 py-3">
        <CountryFlag code={group.code} size="lg" />
        <div className="min-w-0">
          <h3 id={`country-${group.code}`} className="truncate text-base font-semibold">
            {group.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">{facts.join(" · ")}</p>
        </div>
      </div>
      <ul className="divide-y">
        {group.places.map((place) => (
          <PlaceItem key={place.id} place={place} actions={actions} />
        ))}
      </ul>
    </li>
  );
}

/** A visited place: opens for editing; star and menu on the side. */
function PlaceItem({
  place,
  actions,
  showCountry = false,
}: {
  place: Place;
  actions: PlaceActions;
  showCountry?: boolean;
}) {
  const details = [
    place.locality,
    showCountry ? countryName(place.country_code) : "",
    place.visited_on ? formatCalendarDate(place.visited_on) : "",
  ].filter(Boolean);
  return (
    <li className="group flex items-center gap-1 pr-2 transition-colors hover:bg-accent/40">
      <button
        type="button"
        onClick={() => actions.edit(place)}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {showCountry ? (
          <CountryFlag code={place.country_code} />
        ) : (
          <MapPin
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              place.location ? "text-brand" : "text-muted-foreground/40",
            )}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{place.name}</span>
          {details.length > 0 ? (
            <span className="block truncate text-xs text-muted-foreground">
              {details.join(" · ")}
            </span>
          ) : null}
        </span>
      </button>
      <FavoriteToggle place={place} actions={actions} />
      <MoreMenu place={place} actions={actions} />
    </li>
  );
}

function Timeline({ places, actions }: { places: readonly Place[]; actions: PlaceActions }) {
  const years = groupByYear(places);
  return (
    <ol aria-label="Timeline" className="space-y-6">
      {years.map((entry) => {
        const countries = new Set(entry.places.map((place) => place.country_code)).size;
        const label = entry.year ?? "Undated";
        return (
          <li key={label} aria-labelledby={`year-${label}`} className="relative pl-7">
            <span
              aria-hidden="true"
              className="absolute top-0 bottom-0 left-[0.6rem] w-px bg-border"
            />
            <span
              aria-hidden="true"
              className="absolute top-1 left-0 flex size-5 items-center justify-center rounded-full bg-brand text-brand-foreground ring-4 ring-background"
            >
              <CalendarDays className="size-3" />
            </span>
            <div className="mb-2 flex items-baseline gap-2">
              <h3 id={`year-${label}`} className="text-base font-semibold tabular-nums">
                {label}
              </h3>
              <span className="text-xs text-muted-foreground">
                {plural(entry.places.length, "place", "places")} ·{" "}
                {plural(countries, "country", "countries")}
              </span>
            </div>
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-elevation-1">
              {entry.places.map((place) => (
                <PlaceItem key={place.id} place={place} actions={actions} showCountry />
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

// Want to go

/** Places you want to go: a bucket list of cards. */
export function WishList({ places, actions }: { places: readonly Place[]; actions: PlaceActions }) {
  const wishes = places.filter((place) => place.status === "want_to_visit");
  const [text, setText] = useState("");
  const [continent, setContinent] = useState<ContinentFilter>("all");
  const [sort, setSort] = useState<WishSort>("favorites");

  if (wishes.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Your list is empty"
        description="Add the places you dream about; mark them visited once you’ve been."
      />
    );
  }

  const shown = sortWishes(
    wishes.filter((place) => inContinent(place, continent) && matchesText(place, text)),
    sort,
  );
  const countries = new Set(shown.map((place) => place.country_code)).size;

  return (
    <div className="space-y-5">
      <Toolbar
        places={wishes}
        text={text}
        onText={setText}
        continent={continent}
        onContinent={setContinent}
        sort={sort}
        sorts={WISH_SORTS}
        onSort={setSort}
        summary={`${plural(shown.length, "place", "places")} in ${plural(countries, "country", "countries")}`}
      />
      {shown.length === 0 ? (
        <NoMatches />
      ) : (
        <ul
          aria-label="Places you want to go"
          className="grid gap-4 @2xl/places:grid-cols-2 @6xl/places:grid-cols-3"
        >
          {shown.map((place) => (
            <WishCard key={place.id} place={place} actions={actions} />
          ))}
        </ul>
      )}
    </div>
  );
}

function WishCard({ place, actions }: { place: Place; actions: PlaceActions }) {
  const headingId = useId();
  return (
    <li
      aria-labelledby={headingId}
      className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-elevation-1 transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-elevation-2"
    >
      <div className="flex items-start justify-between gap-2 bg-linear-to-br from-brand-subtle via-brand-subtle/40 to-transparent px-4 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <CountryFlag code={place.country_code} size="lg" />
          <span className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {countryName(place.country_code)}
          </span>
        </div>
        <div className="-mt-1 -mr-1 flex items-center">
          <FavoriteToggle place={place} actions={actions} />
          <MoreMenu place={place} actions={actions} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => actions.edit(place)}
        className="flex-1 space-y-1 px-4 pt-1 pb-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <h3 id={headingId} className="text-lg leading-snug font-semibold text-balance">
          {place.name}
        </h3>
        {place.locality ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin aria-hidden="true" className="size-3" />
            {place.locality}
          </p>
        ) : null}
        {place.note ? (
          <p className="line-clamp-2 pt-1 text-sm text-pretty text-muted-foreground">
            {place.note}
          </p>
        ) : null}
      </button>
      <div className="flex items-center justify-end border-t px-3 py-2">
        <Button
          variant="soft"
          size="sm"
          onClick={() => actions.markVisited(place)}
          aria-label={`Mark ${place.name} as visited`}
        >
          <Check aria-hidden="true" />
          Been there
        </Button>
      </div>
    </li>
  );
}
