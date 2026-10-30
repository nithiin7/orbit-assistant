import type {
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  MonthCashFlow,
} from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption } from "@/test/controls";
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
const FINANCE = `/api/v1/workspaces/${personal.id}/finance`;
const STAMP = "2026-02-01T09:00:00Z";

function account(overrides: Partial<FinanceAccount> & Pick<FinanceAccount, "id" | "name">) {
  return {
    workspace_id: personal.id,
    type: "bank",
    account_class: "asset",
    currency: "INR",
    opening_balance: 0,
    balance: 0,
    notes: "",
    archived: false,
    archived_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  } satisfies FinanceAccount;
}

function category(id: string, name: string, type: FinanceCategory["type"]): FinanceCategory {
  return {
    id,
    workspace_id: personal.id,
    name,
    type,
    is_default: true,
    created_at: STAMP,
    updated_at: STAMP,
  };
}

function transaction(
  overrides: Partial<FinanceTransaction> & Pick<FinanceTransaction, "id" | "description">,
): FinanceTransaction {
  return {
    workspace_id: personal.id,
    type: "expense",
    amount: 100,
    currency: "INR",
    occurred_on: "2026-02-10",
    category_id: null,
    account_id: "acc-bank",
    to_account_id: null,
    notes: "",
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

const bank = account({ id: "acc-bank", name: "HDFC Savings", balance: 4_500_000 });
const card = account({
  id: "acc-card",
  name: "Amex",
  type: "credit_card",
  account_class: "liability",
  balance: -300_000,
});
const groceries = category("cat-groceries", "Groceries", "expense");
const rent = category("cat-rent", "Rent", "expense");
const salary = category("cat-salary", "Salary", "income");

const emptyMonth = (month: string): MonthCashFlow => ({
  month,
  income: 0,
  expenses: 0,
  refunds: 0,
  net_expenses: 0,
  net: 0,
  transactions: 0,
});

/** A workspace without budgets: the overview shows no budget card. */
const emptyBudgetMonth = {
  month: "2026-02",
  currency: "INR",
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

/** Accounts, categories, and an empty month, which every test starts from. */
function finance(accounts: FinanceAccount[] = [bank, card]) {
  return {
    [`GET ${FINANCE}/accounts`]: json({
      accounts,
      totals: [{ currency: "INR", assets: 4_500_000, liabilities: 300_000 }],
    }),
    [`GET ${FINANCE}/categories`]: json({ categories: [salary, groceries, rent] }),
    [`GET ${FINANCE}/summary`]: json({ ...emptyMonth("2026-02"), currency: "INR" }),
    [`GET ${FINANCE}/trend`]: json({ currency: "INR", months: [emptyMonth("2026-02")] }),
    [`GET ${FINANCE}/spending`]: json({
      month: "2026-02",
      currency: "INR",
      total: 0,
      categories: [],
    }),
    [`GET ${FINANCE}/transactions`]: json({ transactions: [], total: 0 }),
    [`GET ${FINANCE}/commitments/summary`]: json(emptySummary),
    [`GET ${FINANCE}/budgets/overview`]: json(emptyBudgetMonth),
    [`GET ${FINANCE}/savings-goals`]: json({ goals: [] }),
  };
}

/** A workspace without loans, subscriptions, or bills: the overview shows no commitments. */
const emptySummary = {
  currency: "INR",
  today: "2026-02-10",
  loans_outstanding: 0,
  active_loans: 0,
  monthly_emi: 0,
  monthly_subscriptions: 0,
  annual_subscriptions: 0,
  active_subscriptions: 0,
  upcoming_bills: { count: 0, amount: 0 },
  due_this_month: { count: 0, amount: 0 },
  overdue: { count: 0, amount: 0 },
};

/** Query strings of every transaction-history request, in order. */
function historyQueries(api: ReturnType<typeof mockApi>): URLSearchParams[] {
  return api.mock.calls
    .map(([input, init]) => ({ url: new URL(String(input)), method: init?.method ?? "GET" }))
    .filter(({ url, method }) => method === "GET" && url.pathname === `${FINANCE}/transactions`)
    .map(({ url }) => url.searchParams);
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("FinancePanel", () => {
  it("asks for an account before anything can be recorded", async () => {
    mockApi({ ...session, ...finance([]) });

    await renderSignedIn(<FinancePanel />);

    expect(
      await screen.findByRole("heading", { name: "Add an account to get started" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expense" })).not.toBeInTheDocument();
  });

  it("shows the month's figures from the API, keeping cash flow and balances apart", async () => {
    mockApi({
      ...session,
      ...finance(),
      [`GET ${FINANCE}/summary`]: json({
        month: "2026-02",
        currency: "INR",
        income: 9_000_000,
        expenses: 2_550_000,
        refunds: 50_000,
        net_expenses: 2_500_000,
        net: 6_500_000,
        transactions: 4,
      }),
      [`GET ${FINANCE}/spending`]: json({
        month: "2026-02",
        currency: "INR",
        total: 2_500_000,
        categories: [{ category_id: rent.id, expenses: 2_500_000, refunds: 0, net: 2_500_000 }],
      }),
    });

    await renderSignedIn(<FinancePanel />);

    const income = (await screen.findByText("Income", { selector: "dt" })).parentElement!;
    expect(income).toHaveTextContent("₹90,000.00");
    const spending = screen.getByText("Spending", { selector: "dt" }).parentElement!;
    expect(spending).toHaveTextContent("₹25,000.00");
    expect(spending).toHaveTextContent("₹25,500.00 spent, ₹500.00 refunded");
    const net = screen.getByText("Net cash flow", { selector: "dt" }).parentElement!;
    expect(net).toHaveTextContent("+₹65,000.00");
    expect(net).toHaveTextContent("Saved 72% of income");

    const balances = screen.getByRole("region", { name: "Account balances" });
    expect(balances).toHaveTextContent(/Not net worth/);
    expect(within(balances).getByText("Owed on cards and loans").nextSibling).toHaveTextContent(
      "₹3,000.00",
    );
    expect(balances).toHaveTextContent(/Amex.*₹3,000.00 owed/);
    expect(screen.getByRole("region", { name: "Spending by category" })).toHaveTextContent(
      /Rent₹25,000.00100%/,
    );
  });

  it("hides loan accounts on the accounts tab until asked for", async () => {
    const loan = account({
      id: "acc-loan",
      name: "Home loan",
      type: "loan",
      account_class: "liability",
      balance: -5_000_000,
    });
    mockApi({ ...session, ...finance([bank, card, loan]) });
    const user = userEvent.setup();

    await renderSignedIn(<FinancePanel />);
    await user.click(await screen.findByRole("button", { name: "Accounts" }));

    const list = await screen.findByRole("list", { name: "Active accounts" });
    expect(within(list).getByText("HDFC Savings")).toBeInTheDocument();
    expect(within(list).getByText("Amex")).toBeInTheDocument();
    expect(within(list).queryByText("Home loan")).not.toBeInTheDocument();

    const toggle = screen.getByRole("checkbox", { name: "Show loan accounts (1)" });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(within(list).getByText("Home loan")).toBeInTheDocument();

    await user.click(toggle);
    expect(within(list).queryByText("Home loan")).not.toBeInTheDocument();
  });

  it("records an expense in exact paise", async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    mockApi({
      ...session,
      ...finance(),
      [`POST ${FINANCE}/transactions`]: ({ body }: MockRequest) => {
        posted.push(body);
        return Response.json(transaction({ id: "t-new", description: "Weekly shop" }), {
          status: 201,
        });
      },
    });
    await renderSignedIn(<FinancePanel />);

    await user.click(await screen.findByRole("button", { name: "Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Record a transaction" });
    await user.type(within(dialog).getByRole("textbox", { name: "Amount (INR)" }), "1,250.10");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Weekly shop");
    await chooseOption(
      user,
      within(dialog).getByRole("combobox", { name: "Category" }),
      "Groceries",
    );
    await user.click(within(dialog).getByRole("button", { name: "Record" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      type: "expense",
      amount: 125_010,
      description: "Weekly shop",
      account_id: bank.id,
      to_account_id: null,
      category_id: groceries.id,
      notes: "",
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Record a transaction" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Recorded “Weekly shop”.");
  });

  it("rejects an amount with more decimals than the currency has", async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...session, ...finance() });
    await renderSignedIn(<FinancePanel />);

    await user.click(await screen.findByRole("button", { name: "Income" }));
    const dialog = screen.getByRole("dialog", { name: "Record a transaction" });
    const amount = within(dialog).getByRole("textbox", { name: "Amount (INR)" });
    await user.type(amount, "12.345");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Interest");
    await user.click(within(dialog).getByRole("button", { name: "Record" }));

    expect(amount).toHaveAccessibleDescription(/Enter an amount/);
    expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("pays a card bill as a transfer, without a category", async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    mockApi({
      ...session,
      ...finance(),
      [`POST ${FINANCE}/transactions`]: ({ body }: MockRequest) => {
        posted.push(body);
        return Response.json(
          transaction({ id: "t-bill", description: "Card bill", type: "transfer" }),
          { status: 201 },
        );
      },
    });
    await renderSignedIn(<FinancePanel />);

    await user.click(await screen.findByRole("button", { name: "Transfer" }));
    const dialog = screen.getByRole("dialog", { name: "Record a transaction" });
    expect(within(dialog).queryByRole("combobox", { name: "Category" })).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Amount (INR)" }), "3000");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Card bill");
    await user.click(within(dialog).getByRole("button", { name: "Record" }));
    expect(
      within(dialog).getByRole("combobox", { name: "To account" }),
    ).toHaveAccessibleDescription("Choose the account the money goes to.");
    await chooseOption(user, within(dialog).getByRole("combobox", { name: "To account" }), "Amex");
    await user.click(within(dialog).getByRole("button", { name: "Record" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      type: "transfer",
      amount: 300_000,
      account_id: bank.id,
      to_account_id: card.id,
      category_id: null,
    });
  });

  it("filters and searches the transaction history", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      ...finance(),
      [`GET ${FINANCE}/transactions`]: json({
        transactions: [
          transaction({
            id: "t-rent",
            description: "February rent",
            amount: 2_000_000,
            category_id: rent.id,
          }),
        ],
        total: 1,
      }),
    });
    await renderSignedIn(<FinancePanel />);

    await user.click(await screen.findByRole("button", { name: "Transactions" }));
    const list = await screen.findByRole("list", { name: "1 transaction" });
    expect(within(list).getByRole("listitem")).toHaveTextContent(
      /February rent.*Rent.*HDFC Savings.*-₹20,000\.00/,
    );

    await chooseOption(user, screen.getByRole("combobox", { name: "Type" }), "Expense");
    await chooseOption(user, screen.getByRole("combobox", { name: "Account" }), "HDFC Savings");
    await user.type(screen.getByRole("searchbox", { name: "Search transactions" }), "rent");

    await waitFor(() => {
      const last = historyQueries(api).at(-1);
      expect(last?.get("q")).toBe("rent");
    });
    const last = historyQueries(api).at(-1)!;
    expect(last.getAll("type")).toEqual(["expense"]);
    expect(last.get("account_id")).toBe(bank.id);
    expect(last.get("offset")).toBe("0");
  });

  it("deletes a transaction only after confirmation", async () => {
    const user = userEvent.setup();
    const deleted: string[] = [];
    let transactions = [transaction({ id: "t-tea", description: "Tea" })];
    mockApi({
      ...session,
      ...finance(),
      [`GET ${FINANCE}/transactions`]: () =>
        Response.json({ transactions, total: transactions.length }),
      [`DELETE ${FINANCE}/transactions/t-tea`]: ({ path }: MockRequest) => {
        deleted.push(path);
        transactions = [];
        return new Response(null, { status: 204 });
      },
    });
    await renderSignedIn(<FinancePanel />);
    await user.click(await screen.findByRole("button", { name: "Transactions" }));

    await user.click(await screen.findByRole("button", { name: "Delete “Tea”" }));
    expect(deleted).toEqual([]);
    const confirm = screen.getByRole("group", { name: "Delete “Tea”?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("heading", { name: "No transactions yet" })).toBeInTheDocument();
    expect(deleted).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Deleted “Tea”.");
  });
});
