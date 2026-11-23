"use client";

import type { Person, PersonBalance, PersonLedgerEntry } from "@orbit/contracts";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BellOff,
  BellRing,
  CalendarHeart,
  CheckCircle2,
  HandCoins,
  Mail,
  Pencil,
  Phone,
  Plus,
  Star,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogCloseButton } from "@/components/ui/dialog";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  balanceText,
  type CalendarDay,
  dateLabel,
  formatDayMonth,
  nextOccurrence,
  occasion,
  personTone,
  RELATIONSHIP_LABELS,
  remindLabel,
  telHref,
  yearsOn,
} from "@/lib/people";
import { cn } from "@/utils/common";

import { DATE_ICONS } from "./date-icon";
import { GiftIdeas } from "./gift-ideas";
import { EntryRow } from "./money-view";
import { Countdown, DateTile } from "./people-lists";
import { PersonAvatar } from "./person-avatar";
import { SectionCard } from "./section-card";

const SHOWN_ENTRIES = 5;

/** One person at a glance: their dates with countdowns and reminders, the money between you,
 * how to reach them, and the note. */
export function PersonDetail({
  workspaceId,
  person,
  today,
  balances,
  entries,
  onEdit,
  onDelete,
  onRecord,
  onSettle,
  onDeleteEntry,
  onClose,
}: {
  workspaceId: string;
  person: Person;
  today: CalendarDay;
  /** Open balances, one per currency; `null` while money owed loads. */
  balances: readonly PersonBalance[] | null;
  /** Their ledger entries, newest first. */
  entries: readonly PersonLedgerEntry[];
  onEdit: () => void;
  onDelete: () => void;
  /** Money dialogs open over this one, which stays open. */
  onRecord: () => void;
  onSettle: (balance: PersonBalance) => void;
  onDeleteEntry: (entry: PersonLedgerEntry) => void;
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

  const tone = personTone(person.id);
  const contact = [person.phone, person.email].filter(Boolean).join(" · ");
  const quick =
    "flex flex-1 flex-col items-center gap-1 rounded-xl bg-background/70 px-2 py-2.5 text-xs font-medium ring-1 ring-border/70 backdrop-blur transition outline-none hover:bg-background hover:shadow-elevation-1 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] [&_svg]:size-4 [&_svg]:text-brand";

  return (
    <Dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="mt-[6vh] max-h-[88vh] max-w-lg overflow-y-auto"
    >
      <div className="relative isolate overflow-hidden rounded-t-xl px-5 pt-5 pb-5">
        {/* The banner takes the person's colour. */}
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 -z-10 bg-linear-to-br via-brand-subtle/30 to-transparent",
            tone.wash,
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            "absolute -top-20 -right-16 -z-10 size-56 rounded-full opacity-20 blur-3xl",
            tone.dot,
          )}
        />
        <div className="flex items-start gap-4">
          <PersonAvatar
            person={person}
            size="xl"
            className="shadow-elevation-2 ring-4 ring-popover"
          />
          <div className="min-w-0 flex-1 space-y-1 pt-2">
            <h2
              id={`${id}-heading`}
              className="flex items-center gap-2 text-xl font-semibold tracking-tight"
            >
              <span className="truncate">{person.name}</span>
              {person.favorite ? (
                <Star
                  className="size-4 shrink-0 fill-current text-amber-500"
                  aria-label="Favorite"
                />
              ) : null}
            </h2>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="rounded-full bg-background/70 px-2 py-0.5 text-xs ring-1 ring-border/70">
                {RELATIONSHIP_LABELS[person.relationship]}
              </span>
              {contact ? <span className="min-w-0 truncate text-xs">{contact}</span> : null}
            </p>
          </div>
          <DialogCloseButton onClick={close} />
        </div>
        <div className="mt-5 flex gap-2">
          {person.phone ? (
            <a href={telHref(person.phone)} className={quick}>
              <Phone aria-hidden="true" />
              Call
            </a>
          ) : null}
          {person.email ? (
            <a href={`mailto:${person.email}`} className={quick}>
              <Mail aria-hidden="true" />
              Email
            </a>
          ) : null}
          <button type="button" className={quick} onClick={onRecord}>
            <HandCoins aria-hidden="true" />
            Money
          </button>
          <button
            type="button"
            className={quick}
            onClick={() => {
              close();
              onEdit();
            }}
          >
            <Pencil aria-hidden="true" />
            Edit
          </button>
        </div>
      </div>

      <div className="space-y-3 p-5 pt-1">
        <SectionCard icon={CalendarHeart} title="Dates">
          {dates.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
              No dates yet. Add a birthday and Orbit will remind you before it.
            </p>
          ) : (
            <ul className="space-y-2">
              {dates.map(({ date, on, daysAway, years }) => {
                const Icon = DATE_ICONS[date.kind];
                const reminder = remindLabel(date.remind_days_before);
                return (
                  <li
                    key={`${date.kind}-${date.label}-${date.month}-${date.day}`}
                    className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5"
                  >
                    <DateTile day={on.day} month={on.month} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        <Icon className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
                        <span className="truncate">{dateLabel(date)}</span>
                        <span className="shrink-0 font-normal text-muted-foreground">
                          · {formatDayMonth(date)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {years ? `${occasion({ date, years })} on ` : "Next on "}
                        {formatDayMonth(on)} {on.year}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        {reminder ? (
                          <BellRing className="size-3 shrink-0" aria-hidden="true" />
                        ) : (
                          <BellOff className="size-3 shrink-0" aria-hidden="true" />
                        )}
                        {reminder ? `Reminder ${reminder.toLocaleLowerCase()}` : "No reminder"}
                      </p>
                    </div>
                    <Countdown daysAway={daysAway} />
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          icon={HandCoins}
          title="Money"
          action={
            <Button variant="ghost" size="sm" className="h-7" onClick={onRecord}>
              <Plus aria-hidden="true" />
              Record
            </Button>
          }
        >
          {balances === null ? null : balances.length > 0 ? (
            <ul className="space-y-2">
              {balances.map((balance) => {
                const owesYou = balance.amount > 0;
                const Direction = owesYou ? ArrowDownLeft : ArrowUpRight;
                return (
                  <li
                    key={balance.currency}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset",
                      owesYou
                        ? "bg-linear-to-r from-success/12 to-success/4 ring-success/20"
                        : "bg-linear-to-r from-warning/12 to-warning/4 ring-warning/20",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full",
                        owesYou ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                      )}
                    >
                      <Direction className="size-4" />
                    </span>
                    <span className="flex-1 text-sm font-semibold tabular-nums">
                      {balanceText(balance)}
                    </span>
                    <Button
                      variant="soft"
                      size="sm"
                      className="rounded-full"
                      onClick={() => onSettle(balance)}
                    >
                      Settle up
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
              {entries.length > 0 ? "All square." : "Nothing owed either way."}
            </p>
          )}
          {entries.length > 0 ? (
            <ul
              className="-mx-1 divide-y overflow-hidden rounded-xl border"
              aria-label={`Money with ${person.name}`}
            >
              {entries.slice(0, SHOWN_ENTRIES).map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  person={person}
                  actions={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground"
                      aria-label={`Delete “${entry.description}”`}
                      onClick={() => onDeleteEntry(entry)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  }
                />
              ))}
            </ul>
          ) : null}
        </SectionCard>

        <GiftIdeas workspaceId={workspaceId} person={person} />

        {person.note ? (
          <SectionCard icon={StickyNote} title="Note">
            <p className="rounded-xl border-l-2 border-brand/40 bg-muted/40 px-4 py-3 text-sm leading-relaxed whitespace-pre-line">
              {person.note}
            </p>
          </SectionCard>
        ) : null}

        <div className="flex justify-start pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              close();
              onDelete();
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete {person.name}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
