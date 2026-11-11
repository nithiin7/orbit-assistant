"use client";

import type { Currency, Deposit } from "@orbit/contracts";
import { CircleCheck, Pencil, Plus, RotateCcw, Tag } from "lucide-react";
import { type ReactNode } from "react";

import { describeApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type Resource } from "@/hooks/query-resource";
import { useInvestmentMutations } from "@/hooks/use-investments";
import { formatRate } from "@/lib/commitments";
import { formatMoney } from "@/lib/finance";
import { compoundingLabel } from "@/lib/investments";
import { cn } from "@/utils/common";
import { formatCalendarDate, localDateString } from "@/utils/dates";

import { Chip, twoColumnRows } from "./finance-meta";
import { Figure, FreshnessBadge } from "./investment-parts";
import { type Dialog } from "./investments-sections";
import { LoadError, Panel } from "./panel";
import { RowActions } from "./row-actions";

export function DepositsPanel({
  empty,
  state,
  onRetry,
  currency,
  workspaceId,
  onDialog,
  onAnnounce,
}: {
  /** Shown in place of the list when there are no deposits. */
  empty: ReactNode;
  state: Resource<{ deposits: Deposit[] }>;
  onRetry: () => void;
  currency: Currency;
  workspaceId: string;
  onDialog: (dialog: Dialog) => void;
  onAnnounce: (message: string) => void;
}) {
  const { reopenDeposit } = useInvestmentMutations(workspaceId);
  const reopen = async (deposit: Deposit, deleteLedger: boolean) => {
    try {
      await reopenDeposit.mutateAsync({ id: deposit.id, deleteLedger });
      onAnnounce(`Reopened “${deposit.name}”.`);
    } catch (reason) {
      onAnnounce(describeApiError(reason, "Couldn’t reopen the deposit."));
    }
  };
  if (state.status === "error") return <LoadError message={state.message} onRetry={onRetry} />;
  if (state.status === "loading") return <Skeleton className="h-32 rounded-xl" />;
  const deposits = state.data.deposits.filter((deposit) => deposit.currency === currency);
  if (deposits.length === 0) return empty;
  const today = localDateString();

  return (
    <Panel title="Fixed and recurring deposits" description="Values are estimates." flush>
      <ul
        className={cn(
          "@container/rows grid divide-y border-t",
          twoColumnRows(deposits.length, "6xl"),
        )}
      >
        {deposits.map((deposit) => {
          const open = deposit.status === "active";
          const awaiting = open && deposit.maturity_date <= today;
          return (
            <li key={deposit.id} className="min-w-0 space-y-3 px-4 py-3.5 @md/rows:px-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">{deposit.name}</p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{deposit.kind === "fixed" ? "Fixed deposit" : "Recurring deposit"}</span>
                    {deposit.institution ? <span>{deposit.institution}</span> : null}
                    <span>
                      {formatRate(deposit.interest_rate_bps)}% ·{" "}
                      {compoundingLabel(deposit.compounding)}
                    </span>
                    {open ? (
                      awaiting ? (
                        <Chip tone="warning">Matured, awaiting payout</Chip>
                      ) : (
                        <FreshnessBadge
                          freshness={deposit.freshness}
                          source={deposit.value_source}
                        />
                      )
                    ) : (
                      <Chip>
                        {deposit.status === "matured" ? "Matured" : "Closed early"}
                        {deposit.closed_on ? ` ${formatCalendarDate(deposit.closed_on)}` : ""}
                      </Chip>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-semibold whitespace-nowrap tabular-nums">
                    {formatMoney(deposit.value, deposit.currency)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {open
                      ? deposit.value_source === "manual"
                        ? `Your value on ${formatCalendarDate(deposit.valued_on)}`
                        : "Estimated today"
                      : `Interest received ${formatMoney(deposit.interest_received, deposit.currency)}`}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @lg/rows:grid-cols-4">
                <Figure label="Principal">
                  {formatMoney(deposit.principal, deposit.currency)}
                </Figure>
                <Figure label="Matures">{formatCalendarDate(deposit.maturity_date)}</Figure>
                <Figure label="Expected at maturity (estimate)">
                  {formatMoney(deposit.projected_maturity_amount, deposit.currency)}
                </Figure>
                <Figure label="Bank’s stated amount">
                  {deposit.stated_maturity_amount
                    ? formatMoney(deposit.stated_maturity_amount, deposit.currency)
                    : "Not entered"}
                </Figure>
              </dl>
              <RowActions
                name={deposit.name}
                primary={
                  open ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onDialog({
                          kind: "deposit-action",
                          deposit,
                          action: awaiting
                            ? "close"
                            : deposit.kind === "recurring"
                              ? "contribute"
                              : "value",
                        })
                      }
                    >
                      {awaiting
                        ? "Record payout"
                        : deposit.kind === "recurring"
                          ? "Record installment"
                          : "Set value"}
                    </Button>
                  ) : null
                }
                actions={[
                  {
                    id: "contribute",
                    label: "Add money",
                    icon: Plus,
                    hidden: !open || deposit.kind === "recurring",
                    onSelect: () =>
                      onDialog({ kind: "deposit-action", deposit, action: "contribute" }),
                  },
                  {
                    id: "value",
                    label: "Set value",
                    icon: Tag,
                    hidden: !open || deposit.kind === "fixed",
                    onSelect: () => onDialog({ kind: "deposit-action", deposit, action: "value" }),
                  },
                  {
                    id: "close",
                    label: "Close early",
                    description: "Record the payout before maturity",
                    icon: CircleCheck,
                    hidden: !open || awaiting,
                    onSelect: () => onDialog({ kind: "deposit-action", deposit, action: "close" }),
                  },
                  {
                    id: "edit",
                    label: "Edit",
                    icon: Pencil,
                    hidden: !open,
                    onSelect: () => onDialog({ kind: "deposit", deposit }),
                  },
                  {
                    id: "reopen",
                    label: "Reopen…",
                    icon: RotateCcw,
                    hidden: open,
                    confirm: {
                      prompt: `Undo closing “${deposit.name}”?`,
                      choices: [
                        {
                          label: "Reopen, keep the payout transactions",
                          onConfirm: () => reopen(deposit, false),
                        },
                        {
                          label: "Reopen and delete them",
                          destructive: true,
                          onConfirm: () => reopen(deposit, true),
                        },
                      ],
                    },
                  },
                ]}
              />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
