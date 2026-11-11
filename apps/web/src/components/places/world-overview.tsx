"use client";

import type { Place } from "@orbit/contracts";
import {
  ArrowRight,
  CalendarDays,
  Compass,
  Crown,
  Lock,
  type LucideIcon,
  Medal,
  Plane,
  Sparkles,
  Stamp,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  CONTINENT_LABELS,
  type ContinentProgress,
  continentProgress,
  countryName,
  groupByCountry,
  type Milestone,
  milestones,
  nextMilestone,
  placesHref,
  sortWishes,
  SOVEREIGN_COUNT,
  travelStats,
  yearInTravel,
} from "@/lib/places";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";

import { CountryFlag } from "./country-flag";
import { WorldMap } from "./world-map";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Your world": the map with your tally, highlights, continents, milestones, and passport. */
export function WorldOverview({
  places,
  styleUrl,
  online,
  onSelectPlace,
}: {
  places: readonly Place[];
  styleUrl: string | null;
  online: boolean;
  onSelectPlace: (id: string) => void;
}) {
  const stats = travelStats(places);
  const mapLabel =
    `World map with ${plural(stats.countries, "country", "countries")} visited` +
    (stats.newCountriesOnWishlist > 0 ? ` and ${stats.newCountriesOnWishlist} more to go.` : ".");

  return (
    <div className="space-y-8">
      <section
        aria-label="Your travels in numbers"
        className="relative overflow-hidden rounded-3xl border bg-card shadow-elevation-1"
      >
        <WorldMap
          places={places}
          styleUrl={styleUrl}
          label={mapLabel}
          onSelectPlace={onSelectPlace}
          className="aspect-[4/3] w-full rounded-none border-0 @3xl/places:aspect-[16/8]"
        />
        <div className="border-t p-4 @3xl/places:absolute @3xl/places:top-4 @3xl/places:left-4 @3xl/places:w-80 @3xl/places:rounded-2xl @3xl/places:border @3xl/places:bg-card/85 @3xl/places:shadow-elevation-2 @3xl/places:backdrop-blur-md">
          <div className="flex items-center gap-4">
            <ProgressRing value={stats.countries} max={SOVEREIGN_COUNT} share={stats.worldShare} />
            <div className="min-w-0">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                You’ve been to
              </p>
              <p className="text-3xl font-semibold tracking-tight tabular-nums">
                {stats.countries}{" "}
                <span className="text-base font-medium text-muted-foreground">
                  {stats.countries === 1 ? "country" : "countries"}
                </span>
              </p>
              {stats.regions > 0 ? (
                <p className="text-xs text-muted-foreground">
                  plus {plural(stats.regions, "other region", "other regions")}
                </p>
              ) : null}
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-center">
            <Figure label="Continents" value={`${stats.continents.length} / 7`} />
            <Figure label="Places" value={String(stats.visitedPlaces)} />
            <Figure label="On your list" value={String(stats.wishlistPlaces)} />
          </dl>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <Legend className="bg-brand" label="Visited" />
            <Legend className="bg-brand-2/60" label="Want to go" />
          </div>
          {online ? null : (
            <Link
              href="/settings/places"
              className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Offline map. Turn on online maps for streets and pins
            </Link>
          )}
        </div>
      </section>

      <Highlights places={places} />
      <Continents progress={continentProgress(places)} />
      <Milestones list={milestones(stats)} />
      <Passport places={places} />
    </div>
  );
}

