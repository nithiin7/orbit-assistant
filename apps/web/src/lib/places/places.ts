import type {
  CreatePlaceRequest,
  Place,
  PlaceMatch,
  PlaceStatus,
  UpdatePlaceRequest,
} from "@orbit/contracts";
import { boolean, type InferType, mixed, object, string } from "yup";

import { type Option } from "@/utils/common";
import { multiLineText, singleLineText } from "@/utils/validation";

import {
  type Continent,
  continentOf,
  CONTINENTS,
  COUNTRIES,
  countryName,
  SOVEREIGN_COUNT,
} from "./countries";

// Views

export type PlacesView = "overview" | "visited" | "wishlist";

export const PLACES_VIEWS: readonly Option<PlacesView>[] = [
  { value: "overview", label: "Your world" },
  { value: "visited", label: "Visited" },
  { value: "wishlist", label: "Want to go" },
];

export function parsePlacesView(params: URLSearchParams): PlacesView {
  const view = params.get("view");
  return PLACES_VIEWS.find((option) => option.value === view)?.value ?? "overview";
}

export function placesHref(view: PlacesView): string {
  return view === "overview" ? "/places" : `/places?view=${view}`;
}

/** Where a search hit for a place opens: the list it's in. */
export function placeHref(place: Pick<Place, "status">): string {
  return placesHref(place.status === "visited" ? "visited" : "wishlist");
}

export const STATUS_LABELS: Readonly<Record<PlaceStatus, string>> = {
  visited: "Been there",
  want_to_visit: "Want to go",
};

export const STATUSES: readonly PlaceStatus[] = ["visited", "want_to_visit"];

// Stats

export type CountryGroup = {
  code: string;
  name: string;
  places: Place[];
  /** The latest visit date among its places, if any has one. */
  lastVisited: string | null;
};

export type TravelStats = {
  /** Distinct UN member and observer states visited. */
  countries: number;
  /** Visited territories and other regions, such as Hong Kong or Puerto Rico. */
  regions: number;
  /** Share of the world's 195 countries visited, rounded to a whole percent. */
  worldShare: number;
  /** Continents visited, in a fixed order. */
  continents: Continent[];
  visitedPlaces: number;
  wishlistPlaces: number;
  /** Countries on the wishlist that haven't been visited yet. */
  newCountriesOnWishlist: number;
  /** The most recent visit with a date. */
  latest: Place | null;
};

function visitedCodes(places: readonly Place[]): Set<string> {
  return new Set(places.filter((place) => place.status === "visited").map((p) => p.country_code));
}

export function travelStats(places: readonly Place[]): TravelStats {
  const visited = visitedCodes(places);
  const wished = new Set(
    places.filter((place) => place.status === "want_to_visit").map((p) => p.country_code),
  );
  let countries = 0;
  let regions = 0;
  const continents = new Set<Continent>();
  for (const code of visited) {
    const country = COUNTRIES.get(code);
    if (!country) continue;
    if (country.sovereign) countries += 1;
    else regions += 1;
    continents.add(country.continent);
  }
  const dated = places
    .filter((place) => place.status === "visited" && place.visited_on)
    .sort((a, b) => (b.visited_on ?? "").localeCompare(a.visited_on ?? ""));
  return {
    countries,
    regions,
    worldShare: Math.round((countries / SOVEREIGN_COUNT) * 100),
    continents: CONTINENTS.filter((continent) => continents.has(continent)),
    visitedPlaces: places.filter((place) => place.status === "visited").length,
    wishlistPlaces: places.filter((place) => place.status === "want_to_visit").length,
    newCountriesOnWishlist: [...wished].filter((code) => !visited.has(code)).length,
    latest: dated[0] ?? null,
  };
}

/** The map's colors per country: visited wins over wished-for. */
export function countryStatuses(places: readonly Place[]): Map<string, PlaceStatus> {
  const statuses = new Map<string, PlaceStatus>();
  for (const place of places) {
    if (place.status === "visited" || !statuses.has(place.country_code)) {
      statuses.set(place.country_code, place.status);
    }
  }
  return statuses;
}

