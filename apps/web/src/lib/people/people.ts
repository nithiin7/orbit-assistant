import type {
  CreatePersonRequest,
  Person,
  PersonDate,
  PersonDateKind,
  PersonRelationship,
  UpdatePersonRequest,
} from "@orbit/contracts";
import { array, boolean, type InferType, mixed, object, string } from "yup";

import { type Option } from "@/utils/common";
import { multiLineText, singleLineText } from "@/utils/validation";

// Limits, matching the API.
export const NAME_MAX_LENGTH = 120;
export const PHONE_MAX_LENGTH = 40;
export const EMAIL_MAX_LENGTH = 254;
export const NOTE_MAX_LENGTH = 2000;
export const LABEL_MAX_LENGTH = 60;
export const MAX_DATES = 10;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

// Views

export type PeopleView = "everyone" | "upcoming" | "money";

export const PEOPLE_VIEWS: readonly Option<PeopleView>[] = [
  { value: "everyone", label: "Everyone" },
  { value: "upcoming", label: "Upcoming dates" },
  { value: "money", label: "Money" },
];

export function parsePeopleView(params: URLSearchParams): PeopleView {
  const view = params.get("view");
  return PEOPLE_VIEWS.find((option) => option.value === view)?.value ?? "everyone";
}

/** A link to a People view, optionally opening one person. */
export function peopleHref(view: PeopleView = "everyone", personId?: string): string {
  const params = new URLSearchParams();
  if (view !== "everyone") params.set("view", view);
  if (personId) params.set("person", personId);
  const query = params.toString();
  return query ? `/people?${query}` : "/people";
}

// Relationships

export const RELATIONSHIPS: readonly PersonRelationship[] = [
  "family",
  "partner",
  "friend",
  "colleague",
  "other",
];

export const RELATIONSHIP_LABELS: Readonly<Record<PersonRelationship, string>> = {
  family: "Family",
  partner: "Partner",
  friend: "Friend",
  colleague: "Colleague",
  other: "Other",
};

/** The filter chips' labels, one per relationship. */
export const RELATIONSHIP_FILTER_LABELS: Readonly<Record<PersonRelationship, string>> = {
  family: "Family",
  partner: "Partner",
  friend: "Friends",
  colleague: "Colleagues",
  other: "Other",
};

export const RELATIONSHIP_OPTIONS: readonly Option<PersonRelationship>[] = RELATIONSHIPS.map(
  (value) => ({ value, label: RELATIONSHIP_LABELS[value] }),
);

