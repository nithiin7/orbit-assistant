"use client";

import type { Person, PersonBalance, PersonRelationship } from "@orbit/contracts";
import {
  Cake,
  Mail,
  MoreHorizontal,
  PartyPopper,
  Pencil,
  Phone,
  Search,
  SearchX,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ChoiceChips } from "@/components/watchlist/choice-chips";
import {
  balanceText,
  type CalendarDay,
  filterPeople,
  formatDayMonth,
  groupUpcoming,
  monthName,
  nextDateOf,
  occasion,
  personTone,
  RELATIONSHIP_FILTER_LABELS,
  RELATIONSHIP_LABELS,
  RELATIONSHIPS,
  relativeDays,
  telHref,
  type UpcomingDate,
  upcomingDates,
} from "@/lib/people";
import { cn } from "@/utils/common";

import { DATE_ICONS } from "./date-icon";
import { PersonAvatar } from "./person-avatar";

export type PersonActions = {
  open: (person: Person) => void;
  edit: (person: Person) => void;
  toggleFavorite: (person: Person) => void;
  remove: (person: Person) => void;
};

/** A small uppercase label over a group, with how many it holds. */
export function GroupHeading({
  id,
  children,
  count,
}: {
  id?: string;
  children: string;
  count?: number;
}) {
  return (
    <h3
      id={id}
      className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase"
    >
      {children}
      {count === undefined ? null : (
        <span className="rounded-full bg-muted px-1.5 py-px text-[0.6875rem] font-medium tracking-normal tabular-nums">
          {count}
        </span>
      )}
    </h3>
  );
}

// Everyone

type Filter = PersonRelationship | "all";

/** Everyone as cards, with a search box and relationship chips. */
export function EveryoneList({
  people,
  balances,
  today,
  query,
  relationship,
  onQuery,
  onRelationship,
  actions,
}: {
  people: readonly Person[];
  /** Each person's open balances, by person ID. */
  balances: ReadonlyMap<string, readonly PersonBalance[]>;
  today: CalendarDay;
  query: string;
  relationship: Filter;
  onQuery: (query: string) => void;
  onRelationship: (relationship: Filter) => void;
  actions: PersonActions;
}) {
  const shown = filterPeople(people, query, relationship === "all" ? null : relationship);
  const present = RELATIONSHIPS.filter((value) => people.some((p) => p.relationship === value));
  const favorites = shown.filter((person) => person.favorite);
  const others = shown.filter((person) => !person.favorite);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 @3xl/people:flex-row @3xl/people:items-center">
        <div className="relative w-full @3xl/people:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search people"
            placeholder="Search by name or note"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            className="h-10 rounded-full bg-card pl-9 shadow-elevation-1"
          />
        </div>
        {present.length > 1 ? (
          <ChoiceChips
            label="Relationship"
            hideLabel
            size="sm"
            value={relationship}
            onChange={onRelationship}
            options={[
              { value: "all", label: "Everyone" },
              ...present.map((value) => ({ value, label: RELATIONSHIP_FILTER_LABELS[value] })),
            ]}
          />
        ) : null}
        <p className="sr-only" aria-live="polite">
          {shown.length === 1 ? "1 person" : `${shown.length} people`}
        </p>
      </div>
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/40 px-6 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <SearchX className="size-5 text-muted-foreground" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">No one matches. Try another name.</p>
        </div>
      ) : (
        <>
          {favorites.length > 0 ? (
            <CardGrid
              title="Favorites"
              people={favorites}
              balances={balances}
              today={today}
              actions={actions}
            />
          ) : null}
          {others.length > 0 ? (
            <CardGrid
              title={favorites.length > 0 ? "Everyone else" : null}
              people={others}
              balances={balances}
              today={today}
              actions={actions}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function CardGrid({
  title,
  people,
  balances,
  today,
  actions,
}: {
  title: string | null;
  people: readonly Person[];
  balances: ReadonlyMap<string, readonly PersonBalance[]>;
  today: CalendarDay;
  actions: PersonActions;
}) {
  return (
    <section className="space-y-3" aria-label={title ?? "People"}>
      {title ? <GroupHeading count={people.length}>{title}</GroupHeading> : null}
      <ul className="grid gap-4 @2xl/people:grid-cols-2 @6xl/people:grid-cols-3">
        {people.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            balances={balances.get(person.id) ?? []}
            today={today}
            actions={actions}
          />
        ))}
      </ul>
    </section>
  );
}

function PersonCard({
  person,
  balances,
  today,
  actions,
}: {
  person: Person;
  balances: readonly PersonBalance[];
  today: CalendarDay;
  actions: PersonActions;
}) {
  const next = nextDateOf(person, today);
  const Icon = next ? DATE_ICONS[next.date.kind] : null;
  return (
    <li className="group relative isolate flex flex-col overflow-hidden rounded-2xl border bg-card shadow-elevation-1 transition duration-200 hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-elevation-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      {/* A wash of the person's colour across the top of the card. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 -z-10 h-24 bg-linear-to-b to-transparent opacity-80 transition-opacity group-hover:opacity-100",
          personTone(person.id).wash,
        )}
      />
      <div className="flex items-start gap-3.5 p-4">
        <PersonAvatar person={person} />
        <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
          <h4 className="truncate text-[0.9375rem] leading-tight font-semibold">
            {/* The name opens the person; its hit area covers the whole card. */}
            <button
              type="button"
              onClick={() => actions.open(person)}
              className="rounded-sm text-left outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {person.name}
            </button>
          </h4>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-background/70 px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border/70">
              {RELATIONSHIP_LABELS[person.relationship]}
            </span>
            {balances.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label={`Money with ${person.name}`}>
                {balances.map((balance) => (
                  <li
                    key={balance.currency}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                      balance.amount > 0
                        ? "bg-success/10 text-success"
                        : "bg-warning/10 text-warning",
                    )}
                  >
                    {balanceText(balance)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="relative z-10 -mt-1.5 -mr-1.5 flex items-center">
          <FavoriteToggle person={person} actions={actions} />
          <MoreMenu person={person} actions={actions} />
        </div>
      </div>
      <div className="mt-auto flex items-center gap-3 border-t border-border/60 bg-muted/25 px-4 py-2.5">
        {next && Icon ? (
          <>
            <DateTile day={next.on.day} month={next.on.month} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Icon className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
                <span className="truncate">{occasion(next)}</span>
              </span>
              <span className="block text-xs text-muted-foreground">{formatDayMonth(next.on)}</span>
            </span>
            <Countdown daysAway={next.daysAway} />
          </>
        ) : (
          <p className="py-1 text-xs text-muted-foreground">No dates yet</p>
        )}
      </div>
    </li>
  );
}

function personMenu(person: Person, actions: PersonActions): MenuItem[] {
  return [
    { id: "edit", label: "Edit", icon: Pencil, onSelect: () => actions.edit(person) },
    {
      id: "delete",
      label: "Delete",
      icon: Trash2,
      destructive: true,
      onSelect: () => actions.remove(person),
    },
  ];
}

export function MoreMenu({ person, actions }: { person: Person; actions: PersonActions }) {
  return (
    <Menu
      items={personMenu(person, actions)}
      variant="ghost"
      size="icon"
      chevron={false}
      align="end"
      aria-label={`Actions for ${person.name}`}
      className="size-8 rounded-full text-muted-foreground"
    >
      <MoreHorizontal aria-hidden="true" />
    </Menu>
  );
}

function FavoriteToggle({ person, actions }: { person: Person; actions: PersonActions }) {
  return (
    <button
      type="button"
      aria-pressed={person.favorite}
      aria-label={`Favorite ${person.name}`}
      onClick={() => actions.toggleFavorite(person)}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full transition outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-90",
        person.favorite ? "text-amber-500" : "text-muted-foreground/60 hover:text-foreground",
      )}
    >
      <Star
        className={cn("size-4", person.favorite && "animate-check-pop fill-current")}
        aria-hidden="true"
      />
    </button>
  );
}

