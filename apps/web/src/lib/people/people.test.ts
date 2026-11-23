import type { Person } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  avatarTone,
  changesOf,
  createRequestOf,
  filterPeople,
  groupUpcoming,
  initials,
  newPersonValues,
  nextOccurrence,
  occasion,
  parsePeopleView,
  peopleHref,
  personSchema,
  personValues,
  relativeDays,
  remindOptions,
  upcomingDates,
} from "./people";

function person(overrides: Partial<Person> & Pick<Person, "id" | "name">): Person {
  return {
    relationship: "friend",
    phone: "",
    email: "",
    note: "",
    favorite: false,
    dates: [],
    reminder_time: "09:00:00",
    timezone: "UTC",
    created_at: "2030-01-01T00:00:00Z",
    updated_at: "2030-01-01T00:00:00Z",
    ...overrides,
  };
}

const TODAY = { year: 2030, month: 3, day: 10 };

describe("views and links", () => {
  it("reads the view and builds links that open a person", () => {
    expect(parsePeopleView(new URLSearchParams("view=upcoming"))).toBe("upcoming");
    expect(parsePeopleView(new URLSearchParams("view=nope"))).toBe("everyone");
    expect(peopleHref()).toBe("/people");
    expect(peopleHref("upcoming", "p1")).toBe("/people?view=upcoming&person=p1");
  });
});

describe("avatars", () => {
  it("uses up to two initials and a stable tone", () => {
    expect(initials("priya sharma")).toBe("PS");
    expect(initials("  Amma ")).toBe("A");
    expect(initials("Jean Luc Picard")).toBe("JP");
    expect(avatarTone("p1")).toBe(avatarTone("p1"));
  });
});

describe("dates", () => {
  it("finds the next occurrence, counting today", () => {
    expect(nextOccurrence({ month: 3, day: 10 }, TODAY)).toEqual({
      on: { year: 2030, month: 3, day: 10 },
      daysAway: 0,
    });
    expect(nextOccurrence({ month: 3, day: 9 }, TODAY).on.year).toBe(2031);
  });

  it("puts 29 February on 28 February outside leap years", () => {
    expect(nextOccurrence({ month: 2, day: 29 }, { year: 2031, month: 1, day: 1 }).on).toEqual({
      year: 2031,
      month: 2,
      day: 28,
    });
    expect(nextOccurrence({ month: 2, day: 29 }, { year: 2032, month: 1, day: 1 }).on.day).toBe(29);
  });

  it("lists upcoming dates soonest first, with ages", () => {
    const priya = person({
      id: "p1",
      name: "Priya",
      dates: [{ kind: "birthday", label: "", month: 3, day: 20, year: 2000 }],
    });
    const sam = person({
      id: "p2",
      name: "Sam",
      dates: [{ kind: "anniversary", label: "", month: 3, day: 11, year: 2025 }],
    });
    const upcoming = upcomingDates([priya, sam], TODAY);
    expect(upcoming.map((item) => [item.person.name, item.daysAway, occasion(item)])).toEqual([
      ["Sam", 1, "Anniversary · 5 years"],
      ["Priya", 10, "Turns 30"],
    ]);
    expect(upcomingDates([priya, sam], TODAY, 5)).toHaveLength(1);
    expect(groupUpcoming(upcoming, TODAY).map((group) => group.label)).toEqual([
      "This week",
      "March",
    ]);
  });

  it("describes how far away a date is", () => {
    expect(relativeDays(0)).toBe("Today");
    expect(relativeDays(1)).toBe("Tomorrow");
    expect(relativeDays(4)).toBe("In 4 days");
    expect(relativeDays(21)).toBe("In 3 weeks");
    expect(relativeDays(200)).toBe("In 7 months");
  });
});

describe("filtering", () => {
  it("matches every word of the query and the relationship", () => {
    const people = [
      person({ id: "a", name: "Amma", relationship: "family", note: "Loves jasmine" }),
      person({ id: "b", name: "Ben", relationship: "colleague" }),
    ];
    expect(filterPeople(people, "jasmine", null).map((p) => p.id)).toEqual(["a"]);
    expect(filterPeople(people, "", "colleague").map((p) => p.id)).toEqual(["b"]);
  });
});

describe("the form", () => {
  it("validates days the month lacks and both-or-neither month and day", async () => {
    const values = { ...newPersonValues(), name: "Priya" };
    await expect(
      personSchema.validate({ ...values, birthdayMonth: "4", birthdayDay: "31" }),
    ).rejects.toThrow("April has no day 31.");
    await expect(
      personSchema.validate({
        ...values,
        birthdayMonth: "2",
        birthdayDay: "29",
        birthdayYear: "2023",
      }),
    ).rejects.toThrow("February 2023 has no day 29.");
    await expect(personSchema.validate({ ...values, birthdayMonth: "2" })).rejects.toThrow(
      "Choose both a month and a day.",
    );
    await expect(
      personSchema.validate({ ...values, birthdayMonth: "2", birthdayDay: "29" }),
    ).resolves.toBeTruthy();
  });

  it("turns values into a request and back, and sends only changes", () => {
    const values = {
      ...newPersonValues(),
      name: " Priya ",
      birthdayMonth: "3",
      birthdayDay: "20",
      birthdayYear: "2000",
      birthdayRemind: "7",
      others: [
        { kind: "other" as const, label: "Name day", month: "7", day: "4", year: "", remind: "" },
      ],
    };
    const request = createRequestOf(values, "Asia/Kolkata");
    expect(request).toMatchObject({
      name: "Priya",
      timezone: "Asia/Kolkata",
      reminder_time: "09:00:00",
      dates: [
        { kind: "birthday", label: "", month: 3, day: 20, year: 2000, remind_days_before: 7 },
        {
          kind: "other",
          label: "Name day",
          month: 7,
          day: 4,
          year: null,
          remind_days_before: null,
        },
      ],
    });
    const saved = person({ id: "p1", name: "Priya", dates: request.dates ?? [] });
    expect(changesOf(saved, personValues(saved))).toBeNull();
    expect(changesOf(saved, { ...personValues(saved), favorite: true })).toEqual({
      favorite: true,
    });
    expect(changesOf(saved, { ...personValues(saved), birthdayRemind: "" })?.dates?.[0]).toEqual(
      expect.objectContaining({ remind_days_before: null }),
    );
  });

  it("keeps a reminder value that isn't a preset", () => {
    expect(remindOptions("5").at(-1)).toEqual({ value: "5", label: "5 days before" });
    expect(remindOptions("7")).toHaveLength(7);
  });
});
