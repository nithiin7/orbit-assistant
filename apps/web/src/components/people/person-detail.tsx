"use client";

import type { Person } from "@orbit/contracts";
import { BellRing, Mail, Pencil, Phone, Star, Trash2 } from "lucide-react";
import { useId } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogCloseButton, DialogFooter } from "@/components/ui/dialog";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  type CalendarDay,
  dateLabel,
  formatDayMonth,
  nextOccurrence,
  occasion,
  RELATIONSHIP_LABELS,
  remindLabel,
  telHref,
  yearsOn,
} from "@/lib/people";

import { DATE_ICONS } from "./date-icon";
import { Countdown } from "./people-lists";
import { PersonAvatar } from "./person-avatar";

/** One person at a glance: their dates with countdowns and reminders, how to reach them, and
 * the note. */
export function PersonDetail({
  person,
  today,
  onEdit,
  onDelete,
  onClose,
}: {
  person: Person;
  today: CalendarDay;
  onEdit: () => void;
  onDelete: () => void;
  /** Called once the dialog has closed. */
  onClose: () => void;
}) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose });
  const dates = person.dates
    .map((date) => {
      const next = nextOccurrence(date, today);
      return { date, ...next, years: yearsOn(date, next.on.year) };
    })
    .sort((a, b) => a.daysAway - b.daysAway);

  return (
    <Dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="mt-[6vh] max-h-[88vh] max-w-lg overflow-y-auto"
    >
      <div className="relative overflow-hidden rounded-t-xl bg-linear-to-br from-brand-subtle via-brand-subtle/30 to-transparent px-5 pt-5 pb-4">
        <div className="flex items-start gap-4">
          <PersonAvatar person={person} size="lg" className="ring-4 ring-popover" />
          <div className="min-w-0 flex-1 pt-1">
            <h2 id={`${id}-heading`} className="flex items-center gap-2 text-lg font-semibold">
              <span className="truncate">{person.name}</span>
              {person.favorite ? (
                <Star
                  className="size-4 shrink-0 fill-current text-amber-500"
                  aria-label="Favorite"
                />
              ) : null}
            </h2>
            <p className="text-sm text-muted-foreground">
              {RELATIONSHIP_LABELS[person.relationship]}
            </p>
          </div>
          <DialogCloseButton onClick={close} />
        </div>
        {person.phone || person.email ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {person.phone ? (
              <a
                href={telHref(person.phone)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Phone aria-hidden="true" />
                {person.phone}
              </a>
            ) : null}
            {person.email ? (
              <a
                href={`mailto:${person.email}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Mail aria-hidden="true" />
                <span className="max-w-48 truncate">{person.email}</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-5 p-5">
        <section aria-labelledby={`${id}-dates`} className="space-y-2">
          <h3
            id={`${id}-dates`}
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            Dates
          </h3>
          {dates.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
              No dates yet. Add a birthday and Orbit will remind you before it.
            </p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {dates.map(({ date, on, daysAway, years }) => {
                const Icon = DATE_ICONS[date.kind];
                const reminder = remindLabel(date.remind_days_before);
                return (
                  <li
                    key={`${date.kind}-${date.label}-${date.month}-${date.day}`}
                    className="flex items-start gap-3 px-3 py-3"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand"
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-sm font-medium">
                        {dateLabel(date)}
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · {formatDayMonth(date)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {years ? `${occasion({ date, years })} on ` : "Next on "}
                        {formatDayMonth(on)} {on.year}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <BellRing className="size-3 shrink-0" aria-hidden="true" />
                        {reminder ? `Reminder ${reminder.toLocaleLowerCase()}` : "No reminder"}
                      </p>
                    </div>
                    <Countdown daysAway={daysAway} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {person.note ? (
          <section aria-labelledby={`${id}-note`} className="space-y-2">
            <h3
              id={`${id}-note`}
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Note
            </h3>
            <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm whitespace-pre-line">
              {person.note}
            </p>
          </section>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              close();
              onDelete();
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
          <Button
            variant="soft"
            onClick={() => {
              close();
              onEdit();
            }}
          >
            <Pencil aria-hidden="true" />
            Edit
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
