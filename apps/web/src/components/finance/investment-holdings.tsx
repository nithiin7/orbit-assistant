"use client";

import type { Currency, Holding, HoldingKind, InvestmentAccount, SipPlan } from "@orbit/contracts";
import {
  ArrowUpFromLine,
  CalendarClock,
  Coins,
  Pause,
  Pencil,
  Play,
  Tag,
  Trash2,
} from "lucide-react";
import { type ReactNode } from "react";

import { describeApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type Resource } from "@/hooks/query-resource";
import { useInvestmentMutations } from "@/hooks/use-investments";
import { frequencyLabel } from "@/lib/commitments";
import { formatMoney } from "@/lib/finance";
import {
  formatUnitPrice,
  formatUnits,
  gainTone,
  holdingKindLabel,
  SIP_STATES,
} from "@/lib/investments";
import { cn } from "@/utils/common";
import { formatCalendarDate, localDateString } from "@/utils/dates";

import { Chip, twoColumnRows } from "./finance-meta";
import { Figure, FreshnessBadge, Gain } from "./investment-parts";
import { type Dialog } from "./investments-sections";
import { LoadError, Panel } from "./panel";
import { RowActions } from "./row-actions";

export function HoldingsPanel({
  title,
  kind,
  empty,
  state,
  onRetry,
  currency,
  profiles,
  sips,
  onDialog,
  workspaceId,
  onAnnounce,
}: {
  title: string;
  kind: HoldingKind;
  /** Shown in place of the list when there are none of this kind. */
  empty: ReactNode;
  state: Resource<{ holdings: Holding[] }>;
  onRetry: () => void;
  currency: Currency;
  profiles: readonly InvestmentAccount[];
  sips: readonly SipPlan[];
  onDialog: (dialog: Dialog) => void;
  workspaceId: string;
  onAnnounce: (message: string) => void;
}) {
  const { deleteHolding, updateSip } = useInvestmentMutations(workspaceId);
  if (state.status === "error") return <LoadError message={state.message} onRetry={onRetry} />;
  if (state.status === "loading") return <Skeleton className="h-48 rounded-xl" />;
  const holdings = state.data.holdings.filter(
    (holding) => holding.currency === currency && holding.kind === kind,
  );
  const byAccount = profiles
    .filter((account) => account.currency === currency)
    .map((account) => ({
      account,
      holdings: holdings.filter((holding) => holding.account_id === account.account_id),
    }))
    .filter((group) => group.holdings.length > 0);
  if (byAccount.length === 0) return empty;

  return (
    <Panel
      title={title}
      description="Units and cost come from recorded buys and sales (first in, first out). Values use the latest price you entered."
      flush
    >
      {byAccount.map(({ account, holdings: rows }) => (
        <section key={account.account_id} aria-label={account.name} className="border-t">
          <h4 className="bg-muted/30 px-5 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {account.name}
          </h4>
          <ul className={cn("@container/rows grid divide-y", twoColumnRows(rows.length, "6xl"))}>
            {rows.map((holding) => (
              <HoldingRow
                key={holding.id}
                holding={holding}
                plans={sips.filter((plan) => plan.holding_id === holding.id)}
                onDialog={onDialog}
                onDelete={async () => {
                  try {
                    await deleteHolding.mutateAsync(holding.id);
                    onAnnounce(`Deleted “${holding.name}”.`);
                  } catch (reason) {
                    onAnnounce(describeApiError(reason, "Couldn’t delete the holding."));
                  }
                }}
                onSipState={async (plan, next) => {
                  try {
                    await updateSip.mutateAsync({ id: plan.id, body: { state: next } });
                    onAnnounce(
                      `SIP ${next === "active" ? "resumed" : SIP_STATES[next].toLowerCase()}.`,
                    );
                  } catch (reason) {
                    onAnnounce(describeApiError(reason, "Couldn’t change the SIP."));
                  }
                }}
              />
            ))}
          </ul>
        </section>
      ))}
    </Panel>
  );
}

