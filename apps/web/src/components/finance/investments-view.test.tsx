import type {
  Asset,
  Deposit,
  FinanceAccount,
  Holding,
  InvestmentAccount,
  NetWorth,
  Portfolio,
} from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatMoney } from "@/lib/finance";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { FinancePanel } from "./finance-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/finance",
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const money = (amount: number, signed = false) =>
  formatMoney(amount, "INR", { signDisplay: signed ? "always" : "auto" });
const FINANCE = `/api/v1/workspaces/${personal.id}/finance`;
const STAMP = "2026-02-01T09:00:00Z";

const bank: FinanceAccount = {
  id: "acc-bank",
  workspace_id: personal.id,
  name: "HDFC Savings",
  type: "bank",
  account_class: "asset",
  currency: "INR",
  opening_balance: 0,
  balance: 50_000_000,
  notes: "",
  archived: false,
  archived_at: null,
  created_at: STAMP,
  updated_at: STAMP,
};
const brokerAccount: FinanceAccount = {
  ...bank,
  id: "acc-broker",
  name: "Zerodha",
  type: "investment",
};

const broker: InvestmentAccount = {
  account_id: "acc-broker",
  workspace_id: personal.id,
  name: "Zerodha",
  currency: "INR",
  kind: "brokerage",
  provider: "Zerodha",
  linked_account_id: "acc-bank",
  notes: "",
  archived: false,
  ledger_balance: 3_000_000,
  cash: 0,
  holdings_value: 3_300_000,
  deposits_value: 0,
  value: 3_300_000,
  created_at: STAMP,
  updated_at: STAMP,
};

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: "h-infy",
    workspace_id: personal.id,
    account_id: "acc-broker",
    currency: "INR",
    kind: "stock",
    name: "Infosys",
    symbol: "INFY",
    exchange: "NSE",
    isin: "",
    issuer: "",
    category: "",
    folio: "",
    notes: "",
    quantity: "20",
    cost: 3_000_000,
    average_cost: "1500",
    invested_total: 3_000_000,
    price: {
      id: "p1",
      holding_id: "h-infy",
      price_date: "2025-01-02",
      price: "1650",
      source: "manual",
      created_at: STAMP,
    },
    market_value: 3_300_000,
    value: 3_300_000,
    unrealized_gain: 300_000,
    realized_gain: 0,
    dividends: 0,
    fees: 0,
    freshness: "stale",
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

const deposit: Deposit = {
  id: "fd-1",
  workspace_id: personal.id,
  account_id: "acc-broker",
  currency: "INR",
  kind: "fixed",
  name: "SBI FD",
  institution: "SBI",
  interest_rate_bps: 710,
  compounding: "quarterly",
  start_date: "2025-01-01",
  maturity_date: "2030-01-01",
  installment_amount: null,
  stated_maturity_amount: null,
  status: "active",
  closed_on: null,
  principal: 10_000_000,
  interest_received: 0,
  estimated_value: 10_400_000,
  value: 10_400_000,
  valued_on: "2026-01-01",
  value_source: "estimate",
  freshness: "estimated",
  manual_value: null,
  manual_valued_on: null,
  projected_maturity_amount: 14_200_000,
  projected_interest: 4_200_000,
  projected_contributions: 10_000_000,
  reminder: null,
  notes: "",
  created_at: STAMP,
  updated_at: STAMP,
};

const portfolio: Portfolio = {
  currency: "INR",
  date_from: null,
  date_to: null,
  invested: 13_000_000,
  current_value: 13_700_000,
  cash: 0,
  unrealized_gain: 300_000,
  realized_gain: 0,
  income: 0,
  fees: 0,
  total_return: 300_000,
  return_percent: "2.31",
  allocation: [
    { key: "deposit", label: "Deposits", value: 10_400_000 },
    { key: "stock", label: "Stocks", value: 3_300_000 },
  ],
  categories: [],
  missing_prices: 0,
  stale_prices: 1,
};

function routes(overrides: Record<string, ReturnType<typeof json>> = {}) {
  return {
    ...session,
    [`GET ${FINANCE}/accounts`]: json({
      accounts: [bank, brokerAccount],
      totals: [{ currency: "INR", assets: 53_000_000, liabilities: 0 }],
    }),
    [`GET ${FINANCE}/categories`]: json({ categories: [] }),
    [`GET ${FINANCE}/summary`]: json({
      month: "2026-02",
      income: 0,
      expenses: 0,
      refunds: 0,
      net_expenses: 0,
      net: 0,
      transactions: 0,
      currency: "INR",
    }),
    [`GET ${FINANCE}/trend`]: json({ currency: "INR", months: [] }),
    [`GET ${FINANCE}/spending`]: json({
      month: "2026-02",
      currency: "INR",
      total: 0,
      categories: [],
    }),
    [`GET ${FINANCE}/transactions`]: json({ transactions: [], total: 0 }),
    [`GET ${FINANCE}/commitments/summary`]: status(404),
    [`GET ${FINANCE}/investment-accounts`]: json({ accounts: [broker] }),
    [`GET ${FINANCE}/holdings`]: json({ holdings: [holding()] }),
    [`GET ${FINANCE}/deposits`]: json({ deposits: [deposit] }),
    [`GET ${FINANCE}/sip-plans`]: json({ plans: [] }),
    [`GET ${FINANCE}/portfolio`]: json(portfolio),
    [`GET ${FINANCE}/investment-transactions`]: json({ transactions: [], total: 0 }),
    ...overrides,
  };
}