/** People whose name or note matches `query`, in a relationship, or everyone. */
export function filterPeople(
  people: readonly Person[],
  query: string,
  relationship: PersonRelationship | null,
): Person[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return people.filter((person) => {
    if (relationship !== null && person.relationship !== relationship) return false;
    const text = `${person.name} ${person.note}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}

// Avatars

/**
 * Each person's colour, used on their avatar, their card, and the banner of their detail. Written
 * out in full so Tailwind sees every class.
 */
const PERSON_TONES = [
  {
    avatar: "from-event-rose/35 to-event-rose/10 text-event-rose ring-event-rose/25",
    wash: "from-event-rose/15",
    dot: "bg-event-rose",
  },
  {
    avatar: "from-event-amber/35 to-event-amber/10 text-event-amber ring-event-amber/25",
    wash: "from-event-amber/15",
    dot: "bg-event-amber",
  },
  {
    avatar: "from-event-green/35 to-event-green/10 text-event-green ring-event-green/25",
    wash: "from-event-green/15",
    dot: "bg-event-green",
  },
  {
    avatar: "from-event-teal/35 to-event-teal/10 text-event-teal ring-event-teal/25",
    wash: "from-event-teal/15",
    dot: "bg-event-teal",
  },
  {
    avatar: "from-event-blue/35 to-event-blue/10 text-event-blue ring-event-blue/25",
    wash: "from-event-blue/15",
    dot: "bg-event-blue",
  },
  {
    avatar: "from-event-violet/35 to-event-violet/10 text-event-violet ring-event-violet/25",
    wash: "from-event-violet/15",
    dot: "bg-event-violet",
  },
  {
    avatar: "from-event-orange/35 to-event-orange/10 text-event-orange ring-event-orange/25",
    wash: "from-event-orange/15",
    dot: "bg-event-orange",
  },
] as const;

export type PersonTone = (typeof PERSON_TONES)[number];

/** Up to two initials: the first letters of the first and last words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0] ?? "")[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1] ?? "")[0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

/** A tone picked from the person's ID, so it stays the same across renames and devices. */
export function personTone(id: string): PersonTone {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PERSON_TONES[hash % PERSON_TONES.length] ?? PERSON_TONES[0];
}

// Calendar dates

/** A calendar date with a one-based month, free of time zones. */
export type CalendarDay = { year: number; month: number; day: number };

/** Today's date where the browser is. */
export function localToday(now: Date = new Date()): CalendarDay {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayNumber({ year, month, day }: CalendarDay): number {
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** The date in `year`. 29 February falls on 28 February outside leap years. */
export function occurrence(date: Pick<PersonDate, "month" | "day">, year: number): CalendarDay {
  return { year, month: date.month, day: Math.min(date.day, daysInMonth(year, date.month)) };
}

/** The next time the date comes round (today or later), and how many days away it is. */
export function nextOccurrence(
  date: Pick<PersonDate, "month" | "day">,
  today: CalendarDay,
): { on: CalendarDay; daysAway: number } {
  let on = occurrence(date, today.year);
  if (dayNumber(on) < dayNumber(today)) on = occurrence(date, today.year + 1);
  return { on, daysAway: dayNumber(on) - dayNumber(today) };
}

/** How old they turn, or how many years it has been, in `year`; `null` without a year. */
export function yearsOn(date: Pick<PersonDate, "year">, year: number): number | null {
  if (date.year === null || date.year === undefined) return null;
  const years = year - date.year;
  return years > 0 ? years : null;
}

export type UpcomingDate = {
  person: Person;
  date: PersonDate;
  on: CalendarDay;
  daysAway: number;
  years: number | null;
};

/** Every date coming up within `withinDays` (today counts), soonest first. */
export function upcomingDates(
  people: readonly Person[],
  today: CalendarDay,
  withinDays = 366,
): UpcomingDate[] {
  const upcoming: UpcomingDate[] = [];
  for (const person of people) {
    for (const date of person.dates) {
      const { on, daysAway } = nextOccurrence(date, today);
      if (daysAway >= withinDays) continue;
      upcoming.push({ person, date, on, daysAway, years: yearsOn(date, on.year) });
    }
  }
  return upcoming.sort(
    (a, b) => a.daysAway - b.daysAway || a.person.name.localeCompare(b.person.name),
  );
}

/** The person's soonest date, if they have any. */
export function nextDateOf(person: Person, today: CalendarDay): UpcomingDate | null {
  return upcomingDates([person], today)[0] ?? null;
}

export function birthdayOf(person: Person): PersonDate | null {
  return person.dates.find((date) => date.kind === "birthday") ?? null;
}

export const DATE_KIND_LABELS: Readonly<Record<PersonDateKind, string>> = {
  birthday: "Birthday",
  anniversary: "Anniversary",
  other: "Date",
};

/** What a date is called: "Birthday", "Anniversary", or the user's label. */
export function dateLabel(date: PersonDate): string {
  return date.kind === "other" ? date.label : DATE_KIND_LABELS[date.kind];
}

/** A short line for an upcoming date: "Turns 30", "Birthday", "Anniversary · 5 years". */
export function occasion(upcoming: Pick<UpcomingDate, "date" | "years">): string {
  const { date, years } = upcoming;
  if (date.kind === "birthday") return years ? `Turns ${years}` : "Birthday";
  if (years) return `${dateLabel(date)} · ${years} ${years === 1 ? "year" : "years"}`;
  return dateLabel(date);
}

export function relativeDays(daysAway: number): string {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  if (daysAway < 7) return `In ${daysAway} days`;
  if (daysAway < 14) return "Next week";
  if (daysAway < 60) return `In ${Math.round(daysAway / 7)} weeks`;
  return `In ${Math.round(daysAway / 30.4)} months`;
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? "";
}

/** "12 Mar", or "12 Mar 1996" when the year is given. */
export function formatDayMonth(date: Pick<PersonDate, "month" | "day" | "year">): string {
  const short = monthName(date.month).slice(0, 3);
  return date.year ? `${date.day} ${short} ${date.year}` : `${date.day} ${short}`;
}

export type MonthGroup = { key: string; label: string; items: UpcomingDate[] };

/** Upcoming dates in "This week", then by month. */
export function groupUpcoming(upcoming: readonly UpcomingDate[], today: CalendarDay): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const item of upcoming) {
    const soon = item.daysAway < 7;
    const key = soon ? "soon" : `${item.on.year}-${item.on.month}`;
    const label = soon
      ? "This week"
      : item.on.year === today.year
        ? monthName(item.on.month)
        : `${monthName(item.on.month)} ${item.on.year}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, label, items: [item] });
  }
  return groups;
}

// Reminders

export const REMIND_OPTIONS: readonly Option<string>[] = [
  { value: "", label: "Don’t remind me" },
  { value: "0", label: "On the day" },
  { value: "1", label: "A day before" },
  { value: "3", label: "3 days before" },
  { value: "7", label: "A week before" },
  { value: "14", label: "2 weeks before" },
  { value: "30", label: "A month before" },
];

