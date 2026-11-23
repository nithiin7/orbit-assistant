"use client";

import type { Person, PersonBalance, PersonLedger, PersonLedgerEntry } from "@orbit/contracts";
import { ArrowDownLeft, ArrowUpRight, HandCoins, Landmark } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/finance";
import { type CurrencyTotal, entryHeadline, moneySummary, signedAmount } from "@/lib/people";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";

import { PersonAvatar } from "./person-avatar";

const RECENT = 8;

/** Who owes you, whom you owe, and the latest money between you and everyone. */
export function MoneyView({
  people,
  ledger,
  onOpen,
  onSettle,
  onRecord,
}: {
  people: readonly Person[];
  ledger: PersonLedger;
  onOpen: (person: Person) => void;
  onSettle: (person: Person, balance: PersonBalance) => void;
  onRecord: () => void;
}) {
  const summary = moneySummary(people, ledger);
  const byId = new Map(people.map((person) => [person.id, person]));

  if (ledger.entries.length === 0) {
    return (
      <EmptyState
        icon={HandCoins}
        title="All square"
        description="Record what someone owes you or what you owe them, or split an expense with someone when you add it in Finance."
      >
        <Button variant="soft" onClick={onRecord}>
          Record money
        </Button>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 @2xl/people:grid-cols-2">
        <Tile title="Owed to you" totals={summary.owedToYou} tone="in" />
        <Tile title="You owe" totals={summary.youOwe} tone="out" />
      </div>

      <div className="grid gap-5 @4xl/people:grid-cols-2">
        <BalanceList
          title="Who owes you"
          empty="No one owes you anything."
          rows={summary.owers}
          onOpen={onOpen}
          onSettle={onSettle}
        />
        <BalanceList
          title="Who you owe"
          empty="You don’t owe anyone."
          rows={summary.owed}
          onOpen={onOpen}
          onSettle={onSettle}
        />
      </div>

      <section aria-labelledby="money-recent" className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3
            id="money-recent"
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            Recent
          </h3>
          <Button variant="ghost" size="sm" onClick={onRecord}>
            Record money
          </Button>
        </div>
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-elevation-1">
          {ledger.entries.slice(0, RECENT).map((entry) => {
            const person = byId.get(entry.person_id);
            return person ? (
              <EntryRow key={entry.id} entry={entry} person={person} onOpen={onOpen} />
            ) : null;
          })}
        </ul>
      </section>
    </div>
  );
}

function Tile({
  title,
  totals,
  tone,
}: {
  title: string;
  totals: readonly CurrencyTotal[];
  tone: "in" | "out";
}) {
  const Icon = tone === "in" ? ArrowDownLeft : ArrowUpRight;
  return (
    <section
      aria-label={title}
      className={cn(
        "rounded-2xl border p-4 shadow-elevation-1",
        tone === "in"
          ? "bg-linear-to-br from-success/10 to-card"
          : "bg-linear-to-br from-warning/10 to-card",
      )}
    >
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-6 items-center justify-center rounded-full",
            tone === "in" ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
          )}
        >
          <Icon className="size-3.5" />
        </span>
        {title}
      </p>
      {totals.length === 0 ? (
        <p className="mt-2 text-2xl font-semibold text-muted-foreground">—</p>
      ) : (
        <ul className="mt-2 space-y-0.5">
          {totals.map((total) => (
            <li key={total.currency} className="text-2xl font-semibold tabular-nums">
              {formatMoney(total.amount, total.currency)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BalanceList({
  title,
  empty,
  rows,
  onOpen,
  onSettle,
}: {
  title: string;
  empty: string;
  rows: readonly { person: Person; balances: PersonBalance[] }[];
  onOpen: (person: Person) => void;
  onSettle: (person: Person, balance: PersonBalance) => void;
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-elevation-1">
          {rows.flatMap(({ person, balances }) =>
            balances.map((balance) => (
              <li
                key={`${person.id}-${balance.currency}`}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <PersonAvatar person={person} size="sm" />
                <button
                  type="button"
                  onClick={() => onOpen(person)}
                  className="min-w-0 flex-1 truncate rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {person.name}
                </button>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    balance.amount > 0 ? "text-success" : "text-warning",
                  )}
                >
                  {formatMoney(Math.abs(balance.amount), balance.currency)}
                </span>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={() => onSettle(person, balance)}
                  aria-label={`Settle up with ${person.name}`}
                >
                  Settle up
                </Button>
              </li>
            )),
          )}
        </ul>
      )}
    </section>
  );
}

export function EntryRow({
  entry,
  person,
  onOpen,
  actions,
}: {
  entry: PersonLedgerEntry;
  person: Person;
  onOpen?: (person: Person) => void;
  /** Extra controls at the end of the row, such as a menu. */
  actions?: ReactNode;
}) {
  const signed = signedAmount(entry);
  const content = (
    <>
      <PersonAvatar person={person} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {entryHeadline(entry, person.name)}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">
            {entry.description} · {formatCalendarDate(entry.occurred_on)}
          </span>
          {entry.transaction ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5">
              <Landmark className="size-3" aria-hidden="true" />
              In Finance
            </span>
          ) : null}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          signed > 0 ? "text-success" : "text-warning",
        )}
      >
        {formatMoney(signed, entry.currency, { signDisplay: "always" })}
      </span>
    </>
  );
  return (
    <li className="flex items-center gap-2 pr-2">
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(person)}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">{content}</div>
      )}
      {actions}
    </li>
  );
}