/** Share of the world's countries visited, as a ring. */
function ProgressRing({ value, max, share }: { value: number; max: number; share: number }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(1, value / max) * circumference;
  return (
    <div
      role="progressbar"
      aria-label="Countries of the world visited"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} of ${max} countries`}
      className="relative size-[4.5rem] shrink-0"
    >
      <svg viewBox="0 0 72 72" className="size-full -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id="places-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>
        <circle cx="36" cy="36" r={radius} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          stroke="url(#places-ring)"
          strokeDasharray={`${Math.max(filled, value > 0 ? 4 : 0)} ${circumference}`}
          className="transition-[stroke-dasharray] duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-base font-semibold tabular-nums">{share}%</span>
        <span className="mt-0.5 text-[0.625rem] text-muted-foreground">of world</span>
      </span>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-[0.6875rem] text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("size-2.5 rounded-sm", className)} />
      {label}
    </span>
  );
}

function SectionHeading({ id, title, aside }: { id: string; title: string; aside?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 id={id} className="text-base font-semibold tracking-tight">
        {title}
      </h3>
      {aside ? <p className="text-xs text-muted-foreground">{aside}</p> : null}
    </div>
  );
}

// Highlights

function Highlights({ places }: { places: readonly Place[] }) {
  const stats = travelStats(places);
  const top = groupByCountry(places, "visited")[0] ?? null;
  const next = sortWishes(
    places.filter((place) => place.status === "want_to_visit"),
    "favorites",
  )[0];
  const thisYear = yearInTravel(places, String(new Date().getFullYear()));

  return (
    <section aria-labelledby="places-highlights">
      <SectionHeading id="places-highlights" title="Highlights" />
      <ul className="grid gap-3 @2xl/places:grid-cols-2 @6xl/places:grid-cols-4">
        <HighlightCard icon={Plane} label="Latest trip">
          {stats.latest ? (
            <FlagLine
              code={stats.latest.country_code}
              title={stats.latest.name}
              detail={`${countryName(stats.latest.country_code)} · ${formatCalendarDate(
                stats.latest.visited_on ?? "",
              )}`}
            />
          ) : (
            <Hint>Add a date to a visit and your latest trip shows here.</Hint>
          )}
        </HighlightCard>
        <HighlightCard icon={Crown} label="Most explored">
          {top ? (
            <FlagLine
              code={top.code}
              title={top.name}
              detail={plural(top.places.length, "place", "places")}
            />
          ) : (
            <Hint>Your most visited country shows here.</Hint>
          )}
        </HighlightCard>
        <HighlightCard icon={Sparkles} label="Next up">
          {next ? (
            <Link
              href={placesHref("wishlist")}
              className="group/next -m-1 flex items-center gap-1 rounded-lg p-1 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FlagLine
                code={next.country_code}
                title={next.name}
                detail={countryName(next.country_code)}
              />
              <ArrowRight
                aria-hidden="true"
                className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover/next:translate-x-0.5"
              />
            </Link>
          ) : (
            <Hint>Add a place you dream about to plan what’s next.</Hint>
          )}
        </HighlightCard>
        <HighlightCard icon={CalendarDays} label={`This year (${thisYear.year})`}>
          {thisYear.places > 0 ? (
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {thisYear.places}{" "}
                <span className="text-sm font-medium text-muted-foreground">
                  {thisYear.places === 1 ? "place" : "places"}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                in {plural(thisYear.countries, "country", "countries")}
              </p>
            </div>
          ) : (
            <Hint>No dated trips yet this year. Where to?</Hint>
          )}
        </HighlightCard>
      </ul>
    </section>
  );
}

function HighlightCard({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex min-h-28 flex-col gap-3 rounded-2xl border bg-card p-4 shadow-elevation-1">
      <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <Icon aria-hidden="true" className="size-3.5 text-brand" />
        {label}
      </p>
      <div className="mt-auto min-w-0">{children}</div>
    </li>
  );
}

function FlagLine({ code, title, detail }: { code: string; title: string; detail: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <CountryFlag code={code} size="lg" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-pretty text-muted-foreground">{children}</p>;
}

// Continents

const SHOWN_FLAGS = 8;

function Continents({ progress }: { progress: readonly ContinentProgress[] }) {
  const reached = progress.filter((entry) => entry.codes.length > 0).length;
  return (
    <section aria-labelledby="places-continents">
      <SectionHeading
        id="places-continents"
        title="Continents"
        aside={`${reached} of ${progress.length} inhabited continents`}
      />
      <ul
        aria-label="Continents"
        className="grid gap-3 @2xl/places:grid-cols-2 @5xl/places:grid-cols-3"
      >
        {progress.map((entry) => {
          const label = CONTINENT_LABELS[entry.continent];
          const visited = entry.codes.length > 0;
          const extra = entry.codes.length - SHOWN_FLAGS;
          return (
            <li
              key={entry.continent}
              aria-label={label}
              className={cn(
                "space-y-3 rounded-2xl border p-4 transition-colors",
                visited ? "bg-card shadow-elevation-1" : "border-dashed bg-card/40",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className={cn("font-semibold", !visited && "text-muted-foreground")}>
                  {label}
                  <span className="sr-only">{visited ? " (visited)" : " (not yet)"}</span>
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {entry.countries} of {entry.total}
                </p>
              </div>
              <div
                role="progressbar"
                aria-label={`${label}: countries visited`}
                aria-valuemin={0}
                aria-valuemax={entry.total}
                aria-valuenow={entry.countries}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-linear-to-r from-brand to-brand-2 transition-[width] duration-700"
                  style={{
                    width: `${entry.total > 0 ? Math.min(100, (entry.countries / entry.total) * 100) : 0}%`,
                  }}
                />
              </div>
              {visited ? (
                <ul
                  aria-label={`Visited in ${label}`}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  {entry.codes.slice(0, SHOWN_FLAGS).map((code) => (
                    <li key={code} title={countryName(code)} className="flex">
                      <CountryFlag code={code} />
                      <span className="sr-only">{countryName(code)}</span>
                    </li>
                  ))}
                  {extra > 0 ? (
                    <li className="text-xs text-muted-foreground tabular-nums">+{extra}</li>
                  ) : null}
                </ul>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Compass aria-hidden="true" className="size-3.5" />
                  Still to explore
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Milestones

function Milestones({ list }: { list: readonly Milestone[] }) {
  const next = nextMilestone(list);
  const reached = list.filter((milestone) => milestone.reached).length;
  return (
    <section aria-labelledby="places-milestones">
      <SectionHeading
        id="places-milestones"
        title="Milestones"
        aside={`${reached} of ${list.length} unlocked`}
      />
      {next ? (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-brand/20 bg-linear-to-r from-brand-subtle to-transparent px-4 py-3">
          <Trophy aria-hidden="true" className="size-5 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Next: {next.label}{" "}
              <span className="font-normal text-muted-foreground">· {next.remaining} to go</span>
            </p>
            <div
              role="progressbar"
              aria-label={`Progress to ${next.label}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(next.progress * 100)}
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-700"
                style={{ width: `${next.progress * 100}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}
      <ul
        aria-label="Milestones"
        className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3"
      >
        {list.map((milestone) => (
          <li
            key={milestone.id}
            className={cn(
              "flex flex-col items-center gap-2 rounded-2xl border p-3 text-center",
              milestone.reached ? "bg-card shadow-elevation-1" : "border-dashed bg-card/40",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-11 items-center justify-center rounded-full",
                milestone.reached
                  ? "bg-linear-to-br from-brand to-brand-2 text-white shadow-elevation-2"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {milestone.reached ? <Medal className="size-5" /> : <Lock className="size-4" />}
            </span>
            <span className="space-y-0.5">
              <span
                className={cn(
                  "block text-sm font-semibold",
                  !milestone.reached && "text-muted-foreground",
                )}
              >
                {milestone.label}
                <span className="sr-only">
                  {milestone.reached ? " (unlocked)" : ` (locked, ${milestone.remaining} to go)`}
                </span>
              </span>
              <span className="block text-[0.6875rem] leading-snug text-muted-foreground">
                {milestone.description}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Passport

function Passport({ places }: { places: readonly Place[] }) {
  const stamps = groupByCountry(places, "visited").sort((a, b) => a.name.localeCompare(b.name));
  if (stamps.length === 0) return null;
  return (
    <section aria-labelledby="places-passport">
      <SectionHeading
        id="places-passport"
        title="Your passport"
        aside={plural(stamps.length, "stamp", "stamps")}
      />
      <ul
        aria-label="Countries you’ve visited"
        className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3"
      >
        {stamps.map((group) => (
          <li
            key={group.code}
            className="group flex flex-col items-center gap-2 rounded-2xl border bg-card p-3 text-center shadow-elevation-1 transition-transform duration-200 hover:-translate-y-0.5"
          >
            <span className="relative">
              <CountryFlag code={group.code} size="xl" className="shadow-elevation-1" />
              <Stamp
                aria-hidden="true"
                className="absolute -right-2 -bottom-1.5 size-4 rounded-full bg-card p-0.5 text-brand"
              />
            </span>
            <span className="w-full">
              <span className="block truncate text-sm font-medium">{group.name}</span>
              <span className="block text-[0.6875rem] text-muted-foreground">
                {plural(group.places.length, "place", "places")}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
