"use client";

import { ArrowRight, Plus, Users } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { usePeople } from "@/hooks/use-people";
import { localToday, occasion, peopleHref, upcomingDates } from "@/lib/people";
import { cn } from "@/utils/common";

import { DATE_ICONS } from "./date-icon";
import { Countdown, DateTile } from "./people-lists";
import { PersonAvatar } from "./person-avatar";

const SHOWN = 4;
const WINDOW_DAYS = 30;

/** The dashboard's people: birthdays and other dates in the next month. */
export function PeopleWidget() {
  const workspaceId = useActiveWorkspaceId();
  return (
    <section aria-labelledby="people-widget-heading" className="h-full">
      <Card className="h-full shadow-elevation-1">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2
            id="people-widget-heading"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <Users className="size-4 text-muted-foreground" aria-hidden="true" />
            Coming up
          </h2>
          <Link
            href={peopleHref("upcoming")}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Open people
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
  const { people, reload } = usePeople(workspaceId);

  if (people.status === "loading") return <WidgetSkeleton />;
  if (people.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">{people.message}</p>
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          Try again
        </Button>
      </div>
    );
  }
  if (people.data.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 p-5">
        <p className="text-sm text-muted-foreground">
          Add the people who matter and never miss a birthday.
        </p>
        <Link href="/people" className={buttonVariants({ variant: "soft", size: "sm" })}>
          <Plus aria-hidden="true" />
          Add a person
        </Link>
      </div>
    );
  }

  const upcoming = upcomingDates(people.data, localToday(), WINDOW_DAYS);
  if (upcoming.length === 0) {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        No birthdays or anniversaries in the next {WINDOW_DAYS} days.
      </p>
    );
  }
  const more = upcoming.length - SHOWN;

  return (
    <div className="p-2">
      <ul className="space-y-0.5">
        {upcoming.slice(0, SHOWN).map((item, index) => {
          const Icon = DATE_ICONS[item.date.kind];
          return (
            <li key={`${item.person.id}-${item.date.kind}-${item.date.label}`}>
              <Link
                href={peopleHref("upcoming", item.person.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
                  // The soonest date stands out.
                  index === 0 && "bg-brand-subtle/60 hover:bg-brand-subtle",
                )}
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
              </Link>
            </li>
          );
        })}
      </ul>
      {more > 0 ? (
        <p className="px-3 pt-1 pb-2 text-xs text-muted-foreground">
          And {more} more in the next {WINDOW_DAYS} days.
        </p>
      ) : null}
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div className="space-y-2 p-5">
      <span className="sr-only">Loading your people…</span>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}
