"use client";

import type { Person, PersonBalance, PersonLedger, PersonLedgerEntry } from "@orbit/contracts";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  HandCoins,
  History,
  Landmark,
  type LucideIcon,
  Plus,
  Scale,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/finance";
import { type CurrencyTotal, entryHeadline, moneySummary, signedAmount } from "@/lib/people";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";

import { GroupHeading } from "./people-lists";
import { PersonAvatar } from "./person-avatar";

/** Totals over two tabs: who owes you and whom you owe, and everything recorded, by month. */
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
  const tabsId = useId();
  const [tab, setTab] = useState<MoneyTab>("balances");
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

  const months = entriesByMonth(ledger.entries);
  const counts: Record<MoneyTab, number> = {
    balances: summary.owers.length + summary.owed.length,
    recent: ledger.entries.length,
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 @2xl/people:grid-cols-2">
        <Tile
          title="Owed to you"
          totals={summary.owedToYou}
          people={summary.owers.length}
          tone="in"
        />
        <Tile title="You owe" totals={summary.youOwe} people={summary.owed.length} tone="out" />
      </div>

      <div className="flex items-end justify-between gap-3 border-b">
        <MoneyTabs idPrefix={tabsId} tab={tab} counts={counts} onChange={setTab} />
        <Button variant="soft" size="sm" className="mb-1.5 shrink-0" onClick={onRecord}>
          <Plus aria-hidden="true" />
          Record money
        </Button>
      </div>

      <div
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${tab}`}
        className="animate-page-in"
      >
        {tab === "balances" ? (
          <div className="grid gap-6 @4xl/people:grid-cols-2">
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
        ) : (
          <div className="space-y-6">
            {months.map((month) => (
              <section
                key={month.key}
                aria-labelledby={`${tabsId}-${month.key}`}
                className="space-y-3"
              >
                <GroupHeading id={`${tabsId}-${month.key}`} count={month.entries.length}>
                  {month.label}
                </GroupHeading>
                <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-elevation-1">
                  {month.entries.map((entry) => {
                    const person = byId.get(entry.person_id);
                    return person ? (
                      <EntryRow key={entry.id} entry={entry} person={person} onOpen={onOpen} />
                    ) : null;
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type MoneyTab = "balances" | "recent";

const MONEY_TABS: readonly { id: MoneyTab; label: string; icon: LucideIcon }[] = [
  { id: "balances", label: "Balances", icon: Scale },
  { id: "recent", label: "Recent", icon: History },
];

/** Entries (already newest first) grouped by the month they happened in. */
function entriesByMonth(
  entries: readonly PersonLedgerEntry[],
): { key: string; label: string; entries: PersonLedgerEntry[] }[] {
  const format = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const months: { key: string; label: string; entries: PersonLedgerEntry[] }[] = [];
  for (const entry of entries) {
    const key = entry.occurred_on.slice(0, 7);
    const last = months[months.length - 1];
    if (last?.key === key) {
      last.entries.push(entry);
      continue;
    }
    const [year = 0, month = 1] = key.split("-").map(Number);
    months.push({
      key,
      label: format.format(new Date(Date.UTC(year, month - 1, 1))),
      entries: [entry],
    });
  }
  return months;
}

function MoneyTabs({
  idPrefix,
  tab,
  counts,
  onChange,
}: {
  idPrefix: string;
  tab: MoneyTab;
  counts: Record<MoneyTab, number>;
  onChange: (tab: MoneyTab) => void;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = MONEY_TABS.length - 1;
    const next = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    const target = next === undefined ? undefined : MONEY_TABS[next];
    if (next === undefined || !target) return;
    event.preventDefault();
    onChange(target.id);
    tabs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label="Money" className="-mb-px flex gap-1">
      {MONEY_TABS.map(({ id, label, icon: Icon }, index) => {
        const selected = id === tab;
        return (
          <button
            key={id}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-${id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "relative flex h-10 shrink-0 items-center gap-2 rounded-t-md px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full",
              selected
                ? "text-foreground after:bg-brand"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className={cn("size-4", selected && "text-brand")} />
            {label}
            <span
              aria-hidden="true"
              className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums"
            >
              {counts[id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Tile({
  title,
  totals,
  people,
  tone,
}: {
  title: string;
  totals: readonly CurrencyTotal[];
  /** How many people the totals come from. */
  people: number;
  tone: "in" | "out";
}) {
  const Icon = tone === "in" ? ArrowDownLeft : ArrowUpRight;
  const who = people === 1 ? "1 person" : `${people} people`;
  return (
    <section
      aria-label={title}
      className={cn(
        "relative isolate overflow-hidden rounded-3xl border p-5 shadow-elevation-1",
        tone === "in"
          ? "border-success/20 bg-linear-to-br from-success/12 via-success/4 to-card"
          : "border-warning/20 bg-linear-to-br from-warning/12 via-warning/4 to-card",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute -top-12 -right-12 -z-10 size-36 rounded-full blur-2xl",
          tone === "in" ? "bg-success/15" : "bg-warning/15",
        )}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <span
          aria-hidden="true"
          className={cn(
            "flex size-9 items-center justify-center rounded-xl",
            tone === "in" ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
          )}
        >
          <Icon className="size-4.5" />
        </span>
      </div>
      {totals.length === 0 ? (
        <p className="mt-3 text-3xl font-semibold tracking-tight text-muted-foreground/60">—</p>
      ) : (
        <ul className="mt-3 space-y-0.5">
          {totals.map((total) => (
            <li key={total.currency} className="text-3xl font-semibold tracking-tight tabular-nums">
              {formatMoney(total.amount, total.currency)}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {people === 0
          ? tone === "in"
            ? "No one owes you right now"
            : "You’re all clear"
          : tone === "in"
            ? `From ${who}`
            : `To ${who}`}
      </p>
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
    <section aria-label={title} className="space-y-3">
      <GroupHeading count={rows.length}>{title}</GroupHeading>
      {rows.length === 0 ? (
        <p className="flex items-center gap-2.5 rounded-2xl border border-dashed bg-card/40 px-4 py-5 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.flatMap(({ person, balances }) =>
            balances.map((balance) => {
              const owesYou = balance.amount > 0;
              return (
                <li
                  key={`${person.id}-${balance.currency}`}
                  className="flex items-center gap-3 rounded-2xl border bg-card px-3 py-2.5 shadow-elevation-1 transition-shadow hover:shadow-elevation-2"
                >
                  <PersonAvatar person={person} />
                  <span className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onOpen(person)}
                      className="block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {person.name}
                    </button>
                    <span
                      className={cn(
                        "block text-lg leading-tight font-semibold tabular-nums",
                        owesYou ? "text-success" : "text-warning",
                      )}
                    >
                      {formatMoney(Math.abs(balance.amount), balance.currency)}
                    </span>
                  </span>
                  <Button
                    variant="soft"
                    size="sm"
                    className="rounded-full"
                    onClick={() => onSettle(person, balance)}
                    aria-label={`Settle up with ${person.name}`}
                  >
                    Settle up
                  </Button>
                </li>
              );
            }),
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
  const Direction = signed > 0 ? ArrowDownLeft : ArrowUpRight;
  const content = (
    <>
      <span className="relative shrink-0" aria-hidden="true">
        <PersonAvatar person={person} size="sm" />
        <span
          className={cn(
            "absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full ring-2 ring-card",
            signed > 0 ? "bg-success text-white" : "bg-warning text-white",
          )}
        >
          <Direction className="size-2.5" strokeWidth={3} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {entryHeadline(entry, person.name)}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">
            {entry.description} · {formatCalendarDate(entry.occurred_on)}
          </span>
          {entry.transaction ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-medium">
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
