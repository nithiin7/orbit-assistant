import type { Place } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  changesOf,
  CODE_BY_NUMERIC,
  continentProgress,
  continentsIn,
  COUNTRIES,
  COUNTRY_OPTIONS,
  countryName,
  countryStatuses,
  createRequestOf,
  groupByCountry,
  groupByYear,
  matchesText,
  milestones,
  newPlaceValues,
  nextMilestone,
  parsePlacesView,
  placeSchema,
  placesHref,
  placeValues,
  sortCountryGroups,
  sortWishes,
  SOVEREIGN_COUNT,
  travelStats,
  visitMessage,
  withMatch,
  yearInTravel,
} from ".";

function place(overrides: Partial<Place> & Pick<Place, "id" | "name" | "country_code">): Place {
  return {
    locality: "",
    location: null,
    status: "visited",
    visited_on: null,
    favorite: false,
    note: "",
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    ...overrides,
  } satisfies Place;
}

describe("countries", () => {
  it("covers every ISO code once, with the UN's 195 countries", () => {
    expect(COUNTRIES.size).toBe(249);
    expect([...COUNTRIES.values()].filter((country) => country.sovereign)).toHaveLength(
      SOVEREIGN_COUNT,
    );
    expect(CODE_BY_NUMERIC.size).toBe(249);
    expect(CODE_BY_NUMERIC.get("392")).toBe("JP");
    expect(COUNTRIES.get("HK")?.sovereign).toBe(false);
    expect(COUNTRY_OPTIONS).toHaveLength(249);
  });

  it("names countries", () => {
    expect(countryName("JP")).toBe("Japan");
  });
});

describe("views", () => {
  it("reads and links views", () => {
    expect(parsePlacesView(new URLSearchParams())).toBe("overview");
    expect(parsePlacesView(new URLSearchParams("view=wishlist"))).toBe("wishlist");
    expect(parsePlacesView(new URLSearchParams("view=nope"))).toBe("overview");
    expect(placesHref("overview")).toBe("/places");
    expect(placesHref("visited")).toBe("/places?view=visited");
  });
});

describe("travelStats", () => {
  it("counts countries, regions, continents, and the share of the world", () => {
    const places = [
      place({ id: "1", name: "Kyoto", country_code: "JP", visited_on: "2024-04-02" }),
      place({ id: "2", name: "Tokyo", country_code: "JP", visited_on: "2025-01-10" }),
      place({ id: "3", name: "Lisbon", country_code: "PT" }),
      place({ id: "4", name: "Hong Kong", country_code: "HK" }),
      place({ id: "5", name: "Reykjavik", country_code: "IS", status: "want_to_visit" }),
      place({ id: "6", name: "Porto", country_code: "PT", status: "want_to_visit" }),
    ];
    const stats = travelStats(places);
    expect(stats.countries).toBe(2);
    expect(stats.regions).toBe(1);
    expect(stats.worldShare).toBe(1);
    expect(stats.continents).toEqual(["AS", "EU"]);
    expect(stats.visitedPlaces).toBe(4);
    expect(stats.wishlistPlaces).toBe(2);
    expect(stats.newCountriesOnWishlist).toBe(1);
    expect(stats.latest?.name).toBe("Tokyo");
  });

  it("starts at zero", () => {
    expect(travelStats([])).toMatchObject({ countries: 0, worldShare: 0, continents: [] });
  });
});

describe("countryStatuses", () => {
  it("lets a visit win over a wish", () => {
    const statuses = countryStatuses([
      place({ id: "1", name: "Porto", country_code: "PT", status: "want_to_visit" }),
      place({ id: "2", name: "Lisbon", country_code: "PT" }),
      place({ id: "3", name: "Reykjavik", country_code: "IS", status: "want_to_visit" }),
    ]);
    expect(statuses.get("PT")).toBe("visited");
    expect(statuses.get("IS")).toBe("want_to_visit");
  });
});