/** How far away a date is, louder as it gets close. */
export function Countdown({ daysAway }: { daysAway: number }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums",
        daysAway === 0
          ? "bg-linear-to-r from-brand to-brand/80 text-brand-foreground shadow-elevation-1"
          : daysAway < 7
            ? "bg-brand-subtle text-brand ring-1 ring-brand/20 ring-inset"
            : "bg-muted text-muted-foreground",
      )}
    >
      {relativeDays(daysAway)}
    </span>
  );
}

// Upcoming dates

/** Every date in the coming year: today's first, celebrated, then the next one up, then a
 * timeline by week and month. */
export function UpcomingList({
  people,
  today,
  onOpen,
}: {
  people: readonly Person[];
  today: CalendarDay;
  onOpen: (person: Person) => void;
}) {
  const upcoming = upcomingDates(people, today);
  const todays = upcoming.filter((item) => item.daysAway === 0);
  const [next, ...later] = upcoming.filter((item) => item.daysAway > 0);
  const groups = groupUpcoming(later, today);

  return (
    <div className="space-y-8">
      {todays.length > 0 ? (
        <ul className="space-y-3" aria-label="Today">
          {todays.map((item) => (
            <TodayCard key={keyOf(item)} item={item} />
          ))}
        </ul>
      ) : null}
      {next ? <NextUp item={next} onOpen={onOpen} /> : null}
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`upcoming-${group.key}`} className="space-y-3">
          <GroupHeading id={`upcoming-${group.key}`} count={group.items.length}>
            {group.label}
          </GroupHeading>
          {/* A timeline: a line down the left with a dot in each person's colour. */}
          <ul className="relative space-y-2 pl-6 before:absolute before:top-3 before:bottom-3 before:left-[0.4375rem] before:w-px before:bg-border">
            {group.items.map((item) => (
              <UpcomingRow key={keyOf(item)} item={item} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function keyOf(item: UpcomingDate): string {
  return `${item.person.id}-${item.date.kind}-${item.date.label}`;
}

function weekday({ year, month, day }: CalendarDay): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

function TodayCard({ item }: { item: UpcomingDate }) {
  const { person, date } = item;
  const Icon = date.kind === "birthday" ? Cake : PartyPopper;
  const headline =
    date.kind === "birthday"
      ? item.years
        ? `${person.name} turns ${item.years} today`
        : `It’s ${person.name}’s birthday today`
      : `${occasion(item)} for ${person.name} today`;
  const action =
    "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-foreground [&_svg]:size-4";
  return (
    <li className="relative isolate flex flex-wrap items-center gap-4 overflow-hidden rounded-3xl bg-brand p-5 text-brand-foreground shadow-elevation-2">
      {/* Soft, slowly drifting glows behind the card. */}
      <span
        aria-hidden="true"
        className="absolute -top-16 -right-10 -z-10 size-48 rounded-full bg-brand-2/45 blur-3xl motion-safe:animate-drift"
      />
      <span
        aria-hidden="true"
        className="absolute -bottom-20 left-1/4 -z-10 size-40 rounded-full bg-white/15 blur-3xl"
      />
      <span aria-hidden="true" className="relative shrink-0">
        <PersonAvatar
          person={person}
          size="lg"
          className="bg-white/90 from-transparent to-transparent ring-4 ring-white/30"
        />
        <span className="absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full bg-white text-brand shadow-elevation-2">
          <Icon className="size-4" />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase opacity-80">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Today
        </p>
        <p className="text-lg font-semibold text-pretty">{headline}</p>
        <p className="text-sm opacity-85">
          {date.kind === "birthday" ? "Send them some love." : "A good day to say something."}
        </p>
      </div>
      <div className="flex gap-2">
        {person.phone ? (
          <a
            href={telHref(person.phone)}
            className={cn(action, "bg-white text-brand hover:bg-white/90")}
          >
            <Phone aria-hidden="true" />
            Call
          </a>
        ) : null}
        {person.email ? (
          <a
            href={`mailto:${person.email}`}
            className={cn(action, "bg-white/15 hover:bg-white/25")}
          >
            <Mail aria-hidden="true" />
            Email
          </a>
        ) : null}
      </div>
    </li>
  );
}

/** The next date after today, large, with the days left as the headline. */
function NextUp({ item, onOpen }: { item: UpcomingDate; onOpen: (person: Person) => void }) {
  const Icon = DATE_ICONS[item.date.kind];
  const tone = personTone(item.person.id);
  return (
    <button
      type="button"
      onClick={() => onOpen(item.person)}
      className="group relative isolate flex w-full items-center gap-5 overflow-hidden rounded-3xl border bg-card p-5 text-left shadow-elevation-1 transition duration-200 outline-none hover:shadow-elevation-2 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 -z-10 bg-linear-to-br via-transparent to-transparent",
          tone.wash,
        )}
      />
      <PersonAvatar person={item.person} size="lg" className="hidden @md/people:inline-flex" />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Next up
        </span>
        <span className="block truncate text-lg leading-tight font-semibold">
          {item.person.name}
        </span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Icon className="size-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="truncate">
            {occasion(item)} · {weekday(item.on)}, {item.on.day} {monthName(item.on.month)}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-center rounded-2xl bg-background/80 px-4 py-2.5 ring-1 ring-border/70 backdrop-blur">
        <span className="text-3xl leading-none font-semibold tracking-tight tabular-nums">
          {item.daysAway}
        </span>
        <span className="mt-1 text-xs text-muted-foreground">
          {item.daysAway === 1 ? "day to go" : "days to go"}
        </span>
      </span>
    </button>
  );
}

function UpcomingRow({ item, onOpen }: { item: UpcomingDate; onOpen: (person: Person) => void }) {
  const Icon = DATE_ICONS[item.date.kind];
  return (
    <li className="relative">
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1/2 -left-6 size-3.5 -translate-y-1/2 rounded-full ring-4 ring-background",
          personTone(item.person.id).dot,
        )}
      />
      <button
        type="button"
        onClick={() => onOpen(item.person)}
        className="flex w-full items-center gap-3 rounded-2xl border bg-card px-3 py-2.5 text-left shadow-elevation-1 transition duration-150 outline-none hover:translate-x-0.5 hover:shadow-elevation-2 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-x-0"
      >
        <DateTile day={item.on.day} month={item.on.month} />
        <PersonAvatar person={item.person} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.person.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{occasion(item)}</span>
          </span>
        </span>
        <Countdown daysAway={item.daysAway} />
      </button>
    </li>
  );
}

/** A small calendar leaf: the month above the day. */
export function DateTile({
  day,
  month,
  size = "md",
}: {
  day: number;
  month: number;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 flex-col items-center overflow-hidden rounded-lg border bg-background leading-none shadow-elevation-1",
        size === "sm" ? "w-9" : "w-11",
      )}
    >
      <span
        className={cn(
          "w-full bg-linear-to-b from-brand to-brand/85 text-center font-semibold tracking-wide text-brand-foreground uppercase",
          size === "sm" ? "py-px text-[0.5625rem]" : "py-0.5 text-[0.625rem]",
        )}
      >
        {monthName(month).slice(0, 3)}
      </span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          size === "sm" ? "py-0.5 text-sm" : "py-1 text-base",
        )}
      >
        {day}
      </span>
    </span>
  );
}
