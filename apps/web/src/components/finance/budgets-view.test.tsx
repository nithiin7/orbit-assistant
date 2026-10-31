import type {
  Budget,
  BudgetMonth,
  BudgetPeriod,
  FinanceAccount,
  FinanceCategory,
  MonthPlan,
  SavingsGoal,
} from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatMoney } from "@/lib/finance";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption } from "@/test/controls";
import { renderSignedIn } from "@/test/session";
import {
  localDateString,
  localMonthString,
  monthLabel,
  monthRange,
  shiftMonth,
} from "@/utils/dates";

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
const FINANCE = `/api/v1/workspaces/${personal.id}/finance`;
const STAMP = "2026-02-01T09:00:00Z";
const TODAY = localDateString();
const MONTH = localMonthString();

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
const savings: FinanceAccount = {
  ...bank,
  id: "acc-savings",
  name: "Rainy day",
  type: "savings",
  balance: 4_000_000,
};

const groceries: FinanceCategory = {
  id: "cat-groceries",
  workspace_id: personal.id,
  name: "Groceries",
  type: "expense",
  is_default: true,
  created_at: STAMP,
  updated_at: STAMP,
};
const dining: FinanceCategory = { ...groceries, id: "cat-dining", name: "Food and dining" };

function period(overrides: Partial<BudgetPeriod> = {}): BudgetPeriod {
  return {
    start: `${MONTH}-01`,
    end: monthRange(MONTH).to,
    base_amount: 1_000_000,
    rollover_amount: 0,
    available: 1_000_000,
    spent: 920_000,
    remaining: 80_000,
    utilization_percent: "92.00",
    status: "near",
    projected: 1_250_000,
    closed: false,
    closed_at: null,
    spent_at_close: null,
    ...overrides,
  };
}

const groceriesBudget: Budget = {
  id: "budget-groceries",
  workspace_id: personal.id,
  name: "Groceries",
  scope: "category",
  category_id: groceries.id,
  currency: "INR",
  amount: 1_000_000,
  period: "monthly",
  start_date: `${MONTH}-01`,
  end_date: null,
  recurring: true,
  rollover: "surplus",
  alerts_enabled: true,
  alert_thresholds: [50, 75, 90, 100],
  state: "active",
  status: "active",
  notes: "",
  archived_at: null,
  created_at: STAMP,
  updated_at: STAMP,
  current_period: period({ rollover_amount: 200_000, base_amount: 800_000 }),
};
const diningBudget: Budget = {
  ...groceriesBudget,
  id: "budget-dining",
  name: "Dining out",
  category_id: dining.id,
  rollover: "none",
  current_period: period({
    available: 500_000,
    base_amount: 500_000,
    spent: 100_000,
    remaining: 400_000,
    utilization_percent: "20.00",
    status: "on_track",
    projected: null,
  }),
};

const month: BudgetMonth = {
  month: MONTH,
  currency: "INR",
  total: 1_500_000,
  basis: "categories",
  spent: 1_120_000,
  remaining: 380_000,
  utilization_percent: "74.66",
  status: "on_track",
  budgets_counted: 2,
  budgets_within: 2,
  unbudgeted: 100_000,
  categories: [
    { category_id: groceries.id, spent: 920_000, budget: 1_000_000 },
    { category_id: dining.id, spent: 100_000, budget: 500_000 },
    { category_id: null, spent: 100_000, budget: null },
  ],
  budgets: [diningBudget, groceriesBudget],
};

const emptyMonth: BudgetMonth = {
  ...month,
  total: null,
  basis: null,
  spent: 0,
  remaining: null,
  utilization_percent: null,
  status: null,
  budgets_counted: 0,
  budgets_within: 0,
  unbudgeted: null,
  categories: [],
  budgets: [],
};

