"use client";

import type {
  Currency,
  Deposit,
  FinanceAccount,
  Holding,
  InvestmentAccount,
  InvestmentTransaction,
  SipPlan,
} from "@orbit/contracts";
import {
  ArrowUpFromLine,
  BriefcaseBusiness,
  CalendarClock,
  CircleCheck,
  CircleHelp,
  Coins,
  Landmark,
  LineChart,
  Pause,
  Pencil,
  PiggyBank,
  Play,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { type Resource } from "@/hooks/query-resource";
import {
  useDeposits,
  useHoldings,
  useInvestmentAccounts,
  useInvestmentMutations,
  useInvestmentTransactions,
  usePortfolio,
  useSipPlans,
} from "@/hooks/use-investments";
import { formatRate, frequencyLabel } from "@/lib/commitments";
import { formatMoney } from "@/lib/finance";
import {
  accountKindLabel,
  compoundingLabel,
  formatPercent,
  formatUnitPrice,
  formatUnits,
  gainTone,
  holdingKindLabel,
  rangeStart,
  SIP_STATES,
  transactionTypeLabel,
} from "@/lib/investments";
import { cn } from "@/utils/common";
import { formatCalendarDate, localDateString } from "@/utils/dates";

import { Chip, twoColumnRows } from "./finance-meta";
import type { FinanceData } from "./finance-view";
import {
  type DepositAction,
  DepositActionDialog,
  DepositDialog,
  HoldingDialog,
  InvestmentAccountDialog,
  PriceDialog,
  SipDialog,
  TradeDialog,
  type TradeType,
} from "./investment-dialogs";
import { Figure, FreshnessBadge, Gain, InlineSelect, ProportionBars } from "./investment-parts";
import { LoadError, Panel } from "./panel";
import { RowActions } from "./row-actions";
import { StatGrid, StatTile } from "./stat-tile";
import { CurrencySwitcher, ViewHeader } from "./view-header";

type Range = "ytd" | "12" | "all";

const RANGES: { value: Range; label: string }[] = [
  { value: "ytd", label: "This year" },
  { value: "12", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

type Dialog =
  | { kind: "account"; account?: InvestmentAccount }
  | { kind: "holding"; holding?: Holding }
  | { kind: "trade"; holding: Holding; type: TradeType; sip?: SipPlan }
  | { kind: "price"; holding: Holding }
  | { kind: "sip"; holding: Holding; plan?: SipPlan }
  | { kind: "deposit"; deposit?: Deposit }
  | { kind: "deposit-action"; deposit: Deposit; action: DepositAction };

/**
 * The portfolio: what investments are worth against what they cost, gains realized and not,
 * income, allocation, every holding and deposit, SIPs, and recent activity. Values are as of
 * today; realized gains, income, and fees cover the chosen range.
 */
export function InvestmentsView({ workspaceId, accounts, onAnnounce }: FinanceData) {
  const today = localDateString();
  const investmentAccounts = useInvestmentAccounts(workspaceId, today);
  const holdings = useHoldings(workspaceId, today);
  const deposits = useDeposits(workspaceId, today);
  const sips = useSipPlans(workspaceId, today);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [chosenCurrency, setCurrency] = useState<Currency | null>(null);
  const [range, setRange] = useState<Range>("ytd");

  const accountsState = investmentAccounts.state;
  if (accountsState.status === "error") {
    return <LoadError message={accountsState.message} onRetry={investmentAccounts.reload} />;
  }
  if (accountsState.status === "loading") return <InvestmentsSkeleton />;

  const profiles = accountsState.data.accounts;
  const profiled = new Set(profiles.map((account) => account.account_id));
  const adoptable = accounts.filter(
    (account) => account.type === "investment" && !account.archived && !profiled.has(account.id),
  );
  const currencies = [...new Set(profiles.map((account) => account.currency))].sort();
  const currency = chosenCurrency ?? currencies[0] ?? "INR";
  const close = () => setDialog(null);
  const common = { workspaceId, onSaved: onAnnounce, onClose: close };

  const dialogs =
    dialog?.kind === "account" ? (
      <InvestmentAccountDialog
        {...common}
        account={dialog.account}
        accounts={accounts}
        adoptable={adoptable}
      />
    ) : dialog?.kind === "holding" ? (
      <HoldingDialog {...common} holding={dialog.holding} investmentAccounts={profiles} />
    ) : dialog?.kind === "trade" ? (
      <TradeDialog
        {...common}
        holding={dialog.holding}
        type={dialog.type}
        sip={dialog.sip}
        account={profiles.find((entry) => entry.account_id === dialog.holding.account_id)}
        accounts={accounts}
      />
    ) : dialog?.kind === "price" ? (
      <PriceDialog {...common} holding={dialog.holding} />
    ) : dialog?.kind === "sip" ? (
      <SipDialog {...common} holding={dialog.holding} plan={dialog.plan} accounts={accounts} />
    ) : dialog?.kind === "deposit" ? (
      <DepositDialog
        {...common}
        deposit={dialog.deposit}
        investmentAccounts={profiles}
        accounts={accounts}
      />
    ) : dialog?.kind === "deposit-action" ? (
      <DepositActionDialog
        {...common}
        deposit={dialog.deposit}
        action={dialog.action}
        accounts={accounts}
        linkedAccountId={
          profiles.find((entry) => entry.account_id === dialog.deposit.account_id)
            ?.linked_account_id ?? null
        }
      />
    ) : null;

  if (profiles.length === 0) {
    return (
      <>
        <EmptyState
          icon={LineChart}
          title="Track your investments"
          description="Add a mutual fund platform, a broker, or where your fixed deposits are. Prices are entered by hand; Orbit never connects to brokers or banks."
        >
          <Button onClick={() => setDialog({ kind: "account" })}>
            <Plus aria-hidden="true" />
            Add investment account
          </Button>
        </EmptyState>
        {dialogs}
      </>
    );
  }

  const active = profiles.filter((account) => !account.archived);

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Investments"
        description="What your funds, shares, and deposits are worth against what they cost. Prices are entered by hand."
        controls={
          <>
            <CurrencySwitcher currencies={currencies} currency={currency} onChange={setCurrency} />
            <InlineSelect
              label="Gains and income for"
              value={range}
              className="w-40"
              onChange={setRange}
              options={RANGES}
            />
          </>
        }
        action={
          <Menu
            align="end"
            items={[
              {
                id: "holding",
                label: "Holding",
                description: "A mutual fund, stock, or ETF",
                icon: LineChart,
                disabled: active.length === 0,
                onSelect: () => setDialog({ kind: "holding" }),
              },
              {
                id: "deposit",
                label: "Deposit",
                description: "A fixed or recurring deposit",
                icon: PiggyBank,
                disabled: active.length === 0,
                onSelect: () => setDialog({ kind: "deposit" }),
              },
              {
                id: "account",
                label: "Investment account",
                description: "A broker, fund platform, or bank",
                icon: Landmark,
                onSelect: () => setDialog({ kind: "account" }),
              },
            ]}
          >
            <Plus aria-hidden="true" />
            Add
          </Menu>
        }
      />

      <PortfolioSummary workspaceId={workspaceId} currency={currency} today={today} range={range} />

      <HoldingsPanel
        state={holdings.state}
        onRetry={holdings.reload}
        currency={currency}
        profiles={profiles}
        sips={sips.state.status === "success" ? sips.state.data.plans : []}
        onDialog={setDialog}
        workspaceId={workspaceId}
        onAnnounce={onAnnounce}
      />

      <DepositsPanel
        state={deposits.state}
        onRetry={deposits.reload}
        currency={currency}
        workspaceId={workspaceId}
        onDialog={setDialog}
        onAnnounce={onAnnounce}
      />

      <div className="grid items-start gap-6 @4xl/list:grid-cols-2">
        <ActivityPanel
          workspaceId={workspaceId}
          holdings={holdings.state.status === "success" ? holdings.state.data.holdings : []}
          deposits={deposits.state.status === "success" ? deposits.state.data.deposits : []}
          onAnnounce={onAnnounce}
        />
        <AccountsPanel
          profiles={profiles}
          accounts={accounts}
          onEdit={(account) => setDialog({ kind: "account", account })}
        />
      </div>

      {dialogs}
    </div>
  );
}

/** Gains read green, losses red, and nothing neutral. */
function signTone(amount: number): "default" | "positive" | "negative" {
  return amount > 0 ? "positive" : amount < 0 ? "negative" : "default";
}

function PortfolioSummary({
  workspaceId,
  currency,
  today,
  range,
}: {
  workspaceId: string;
  currency: Currency;
  today: string;
  range: Range;
}) {
  const from = rangeStart(today, range === "12" ? 12 : range);
  const portfolio = usePortfolio(workspaceId, {
    currency,
    today,
    date_from: from ?? null,
    date_to: range === "all" ? null : today,
  });
  const state = portfolio.state;
  if (state.status === "error") {
    return <LoadError message={state.message} onRetry={portfolio.reload} />;
  }
  if (state.status === "loading") {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-4">
        {[0, 1, 2, 3].map((tile) => (
          <Skeleton key={tile} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }
  const data = state.data;
  const rangeLabel = RANGES.find((option) => option.value === range)?.label.toLowerCase();
  return (
    <div className="space-y-6">
      <StatGrid>
        <StatTile
          label="Current value"
          icon={BriefcaseBusiness}
          accent="brand"
          value={formatMoney(data.current_value, currency)}
        >
          {data.cash
            ? `Plus ${formatMoney(data.cash, currency)} uninvested cash`
            : "Holdings and deposits"}
        </StatTile>
        <StatTile
          label="Cost of what you hold"
          icon={Coins}
          value={formatMoney(data.invested, currency)}
        >
          FIFO cost of units held, plus deposits
        </StatTile>
        <StatTile
          label="Unrealized gain"
          icon={data.unrealized_gain < 0 ? TrendingDown : TrendingUp}
          value={formatMoney(data.unrealized_gain, currency, {
            signDisplay: data.unrealized_gain === 0 ? "auto" : "always",
          })}
          tone={signTone(data.unrealized_gain)}
          accent={data.unrealized_gain < 0 ? "negative" : "positive"}
        >
          Market value minus cost, priced holdings only
        </StatTile>
        <StatTile
          label="Total return"
          icon={LineChart}
          value={formatMoney(data.total_return, currency, {
            signDisplay: data.total_return === 0 ? "auto" : "always",
          })}
          tone={signTone(data.total_return)}
          accent={data.total_return < 0 ? "negative" : "positive"}
        >
          {formatPercent(data.return_percent)} on everything invested. Realized{" "}
          {formatMoney(data.realized_gain, currency)}, income {formatMoney(data.income, currency)},
          fees {formatMoney(data.fees, currency)} ({rangeLabel}).
        </StatTile>
      </StatGrid>

      {data.missing_prices + data.stale_prices > 0 ? (
        <p
          role="note"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
        >
          <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            {data.missing_prices > 0
              ? `${data.missing_prices} holding${data.missing_prices === 1 ? " has" : "s have"} no price and ${data.missing_prices === 1 ? "is" : "are"} counted at cost. `
              : ""}
            {data.stale_prices > 0
              ? `${data.stale_prices} price${data.stale_prices === 1 ? " is" : "s are"} more than a week old. `
              : ""}
            Update prices to see current values.
          </span>
        </p>
      ) : null}

      <div className="grid gap-6 @3xl/list:grid-cols-2">
        <Panel title="Allocation" description="Current value by asset class.">
          <ProportionBars slices={data.allocation} currency={currency} label="Allocation" />
        </Panel>
        <Panel title="By category" description="Scheme categories and deposit types.">
          <ProportionBars slices={data.categories} currency={currency} label="By category" />
        </Panel>
      </div>
    </div>
  );
}

function HoldingsPanel({
  state,
  onRetry,
  currency,
  profiles,
  sips,
  onDialog,
  workspaceId,
  onAnnounce,
}: {
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
  const holdings = state.data.holdings.filter((holding) => holding.currency === currency);
  const byAccount = profiles
    .filter((account) => account.currency === currency)
    .map((account) => ({
      account,
      holdings: holdings.filter((holding) => holding.account_id === account.account_id),
    }))
    .filter((group) => group.holdings.length > 0);

  return (
    <Panel
      title="Holdings"
      description="Units and cost come from recorded buys and sales (first in, first out). Values use the latest price you entered."
      flush
    >
      {byAccount.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">
          No holdings yet. Add a mutual fund, stock, or ETF, then record its purchases.
        </p>
      ) : (
        byAccount.map(({ account, holdings: rows }) => (
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
        ))
      )}
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
                      {overdue ? "Overdue since" : "Next"} {formatCalendarDate(plan.next_due_date)}
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

function DepositsPanel({
  state,
  onRetry,
  currency,
  workspaceId,
  onDialog,
  onAnnounce,
}: {
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
  if (deposits.length === 0) return null;
  const today = localDateString();

  return (
    <Panel
      title="Fixed and recurring deposits"
      description="Values are estimates from the rate and compounding unless you set them; maturity amounts are projections, not guarantees."
      flush
    >
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

function ActivityPanel({
  workspaceId,
  holdings,
  deposits,
  onAnnounce,
}: {
  workspaceId: string;
  holdings: readonly Holding[];
  deposits: readonly Deposit[];
  onAnnounce: (message: string) => void;
}) {
  const activity = useInvestmentTransactions(workspaceId, { limit: 10 });
  const { deleteTransaction } = useInvestmentMutations(workspaceId);
  const names = new Map<string, string>([
    ...holdings.map((holding) => [holding.id, holding.name] as const),
    ...deposits.map((deposit) => [deposit.id, deposit.name] as const),
  ]);
  const state = activity.state;

  const remove = (entry: InvestmentTransaction, deleteLedger: boolean) => async () => {
    try {
      await deleteTransaction.mutateAsync({ id: entry.id, deleteLedger });
      onAnnounce("Deleted the investment transaction.");
    } catch (reason) {
      onAnnounce(describeApiError(reason, "Couldn’t delete it."));
    }
  };

  return (
    <Panel title="Recent activity" description="Buys, sales, income, fees, and deposits." flush>
      {state.status === "error" ? (
        <div className="px-5 pb-5">
          <LoadError message={state.message} onRetry={activity.reload} />
        </div>
      ) : state.status === "loading" ? (
        <div className="px-5 pb-5">
          <Skeleton className="h-24" />
        </div>
      ) : state.data.transactions.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="@container/rows divide-y border-t">
          {state.data.transactions.map((entry) => {
            const subject =
              names.get(entry.holding_id ?? entry.deposit_id ?? "") ?? "Investment account";
            const outflow =
              entry.type === "buy" || entry.type === "deposit" || entry.type === "fee";
            return (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5 @md/rows:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {transactionTypeLabel(entry.type)}
                    {entry.plan === "sip" ? " (SIP)" : ""} · {subject}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCalendarDate(entry.trade_date)}
                    {entry.quantity
                      ? ` · ${formatUnits(entry.quantity)} units at ${formatUnitPrice(entry.unit_price ?? "0", entry.currency)}`
                      : ""}
                    {entry.fees ? ` · charges ${formatMoney(entry.fees, entry.currency)}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-sm whitespace-nowrap tabular-nums">
                  {formatMoney(outflow ? -entry.amount : entry.amount, entry.currency, {
                    signDisplay: "always",
                  })}
                </span>
                <RowActions
                  name={`${transactionTypeLabel(entry.type)} of ${subject}`}
                  actions={[
                    {
                      id: "delete",
                      label: "Delete…",
                      icon: Trash2,
                      destructive: true,
                      confirm: {
                        prompt: "Delete this investment transaction?",
                        choices: [
                          { label: "Delete, keep ledger entries", onConfirm: remove(entry, false) },
                          {
                            label: "Delete with ledger entries",
                            destructive: true,
                            onConfirm: remove(entry, true),
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
      )}
    </Panel>
  );
}

function AccountsPanel({
  profiles,
  accounts,
  onEdit,
}: {
  profiles: readonly InvestmentAccount[];
  accounts: readonly FinanceAccount[];
  onEdit: (account: InvestmentAccount) => void;
}) {
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  return (
    <Panel
      title="Investment accounts"
      description="Cash is what was moved in and not yet invested; the balance in Accounts also counts what was spent on holdings."
      flush
    >
      <ul className="divide-y border-t">
        {profiles.map((account) => (
          <li
            key={account.account_id}
            className="flex items-center justify-between gap-3 px-4 py-2.5 @md/rows:px-5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {account.name}
                {account.archived ? (
                  <span className="text-muted-foreground"> (archived)</span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[
                  accountKindLabel(account.kind),
                  account.provider,
                  account.linked_account_id
                    ? `Linked to ${names.get(account.linked_account_id) ?? "an account"}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <p className="text-sm font-medium whitespace-nowrap tabular-nums">
                  {formatMoney(account.value, account.currency)}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  Cash {formatMoney(account.cash, account.currency)}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onEdit(account)}
                aria-label={`Edit ${account.name}`}
              >
                Edit
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function InvestmentsSkeleton() {
  return (
    <div className="space-y-4">
      <span className="sr-only">Loading investments…</span>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-4">
        {[0, 1, 2, 3].map((tile) => (
          <Skeleton key={tile} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}
