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
import { CircleHelp, LineChart, Plus } from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { currencyOptions, formatMoney } from "@/lib/finance";
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

import { ConfirmAction } from "./commitment-parts";
import { Panel, Tile } from "./finance-overview";
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
    return <ErrorPanel message={accountsState.message} onRetry={investmentAccounts.reload} />;
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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {currencies.length > 1 ? (
            <InlineSelect
              label="Currency"
              value={currency}
              className="w-24"
              onChange={setCurrency}
              options={currencyOptions(currencies)}
            />
          ) : null}
          <InlineSelect
            label="Gains and income for"
            value={range}
            className="w-40"
            onChange={setRange}
            options={RANGES}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button variant="outline" onClick={() => setDialog({ kind: "account" })}>
            <Plus aria-hidden="true" />
            Account
          </Button>
          <Button
            variant="outline"
            disabled={active.length === 0}
            onClick={() => setDialog({ kind: "holding" })}
          >
            <Plus aria-hidden="true" />
            Holding
          </Button>
          <Button
            variant="outline"
            disabled={active.length === 0}
            onClick={() => setDialog({ kind: "deposit" })}
          >
            <Plus aria-hidden="true" />
            Deposit
          </Button>
        </div>
      </div>

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

      <div className="grid gap-6 lg:grid-cols-2">
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
    return <ErrorPanel message={state.message} onRetry={portfolio.reload} />;
  }
  if (state.status === "loading") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Current value" value={formatMoney(data.current_value, currency)}>
          {data.cash
            ? `Plus ${formatMoney(data.cash, currency)} uninvested cash`
            : "Holdings and deposits"}
        </Tile>
        <Tile label="Cost of what you hold" value={formatMoney(data.invested, currency)}>
          FIFO cost of units held, plus deposits
        </Tile>
        <Tile
          label="Unrealized gain"
          value={formatMoney(data.unrealized_gain, currency, {
            signDisplay: data.unrealized_gain === 0 ? "auto" : "always",
          })}
          tone={data.unrealized_gain < 0 ? "negative" : "default"}
        >
          Market value minus cost, priced holdings only
        </Tile>
        <Tile
          label="Total return"
          value={formatMoney(data.total_return, currency, {
            signDisplay: data.total_return === 0 ? "auto" : "always",
          })}
          tone={data.total_return < 0 ? "negative" : "default"}
        >
          {formatPercent(data.return_percent)} on everything invested. Realized{" "}
          {formatMoney(data.realized_gain, currency)}, income {formatMoney(data.income, currency)},
          fees {formatMoney(data.fees, currency)} ({rangeLabel}).
        </Tile>
      </dl>

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

      <div className="grid gap-6 lg:grid-cols-2">
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
  if (state.status === "error") return <ErrorPanel message={state.message} onRetry={onRetry} />;
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
            <h4 className="px-5 pt-3 text-xs font-medium text-muted-foreground">{account.name}</h4>
            <ul className="divide-y">
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
    <li className="space-y-3 px-5 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{holding.name}</p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{holdingKindLabel(holding.kind)}</span>
            {holding.symbol ? (
              <span>{[holding.symbol, holding.exchange].filter(Boolean).join(" · ")}</span>
            ) : null}
            {holding.category ? <span>{holding.category}</span> : null}
            {holding.folio ? <span>Folio {holding.folio}</span> : null}
            {held ? (
              <FreshnessBadge freshness={holding.freshness} />
            ) : (
              <Badge variant="outline">Sold</Badge>
            )}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-lg font-semibold tabular-nums">
            {formatMoney(holding.value, currency)}
          </p>
          <p className={cn("text-xs", gainTone(holding.unrealized_gain))}>
            {holding.unrealized_gain === null ? (
              "Counted at cost: no price yet"
            ) : (
              <>
                <Gain amount={holding.unrealized_gain} currency={currency} /> unrealized
              </>
            )}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
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
        <ul aria-label="SIPs" className="space-y-2">
          {plans.map((plan) => {
            const overdue = plan.next_due_date !== null && plan.next_due_date < today;
            return (
              <li
                key={plan.id}
                className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  SIP {formatMoney(plan.amount, plan.currency)}{" "}
                  {frequencyLabel(plan.frequency).toLowerCase()}
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
                <span className="flex flex-wrap gap-1">
                  {plan.state === "active" && plan.next_due_date ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDialog({ kind: "trade", holding, type: "buy", sip: plan })}
                    >
                      Record installment
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDialog({ kind: "sip", holding, plan })}
                  >
                    Edit
                  </Button>
                  {plan.state === "active" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void onSipState(plan, "paused")}
                    >
                      Pause
                    </Button>
                  ) : plan.state === "paused" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void onSipState(plan, "active")}
                    >
                      Resume
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDialog({ kind: "trade", holding, type: "buy" })}
        >
          Buy
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!held}
          onClick={() => onDialog({ kind: "trade", holding, type: "sell" })}
        >
          Sell
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDialog({ kind: "price", holding })}>
          {holding.kind === "mutual_fund" ? "Update NAV" : "Update price"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDialog({ kind: "trade", holding, type: "dividend" })}
        >
          Dividend
        </Button>
        {holding.kind === "mutual_fund" ? (
          <Button size="sm" variant="ghost" onClick={() => onDialog({ kind: "sip", holding })}>
            Schedule SIP
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => onDialog({ kind: "holding", holding })}>
          Edit
        </Button>
        {holding.invested_total === 0 ? (
          <ConfirmAction
            label="Delete"
            prompt={`Delete “${holding.name}”?`}
            options={[{ label: "Delete holding", destructive: true, onConfirm: onDelete }]}
          />
        ) : null}
      </div>
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
  if (state.status === "error") return <ErrorPanel message={state.message} onRetry={onRetry} />;
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
      <ul className="divide-y border-t">
        {deposits.map((deposit) => {
          const open = deposit.status === "active";
          const awaiting = open && deposit.maturity_date <= today;
          return (
            <li key={deposit.id} className="space-y-3 px-5 py-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <p className="font-medium">{deposit.name}</p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{deposit.kind === "fixed" ? "Fixed deposit" : "Recurring deposit"}</span>
                    {deposit.institution ? <span>{deposit.institution}</span> : null}
                    <span>
                      {formatRate(deposit.interest_rate_bps)}% ·{" "}
                      {compoundingLabel(deposit.compounding)}
                    </span>
                    {open ? (
                      awaiting ? (
                        <Badge variant="outline" className="border-warning/40 text-warning">
                          Matured, awaiting payout
                        </Badge>
                      ) : (
                        <FreshnessBadge
                          freshness={deposit.freshness}
                          source={deposit.value_source}
                        />
                      )
                    ) : (
                      <Badge variant="outline">
                        {deposit.status === "matured" ? "Matured" : "Closed early"}
                        {deposit.closed_on ? ` ${formatCalendarDate(deposit.closed_on)}` : ""}
                      </Badge>
                    )}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-lg font-semibold tabular-nums">
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
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
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
              <div className="flex flex-wrap gap-1">
                {open ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDialog({ kind: "deposit-action", deposit, action: "close" })}
                    >
                      {awaiting ? "Record payout" : "Close"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        onDialog({ kind: "deposit-action", deposit, action: "contribute" })
                      }
                    >
                      {deposit.kind === "recurring" ? "Record installment" : "Add money"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onDialog({ kind: "deposit-action", deposit, action: "value" })}
                    >
                      Set value
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onDialog({ kind: "deposit", deposit })}
                    >
                      Edit
                    </Button>
                  </>
                ) : (
                  <ConfirmAction
                    label="Reopen"
                    prompt={`Undo closing “${deposit.name}”?`}
                    options={[
                      {
                        label: "Reopen, keep the payout transactions",
                        onConfirm: async () => {
                          try {
                            await reopenDeposit.mutateAsync({
                              id: deposit.id,
                              deleteLedger: false,
                            });
                            onAnnounce(`Reopened “${deposit.name}”.`);
                          } catch (reason) {
                            onAnnounce(describeApiError(reason, "Couldn’t reopen the deposit."));
                          }
                        },
                      },
                      {
                        label: "Reopen and delete them",
                        destructive: true,
                        onConfirm: async () => {
                          try {
                            await reopenDeposit.mutateAsync({ id: deposit.id, deleteLedger: true });
                            onAnnounce(`Reopened “${deposit.name}”.`);
                          } catch (reason) {
                            onAnnounce(describeApiError(reason, "Couldn’t reopen the deposit."));
                          }
                        },
                      },
                    ]}
                  />
                )}
              </div>
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
          <ErrorPanel message={state.message} onRetry={activity.reload} />
        </div>
      ) : state.status === "loading" ? (
        <div className="px-5 pb-5">
          <Skeleton className="h-24" />
        </div>
      ) : state.data.transactions.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="divide-y border-t">
          {state.data.transactions.map((entry) => {
            const subject =
              names.get(entry.holding_id ?? entry.deposit_id ?? "") ?? "Investment account";
            const outflow =
              entry.type === "buy" || entry.type === "deposit" || entry.type === "fee";
            return (
              <li
                key={entry.id}
                className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
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
                <div className="flex items-center gap-2">
                  <span className="text-sm tabular-nums">
                    {formatMoney(outflow ? -entry.amount : entry.amount, entry.currency, {
                      signDisplay: "always",
                    })}
                  </span>
                  <ConfirmAction
                    label="Delete"
                    prompt="Delete this investment transaction?"
                    options={[
                      { label: "Delete, keep ledger entries", onConfirm: remove(entry, false) },
                      {
                        label: "Delete with ledger entries",
                        destructive: true,
                        onConfirm: remove(entry, true),
                      },
                    ]}
                  />
                </div>
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
            className="flex items-center justify-between gap-3 px-5 py-3"
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
                <p className="text-sm font-medium tabular-nums">
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

export function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function InvestmentsSkeleton() {
  return (
    <div className="space-y-4">
      <span className="sr-only">Loading investments…</span>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <Skeleton key={tile} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}
