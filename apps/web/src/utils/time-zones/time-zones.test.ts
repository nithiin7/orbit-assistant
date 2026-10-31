import { describe, expect, it } from "vitest";

import { localParts, sameTimeZone, timeZoneLabel, timeZoneNames } from "./time-zones";

describe("time zones", () => {
  it("treat aliases of one zone as the same zone", () => {
    expect(sameTimeZone("Asia/Kolkata", "Asia/Calcutta")).toBe(true);
    expect(sameTimeZone("Europe/Paris", "Europe/Paris")).toBe(true);
    expect(sameTimeZone("Europe/Paris", "Europe/Berlin")).toBe(false);
    expect(sameTimeZone("Not/AZone", "UTC")).toBe(false);
  });

  it("read an instant on another zone's wall clock, across midnight and DST", () => {
    const instant = new Date("2030-01-14T23:30:00Z");
    expect(localParts(instant, "Asia/Tokyo")).toEqual({ date: "2030-01-15", time: "08:30" });
    expect(localParts(instant, "America/Los_Angeles")).toEqual({
      date: "2030-01-14",
      time: "15:30",
    });
    // New York switches to daylight time at 02:00 on 2026-03-08.
    expect(localParts(new Date("2026-03-08T07:30:00Z"), "America/New_York").time).toBe("03:30");
  });

  it("list zones with UTC and the extras a form needs", () => {
    const names = timeZoneNames("Europe/Paris", null, "Etc/GMT+5");
    expect(names).toContain("UTC");
    expect(names).toContain("Europe/Paris");
    expect(names).toContain("Etc/GMT+5");
    expect(new Set(names).size).toBe(names.length);
    expect(timeZoneLabel("America/Argentina/Buenos_Aires")).toBe(
      "America / Argentina / Buenos Aires",
    );
  });
});