describe("groupByCountry", () => {
  it("groups one status by country, biggest first, newest visit first", () => {
    const groups = groupByCountry(
      [
        place({ id: "1", name: "Lisbon", country_code: "PT" }),
        place({ id: "2", name: "Kyoto", country_code: "JP", visited_on: "2024-04-02" }),
        place({ id: "3", name: "Tokyo", country_code: "JP", visited_on: "2025-01-10" }),
        place({ id: "4", name: "Oslo", country_code: "NO", status: "want_to_visit" }),
      ],
      "visited",
    );
    expect(groups.map((group) => group.code)).toEqual(["JP", "PT"]);
    expect(groups[0]?.places.map((entry) => entry.name)).toEqual(["Tokyo", "Kyoto"]);
    expect(groups[0]?.lastVisited).toBe("2025-01-10");
    expect(groups[1]?.lastVisited).toBeNull();
  });
});

describe("matchesText", () => {
  it("matches name, city, country, and note", () => {
    const kyoto = place({
      id: "1",
      name: "Fushimi Inari",
      locality: "Kyoto",
      country_code: "JP",
      note: "Go early",
    });
    expect(matchesText(kyoto, "")).toBe(true);
    expect(matchesText(kyoto, "inari")).toBe(true);
    expect(matchesText(kyoto, "kyoto")).toBe(true);
    expect(matchesText(kyoto, "japan")).toBe(true);
    expect(matchesText(kyoto, "early")).toBe(true);
    expect(matchesText(kyoto, "paris")).toBe(false);
  });
});

describe("form", () => {
  it("builds a create request, dropping a date on a wish", () => {
    const values = {
      ...newPlaceValues("want_to_visit"),
      name: "  Reykjavik ",
      countryCode: "IS",
      visitedOn: "2025-01-01",
    };
    expect(createRequestOf(values)).toEqual({
      name: "Reykjavik",
      locality: "",
      country_code: "IS",
      status: "want_to_visit",
      location: null,
      visited_on: null,
      favorite: false,
      note: "",
    });
  });

  it("fills in from a search match", () => {
    const values = withMatch(newPlaceValues(), {
      name: "Kyoto",
      locality: "Kyoto Prefecture",
      country_code: "JP",
      location: { latitude: 35.0116, longitude: 135.7681 },
      label: "Kyoto, Japan",
    });
    expect(createRequestOf(values)).toMatchObject({
      name: "Kyoto",
      locality: "Kyoto Prefecture",
      country_code: "JP",
      location: { latitude: 35.0116, longitude: 135.7681 },
    });
  });

  it("sends only what changed", () => {
    const kyoto = place({
      id: "1",
      name: "Kyoto",
      country_code: "JP",
      location: { latitude: 35, longitude: 135 },
    });
    expect(changesOf(kyoto, placeValues(kyoto))).toBeNull();
    expect(changesOf(kyoto, { ...placeValues(kyoto), favorite: true, location: "" })).toEqual({
      favorite: true,
      location: null,
    });
    expect(
      changesOf(kyoto, { ...placeValues(kyoto), status: "want_to_visit", visitedOn: "2024-01-01" }),
    ).toEqual({ status: "want_to_visit" });
  });

  it("validates the name and country", async () => {
    await expect(placeSchema.validate({ ...newPlaceValues(), countryCode: "PT" })).rejects.toThrow(
      "Name the place.",
    );
    await expect(
      placeSchema.validate({ ...newPlaceValues(), name: "Somewhere", countryCode: "ZZ" }),
    ).rejects.toThrow("Choose a country.");
  });
});