async function openTab(name: string) {
  await userEvent.click(await screen.findByRole("button", { name }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Investments", () => {
  it("offers to add an investment account when there are none", async () => {
    mockApi(routes({ [`GET ${FINANCE}/investment-accounts`]: json({ accounts: [] }) }));
    await renderSignedIn(<FinancePanel />);
    await openTab("Investments");

    expect(await screen.findByRole("heading", { name: "Track your investments" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Add investment account" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an investment account" });
    // The existing Zerodha investment account can be adopted rather than duplicated.
    expect(within(dialog).getByRole("radio", { name: /Use an existing/ })).toBeChecked();
  });

  it("shows value against cost, stale prices, and deposit estimates", async () => {
    mockApi(routes());
    await renderSignedIn(<FinancePanel />);
    await openTab("Investments");

    const value = await screen.findByText("Current value");
    expect(value.nextElementSibling).toHaveTextContent(money(13_700_000));
    expect(screen.getByText("Total return").nextElementSibling).toHaveTextContent(
      money(300_000, true),
    );
    expect(screen.getByText(/\+2\.31% on everything invested/)).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent("1 price is more than a week old");

    const holdings = screen.getByRole("region", { name: "Holdings" });
    expect(within(holdings).getByText("Infosys")).toBeVisible();
    expect(within(holdings).getByText("Stale")).toBeVisible();
    expect(within(holdings).getByText(money(150_000))).toBeVisible();

    const deposits = screen.getByRole("region", { name: "Fixed and recurring deposits" });
    expect(within(deposits).getByText("Estimate")).toBeVisible();
    expect(within(deposits).getByText("Expected at maturity (estimate)")).toBeVisible();
    expect(screen.getByRole("list", { name: "Allocation" })).toHaveTextContent("Deposits");
  });

  it("records a purchase funded from the linked bank account", async () => {
    const recorded: MockRequest[] = [];
    mockApi({
      ...routes(),
      [`POST ${FINANCE}/investment-transactions`]: (request: MockRequest) => {
        recorded.push(request);
        return json({ id: "tx-1" }, 201)(request);
      },
    });
    await renderSignedIn(<FinancePanel />);
    await openTab("Investments");

    const holdings = await screen.findByRole("region", { name: "Holdings" });
    await userEvent.click(within(holdings).getByRole("button", { name: "Buy" }));
    const dialog = await screen.findByRole("dialog", { name: "Record a purchase" });
    await userEvent.type(within(dialog).getByLabelText(/Amount invested/), "15,000");
    await userEvent.type(within(dialog).getByLabelText("Units"), "10.5");
    expect(within(dialog).getByRole("combobox", { name: "Account" })).toHaveTextContent(
      "HDFC Savings",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Record" }));

    await waitFor(() => expect(recorded).toHaveLength(1));
    expect(recorded[0]?.body).toMatchObject({
      type: "buy",
      holding_id: "h-infy",
      amount: 1_500_000,
      quantity: "10.5",
      fees: 0,
      plan: "lump_sum",
      settlement: "account",
      cash_account_id: "acc-bank",
    });
  });

  it("rejects units with too many decimals before sending", async () => {
    const fetchMock = mockApi(routes());
    await renderSignedIn(<FinancePanel />);
    await openTab("Investments");
    const holdings = await screen.findByRole("region", { name: "Holdings" });
    await userEvent.click(within(holdings).getByRole("button", { name: "Buy" }));
    const dialog = await screen.findByRole("dialog", { name: "Record a purchase" });
    await userEvent.type(within(dialog).getByLabelText(/Amount invested/), "100");
    await userEvent.type(within(dialog).getByLabelText("Units"), "1.1234567");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record" }));

    expect(await within(dialog).findByText(/up to 6 decimals/)).toBeVisible();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
});

const netWorth: NetWorth = {
  currency: "INR",
  currencies: ["INR"],
  as_of: "2026-02-01",
  assets: 63_700_000,
  liabilities: 45_000_000,
  net_worth: 18_700_000,
  groups: [
    { key: "cash", label: "Bank and cash", side: "asset", value: 50_000_000 },
    { key: "stocks", label: "Stocks", side: "asset", value: 3_300_000 },
    { key: "deposits", label: "Fixed and recurring deposits", side: "asset", value: 10_400_000 },
    { key: "loans", label: "Loans", side: "liability", value: 45_000_000 },
  ],
  items: [
    {
      kind: "account",
      id: "acc-bank",
      name: "HDFC Savings",
      group: "cash",
      side: "asset",
      value: 50_000_000,
      valued_on: "2026-02-01",
      source: "ledger",
      freshness: "current",
      counted: true,
      note: null,
    },
    {
      kind: "deposit",
      id: "fd-1",
      name: "SBI FD",
      group: "deposits",
      side: "asset",
      value: 10_400_000,
      valued_on: "2026-02-01",
      source: "estimate",
      freshness: "estimated",
      counted: true,
      note: "Estimated from the rate; not guaranteed.",
    },
    {
      kind: "asset",
      id: "asset-cash",
      name: "Home cash",
      group: "other_assets",
      side: "asset",
      value: 2_000_000,
      valued_on: "2026-01-01",
      source: "manual",
      freshness: "current",
      counted: false,
      note: "Already counted in the balance of “HDFC Savings”.",
    },
  ],
  quality: { estimated: 1, manual: 0, stale: 0, missing: 0 },
  changes: [
    { months: 1, snapshot: null, change: null },
    {
      months: 3,
      snapshot: null,
      change: 1_000_000,
    },
    { months: 6, snapshot: null, change: null },
    { months: 12, snapshot: null, change: null },
  ],
};

describe("Net worth", () => {
  it("shows totals, value sources, excluded duplicates, and saves a snapshot", async () => {
    const snapshots: MockRequest[] = [];
    mockApi({
      ...routes(),
      [`GET ${FINANCE}/net-worth`]: json(netWorth),
      [`GET ${FINANCE}/net-worth/snapshots`]: json({ snapshots: [] }),
      [`POST ${FINANCE}/net-worth/snapshots`]: (request: MockRequest) => {
        snapshots.push(request);
        return json({ id: "s1" }, 201)(request);
      },
    });
    await renderSignedIn(<FinancePanel />);
    await openTab("Net worth");

    expect(
      (await screen.findByText("Net worth", { selector: "dt" })).nextElementSibling,
    ).toHaveTextContent(money(18_700_000));
    expect(screen.getByText("Total liabilities").nextElementSibling).toHaveTextContent(
      money(45_000_000),
    );
    expect(screen.getByRole("note")).toHaveTextContent("1 estimated");

    const counted = screen.getByRole("region", { name: "What’s counted" });
    expect(within(counted).getByText("Estimated from the rate; not guaranteed.")).toBeVisible();
    expect(within(counted).getByText("Not counted")).toBeVisible();
    expect(within(counted).getByText(/Already counted in the balance/)).toBeVisible();

    const change = screen.getByRole("region", { name: "Change" });
    expect(within(change).getAllByText("No snapshot")).toHaveLength(3);
    expect(within(change).getByText(money(1_000_000, true))).toBeVisible();
    expect(screen.getByRole("list", { name: "Net worth by month" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Save this month’s snapshot" }));
    await waitFor(() => expect(snapshots).toHaveLength(1));
    expect(snapshots[0]?.body).toMatchObject({ currency: "INR", refresh: true });
  });
});

const gold: Asset = {
  id: "asset-gold",
  workspace_id: personal.id,
  name: "Gold coins",
  category: "gold",
  currency: "INR",
  purchase_date: "2020-01-01",
  purchase_cost: 20_000_000,
  linked_account_id: null,
  include_in_net_worth: true,
  notes: "",
  archived: false,
  value: 32_000_000,
  valued_on: "2024-01-01",
  latest_valuation: {
    id: "v1",
    asset_id: "asset-gold",
    valued_on: "2024-01-01",
    value: 32_000_000,
    source: "manual",
    notes: "",
    created_at: STAMP,
  },
  freshness: "stale",
  counted: true,
  excluded_reason: null,
  created_at: STAMP,
  updated_at: STAMP,
};

describe("Assets", () => {
  it("lists assets with stale valuations and records a new value", async () => {
    const valuations: MockRequest[] = [];
    mockApi({
      ...routes(),
      [`GET ${FINANCE}/assets`]: json({ assets: [gold] }),
      [`POST ${FINANCE}/assets/asset-gold/valuations`]: (request: MockRequest) => {
        valuations.push(request);
        return json({ id: "v2" })(request);
      },
    });
    await renderSignedIn(<FinancePanel />);
    await openTab("Assets");

    expect(await screen.findByText("Gold coins")).toBeVisible();
    expect(screen.getByText("Stale")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Update value" }));
    const dialog = await screen.findByRole("dialog", { name: "Update value" });
    const field = within(dialog).getByLabelText("Value (INR)");
    await userEvent.clear(field);
    await userEvent.type(field, "3,40,000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save value" }));

    await waitFor(() => expect(valuations).toHaveLength(1));
    expect(valuations[0]?.body).toMatchObject({ value: 34_000_000 });
  });
});
