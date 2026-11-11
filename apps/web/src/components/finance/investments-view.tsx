"use client";

import type { Currency } from "@orbit/contracts";
import { Landmark, LineChart, PiggyBank, Plus, RefreshCw } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useReviewPortfolio } from "@/hooks/use-ai";
import {
  useDeposits,
  useHoldings,
  useInvestmentAccounts,
  useInvestmentMutations,
  useMarketDataEnabled,
  useSipPlans,
} from "@/hooks/use-investments";
import { holdingKindLabel } from "@/lib/investments";
import { cn } from "@/utils/common";
import { localDateString } from "@/utils/dates";

import { AddInvestmentDialog } from "./add-investment-dialog";
import type { FinanceData } from "./finance-view";
import { AccountsPanel, ActivityPanel } from "./investment-activity";
import { DepositsPanel } from "./investment-deposits";
import {
  DepositActionDialog,
  DepositDialog,
  HoldingDialog,
  InvestmentAccountDialog,
  PriceDialog,
  SipDialog,
  TradeDialog,
} from "./investment-dialogs";
import { HoldingsPanel } from "./investment-holdings";
import { InlineSelect } from "./investment-parts";
import { DepositTotals, HoldingTotals, PortfolioSummary, WhatYouHold } from "./investment-summary";
import {
  type Dialog,
  HOLDING_SECTIONS,
  type Range,
  RANGES,
  type Section,
  SECTION_ICONS,
  SECTIONS,
} from "./investments-sections";
import { LoadError } from "./panel";
import { PortfolioReview } from "./portfolio-review";
import { CurrencySwitcher, ViewHeader } from "./view-header";

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
  const marketData = useMarketDataEnabled(workspaceId);
  const { refreshPrices } = useInvestmentMutations(workspaceId);
  const [chosenCurrency, setCurrency] = useState<Currency | null>(null);
  const [range, setRange] = useState<Range>("ytd");
  const [section, setSection] = useState<Section>("overview");
  const tabsId = useId();
  // Here rather than in the review tab, so a review survives moving between tabs.
  const review = useReviewPortfolio(workspaceId);

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
    ) : dialog?.kind === "add" ? (
      <AddInvestmentDialog
        {...common}
        defaultKind={dialog.holdingKind}
        investmentAccounts={profiles}
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
          description={
            marketData
              ? "Add the funds and shares you own. Prices update automatically."
              : "Add the funds, shares, and deposits you own."
          }
        >
          <Button onClick={() => setDialog({ kind: "add", holdingKind: "mutual_fund" })}>
            <Plus aria-hidden="true" />
            Add an investment
          </Button>
          <Button variant="soft" onClick={() => setDialog({ kind: "account" })}>
            Add investment account
          </Button>
        </EmptyState>
        {dialogs}
      </>
    );
  }

  const active = profiles.filter((account) => !account.archived);
  const holdingsState = holdings.state;
  const depositsState = deposits.state;
  const holdingsLoaded = holdingsState.status === "success";
  const depositsLoaded = depositsState.status === "success";
  const allHoldings = holdingsState.status === "success" ? holdingsState.data.holdings : [];
  const allDeposits = depositsState.status === "success" ? depositsState.data.deposits : [];
  const holdingList = allHoldings.filter((holding) => holding.currency === currency);
  const depositList = allDeposits.filter((deposit) => deposit.currency === currency);
  const sipPlans = sips.state.status === "success" ? sips.state.data.plans : [];
  const counts: Partial<Record<Section, number>> = {
    ...(holdingsLoaded
      ? Object.fromEntries(
          HOLDING_SECTIONS.map(({ kind }) => [
            kind,
            holdingList.filter((holding) => holding.kind === kind).length,
          ]),
        )
      : {}),
    ...(depositsLoaded ? { deposits: depositList.length } : {}),
  };
  const holdingSection = HOLDING_SECTIONS.find((entry) => entry.kind === section);

  async function refresh() {
    try {
      const result = await refreshPrices.mutateAsync();
      onAnnounce(
        result.failed > 0
          ? `Updated ${result.updated} price(s); ${result.failed} couldn’t be fetched. Try again later.`
          : result.updated > 0
            ? `Updated ${result.updated} price(s).`
            : "No holding has a scheme code or symbol to look its price up by.",
      );
    } catch (reason) {
      onAnnounce(describeApiError(reason, "Couldn’t refresh prices. Try again."));
    }
  }

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Investments"
        controls={
          <>
            {marketData ? (
              <Button
                variant="ghost"
                disabled={refreshPrices.isPending}
                onClick={() => void refresh()}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={refreshPrices.isPending ? "animate-spin" : undefined}
                />
                Refresh prices
              </Button>
            ) : null}
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
              ...HOLDING_SECTIONS.map(({ kind }) => ({
                id: kind,
                label: holdingKindLabel(kind),
                description:
                  kind === "mutual_fund"
                    ? "A fund you buy units of, with or without a SIP"
                    : kind === "stock"
                      ? "Shares in one company"
                      : "A fund traded on an exchange",
                icon: SECTION_ICONS[kind],
                group: "Holding",
                onSelect: () => {
                  setSection(kind);
                  setDialog({ kind: "add", holdingKind: kind });
                },
              })),
              {
                id: "deposit",
                label: "Deposit",
                description: "A fixed or recurring deposit",
                icon: PiggyBank,
                disabled: active.length === 0,
                onSelect: () => {
                  setSection("deposits");
                  setDialog({ kind: "deposit" });
                },
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

      <SectionTabs idPrefix={tabsId} section={section} counts={counts} onChange={setSection} />

      <div
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${section}`}
        className="space-y-6"
      >
        {section === "overview" ? (
          <>
            <PortfolioSummary
              workspaceId={workspaceId}
              currency={currency}
              today={today}
              range={range}
            >
              <WhatYouHold
                loaded={holdingsLoaded && depositsLoaded}
                holdings={holdingList}
                deposits={depositList}
                currency={currency}
                onOpen={setSection}
              />
            </PortfolioSummary>
            <AccountsPanel
              profiles={profiles}
              accounts={accounts}
              onEdit={(account) => setDialog({ kind: "account", account })}
            />
          </>
        ) : holdingSection ? (
          <>
            {holdingsLoaded ? (
              <HoldingTotals
                kind={holdingSection.kind}
                holdings={holdingList.filter((holding) => holding.kind === holdingSection.kind)}
                sips={sipPlans}
                currency={currency}
              />
            ) : null}
            <HoldingsPanel
              title={holdingSection.label}
              kind={holdingSection.kind}
              state={holdings.state}
              onRetry={holdings.reload}
              currency={currency}
              profiles={profiles}
              sips={sipPlans}
              onDialog={setDialog}
              workspaceId={workspaceId}
              onAnnounce={onAnnounce}
              empty={
                <EmptySection
                  message={`No ${holdingSection.label.toLowerCase()} yet. Add one, then record its purchases.`}
                  action={`Add ${holdingSection.one}`}
                  disabled={false}
                  onAdd={() => setDialog({ kind: "add", holdingKind: holdingSection.kind })}
                />
              }
            />
          </>
        ) : section === "deposits" ? (
          <>
            {depositsLoaded && depositList.length > 0 ? (
              <DepositTotals deposits={depositList} currency={currency} />
            ) : null}
            <DepositsPanel
              state={deposits.state}
              onRetry={deposits.reload}
              currency={currency}
              workspaceId={workspaceId}
              onDialog={setDialog}
              onAnnounce={onAnnounce}
              empty={
                <EmptySection
                  message="No fixed or recurring deposits yet."
                  action="Add a deposit"
                  disabled={active.length === 0}
                  onAdd={() => setDialog({ kind: "deposit" })}
                />
              }
            />
          </>
        ) : section === "review" ? (
          <PortfolioReview currency={currency} review={review} />
        ) : (
          <ActivityPanel
            workspaceId={workspaceId}
            holdings={allHoldings}
            deposits={allDeposits}
            onAnnounce={onAnnounce}
          />
        )}
      </div>

      {dialogs}
    </div>
  );
}

/** The view's tabs, with arrow keys moving between them as a tab list does. */
function SectionTabs({
  idPrefix,
  section,
  counts,
  onChange,
}: {
  idPrefix: string;
  section: Section;
  counts: Partial<Record<Section, number>>;
  onChange: (section: Section) => void;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = useRef(section);

  // On a narrow page the tabs scroll sideways: keep the chosen one in sight. Not on first render,
  // which would scroll the page.
  useEffect(() => {
    if (shown.current === section) return;
    shown.current = section;
    const index = SECTIONS.findIndex((entry) => entry.id === section);
    tabs.current[index]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [section]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = SECTIONS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    const target = next === null ? undefined : SECTIONS[next];
    if (next === null || !target) return;
    event.preventDefault();
    onChange(target.id);
    tabs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Investment sections"
      className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto border-b px-1"
    >
      {SECTIONS.map(({ id, label }, index) => {
        const Icon = SECTION_ICONS[id];
        const selected = id === section;
        const count = counts[id];
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
              "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full",
              selected
                ? "text-foreground after:bg-brand"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className={cn("size-4", selected && "text-brand")} />
            {label}
            {count !== undefined ? (
              <span
                aria-hidden="true"
                className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums"
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** What a tab shows before anything is in it, with the one way to add something. */
function EmptySection({
  message,
  action,
  disabled,
  onAdd,
}: {
  message: string;
  action: string;
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground @2xl/list:flex-row @2xl/list:items-center @2xl/list:justify-between">
      <p>{message}</p>
      <Button variant="outline" onClick={onAdd} disabled={disabled}>
        <Plus aria-hidden="true" />
        {action}
      </Button>
    </div>
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
