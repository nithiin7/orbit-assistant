"use client";

import type { Currency, PersonLedgerEntry } from "@orbit/contracts";
import { Divide, Plus, Users, X } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { usePeople } from "@/hooks/use-people";
import { formatMoney, toDecimalString } from "@/lib/finance";
import { equalShare, type SplitRow } from "@/lib/people";

let nextKey = 0;

/** A fresh, empty split row. */
export function newSplitRow(): SplitRow {
  nextKey += 1;
  return { key: `split-${nextKey}`, personId: "", amount: "" };
}

/**
 * Who an expense is split with, and their shares. The expense stays whole in Finance; each share
 * is recorded in People as money they owe you, linked to it.
 */
export function SplitWith({
  workspaceId,
  currency,
  total,
  rows,
  existing,
  onChange,
}: {
  workspaceId: string;
  currency: Currency;
  /** The expense's amount in minor units, once it parses. */
  total: number | null;
  rows: readonly SplitRow[];
  /** Shares already recorded for this expense. */
  existing: readonly PersonLedgerEntry[];
  onChange: (rows: SplitRow[]) => void;
}) {
  const id = useId();
  const { people } = usePeople(workspaceId);
  const everyone = people.status === "success" ? people.data : [];
  const names = new Map(everyone.map((person) => [person.id, person.name]));
  const options = everyone.map((person) => ({ value: person.id, label: person.name }));

  const update = (key: string, change: Partial<SplitRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  function splitEqually() {
    if (total === null) return;
    const share = toDecimalString(equalShare(total, rows.length + existing.length), currency);
    onChange(rows.map((row) => ({ ...row, amount: share })));
  }

  if (people.status === "success" && everyone.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
        <Users className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Add people in{" "}
          <Link
            href="/people"
            className="rounded-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            People
          </Link>{" "}
          to split expenses with them.
        </span>
      </p>
    );
  }

  return (
    <fieldset className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-medium">
        <Users className="size-4 text-brand" aria-hidden="true" />
        Split with
      </legend>
      {existing.length > 0 ? (
        <ul className="space-y-1 text-sm" aria-label="Already split with">
          {existing.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3">
              <span className="truncate">{names.get(entry.person_id) ?? "Someone"}</span>
              <span className="text-muted-foreground tabular-nums">
                {formatMoney(entry.amount, entry.currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {rows.map((row, index) => (
        <div key={row.key} className="flex items-center gap-2">
          <Select
            aria-label={`Person ${index + 1}`}
            className="min-w-0 flex-1"
            placeholder={people.status === "loading" ? "Loading…" : "Choose someone"}
            value={row.personId}
            onValueChange={(personId) => update(row.key, { personId })}
            options={options}
          />
          <AmountInput
            id={`${id}-${row.key}`}
            aria-label={`Share for person ${index + 1}`}
            className="w-32"
            placeholder="Their share"
            currency={currency}
            value={row.amount}
            onValueChange={(amount) => update(row.key, { amount })}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-muted-foreground"
            aria-label={`Remove person ${index + 1}`}
            onClick={() => onChange(rows.filter((entry) => entry.key !== row.key))}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={() => onChange([...rows, newSplitRow()])}>
          <Plus aria-hidden="true" />
          Add someone
        </Button>
        {rows.length > 0 ? (
          <Button variant="ghost" size="sm" disabled={total === null} onClick={splitEqually}>
            <Divide aria-hidden="true" />
            Split equally
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        The expense stays whole here. Their shares show in People until they pay you back; then a
        refund brings your spending down to your share.
      </p>
    </fieldset>
  );
}
