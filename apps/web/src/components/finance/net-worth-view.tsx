"use client";

import type {
  Currency,
  NetWorth,
  NetWorthGroupTotal,
  NetWorthItem,
  NetWorthSnapshot,
} from "@orbit/contracts";
import { Camera, CircleHelp, Scale } from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useInvestmentMutations, useNetWorth, useSnapshots } from "@/hooks/use-investments";
import { currencyOptions, formatMoney } from "@/lib/finance";
import { SNAPSHOT_SOURCE_LABELS, SOURCE_LABELS } from "@/lib/investments";
import { cn } from "@/utils/common";
import { formatCalendarDate, localDateString, monthLabel } from "@/utils/dates";

import { Panel, Tile } from "./finance-overview";
import type { FinanceData } from "./finance-view";
import { FreshnessBadge, Gain, InlineSelect } from "./investment-parts";
import { ErrorPanel } from "./investments-view";

/**
 * Everything owned minus everything owed, in one currency, with each value's source and date,
 * changes since earlier months, and the history of monthly snapshots.
 */
export function NetWorthView({ workspaceId, onAnnounce }: FinanceData) {
  const today = localDateString();
  const [chosen, setChosen] = useState<Currency | null>(null);
  const worth = useNetWorth(workspaceId, { today, currency: chosen });
  const state = worth.state;

  if (state.status === "error")
    return <ErrorPanel message={state.message} onRetry={worth.reload} />;
  if (state.status === "loading") {
    return (
      <div className="space-y-4">
        <span className="sr-only">Loading net worth…</span>
        <div className="grid gap-4 sm:grid-cols-3">
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {data.currencies.length > 1 ? (
          <InlineSelect
            label="Currency"
            value={currency}
            className="w-24"
            onChange={onCurrency}
            options={currencyOptions(data.currencies)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">As of {formatCalendarDate(data.as_of)}</p>
        )}
        <Button variant="outline" disabled={saving} onClick={() => void save()}>
          <Camera aria-hidden="true" />
          {saving ? "Saving…" : "Save this month’s snapshot"}
        </Button>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <Tile label="Total assets" value={formatMoney(data.assets, currency)}>
          Accounts, investments, and other assets
        </Tile>
        <Tile label="Total liabilities" value={formatMoney(data.liabilities, currency)}>
          Owed on cards and loans
        </Tile>
        <Tile
          label="Net worth"
          value={formatMoney(data.net_worth, currency)}
          tone={data.net_worth < 0 ? "negative" : "default"}
        >
          Assets minus liabilities, {formatCalendarDate(data.as_of)}
        </Tile>
      </dl>

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
            . Each is marked below.
          </span>
        </p>
      ) : null}

      <Panel title="Change" description="Against the snapshots saved for earlier months.">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {data.changes.map((change) => (
            <div key={change.months}>
              <dt className="text-xs text-muted-foreground">
                {change.months === 1 ? "1 month" : `${change.months} months`}
              </dt>
              <dd className="text-sm font-medium">
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

      <Panel
        title="Net worth over time"
        description="Monthly snapshots, then today. Reconstructed months were rebuilt later from recorded history."
      >
        {snapshots.state.status === "loading" ? (
          <Skeleton className="h-48" />
        ) : snapshots.state.status === "error" ? (
          <ErrorPanel message={snapshots.state.message} onRetry={snapshots.reload} />
        ) : (
          <TrendBars snapshots={snapshots.state.data.snapshots} live={data} />
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown
          title="Assets"
          groups={data.groups.filter((g) => g.side === "asset")}
          currency={currency}
        />
        <Breakdown
          title="Liabilities"
          groups={data.groups.filter((g) => g.side === "liability")}
          currency={currency}
        />
      </div>

      <Panel
        title="What’s counted"
        description="Every balance and valuation behind the totals, with where it came from and when."
        flush
      >
        <ItemList items={counted} currency={currency} />
        {excluded.length > 0 ? (
          <>
            <h4 className="border-t px-5 pt-3 text-xs font-medium text-muted-foreground">
              Not counted
            </h4>
            <ItemList items={excluded} currency={currency} />
          </>
        ) : null}
      </Panel>
    </div>
  );
}

function Breakdown({
  title,
  groups,
  currency,
}: {
  title: string;
  groups: readonly NetWorthGroupTotal[];
  currency: Currency;
}) {
  return (
    <Panel title={title}>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <dl className="space-y-2">
          {groups.map((group) => (
            <div key={group.key} className="flex items-baseline justify-between gap-3 text-sm">
              <dt>{group.label}</dt>
              <dd className="tabular-nums">{formatMoney(group.value, currency)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

function ItemList({ items, currency }: { items: readonly NetWorthItem[]; currency: Currency }) {
  return (
    <ul className="divide-y border-t">
      {items.map((item) => (
        <li
          key={`${item.kind}:${item.id}`}
          className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.name}</p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{SOURCE_LABELS[item.source]}</span>
              {item.valued_on ? <span>{formatCalendarDate(item.valued_on)}</span> : null}
              <FreshnessBadge freshness={item.freshness} />
              {item.note ? <span>{item.note}</span> : null}
            </p>
          </div>
          <span
            className={cn(
              "text-sm tabular-nums",
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
      <ul aria-label="Net worth by month" className="relative flex h-48 items-stretch gap-1">
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
                    "absolute inset-x-[15%] rounded-sm",
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