const goal: SavingsGoal = {
  id: "goal-1",
  workspace_id: personal.id,
  name: "Emergency fund",
  description: "Six months of expenses",
  category: "emergency_fund",
  priority: "high",
  currency: "INR",
  target_amount: 30_000_000,
  start_date: `${MONTH}-01`,
  target_date: `${shiftMonth(MONTH, 9)}-01`,
  state: "active",
  account_id: savings.id,
  notes: "",
  completed_at: null,
  created_at: STAMP,
  updated_at: STAMP,
  saved: 6_000_000,
  remaining: 24_000_000,
  progress_percent: "20.00",
  reached: false,
  suggested_monthly: 2_400_000,
  months_left: 10,
  this_month: 1_000_000,
  available: 4_000_000,
  account: { account_id: savings.id, name: "Rainy day", balance: 4_000_000, allocated: 6_000_000 },
};

const line = (planned: number | null, actual: number) => ({ planned, actual });
const plan: MonthPlan = {
  month: MONTH,
  currency: "INR",
  expected_income: 10_000_000,
  income_source: "earlier",
  income_month: shiftMonth(MONTH, -1),
  notes: "",
  income: line(10_000_000, 9_500_000),
  fixed: {
    total: line(3_500_000, 3_000_000),
    emi: line(1_500_000, 1_500_000),
    rent: line(1_500_000, 1_500_000),
    subscriptions: line(100_000, 0),
    bills: line(400_000, 0),
    planned_interest: 300_000,
  },
  variable: line(2_000_000, 1_100_000),
  variable_basis: "overall_budget",
  savings: line(2_400_000, 1_000_000),
  investments: line(500_000, 500_000),
  remaining: line(1_600_000, 3_900_000),
  spending: 2_900_000,
  allocations: 2_700_000,
  flows: {
    invested: 500_000,
    divested: 0,
    loan_principal: 1_200_000,
    commitment_expenses: 1_800_000,
  },
};

function emptyCashFlow(value: string) {
  return {
    month: value,
    income: 0,
    expenses: 0,
    refunds: 0,
    net_expenses: 0,
    net: 0,
    transactions: 0,
  };
}