function HoldingRow({
  holding,
  plans,
  onDialog,
  onDelete,
  onSipState,
}: {
  holding: Holding;
  plans: readonly SipPlan[];
  onDialog: (dialog: Dialog) => void;
  onDelete: () => Promise<void>;
  onSipState: (plan: SipPlan, state: SipPlan["state"]) => Promise<void>;
}) {
  const currency = holding.currency;
  const today = localDateString();
  const held = holding.quantity !== "0";
  return (
    <li className="min-w-0 space-y-3 px-4 py-3.5 @md/rows:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <button
            type="button"
            onClick={() => onDialog({ kind: "holding", holding })}
            aria-label={`Edit “${holding.name}”`}
            className="block max-w-full text-left text-sm font-medium break-words outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
          >
            {holding.name}
          </button>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{holdingKindLabel(holding.kind)}</span>
            {holding.symbol ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{[holding.symbol, holding.exchange].filter(Boolean).join(" · ")}</span>
              </>
            ) : null}
            {holding.category ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{holding.category}</span>
              </>
            ) : null}
            {holding.folio ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Folio {holding.folio}</span>
              </>
            ) : null}
            {held ? <FreshnessBadge freshness={holding.freshness} /> : <Chip>Sold</Chip>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-semibold whitespace-nowrap tabular-nums">
            {formatMoney(holding.value, currency)}
          </p>
          <p className={cn("text-xs whitespace-nowrap", gainTone(holding.unrealized_gain))}>
            {holding.unrealized_gain === null ? (
              "At cost: no price yet"
            ) : (
              <>
                <Gain amount={holding.unrealized_gain} currency={currency} /> unrealized
              </>
            )}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @lg/rows:grid-cols-5">
        <Figure label="Units">{formatUnits(holding.quantity)}</Figure>
        <Figure label="Average cost">
          {holding.average_cost ? formatUnitPrice(holding.average_cost, currency) : "—"}
        </Figure>
        <Figure label="Cost basis">{formatMoney(holding.cost, currency)}</Figure>
        <Figure label={holding.kind === "mutual_fund" ? "Latest NAV" : "Latest price"}>
          {holding.price
            ? `${formatUnitPrice(holding.price.price, currency)} · ${formatCalendarDate(holding.price.price_date)}`
            : "Not entered"}
        </Figure>
        <Figure label="Realized · dividends">
          <Gain amount={holding.realized_gain} currency={currency} /> ·{" "}
          {formatMoney(holding.dividends, currency)}
        </Figure>
      </dl>

      {plans.length > 0 ? (
        <ul aria-label="SIPs" className="space-y-1.5">
          {plans.map((plan) => {
            const overdue = plan.next_due_date !== null && plan.next_due_date < today;
            return (
              <li
                key={plan.id}
                className="flex items-center gap-2 rounded-lg bg-muted/40 py-1.5 pr-1.5 pl-3 text-xs"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    SIP {formatMoney(plan.amount, plan.currency)}{" "}
                    {frequencyLabel(plan.frequency).toLowerCase()}
                  </span>
                  {" · "}
                  {plan.state !== "active" ? (
                    SIP_STATES[plan.state]
                  ) : plan.next_due_date ? (
                    <span className={overdue ? "text-destructive" : undefined}>
                      {overdue ? "Overdue since" : plan.auto_debit ? "Auto-debit" : "Next"}{" "}
                      {formatCalendarDate(plan.next_due_date)}
                    </span>
                  ) : (
                    "Finished"
                  )}
                  <span className="text-muted-foreground">
                    {" · "}
                    {plan.installments} recorded, {formatMoney(plan.invested, plan.currency)}
                  </span>
                </span>
                <RowActions
                  name={`SIP in ${holding.name}`}
                  primary={
                    plan.state === "active" && plan.next_due_date ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => onDialog({ kind: "trade", holding, type: "buy", sip: plan })}
                      >
                        Record installment
                      </Button>
                    ) : null
                  }
                  actions={[
                    {
                      id: "edit",
                      label: "Edit SIP",
                      icon: Pencil,
                      onSelect: () => onDialog({ kind: "sip", holding, plan }),
                    },
                    {
                      id: "pause",
                      label: "Pause SIP",
                      icon: Pause,
                      hidden: plan.state !== "active",
                      onSelect: () => void onSipState(plan, "paused"),
                    },
                    {
                      id: "resume",
                      label: "Resume SIP",
                      icon: Play,
                      hidden: plan.state !== "paused",
                      onSelect: () => void onSipState(plan, "active"),
                    },
                  ]}
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      <RowActions
        name={holding.name}
        primary={
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDialog({ kind: "trade", holding, type: "buy" })}
          >
            Buy
          </Button>
        }
        actions={[
          {
            id: "sell",
            label: "Sell",
            icon: ArrowUpFromLine,
            disabled: !held,
            onSelect: () => onDialog({ kind: "trade", holding, type: "sell" }),
          },
          {
            id: "price",
            label: holding.kind === "mutual_fund" ? "Update NAV" : "Update price",
            icon: Tag,
            onSelect: () => onDialog({ kind: "price", holding }),
          },
          {
            id: "dividend",
            label: "Record a dividend",
            icon: Coins,
            onSelect: () => onDialog({ kind: "trade", holding, type: "dividend" }),
          },
          {
            id: "sip",
            label: "Schedule a SIP",
            icon: CalendarClock,
            hidden: holding.kind !== "mutual_fund",
            onSelect: () => onDialog({ kind: "sip", holding }),
          },
          {
            id: "edit",
            label: "Edit",
            icon: Pencil,
            onSelect: () => onDialog({ kind: "holding", holding }),
          },
          {
            id: "delete",
            label: "Delete…",
            icon: Trash2,
            destructive: true,
            hidden: holding.invested_total !== 0,
            confirm: {
              prompt: `Delete “${holding.name}”?`,
              choices: [{ label: "Delete holding", destructive: true, onConfirm: onDelete }],
            },
          },
        ]}
      />
    </li>
  );
}
