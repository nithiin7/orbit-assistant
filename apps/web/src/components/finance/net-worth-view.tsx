"use client";

import type {
  Currency,
  NetWorth,
  NetWorthGroupTotal,
  NetWorthItem,
  NetWorthSnapshot,
} from "@orbit/contracts";
import { Camera, ChevronDown, CircleHelp, CreditCard, Landmark, Scale, Wallet } from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useInvestmentMutations, useNetWorth, useSnapshots } from "@/hooks/use-investments";
import { formatMoney } from "@/lib/finance";
import { SNAPSHOT_SOURCE_LABELS, SOURCE_LABELS } from "@/lib/investments";
import { cn } from "@/utils/common";
import { formatCalendarDate, localDateString, monthLabel } from "@/utils/dates";

import { Chip } from "./finance-meta";
import type { FinanceData } from "./finance-view";
import { FreshnessBadge, Gain } from "./investment-parts";
import { EndedSection, LoadError, Panel } from "./panel";
import { StatGrid, StatTile } from "./stat-tile";
import { CurrencySwitcher, ViewHeader } from "./view-header";

/**
 * Everything owned minus everything owed, in one currency, with each value's source and date,
 * changes since earlier months, and the history of monthly snapshots.
 */
export function NetWorthView({ workspaceId, onAnnounce }: FinanceData) {
  const today = localDateString();
  const [chosen, setChosen] = useState<Currency | null>(null);
  const worth = useNetWorth(workspaceId, { today, currency: chosen });
  const state = worth.state;

  if (state.status === "error") {
    return (
      <div className="space-y-6">
        <ViewHeader title="Net worth" />
        <LoadError message={state.message} onRetry={worth.reload} />
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="space-y-4">
        <span className="sr-only">Loading net worth…</span>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-4">
          {[0, 1, 2].map((tile) => (
            <Skeleton key={tile} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-56 rounded-xl" />
      </div>
    );
  }
  const data = state.data;
  if (data.currencies.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title="Nothing to add up yet"
        description="Net worth adds your account balances, investments, and other assets, and subtracts cards and loans. Add an account or an asset to begin."
      />
    );
  }
  return (
    <NetWorthDetail
      data={data}
      today={today}
      workspaceId={workspaceId}
      onCurrency={setChosen}
      onAnnounce={onAnnounce}
    />
  );
}

function NetWorthDetail({
  data,
  today,
  workspaceId,
  onCurrency,
  onAnnounce,
}: {
  data: NetWorth;
  today: string;
  workspaceId: string;
  onCurrency: (currency: Currency) => void;
  onAnnounce: (message: string) => void;
}) {
  const currency = data.currency;
  const snapshots = useSnapshots(workspaceId, currency);
  const { takeSnapshot } = useInvestmentMutations(workspaceId);
  const [saving, setSaving] = useState(false);
  const counted = data.items.filter((item) => item.counted);
  const excluded = data.items.filter((item) => !item.counted);
  const flagged = data.quality.stale + data.quality.missing + data.quality.estimated;

  async function save() {
    setSaving(true);
    try {
      await takeSnapshot.mutateAsync({ currency, today, refresh: true });
      onAnnounce(`Saved ${monthLabel(today.slice(0, 7))}’s net worth.`);
    } catch (reason) {
      onAnnounce(describeApiError(reason, "Couldn’t save the snapshot."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Net worth"
        description={`Everything you own minus everything you owe, as of ${formatCalendarDate(data.as_of)}. Save a snapshot each month to see how it changes.`}
        controls={
          <>
            <CurrencySwitcher
              currencies={data.currencies}
              currency={currency}
              onChange={onCurrency}
            />
            <Button variant="outline" disabled={saving} onClick={() => void save()}>
              <Camera aria-hidden="true" />
              {saving ? "Saving…" : "Save this month’s snapshot"}
            </Button>
          </>
        }
      />

      <StatGrid>
        <StatTile
          label="Net worth"
          icon={Wallet}
          value={formatMoney(data.net_worth, currency)}
          tone={data.net_worth < 0 ? "negative" : "default"}
          accent="brand"
          emphasis
        >
          Assets minus liabilities
        </StatTile>
        <StatTile
          label="Total assets"
          icon={Landmark}
          accent="positive"
          value={formatMoney(data.assets, currency)}
        >
          Accounts, investments, and other assets
        </StatTile>
        <StatTile
          label="Total liabilities"
          icon={CreditCard}
          accent="negative"
          value={formatMoney(data.liabilities, currency)}
        >
          Owed on cards and loans
        </StatTile>
      </StatGrid>

      {flagged > 0 ? (
        <p
          role="note"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
        >
          <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            Not every value is current:{" "}
            {[
              data.quality.estimated ? `${data.quality.estimated} estimated` : "",
              data.quality.stale ? `${data.quality.stale} stale` : "",
              data.quality.missing ? `${data.quality.missing} without a valuation (at cost)` : "",
            ]
              .filter(Boolean)
              .join(", ")}
            . Open a group below to see which.
          </span>
        </p>
      ) : null}

      {/* How it changed, beside what it's made of when there's room. */}
      <div className="grid items-start gap-6 @5xl/list:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Panel
            title="Net worth over time"
            description="Monthly snapshots, then today. Reconstructed months were rebuilt later from recorded history."
          >
            {snapshots.state.status === "loading" ? (
              <Skeleton className="h-48" />
            ) : snapshots.state.status === "error" ? (
              <LoadError message={snapshots.state.message} onRetry={snapshots.reload} />
            ) : (
              <TrendBars snapshots={snapshots.state.data.snapshots} live={data} />
            )}
          </Panel>
          <Panel title="Change" description="Against the snapshots saved for earlier months.">
            <dl className="grid grid-cols-2 gap-4 @2xl/list:grid-cols-4">
              {data.changes.map((change) => (
                <div key={change.months}>
                  <dt className="text-xs text-muted-foreground">
                    {change.months === 1 ? "1 month" : `${change.months} months`}
                  </dt>
                  <dd className="text-sm font-medium whitespace-nowrap">
                    {change.change === null ? (
                      <span className="text-muted-foreground">No snapshot</span>
                    ) : (
                      <Gain amount={change.change} currency={currency} />
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
        <div className="grid gap-6 @3xl/list:grid-cols-2 @5xl/list:grid-cols-1">
          <Breakdown
            title="Assets"
            total={data.assets}
            groups={data.groups.filter((g) => g.side === "asset")}
            items={counted}
            currency={currency}
          />
          <Breakdown
            title="Liabilities"
            total={data.liabilities}
            groups={data.groups.filter((g) => g.side === "liability")}
            items={counted}
            currency={currency}
          />
        </div>
      </div>

      {excluded.length > 0 ? (
        <EndedSection summary={`${excluded.length} not counted, so nothing is added twice`}>
          <ItemList label="Not counted" items={excluded} currency={currency} />
        </EndedSection>
      ) : null}
    </div>
  );
}

/**
 * One side of net worth, a row per group with its total and share. A group opens to show what's
 * in it, with each value's source and date; a group with stale or missing values says so.
 */
function Breakdown({
  title,
  total,
  groups,
  items,
  currency,
}: {
  title: string;
  total: number;
  groups: readonly NetWorthGroupTotal[];
  items: readonly NetWorthItem[];
  currency: Currency;
}) {
  return (
    <Panel
      title={title}
      action={
        <p className="pt-1.5 pr-2 text-sm font-semibold whitespace-nowrap tabular-nums">
          {formatMoney(total, currency)}
        </p>
      }
      flush
    >
      {groups.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">None.</p>
      ) : (
        <ul aria-label={title} className="divide-y border-t">
          {groups.map((group) => {
            const members = items.filter((item) => item.group === group.key);
            const outdated = members.filter(
              (item) => item.freshness === "stale" || item.freshness === "missing",
            ).length;
            const share = total > 0 ? Math.round((group.value / total) * 100) : 0;
            return (
              <li key={group.key}>
                <details className="group/row">
                  <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset @md/list:px-5 [&::-webkit-details-marker]:hidden">
                    <ChevronDown
                      aria-hidden="true"
                      className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform duration-150 group-open/row:rotate-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{group.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {members.length} {members.length === 1 ? "item" : "items"} · {share}%
                      </span>
                    </span>
                    {outdated > 0 ? <Chip tone="warning">{outdated} to update</Chip> : null}
                    <span className="shrink-0 text-sm font-medium whitespace-nowrap tabular-nums">
                      {formatMoney(group.value, currency)}
                    </span>
                  </summary>
                  <ItemList label={group.label} items={members} currency={currency} nested />
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** What's behind a total: each item's value, where it came from, and when. */
function ItemList({
  label,
  items,
  currency,
  nested = false,
}: {
  label: string;
  items: readonly NetWorthItem[];
  currency: Currency;
  /** Inside an opened group: set in from its edge, on a quieter surface. */
  nested?: boolean;
}) {
  return (
    <ul aria-label={label} className={cn("divide-y", nested && "border-t bg-muted/20")}>
      {items.map((item) => (
        <li
          key={`${item.kind}:${item.id}`}
          className={cn(
            "flex min-w-0 items-start justify-between gap-3 py-2.5 pr-4",
            nested ? "pl-10 @md/list:pr-5 @md/list:pl-11" : "pl-4",
          )}
        >
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm">{item.name}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
              <span>{SOURCE_LABELS[item.source]}</span>
              {item.valued_on ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{formatCalendarDate(item.valued_on)}</span>
                </>
              ) : null}
              <FreshnessBadge freshness={item.freshness} />
            </p>
            {item.note ? <p className="text-xs text-muted-foreground">{item.note}</p> : null}
          </div>
          <span
            className={cn(
              "shrink-0 text-sm whitespace-nowrap tabular-nums",
              !item.counted && "text-muted-foreground line-through",
            )}
          >
            {item.side === "liability" ? "−" : ""}
            {formatMoney(item.value, currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

type Point = {
  key: string;
  label: string;
  value: number;
  detail: string;
  kind: "recorded" | "backfill" | "live";
};

/**
 * One bar per month on a shared zero baseline (negative net worth hangs below it). Each bar is
 * focusable and its accessible name carries the month, value, and how it was recorded.
 */
function TrendBars({
  snapshots,
  live,
}: {
  snapshots: readonly NetWorthSnapshot[];
  live: NetWorth;
}) {
  const currency = live.currency;
  const currentMonth = live.as_of.slice(0, 7);
  const points: Point[] = snapshots
    .filter((snapshot) => snapshot.month !== currentMonth)
    .slice(-11)
    .map((snapshot) => ({
      key: snapshot.month,
      label: monthLabel(snapshot.month, { short: true }),
      value: snapshot.net_worth,
      detail: `${SNAPSHOT_SOURCE_LABELS[snapshot.source]}, as of ${formatCalendarDate(snapshot.as_of)}${
        snapshot.quality.estimated + snapshot.quality.stale + snapshot.quality.missing > 0
          ? "; includes estimated or stale values"
          : ""
      }`,
      kind: snapshot.source === "backfill" ? "backfill" : "recorded",
    }));
  points.push({
    key: "live",
    label: "Today",
    value: live.net_worth,
    detail: `Live, as of ${formatCalendarDate(live.as_of)}`,
    kind: "live",
  });
  const max = Math.max(0, ...points.map((point) => point.value));
  const min = Math.min(0, ...points.map((point) => point.value));
  const span = max - min || 1;
  const zero = (max / span) * 100;

  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-chart-1" />
          Recorded
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-sm border border-chart-1 bg-chart-1/30"
          />
          Reconstructed
        </span>
        {points.length === 1 ? <span>Save a snapshot each month to build a history.</span> : null}
      </figcaption>
      <ul aria-label="Net worth by month" className="relative flex h-44 items-stretch gap-1">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 border-t border-border"
          style={{ top: `${zero}%` }}
        />
        {points.map((point) => {
          const height = Math.max((Math.abs(point.value) / span) * 100, point.value ? 1 : 0);
          const top = point.value >= 0 ? zero - height : zero;
          const name = `${point.label}: ${formatMoney(point.value, currency)}. ${point.detail}.`;
          return (
            <li
              key={point.key}
              // Focusable so keyboard users get the same figures as the hover tooltip.
              tabIndex={0}
              aria-label={name}
              className="group relative flex min-w-0 flex-1 flex-col rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div aria-hidden="true" className="relative flex-1 group-hover:bg-accent/50">
                <span
                  className={cn(
                    "absolute inset-x-0 mx-auto w-[70%] max-w-12 rounded-sm",
                    point.kind === "backfill"
                      ? "border border-chart-1 bg-chart-1/30"
                      : "bg-chart-1",
                    point.kind === "live" &&
                      "ring-2 ring-chart-1/40 ring-offset-1 ring-offset-card",
                  )}
                  style={{ top: `${top}%`, height: `${height}%` }}
                />
              </div>
              <span
                aria-hidden="true"
                className="mt-1 truncate text-center text-[11px] text-muted-foreground"
              >
                {point.label}
              </span>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max max-w-56 -translate-x-1/2 animate-tooltip-in rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-elevation-2 group-hover:block group-focus-visible:block"
              >
                <p className="font-medium tabular-nums">{formatMoney(point.value, currency)}</p>
                <p className="text-muted-foreground">{point.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
