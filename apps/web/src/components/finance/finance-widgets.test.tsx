import type {
  Budget,
  BudgetMonth,
  FinanceAccount,
  MonthlySummary,
  NetWorth,
  PaymentItem,
} from "@orbit/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatMoney } from "@/lib/finance";
import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";
import { localDateString, localMonthString } from "@/utils/dates";

import {
  BudgetWidget,
  CashFlowWidget,
  NetWorthWidget,
  UpcomingPaymentsWidget,
} from "./finance-widgets";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

const FINANCE = `/api/v1/workspaces/${personal.id}/finance`;
const STAMP = "2026-02-01T09:00:00Z";
const MONTH = localMonthString();
const TODAY = localDateString();
const money = (amount: number) => formatMoney(amount, "INR");

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

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

const summary: MonthlySummary = {
  month: MONTH,
  currency: "INR",
  income: 10_000_000,
  expenses: 4_200_000,
  refunds: 200_000,
  net_expenses: 4_000_000,
  net: 6_000_000,
  transactions: 12,
};

const budget: Budget = {
  id: "budget-overall",
  workspace_id: personal.id,
  name: "Monthly",
  scope: "overall",
  category_id: null,
  currency: "INR",
  amount: 5_000_000,
  period: "monthly",
  start_date: `${MONTH}-01`,
  end_date: null,
  recurring: true,
  rollover: "none",
  alerts_enabled: false,
  alert_thresholds: [],
  state: "active",
  status: "active",
  notes: "",
  archived_at: null,
  created_at: STAMP,
  updated_at: STAMP,
  current_period: null,
};

const budgetMonth: BudgetMonth = {
  month: MONTH,
  currency: "INR",
  total: 5_000_000,
  basis: "overall",
  spent: 4_000_000,
  remaining: 1_000_000,
  utilization_percent: "80.00",
  status: "approaching",
  budgets_counted: 2,
  budgets_within: 1,
  unbudgeted: null,
  categories: [],
  budgets: [budget],
};

const netWorth: NetWorth = {
  currency: "INR",
  currencies: ["INR"],
  as_of: TODAY,
  assets: 63_700_000,
  liabilities: 45_000_000,
  net_worth: 18_700_000,
  groups: [],
  items: [
    {
      kind: "account",
      id: "acc-bank",
      name: "HDFC Savings",
      group: "cash",
      side: "asset",
      value: 50_000_000,
      valued_on: TODAY,
      source: "ledger",
      freshness: "current",
      counted: true,
      note: null,
    },
  ],
  quality: { estimated: 0, manual: 0, stale: 0, missing: 0 },
  changes: [],
};

const payment = (overrides: Partial<PaymentItem>): PaymentItem => ({
  kind: "bill",
  commitment_id: "bill-1",
  occurrence_id: null,
  name: "Electricity",
  counterparty: "BESCOM",
  amount: 180_000,
  estimated: false,
  currency: "INR",
  due_date: TODAY,
  status: "due",
  account_id: null,
  paid_on: null,
  transaction_ids: [],
  principal: null,
  interest: null,
  ...overrides,
});

function routes(overrides: Record<string, ReturnType<typeof json>> = {}) {
  return {
    ...session,
    [`GET ${FINANCE}/accounts`]: json({
      accounts: [bank],
      totals: [{ currency: "INR", assets: 50_000_000, liabilities: 0 }],
    }),
    [`GET ${FINANCE}/summary`]: json(summary),
    [`GET ${FINANCE}/payments`]: json({
      today: TODAY,
      date_from: TODAY,
      date_to: TODAY,
      payments: [],
    }),
    [`GET ${FINANCE}/budgets/overview`]: json(budgetMonth),
    [`GET ${FINANCE}/net-worth`]: json(netWorth),
    ...overrides,
  };
}

const widget = (name: string) => screen.findByRole("region", { name });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CashFlowWidget", () => {
  it("shows this month's income, spending, net, and balances", async () => {
    mockApi(routes());
    await renderSignedIn(<CashFlowWidget />);

    const card = await widget("This month");
    expect(await within(card).findByText("Income")).toBeInTheDocument();
    expect(within(card).getByText("Income").nextElementSibling).toHaveTextContent(
      money(10_000_000),
    );
    expect(within(card).getByText("Spending").nextElementSibling).toHaveTextContent(
      money(4_000_000),
    );
    expect(within(card).getByText(`${money(50_000_000)} in accounts`)).toBeInTheDocument();
  });

  it("asks for an account when the workspace has none", async () => {
    mockApi(routes({ [`GET ${FINANCE}/accounts`]: json({ accounts: [], totals: [] }) }));
    await renderSignedIn(<CashFlowWidget />);

    const card = await widget("This month");
    expect(await within(card).findByRole("link", { name: "Add an account" })).toHaveAttribute(
      "href",
      "/finance?view=accounts",
    );
  });

  it("reports a failure and retries", async () => {
    let fail = true;
    mockApi({
      ...routes(),
      [`GET ${FINANCE}/summary`]: (request) =>
        fail ? new Response(null, { status: 503 }) : json(summary)(request),
    });
    await renderSignedIn(<CashFlowWidget />);

    const alert = await screen.findByRole("alert");
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Income")).toBeInTheDocument();
  });
});

describe("UpcomingPaymentsWidget", () => {
  it("lists payments soonest first, with their status", async () => {
    mockApi(
      routes({
        [`GET ${FINANCE}/payments`]: json({
          today: TODAY,
          date_from: TODAY,
          date_to: TODAY,
          payments: [
            payment({ commitment_id: "sub-1", name: "Netflix", status: "upcoming" }),
            payment({ due_date: "2020-01-10", status: "overdue" }),
          ],
        }),
      }),
    );
    await renderSignedIn(<UpcomingPaymentsWidget />);

    const card = await widget("Upcoming payments");
    const rows = await within(card).findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Electricity"),
      expect.stringContaining("Netflix"),
    ]);
    expect(within(rows[0]!).getByText("Overdue")).toBeInTheDocument();
  });

  it("says when nothing is due", async () => {
    mockApi(routes());
    await renderSignedIn(<UpcomingPaymentsWidget />);

    expect(await screen.findByText("Nothing due in the next 30 days.")).toBeInTheDocument();
  });
});

describe("BudgetWidget", () => {
  it("shows how much of the month's budget is spent", async () => {
    mockApi(routes());
    await renderSignedIn(<BudgetWidget />);

    const card = await widget("Budget");
    expect(
      await within(card).findByRole("progressbar", { name: "Monthly budget used" }),
    ).toHaveAttribute("aria-valuenow", "80");
    expect(within(card).getByText(/1 of 2 on track/)).toBeInTheDocument();
  });

  it("offers to set a budget when there is none", async () => {
    mockApi(routes({ [`GET ${FINANCE}/budgets/overview`]: json({ ...budgetMonth, budgets: [] }) }));
    await renderSignedIn(<BudgetWidget />);

    expect(await screen.findByRole("link", { name: "Set a budget" })).toBeInTheDocument();
  });
});

describe("NetWorthWidget", () => {
  it("shows net worth, assets, and liabilities", async () => {
    mockApi(routes());
    await renderSignedIn(<NetWorthWidget />);

    const card = await widget("Net worth");
    expect(
      (await within(card).findByText("Net worth", { selector: "dt" })).nextElementSibling,
    ).toHaveTextContent(money(18_700_000));
    expect(within(card).getByText("Liabilities").nextElementSibling).toHaveTextContent(
      money(45_000_000),
    );
  });
});