/** The reminder choices, including a value set elsewhere that isn't one of the presets. */
export function remindOptions(current: string): readonly Option<string>[] {
  if (REMIND_OPTIONS.some((option) => option.value === current)) return REMIND_OPTIONS;
  const days = Number(current);
  return [...REMIND_OPTIONS, { value: current, label: `${days} days before` }];
}

export function remindLabel(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null;
  return remindOptions(String(days)).find((option) => option.value === String(days))?.label ?? null;
}

// Form

export const MONTH_OPTIONS: readonly Option<string>[] = MONTH_NAMES.map((name, index) => ({
  value: String(index + 1),
  label: name,
}));

/** Day choices for a month; every day up to 31 while no month is chosen. */
export function dayOptions(month: string): readonly Option<string>[] {
  const count = month ? daysInMonth(2000, Number(month)) : 31;
  return Array.from({ length: count }, (_, index) => ({
    value: String(index + 1),
    label: String(index + 1),
  }));
}

const yearText = string()
  .trim()
  .defined()
  .test(
    "year",
    `Use a year from ${MIN_YEAR} to ${MAX_YEAR}.`,
    (value) =>
      value === "" ||
      (/^\d{4}$/.test(value) && Number(value) >= MIN_YEAR && Number(value) <= MAX_YEAR),
  );

/** Month and day both or neither, and a day the month has (29 February only in leap years). */
function validDay(values: { month: string; day: string; year: string }): string | null {
  if (!values.month && !values.day) return null;
  if (!values.month || !values.day) return "Choose both a month and a day.";
  const year = /^\d{4}$/.test(values.year) ? Number(values.year) : 2000;
  if (Number(values.day) > daysInMonth(year, Number(values.month))) {
    return `${monthName(Number(values.month))} ${values.year ? `${values.year} ` : ""}has no day ${values.day}.`;
  }
  return null;
}

const otherDateSchema = object({
  kind: mixed<"anniversary" | "other">().oneOf(["anniversary", "other"]).defined(),
  label: singleLineText(LABEL_MAX_LENGTH).when("kind", {
    is: "other",
    then: (schema) => schema.required("Name the date."),
  }),
  month: string().defined().required("Choose a month."),
  day: string()
    .defined()
    .required("Choose a day.")
    .test("valid-day", "", function check(day) {
      const parent = this.parent as { month: string; year: string };
      const message = validDay({ month: parent.month, day, year: parent.year });
      return message ? this.createError({ message }) : true;
    }),
  year: yearText,
  remind: string().defined(),
});

export const personSchema = object({
  name: singleLineText(NAME_MAX_LENGTH).required("Add their name."),
  relationship: mixed<PersonRelationship>().oneOf(RELATIONSHIPS).defined(),
  birthdayMonth: string().defined(),
  birthdayDay: string()
    .defined()
    .test("valid-day", "", function check(day) {
      const parent = this.parent as { birthdayMonth: string; birthdayYear: string };
      const message = validDay({
        month: parent.birthdayMonth,
        day,
        year: parent.birthdayYear,
      });
      return message ? this.createError({ message }) : true;
    }),
  birthdayYear: yearText,
  birthdayRemind: string().defined(),
  others: array(otherDateSchema)
    .defined()
    .max(MAX_DATES - 1),
  phone: singleLineText(PHONE_MAX_LENGTH),
  email: singleLineText(EMAIL_MAX_LENGTH).email("Enter an email address like name@example.com."),
  note: multiLineText(NOTE_MAX_LENGTH),
  favorite: boolean().defined(),
  reminderTime: string()
    .defined()
    .matches(/^\d{2}:\d{2}$/, "Choose a time."),
});

export type PersonValues = InferType<typeof personSchema>;
export type OtherDateValues = PersonValues["others"][number];

export function newOtherDate(kind: OtherDateValues["kind"] = "anniversary"): OtherDateValues {
  return { kind, label: "", month: "", day: "", year: "", remind: "0" };
}

export function newPersonValues(): PersonValues {
  return {
    name: "",
    relationship: "friend",
    birthdayMonth: "",
    birthdayDay: "",
    birthdayYear: "",
    birthdayRemind: "0",
    others: [],
    phone: "",
    email: "",
    note: "",
    favorite: false,
    reminderTime: "09:00",
  };
}

function remindText(days: number | null | undefined): string {
  return days === null || days === undefined ? "" : String(days);
}

