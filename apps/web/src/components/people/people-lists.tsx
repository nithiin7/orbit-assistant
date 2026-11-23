"use client";

import type { Person, PersonBalance, PersonRelationship } from "@orbit/contracts";
import {
  Cake,
  Mail,
  MoreHorizontal,
  PartyPopper,
  Pencil,
  Phone,
  SearchX,
  Star,
  Trash2,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ChoiceChips } from "@/components/watchlist/choice-chips";
import {
  balanceText,
  type CalendarDay,
  filterPeople,
  formatDayMonth,
  groupUpcoming,
  nextDateOf,
  occasion,
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
    <div className="space-y-5">
      <div className="space-y-3">
        <Input
          type="search"
          aria-label="Search people"
          placeholder="Search by name or note"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          className="h-10 max-w-sm"
        />
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
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
          <SearchX className="size-5 text-muted-foreground" aria-hidden="true" />
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
    <section className="space-y-2.5" aria-label={title ?? "People"}>
      {title ? (
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
      ) : null}
      <ul className="grid gap-3 @2xl/people:grid-cols-2 @6xl/people:grid-cols-3">
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
    <li className="relative flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-elevation-1 transition-shadow duration-150 hover:shadow-elevation-2">
      <div className="flex items-start gap-3">
        <PersonAvatar person={person} />
        <div className="min-w-0 flex-1 pt-0.5">
          <h4 className="truncate text-sm font-semibold">
            {/* The name opens the person; its hit area covers the whole card. */}
            <button
              type="button"
              onClick={() => actions.open(person)}
              className="rounded-sm text-left outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {person.name}
            </button>
          </h4>
          <p className="text-xs text-muted-foreground">
            {RELATIONSHIP_LABELS[person.relationship]}
          </p>
        </div>
        <div className="relative z-10 -mt-1 -mr-1 flex items-center">
          <FavoriteToggle person={person} actions={actions} />
          <MoreMenu person={person} actions={actions} />
        </div>
      </div>
      {next && Icon ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-muted/60 px-3 py-2 text-sm">
          <Icon className="size-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {occasion(next)}
            <span className="text-muted-foreground"> · {formatDayMonth(next.on)}</span>
          </span>
          <Countdown daysAway={next.daysAway} />
        </div>
      ) : (
        <p className="px-0.5 text-xs text-muted-foreground">No dates yet</p>
      )}
      {balances.length > 0 ? (
        <ul className="-mt-1 flex flex-wrap gap-1.5" aria-label={`Money with ${person.name}`}>
          {balances.map((balance) => (
            <li
              key={balance.currency}
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                balance.amount > 0 ? "bg-success/10 text-success" : "bg-warning/10 text-warning",
              )}
            >
              {balanceText(balance)}
            </li>
          ))}
        </ul>
      ) : null}
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
      className="size-8 text-muted-foreground"
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
        "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        person.favorite ? "text-amber-500" : "text-muted-foreground/60 hover:text-foreground",
      )}
    >
      <Star className={cn("size-4", person.favorite && "fill-current")} aria-hidden="true" />
    </button>
  );
}

/** How far away a date is, louder as it gets close. */
export function Countdown({ daysAway }: { daysAway: number }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums",
        daysAway === 0
          ? "bg-brand text-brand-foreground"
          : daysAway < 7
            ? "bg-brand-subtle text-brand"
            : "bg-background text-muted-foreground",
      )}
    >
      {relativeDays(daysAway)}
    </span>
  );
}

// Upcoming dates

/** Every date in the coming year: today's first, celebrated, then this week and by month. */
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
  const groups = groupUpcoming(
    upcoming.filter((item) => item.daysAway > 0),
    today,
  );

  return (
    <div className="space-y-6">
      {todays.length > 0 ? (
        <ul className="space-y-3" aria-label="Today">
          {todays.map((item) => (
            <TodayCard key={`${item.person.id}-${item.date.kind}-${item.date.label}`} item={item} />
          ))}
        </ul>
      ) : null}
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`upcoming-${group.key}`} className="space-y-2">
          <h3
            id={`upcoming-${group.key}`}
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            {group.label}
          </h3>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-elevation-1">
            {group.items.map((item) => (
              <UpcomingRow
                key={`${item.person.id}-${item.date.kind}-${item.date.label}`}
                item={item}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
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
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-2xl border border-brand/20 bg-linear-to-r from-brand-subtle via-brand-subtle/40 to-transparent p-4">
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-elevation-2"
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-pretty">{headline}</p>
        <p className="text-sm text-muted-foreground">
          {date.kind === "birthday" ? "Send them some love." : "A good day to say something."}
        </p>
      </div>
      <div className="flex gap-2">
        {person.phone ? (
          <a
            href={telHref(person.phone)}
            className={buttonVariants({ variant: "soft", size: "sm" })}
          >
            <Phone aria-hidden="true" />
            Call
          </a>
        ) : null}
        {person.email ? (
          <a
            href={`mailto:${person.email}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <Mail aria-hidden="true" />
            Email
          </a>
        ) : null}
      </div>
    </li>
  );
}

function UpcomingRow({ item, onOpen }: { item: UpcomingDate; onOpen: (person: Person) => void }) {
  const Icon = DATE_ICONS[item.date.kind];
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.person)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** A small calendar leaf: the month above the day. */
export function DateTile({ day, month }: { day: number; month: number }) {
  return (
    <span className="flex w-11 shrink-0 flex-col items-center overflow-hidden rounded-lg border bg-background leading-none">
      <span className="w-full bg-brand-subtle py-0.5 text-center text-[0.625rem] font-semibold tracking-wide text-brand uppercase">
        {SHORT_MONTHS[month - 1]}
      </span>
      <span className="py-1 text-base font-semibold tabular-nums">{day}</span>
    </span>
  );
}