/** Places with one status grouped by country: most places first, then by name. */
export function groupByCountry(places: readonly Place[], status: PlaceStatus): CountryGroup[] {
  const groups = new Map<string, Place[]>();
  for (const place of places) {
    if (place.status !== status) continue;
    const list = groups.get(place.country_code) ?? [];
    list.push(place);
    groups.set(place.country_code, list);
  }
  return [...groups.entries()]
    .map(([code, list]) => ({
      code,
      name: countryName(code),
      places: [...list].sort(
        (a, b) =>
          (b.visited_on ?? "").localeCompare(a.visited_on ?? "") || a.name.localeCompare(b.name),
      ),
      lastVisited:
        list
          .map((place) => place.visited_on)
          .filter((date): date is string => Boolean(date))
          .sort()
          .at(-1) ?? null,
    }))
    .sort((a, b) => b.places.length - a.places.length || a.name.localeCompare(b.name));
}

/** Filter places by name, city, country, or note. */
export function matchesText(place: Place, text: string): boolean {
  const query = text.trim().toLocaleLowerCase();
  if (!query) return true;
  return [place.name, place.locality, countryName(place.country_code), place.note].some((value) =>
    value.toLocaleLowerCase().includes(query),
  );
}

// Your world

export type ContinentProgress = {
  continent: Continent;
  /** Visited UN member and observer states on this continent. */
  countries: number;
  /** All of this continent's UN member and observer states. */
  total: number;
  /** Every visited code here, territories included, for flags. */
  codes: string[];
};

/** Progress on each inhabited continent, in the usual order. */
export function continentProgress(places: readonly Place[]): ContinentProgress[] {
  const visited = new Set(
    places.filter((place) => place.status === "visited").map((place) => place.country_code),
  );
  return CONTINENTS.filter((continent) => continent !== "AN").map((continent) => {
    const here = [...COUNTRIES.values()].filter((country) => country.continent === continent);
    const codes = here.filter((country) => visited.has(country.code)).map((c) => c.code);
    return {
      continent,
      countries: here.filter((country) => country.sovereign && visited.has(country.code)).length,
      total: here.filter((country) => country.sovereign).length,
      codes: codes.sort((a, b) => countryName(a).localeCompare(countryName(b))),
    };
  });
}

export type Milestone = {
  id: string;
  label: string;
  description: string;
  reached: boolean;
  /** How far along, 0 to 1. */
  progress: number;
  /** What's left, such as "3 more countries"; empty once reached. */
  remaining: string;
};

const COUNTRY_MILESTONES = [1, 5, 10, 25, 50, 100, SOVEREIGN_COUNT] as const;
const CONTINENT_MILESTONES = [3, 6] as const;

function milestoneLabel(count: number): string {
  if (count === 1) return "First country";
  if (count === SOVEREIGN_COUNT) return "Every country";
  return `${count} countries`;
}

/** Country and continent milestones, in order, each reached or not. */
export function milestones(stats: TravelStats): Milestone[] {
  const countries = COUNTRY_MILESTONES.map((goal): Milestone => {
    const left = goal - stats.countries;
    return {
      id: `countries-${goal}`,
      label: milestoneLabel(goal),
      description:
        goal === 1 ? "Your first stamp" : `Visit ${goal} of the world’s ${SOVEREIGN_COUNT}`,
      reached: left <= 0,
      progress: Math.min(1, stats.countries / goal),
      remaining: left > 0 ? `${left} more ${left === 1 ? "country" : "countries"}` : "",
    };
  });
  const continents = CONTINENT_MILESTONES.map((goal): Milestone => {
    const reached = stats.continents.filter((continent) => continent !== "AN").length;
    const left = goal - reached;
    return {
      id: `continents-${goal}`,
      label: goal === 6 ? "Every continent" : `${goal} continents`,
      description: goal === 6 ? "All six inhabited continents" : `Set foot on ${goal} continents`,
      reached: left <= 0,
      progress: Math.min(1, reached / goal),
      remaining: left > 0 ? `${left} more ${left === 1 ? "continent" : "continents"}` : "",
    };
  });
  return [...countries, ...continents];
}

