"use client";

import { ArrowRight, MapPinned, Plus } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { usePlaces } from "@/hooks/use-places";
import { countryName, placesHref, SOVEREIGN_COUNT, travelStats } from "@/lib/places";

import { CountryFlag } from "./country-flag";

/** The dashboard's places: how much of the world you've seen, and where you want to go next. */
export function PlacesWidget() {
  const workspaceId = useActiveWorkspaceId();
  return (
    <section aria-labelledby="places-widget-heading" className="h-full">
      <Card className="h-full shadow-elevation-1">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2
            id="places-widget-heading"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <MapPinned className="size-4 text-muted-foreground" aria-hidden="true" />
            Places
          </h2>
          <Link href="/places" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Open places
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        {workspaceId === null ? (
          <WidgetSkeleton />
        ) : (
          <WidgetBody key={workspaceId} workspaceId={workspaceId} />
        )}
      </Card>
    </section>
  );
}

function WidgetBody({ workspaceId }: { workspaceId: string }) {
  const { places, reload } = usePlaces(workspaceId);

  if (places.status === "loading") return <WidgetSkeleton />;
  if (places.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">{places.message}</p>
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          Try again
        </Button>
      </div>
    );
  }
  if (places.data.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 p-5">
        <p className="text-sm text-muted-foreground">
          Add the places you’ve been and watch your world fill in.
        </p>
        <Link href="/places" className={buttonVariants({ variant: "soft", size: "sm" })}>
          <Plus aria-hidden="true" />
          Add a place
        </Link>
      </div>
    );
  }

  const stats = travelStats(places.data);
  const next = places.data.find((place) => place.status === "want_to_visit") ?? null;

  return (
    <div className="space-y-4 p-5">
      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Countries" value={String(stats.countries)} />
        <Stat label="Of the world" value={`${stats.worldShare}%`} />
        <Stat label="Continents" value={`${stats.continents.length} / 7`} />
      </dl>
      <div
        role="progressbar"
        aria-label="Countries visited"
        aria-valuemin={0}
        aria-valuemax={SOVEREIGN_COUNT}
        aria-valuenow={stats.countries}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${Math.min(100, (stats.countries / SOVEREIGN_COUNT) * 100)}%` }}
        />
      </div>
      {next ? (
        <Link
          href={placesHref("wishlist")}
          className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-xs font-medium tracking-wide text-brand uppercase">Next</span>
          <CountryFlag code={next.country_code} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {next.name}, {countryName(next.country_code)}
          </span>
          <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground" />
        </Link>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div className="space-y-2 p-5">
      <span className="sr-only">Loading your places…</span>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}