export function personValues(person: Person): PersonValues {
  const birthday = birthdayOf(person);
  return {
    name: person.name,
    relationship: person.relationship,
    birthdayMonth: birthday ? String(birthday.month) : "",
    birthdayDay: birthday ? String(birthday.day) : "",
    birthdayYear: birthday?.year ? String(birthday.year) : "",
    birthdayRemind: birthday ? remindText(birthday.remind_days_before) : "0",
    others: person.dates
      .filter((date) => date.kind !== "birthday")
      .map((date) => ({
        kind: date.kind === "other" ? "other" : "anniversary",
        label: date.label,
        month: String(date.month),
        day: String(date.day),
        year: date.year ? String(date.year) : "",
        remind: remindText(date.remind_days_before),
      })),
    phone: person.phone,
    email: person.email,
    note: person.note,
    favorite: person.favorite,
    reminderTime: person.reminder_time.slice(0, 5),
  };
}

function toDate(
  kind: PersonDateKind,
  label: string,
  fields: { month: string; day: string; year: string; remind: string },
): PersonDate {
  return {
    kind,
    label: kind === "other" ? label.trim() : "",
    month: Number(fields.month),
    day: Number(fields.day),
    year: fields.year ? Number(fields.year) : null,
    remind_days_before: fields.remind === "" ? null : Number(fields.remind),
  };
}

export function datesOf(values: PersonValues): PersonDate[] {
  const dates: PersonDate[] = [];
  if (values.birthdayMonth && values.birthdayDay) {
    dates.push(
      toDate("birthday", "", {
        month: values.birthdayMonth,
        day: values.birthdayDay,
        year: values.birthdayYear,
        remind: values.birthdayRemind,
      }),
    );
  }
  for (const other of values.others) dates.push(toDate(other.kind, other.label, other));
  return dates;
}

export function createRequestOf(values: PersonValues, timezone: string): CreatePersonRequest {
  return {
    name: values.name.trim(),
    relationship: values.relationship,
    phone: values.phone.trim(),
    email: values.email.trim(),
    note: values.note.trim(),
    favorite: values.favorite,
    dates: datesOf(values),
    reminder_time: `${values.reminderTime}:00`,
    timezone,
  };
}

function sameDates(a: readonly PersonDate[], b: readonly PersonDate[]): boolean {
  const normal = (date: PersonDate) => [
    date.kind,
    date.label,
    date.month,
    date.day,
    date.year ?? null,
    date.remind_days_before ?? null,
  ];
  return JSON.stringify(a.map(normal)) === JSON.stringify(b.map(normal));
}

/** The fields that changed, or `null` when nothing did. */
export function changesOf(person: Person, values: PersonValues): UpdatePersonRequest | null {
  const next = createRequestOf(values, person.timezone);
  const changes: UpdatePersonRequest = {};
  if (next.name !== person.name) changes.name = next.name;
  if (next.relationship !== person.relationship) changes.relationship = next.relationship;
  if (next.phone !== person.phone) changes.phone = next.phone;
  if (next.email !== person.email) changes.email = next.email;
  if (next.note !== person.note) changes.note = next.note;
  if (next.favorite !== person.favorite) changes.favorite = next.favorite;
  if (!sameDates(next.dates ?? [], person.dates)) changes.dates = next.dates;
  if (values.reminderTime !== person.reminder_time.slice(0, 5)) {
    changes.reminder_time = next.reminder_time;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/** A `tel:` link for a phone number, keeping only what dialers understand. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

// On the calendar

/** One date on the calendar: whose it is, what it says, and its local date (`YYYY-MM-DD`). */
export type CalendarPersonDate = {
  personId: string;
  kind: PersonDateKind;
  title: string;
  day: string;
};

function isoDay({ year, month, day }: CalendarDay): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** What a date says on the calendar: "Priya turns 30", "Sam’s anniversary · 5 years". */
export function calendarTitle(name: string, date: PersonDate, years: number | null): string {
  if (date.kind === "birthday") return years ? `${name} turns ${years}` : `${name}’s birthday`;
  if (date.kind === "anniversary") {
    return years
      ? `${name}’s anniversary · ${years} ${years === 1 ? "year" : "years"}`
      : `${name}’s anniversary`;
  }
  return `${name}: ${date.label}`;
}

/** Every date falling on local days `start` (inclusive) to `end` (exclusive), `YYYY-MM-DD`. */
export function datesBetween(
  people: readonly Person[],
  start: string,
  end: string,
): CalendarPersonDate[] {
  const first = Number(start.slice(0, 4));
  const last = Number(end.slice(0, 4));
  const found: CalendarPersonDate[] = [];
  for (const person of people) {
    for (const date of person.dates) {
      for (let year = first; year <= last; year += 1) {
        // Like reminders: nothing to celebrate until a year after the date first happened.
        if (date.year && year <= date.year) continue;
        const day = isoDay(occurrence(date, year));
        if (day < start || day >= end) continue;
        found.push({
          personId: person.id,
          kind: date.kind,
          title: calendarTitle(person.name, date, yearsOn(date, year)),
          day,
        });
      }
    }
  }
  return found;
}