/** The next milestone to reach: the unreached one closest to done. */
export function nextMilestone(list: readonly Milestone[]): Milestone | null {
  return (
    list.filter((milestone) => !milestone.reached).sort((a, b) => b.progress - a.progress)[0] ??
    null
  );
}

export type YearInTravel = { year: string; places: number; countries: number };

/** Visits dated in `year`. */
export function yearInTravel(places: readonly Place[], year: string): YearInTravel {
  const dated = places.filter(
    (place) => place.status === "visited" && place.visited_on?.startsWith(year),
  );
  return {
    year,
    places: dated.length,
    countries: new Set(dated.map((place) => place.country_code)).size,
  };
}

// Lists

export type VisitedLayout = "countries" | "timeline";

export const VISITED_LAYOUTS: readonly Option<VisitedLayout>[] = [
  { value: "countries", label: "Countries" },
  { value: "timeline", label: "Timeline" },
];

export type CountrySort = "places" | "recent" | "name";

export const COUNTRY_SORTS: readonly Option<CountrySort>[] = [
  { value: "places", label: "Most places" },
  { value: "recent", label: "Recently visited" },
  { value: "name", label: "Name" },
];

export type WishSort = "favorites" | "newest" | "name" | "country";

export const WISH_SORTS: readonly Option<WishSort>[] = [
  { value: "favorites", label: "Favorites first" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name" },
  { value: "country", label: "Country" },
];

/** `"all"`, or one continent. */
export type ContinentFilter = Continent | "all";

/** The continents these places are in, in the usual order, for filter chips. */
export function continentsIn(places: readonly Place[]): Continent[] {
  const found = new Set(places.map((place) => continentOf(place.country_code)));
  return CONTINENTS.filter((continent) => found.has(continent));
}

export function inContinent(place: Place, continent: ContinentFilter): boolean {
  return continent === "all" || continentOf(place.country_code) === continent;
}

export function sortCountryGroups(groups: readonly CountryGroup[], sort: CountrySort) {
  return [...groups].sort((a, b) => {
    if (sort === "recent") {
      const byDate = (b.lastVisited ?? "").localeCompare(a.lastVisited ?? "");
      if (byDate !== 0) return byDate;
    }
    if (sort === "places" && b.places.length !== a.places.length) {
      return b.places.length - a.places.length;
    }
    return a.name.localeCompare(b.name);
  });
}

export function sortWishes(places: readonly Place[], sort: WishSort): Place[] {
  const byNewest = (a: Place, b: Place) =>
    b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);
  return [...places].sort((a, b) => {
    switch (sort) {
      case "favorites":
        return Number(b.favorite) - Number(a.favorite) || byNewest(a, b);
      case "newest":
        return byNewest(a, b);
      case "name":
        return a.name.localeCompare(b.name);
      case "country":
        return (
          countryName(a.country_code).localeCompare(countryName(b.country_code)) ||
          a.name.localeCompare(b.name)
        );
    }
  });
}

export type YearGroup = { year: string | null; places: Place[] };

/** Visited places by the year of the visit, newest first; undated visits last. */
export function groupByYear(places: readonly Place[]): YearGroup[] {
  const years = new Map<string | null, Place[]>();
  for (const place of places) {
    if (place.status !== "visited") continue;
    const year = place.visited_on?.slice(0, 4) ?? null;
    years.set(year, [...(years.get(year) ?? []), place]);
  }
  return [...years.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b.localeCompare(a)))
    .map(([year, list]) => ({
      year,
      places: [...list].sort(
        (a, b) =>
          (b.visited_on ?? "").localeCompare(a.visited_on ?? "") || a.name.localeCompare(b.name),
      ),
    }));
}