function routes(overrides: Record<string, ReturnType<typeof json>> = {}) {
  return {
    ...session,
    [`GET ${FINANCE}/accounts`]: json({
      accounts: [bank, savings],
      totals: [{ currency: "INR", assets: 54_000_000, liabilities: 0 }],
    }),
    [`GET ${FINANCE}/categories`]: json({ categories: [groceries, dining] }),
    [`GET ${FINANCE}/summary`]: json({ ...emptyCashFlow(MONTH), currency: "INR" }),
    [`GET ${FINANCE}/trend`]: json({ currency: "INR", months: [] }),
    [`GET ${FINANCE}/spending`]: json({ month: MONTH, currency: "INR", total: 0, categories: [] }),
    [`GET ${FINANCE}/transactions`]: json({ transactions: [], total: 0 }),
    [`GET ${FINANCE}/commitments/summary`]: status(404),
    [`GET ${FINANCE}/budgets/overview`]: json(month),
    [`GET ${FINANCE}/budgets/history`]: json({
      currency: "INR",
      months: [{ ...month, month: shiftMonth(MONTH, -1) }, month],
    }),
    [`GET ${FINANCE}/budgets`]: json({ budgets: [groceriesBudget, diningBudget] }),
    [`GET ${FINANCE}/savings-goals`]: json({ goals: [goal] }),
    [`GET ${FINANCE}/plan`]: json(plan),
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

describe("Budgets", () => {
  it("shows the month's budget, each budget's progress, and what needs attention first", async () => {
    mockApi(routes());
    await renderSignedIn(<FinancePanel />);
    await openTab("Budgets");

    expect((await screen.findByText("Budget")).nextSibling).toHaveTextContent(
      formatMoney(1_500_000, "INR"),
    );
    expect(
      screen.getByText(`${formatMoney(100_000, "INR")} outside your category budgets`),
    ).toBeInTheDocument();
    expect(screen.getByText("2 of 2 within budget")).toBeInTheDocument();

    const list = screen.getByRole("list", { name: `Budgets for ${monthLabel(MONTH)}` });
    const rows = within(list).getAllByRole("listitem");
    // Near its limit, so Groceries comes before Dining out.
    expect(within(rows[0]!).getAllByRole("button", { name: "Edit “Groceries”" })).not.toHaveLength(
      0,
    );
    expect(within(rows[0]!).getByText("Near limit")).toBeInTheDocument();
    expect(
      within(rows[0]!).getByRole("progressbar", { name: "Groceries budget used" }),
    ).toHaveAttribute("aria-valuenow", "92");
    expect(within(rows[0]!).getByText(/carried in/)).toHaveTextContent(
      `${formatMoney(800_000, "INR")} budget + ${formatMoney(200_000, "INR")} carried in`,
    );
    expect(
      within(rows[0]!).getByText(`On pace for ${formatMoney(1_250_000, "INR")}`),
    ).toBeInTheDocument();
    expect(within(rows[1]!).getByText("On track")).toBeInTheDocument();

    const categories = screen.getByRole("list", { name: "Category spending" });
    expect(within(categories).getByText("Uncategorized")).toBeInTheDocument();
    expect(within(categories).getByText(/no budget/)).toBeInTheDocument();
  });

  it("adds a category budget with whole months and alert thresholds", async () => {
    let created: MockRequest | null = null;
    mockApi({
      ...routes({ [`GET ${FINANCE}/budgets/overview`]: json(emptyMonth) }),
      [`POST ${FINANCE}/budgets`]: (request) => {
        created = request;
        return Response.json({ ...groceriesBudget, name: "Dining" }, { status: 201 });
      },
    });
    const user = userEvent.setup();
    await renderSignedIn(<FinancePanel />);
    await openTab("Budgets");

    expect(
      await screen.findByRole("heading", { name: `No budgets for ${monthLabel(MONTH)}` }),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Add budget" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Add a budget" });
    await user.type(within(dialog).getByLabelText("Name"), "Dining");
    await chooseOption(
      user,
      within(dialog).getByRole("combobox", { name: "Category" }),
      "Food and dining",
    );
    await user.type(within(dialog).getByLabelText("Each month (INR)"), "5,000");
    await chooseOption(
      user,
      within(dialog).getByRole("combobox", { name: "At month end" }),
      "Carry unspent money forward",
    );
    await user.clear(within(dialog).getByLabelText("Thresholds (%)"));
    await user.type(within(dialog).getByLabelText("Thresholds (%)"), "80, 100");
    await user.click(within(dialog).getByRole("button", { name: "Add budget" }));

    await waitFor(() => expect(created).not.toBeNull());
    expect(created!.body).toEqual({
      name: "Dining",
      scope: "category",
      category_id: dining.id,
      currency: "INR",
      amount: 500_000,
      period: "monthly",
      start_date: `${MONTH}-01`,
      end_date: null,
      rollover: "surplus",
      alerts_enabled: true,
      alert_thresholds: [80, 100],
      notes: "",
    });
  });

  it("validates the form before sending anything", async () => {
    mockApi(routes());
    const user = userEvent.setup();
    await renderSignedIn(<FinancePanel />);
    await openTab("Budgets");
    await user.click(await screen.findByRole("button", { name: "Add budget" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a budget" });
    await user.click(within(dialog).getByRole("button", { name: "Add budget" }));
    expect(await within(dialog).findByText("Enter a name.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose a category.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter an amount.")).toBeInTheDocument();
  });

  it("copies last month and archives a budget after confirming", async () => {
    let copied: MockRequest | null = null;
    let archived = false;
    mockApi({
      ...routes(),
      [`POST ${FINANCE}/budgets/copy`]: (request) => {
        copied = request;
        return Response.json({ created: [diningBudget], skipped: [] });
      },
      [`POST ${FINANCE}/budgets/budget-dining/archive`]: () => {
        archived = true;
        return Response.json({ ...diningBudget, state: "archived", status: "archived" });
      },
    });
    const user = userEvent.setup();
    await renderSignedIn(<FinancePanel />);
    await openTab("Budgets");

    const previous = shiftMonth(MONTH, -1);
    await user.click(
      await screen.findByRole("button", { name: `Copy ${monthLabel(previous, { short: true })}` }),
    );
    await waitFor(() => expect(copied).not.toBeNull());
    expect(copied!.body).toEqual({ from_month: previous, to_month: MONTH });
    expect(
      await screen.findByText(`Copied 1 budget from ${monthLabel(previous)}.`),
    ).toBeInTheDocument();

    const rows = within(
      screen.getByRole("list", { name: `Budgets for ${monthLabel(MONTH)}` }),
    ).getAllByRole("listitem");
    await user.click(
      within(rows[1]!).getByRole("button", { name: "More actions for “Dining out”" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    const confirm = within(rows[1]!).getByRole("group", { name: "Archive “Dining out”?" });
    await user.click(within(confirm).getByRole("button", { name: "Archive budget" }));
    await waitFor(() => expect(archived).toBe(true));
  });

  it("shows an error with a retry when the month can't load", async () => {
    mockApi(routes({ [`GET ${FINANCE}/budgets/overview`]: status(500) }));
    await renderSignedIn(<FinancePanel />);
    await openTab("Budgets");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("Savings goals", () => {
  it("shows progress, the suggested monthly amount, and the money behind the goal", async () => {
    mockApi(routes());
    await renderSignedIn(<FinancePanel />);
    await openTab("Goals");

    const card = (await screen.findByRole("heading", { name: "Emergency fund" })).closest("li")!;
    expect(
      within(card).getByRole("progressbar", { name: "Emergency fund progress" }),
    ).toHaveAttribute("aria-valuenow", "20");
    expect(within(card).getByText("Suggested each month").nextSibling).toHaveTextContent(
      formatMoney(2_400_000, "INR"),
    );
    expect(within(card).getByText("10 months left")).toBeInTheDocument();
    expect(within(card).getByText("Kept in Rainy day")).toBeInTheDocument();
    expect(within(card).getByText(/available to withdraw/)).toHaveTextContent(
      `${formatMoney(4_000_000, "INR")} available to withdraw`,
    );
    // The goals in this account count on more than it holds.
    expect(within(card).getByText(/more than it holds/)).toBeInTheDocument();
  });

  it("moves money into the goal's account as a transfer", async () => {
    let sent: MockRequest | null = null;
    mockApi({
      ...routes(),
      [`POST ${FINANCE}/savings-goals/goal-1/contributions`]: (request) => {
        sent = request;
        return Response.json(
          {
            id: "c-1",
            goal_id: goal.id,
            type: "contribution",
            amount: 1_500_000,
            occurred_on: TODAY,
            transaction_id: "t-1",
            notes: "",
            created_at: STAMP,
          },
          { status: 201 },
        );
      },
    });
    const user = userEvent.setup();
    await renderSignedIn(<FinancePanel />);
    await openTab("Goals");

    await user.click(await screen.findByRole("button", { name: "Add money" }));
    const dialog = await screen.findByRole("dialog", { name: "Add to Emergency fund" });
    await chooseOption(
      user,
      within(dialog).getByRole("combobox", { name: "How" }),
      "Move money between accounts",
    );
    await user.type(within(dialog).getByLabelText("Amount (INR)"), "15,000");
    await user.click(within(dialog).getByRole("button", { name: "Add contribution" }));
    expect(await within(dialog).findByText("Choose an account.")).toBeInTheDocument();
    await chooseOption(
      user,
      within(dialog).getByRole("combobox", { name: "Move from" }),
      "HDFC Savings",
    );
    await user.click(within(dialog).getByRole("button", { name: "Add contribution" }));

    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.body).toEqual({
      type: "contribution",
      mode: "transfer",
      amount: 1_500_000,
      occurred_on: TODAY,
      account_id: bank.id,
      notes: "",
    });
  });

  it("invites adding a first goal", async () => {
    mockApi(routes({ [`GET ${FINANCE}/savings-goals`]: json({ goals: [] }) }));
    await renderSignedIn(<FinancePanel />);
    await openTab("Goals");
    expect(
      await screen.findByRole("heading", { name: "No savings goals yet" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(await screen.findByRole("dialog", { name: "Add a savings goal" })).toBeInTheDocument();
  });
});

describe("Monthly plan", () => {
  it("compares planned and actual lines and keeps allocations apart from spending", async () => {
    mockApi(routes());
    await renderSignedIn(<FinancePanel />);
    await openTab("Plan");

    const table = await screen.findByRole("table", {
      name: `Planned and actual cash flow for ${monthLabel(MONTH)}`,
    });
    const income = within(table).getByRole("row", { name: /Income/ });
    expect(
      within(income)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([formatMoney(10_000_000, "INR"), formatMoney(9_500_000, "INR")]);
    const remaining = within(table).getByRole("row", { name: /Remaining/ });
    expect(within(remaining).getAllByRole("cell")[0]).toHaveTextContent(
      formatMoney(1_600_000, "INR"),
    );
    expect(screen.getByText("Available to spend (planned)").nextSibling).toHaveTextContent(
      formatMoney(1_600_000, "INR"),
    );
    expect(
      screen.getByText(
        `Carried from ${monthLabel(shiftMonth(MONTH, -1))}. Save to set ${monthLabel(MONTH)}’s own.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Loan principal repaid: ${formatMoney(1_200_000, "INR")}`),
    ).toBeInTheDocument();
  });

  it("saves the month's expected income", async () => {
    let saved: MockRequest | null = null;
    mockApi({
      ...routes(),
      [`PUT ${FINANCE}/plan/${MONTH}`]: (request) => {
        saved = request;
        return Response.json({
          month: MONTH,
          currency: "INR",
          expected_income: 12_000_000,
          notes: "",
        });
      },
    });
    const user = userEvent.setup();
    await renderSignedIn(<FinancePanel />);
    await openTab("Plan");

    const field = await screen.findByLabelText(`Expected in ${monthLabel(MONTH)} (INR)`);
    await user.clear(field);
    await user.type(field, "1,20,000");
    await user.click(screen.getByRole("button", { name: "Save income" }));
    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved!.body).toEqual({ currency: "INR", expected_income: 12_000_000, notes: "" });
  });
});

describe("Overview", () => {
  it("summarises the budget and savings goals when they exist", async () => {
    mockApi(routes());
    await renderSignedIn(<FinancePanel />);

    const budget = await screen.findByRole("region", { name: "Budget" });
    expect(
      within(budget).getByRole("progressbar", { name: "Monthly budget used" }),
    ).toHaveAttribute("aria-valuenow", "74");
    const attention = within(budget).getByRole("list", { name: "Budgets needing attention" });
    expect(within(attention).getByText("Groceries")).toBeInTheDocument();
    expect(within(attention).queryByText("Dining out")).not.toBeInTheDocument();

    const goals = screen.getByRole("region", { name: "Savings goals" });
    expect(within(goals).getByText("Emergency fund")).toBeInTheDocument();
    await userEvent.click(within(goals).getByRole("button", { name: /Goals/ }));
    expect(await screen.findByRole("heading", { name: "Savings goals" })).toBeInTheDocument();
  });

  it("stays quiet without budgets or goals", async () => {
    mockApi(
      routes({
        [`GET ${FINANCE}/budgets/overview`]: json(emptyMonth),
        [`GET ${FINANCE}/savings-goals`]: json({ goals: [] }),
      }),
    );
    await renderSignedIn(<FinancePanel />);
    expect(await screen.findByText("Account balances")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Budget" })).not.toBeInTheDocument(),
    );
  });
});