describe("lists", () => {
  const kyoto = place({ id: "1", name: "Kyoto", country_code: "JP", visited_on: "2024-04-02" });
  const tokyo = place({ id: "2", name: "Tokyo", country_code: "JP", visited_on: "2025-01-10" });
  const lisbon = place({ id: "3", name: "Lisbon", country_code: "PT", visited_on: "2025-06-01" });
  const oslo = place({ id: "4", name: "Oslo", country_code: "NO" });

  it("finds the continents in a list", () => {
    expect(continentsIn([lisbon, kyoto, oslo])).toEqual(["AS", "EU"]);
  });

  it("sorts countries by places, recency, or name", () => {
    const groups = groupByCountry([kyoto, tokyo, lisbon, oslo], "visited");
    expect(sortCountryGroups(groups, "places").map((group) => group.code)).toEqual([
      "JP",
      "NO",
      "PT",
    ]);
    expect(sortCountryGroups(groups, "recent").map((group) => group.code)).toEqual([
      "PT",
      "JP",
      "NO",
    ]);
    expect(sortCountryGroups(groups, "name").map((group) => group.code)).toEqual([
      "JP",
      "NO",
      "PT",
    ]);
  });

  it("groups visits by year, undated last", () => {
    expect(
      groupByYear([kyoto, tokyo, lisbon, oslo]).map((entry) => [
        entry.year,
        entry.places.map((p) => p.name),
      ]),
    ).toEqual([
      ["2025", ["Lisbon", "Tokyo"]],
      ["2024", ["Kyoto"]],
      [null, ["Oslo"]],
    ]);
  });

  it("puts favorite wishes first", () => {
    const wishes = [
      place({ id: "a", name: "Bali", country_code: "ID", created_at: "2026-11-03T00:00:00Z" }),
      place({ id: "b", name: "Cusco", country_code: "PE", favorite: true }),
    ];
    expect(sortWishes(wishes, "favorites").map((p) => p.name)).toEqual(["Cusco", "Bali"]);
    expect(sortWishes(wishes, "newest").map((p) => p.name)).toEqual(["Bali", "Cusco"]);
    expect(sortWishes(wishes, "country").map((p) => p.name)).toEqual(["Bali", "Cusco"]);
  });

  it("celebrates a new country, and not a repeat", () => {
    const wish = place({ id: "w", name: "Porto", country_code: "PT", status: "want_to_visit" });
    expect(visitMessage([kyoto, wish], wish)).toBe(
      "New country: Portugal. That’s 2 countries now.",
    );
    expect(visitMessage([lisbon, wish], wish)).toBe("Porto is on your map.");
    const hk = place({ id: "h", name: "Hong Kong", country_code: "HK", status: "want_to_visit" });
    expect(visitMessage([hk], hk)).toMatch(/^New on your map: Hong Kong/);
  });
});

describe("your world", () => {
  const places = [
    place({ id: "1", name: "Kyoto", country_code: "JP", visited_on: "2026-04-02" }),
    place({ id: "2", name: "Hong Kong", country_code: "HK", visited_on: "2025-01-10" }),
    place({ id: "3", name: "Lisbon", country_code: "PT", visited_on: "2026-06-01" }),
    place({ id: "4", name: "Oslo", country_code: "NO", status: "want_to_visit" }),
  ];

  it("tracks each inhabited continent against its countries", () => {
    const progress = continentProgress(places);
    expect(progress.map((entry) => entry.continent)).toEqual(["AF", "AS", "EU", "NA", "OC", "SA"]);
    const asia = progress.find((entry) => entry.continent === "AS");
    // Hong Kong gets a flag but doesn't count as a country.
    expect(asia).toMatchObject({ countries: 1, codes: ["HK", "JP"] });
    expect(asia?.total).toBeGreaterThan(40);
    expect(progress.reduce((sum, entry) => sum + entry.total, 0)).toBe(SOVEREIGN_COUNT);
  });

  it("unlocks milestones and picks the closest next one", () => {
    const list = milestones(travelStats(places));
    expect(list.filter((m) => m.reached).map((m) => m.id)).toEqual(["countries-1"]);
    const next = nextMilestone(list);
    // Two of three continents is closer than two of five countries.
    expect(next).toMatchObject({ id: "continents-3", remaining: "1 more continent" });
    expect(list.find((m) => m.id === "countries-5")?.remaining).toBe("3 more countries");
  });

  it("sums up a year", () => {
    expect(yearInTravel(places, "2026")).toEqual({ year: "2026", places: 2, countries: 2 });
    expect(yearInTravel(places, "2020")).toEqual({ year: "2020", places: 0, countries: 0 });
  });
});