/** What to celebrate when `place` is marked visited: a new country, or just the place. */
export function visitMessage(places: readonly Place[], place: Place): string {
  const already = places.some(
    (other) =>
      other.id !== place.id &&
      other.status === "visited" &&
      other.country_code === place.country_code,
  );
  if (already) return `${place.name} is on your map.`;
  const country = COUNTRIES.get(place.country_code);
  const counted = travelStats([
    ...places.filter((other) => other.id !== place.id),
    {
      ...place,
      status: "visited",
    },
  ]);
  return country?.sovereign
    ? `New country: ${countryName(place.country_code)}. That’s ${counted.countries} ${
        counted.countries === 1 ? "country" : "countries"
      } now.`
    : `New on your map: ${countryName(place.country_code)}.`;
}

// Form

export const NAME_MAX_LENGTH = 120;
export const LOCALITY_MAX_LENGTH = 120;
export const NOTE_MAX_LENGTH = 1000;

export const placeSchema = object({
  name: singleLineText(NAME_MAX_LENGTH).required("Name the place."),
  locality: singleLineText(LOCALITY_MAX_LENGTH),
  countryCode: string()
    .defined()
    .required("Choose a country.")
    .test("country", "Choose a country.", (value) => COUNTRIES.has(value)),
  status: mixed<PlaceStatus>().oneOf(STATUSES).defined(),
  visitedOn: string().defined(),
  favorite: boolean().defined(),
  note: multiLineText(NOTE_MAX_LENGTH),
  /** `lat,lng` from place search, or empty for no pin. */
  location: string().defined(),
});

export type PlaceValues = InferType<typeof placeSchema>;

export function newPlaceValues(status: PlaceStatus = "visited"): PlaceValues {
  return {
    name: "",
    locality: "",
    countryCode: "",
    status,
    visitedOn: "",
    favorite: false,
    note: "",
    location: "",
  };
}

function locationText(location: { latitude: number; longitude: number } | null): string {
  return location ? `${location.latitude},${location.longitude}` : "";
}

function parseLocation(value: string): { latitude: number; longitude: number } | null {
  const [lat, lng] = value.split(",").map(Number);
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { latitude: lat, longitude: lng };
}

export function placeValues(place: Place): PlaceValues {
  return {
    name: place.name,
    locality: place.locality,
    countryCode: place.country_code,
    status: place.status,
    visitedOn: place.visited_on ?? "",
    favorite: place.favorite,
    note: place.note,
    location: locationText(place.location),
  };
}

/** Fill the form from a place search result, keeping what the user chose for the rest. */
export function withMatch(values: PlaceValues, match: PlaceMatch): PlaceValues {
  return {
    ...values,
    name: match.name,
    locality: match.locality,
    countryCode: match.country_code,
    location: locationText(match.location),
  };
}

export function createRequestOf(values: PlaceValues): CreatePlaceRequest {
  const visited = values.status === "visited";
  return {
    name: values.name.trim(),
    locality: values.locality.trim(),
    country_code: values.countryCode,
    status: values.status,
    location: parseLocation(values.location),
    visited_on: visited && values.visitedOn ? values.visitedOn : null,
    favorite: values.favorite,
    note: values.note.trim(),
  };
}

/** Only the fields the form changed, or `null` when nothing did. */
export function changesOf(place: Place, values: PlaceValues): UpdatePlaceRequest | null {
  const next = createRequestOf(values);
  const changes: UpdatePlaceRequest = {};
  if (next.name !== place.name) changes.name = next.name;
  if (next.locality !== place.locality) changes.locality = next.locality;
  if (next.country_code !== place.country_code) changes.country_code = next.country_code;
  if (next.status !== place.status) changes.status = next.status;
  if (next.visited_on !== place.visited_on) changes.visited_on = next.visited_on;
  if (next.favorite !== place.favorite) changes.favorite = next.favorite;
  if (next.note !== place.note) changes.note = next.note;
  if (locationText(next.location ?? null) !== locationText(place.location)) {
    changes.location = next.location ?? null;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}
