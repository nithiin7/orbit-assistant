import { describe, expect, it } from "vitest";

import {
  addDays,
  daysBetween,
  formatCalendarDate,
  localDateString,
  localMonthString,
  monthLabel,
  monthRange,
  shiftMonth,
} from "./dates";

describe("local dates", () => {
  it("formats local dates like the API's calendar dates", () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
    expect(localMonthString(new Date(2026, 11, 31, 23, 59))).toBe("2026-12");
  });

  it("counts calendar days across month and year ends", () => {
    expect(daysBetween("2026-10-29", "2026-10-29")).toBe(0);
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-03-01", "2026-02-28")).toBe(-1);
  });

  it("formats a calendar date without shifting it across time zones", () => {
    expect(formatCalendarDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatCalendarDate("2026-12-31", { omitYearIn: 2026 })).toBe("Dec 31");
  });
});

describe("months", () => {
  it("shifts across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 3)).toBe("2027-02");
  });

  it("knows month lengths, including leap years", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("labels months", () => {
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthLabel("2026-10", { short: true })).toBe("Oct");
  });
});

describe("addDays", () => {
  it("moves across month, year, and leap-day boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-03-15", -30)).toBe("2026-02-13");
  });
});
