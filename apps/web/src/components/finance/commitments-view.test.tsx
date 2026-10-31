import type {
  CommitmentSummary,
  FinanceAccount,
  Installment,
  Loan,
  PaymentItem,
  RecurringPayment,
} from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatMoney } from "@/lib/finance";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption } from "@/test/controls";
import { renderSignedIn } from "@/test/session";
import { localDateString } from "@/utils/dates";

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

const bank: FinanceAccount = {
  id: "acc-bank",
  workspace_id: personal.id,
  name: "HDFC Savings",
  type: "bank",
  account_class: "asset",
  currency: "INR",
  opening_balance: 0,
  balance: 10_000_000,
  notes: "",
  archived: false,
  archived_at: null,
  created_at: STAMP,
  updated_at: STAMP,
};
const loanAccount: FinanceAccount = {
  ...bank,
  id: "acc-loan",
  name: "Car loan",
  type: "loan",
  account_class: "liability",
  balance: -45_000_000,
};

const loan: Loan = {
  id: "loan-1",
  workspace_id: personal.id,
  account_id: "acc-loan",
  payment_account_id: "acc-bank",
  name: "Car loan",
  lender: "SBI",
  loan_type: "vehicle",
  currency: "INR",
  principal: 60_000_000,
  outstanding_principal: 45_000_000,
  repaid_principal: 15_000_000,
  interest_rate_bps: 925,
  interest_method: "reducing",
  start_date: "2025-01-01",
  tenure_months: 12,
  emi_amount: 5_270_000,
  emi_frequency: "monthly",
  first_payment_date: "2025-02-05",
  next_payment_date: TODAY,
  next_payment_amount: 5_270_000,
  paid_installments: 3,
  total_installments: 12,
  remaining_interest: 1_200_000,
  notes: "",
  status: "active",
  reminder: null,
  created_at: STAMP,
  updated_at: STAMP,
};

const installment: Installment = {
  id: "inst-4",
  loan_id: "loan-1",
  sequence: 4,
  due_date: TODAY,
  amount: 5_270_000,
  principal: 4_923_100,
  interest: 346_900,
  balance_after: 40_076_900,
  state: "scheduled",
  status: "due",
  paid_on: null,
  principal_transaction_id: null,
  interest_transaction_id: null,
  adjusted: false,
  updated_at: STAMP,
};

function subscription(overrides: Partial<RecurringPayment> = {}): RecurringPayment {
  return {
    id: "sub-1",
    workspace_id: personal.id,
    kind: "subscription",
    name: "Netflix",
    provider: "Netflix",
    category_id: null,
    account_id: "acc-bank",
    amount: 64_900,
    currency: "INR",
    amount_varies: false,
    frequency: "monthly",
    start_date: "2025-01-15",
    next_due_date: TODAY,
    end_date: null,
    trial_ends_on: null,
    auto_renew: true,
    status: "active",
    overdue: 0,
    monthly_cost: 64_900,
    annual_cost: 778_800,
    last_paid_on: null,
    notes: "",
    reminder: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

const summary: CommitmentSummary = {
  currency: "INR",
  today: TODAY,
  loans_outstanding: 45_000_000,
  active_loans: 1,
  monthly_emi: 5_270_000,
  monthly_subscriptions: 64_900,
  annual_subscriptions: 778_800,
  active_subscriptions: 1,
  upcoming_bills: { count: 1, amount: 2_500_000 },
  due_this_month: { count: 2, amount: 5_334_900 },
  overdue: { count: 1, amount: 180_000 },
};

function emptyMonth(month: string) {
  return { month, income: 0, expenses: 0, refunds: 0, net_expenses: 0, net: 0, transactions: 0 };
}

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

function routes() {
  return {
    ...session,
    [`GET ${FINANCE}/accounts`]: json({
      accounts: [bank, loanAccount],
      totals: [{ currency: "INR", assets: 10_000_000, liabilities: 45_000_000 }],
    }),
    [`GET ${FINANCE}/categories`]: json({ categories: [] }),
    [`GET ${FINANCE}/summary`]: json({ ...emptyMonth("2026-02"), currency: "INR" }),
    [`GET ${FINANCE}/trend`]: json({ currency: "INR", months: [] }),
    [`GET ${FINANCE}/spending`]: json({
      month: "2026-02",
      currency: "INR",
      total: 0,
      categories: [],
    }),
    [`GET ${FINANCE}/transactions`]: json({ transactions: [], total: 0 }),
    [`GET ${FINANCE}/commitments/summary`]: json(summary),
    [`GET ${FINANCE}/budgets/overview`]: json(emptyBudgetMonth),
    [`GET ${FINANCE}/savings-goals`]: json({ goals: [] }),
    [`GET ${FINANCE}/loans`]: json({ loans: [loan] }),
    [`GET ${FINANCE}/loans/loan-1`]: json({ loan, installments: [installment] }),
  };
}

async function openTab(name: string) {
  await userEvent.click(await screen.findByRole("button", { name }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Finance commitments", () => {
  it("summarises commitments on the overview and links to upcoming payments", async () => {
    mockApi({
      ...routes(),
      [`GET ${FINANCE}/payments`]: json({
        today: TODAY,
        date_from: TODAY,
        date_to: TODAY,
        payments: [],
      }),
    });
    await renderSignedIn(<FinancePanel />);

    const panel = await screen.findByRole("region", { name: "Commitments" });
    expect(within(panel).getByText("Loans outstanding").nextSibling).toHaveTextContent(
      formatMoney(45_000_000, "INR"),
    );
    expect(within(panel).getByText("Overdue").nextSibling).toHaveTextContent(
      formatMoney(180_000, "INR"),
    );
    expect(within(panel).getByText("1 payment")).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("button", { name: /Upcoming payments/ }));
    expect(await screen.findByRole("heading", { name: "Nothing due" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upcoming" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("records an EMI with principal as a transfer and interest as an expense", async () => {
    let paid: MockRequest | null = null;
    mockApi({
      ...routes(),
      [`POST ${FINANCE}/loans/loan-1/installments/inst-4/pay`]: (request) => {
        paid = request;
        return Response.json({ ...installment, state: "paid", status: "paid", paid_on: TODAY });
      },
    });
    await renderSignedIn(<FinancePanel />);
    await openTab("Loans");

    const card = (await screen.findByRole("heading", { name: "Car loan" })).closest("li");
    expect(card).not.toBeNull();
    expect(
      within(card!).getByText(`25% of ${formatMoney(60_000_000, "INR")} repaid`),
    ).toBeInTheDocument();
    expect(within(card!).getByRole("progressbar", { name: "Principal repaid" })).toHaveAttribute(
      "aria-valuenow",
      "25",
    );

    await userEvent.click(within(card!).getByRole("button", { name: "Show EMI schedule" }));
    const schedule = await screen.findByRole("list", { name: "Car loan EMI schedule" });
    expect(within(schedule).getByText("Due today")).toBeInTheDocument();
    await userEvent.click(within(schedule).getByRole("button", { name: "Pay" }));

    const dialog = await screen.findByRole("dialog", { name: "Record payment: Car loan" });
    expect(within(dialog).getByRole("combobox", { name: "Paid from" })).toHaveTextContent(
      "HDFC Savings",
    );
    // Amounts are grouped the rupee's way.
    expect(within(dialog).getByLabelText("Principal (INR)")).toHaveValue("49,231.00");
    await userEvent.clear(within(dialog).getByLabelText("Interest (INR)"));
    await userEvent.type(within(dialog).getByLabelText("Interest (INR)"), "3,500");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));

    await waitFor(() => expect(paid).not.toBeNull());
    expect(paid!.body).toEqual({
      paid_on: TODAY,
      from_account_id: "acc-bank",
      principal: 4_923_100,
      interest: 350_000,
    });
    expect(await screen.findByText("Recorded the payment for “Car loan”.")).toBeInTheDocument();
  });

  it("adds a subscription with its cost and a reminder", async () => {
    let created: MockRequest | null = null;
    mockApi({
      ...routes(),
      [`GET ${FINANCE}/recurring-payments`]: json({ recurring_payments: [] }),
      [`POST ${FINANCE}/recurring-payments`]: (request) => {
        created = request;
        return Response.json(subscription(), { status: 201 });
      },
    });
    await renderSignedIn(<FinancePanel />);
    await openTab("Subscriptions");

    expect(
      await screen.findByRole("heading", { name: "No subscriptions yet" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add subscription" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a subscription" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "ChatGPT Plus");
    await userEvent.type(within(dialog).getByLabelText("Amount (INR)"), "1,999.00");
    await chooseOption(userEvent, within(dialog).getByLabelText("Repeats"), "Yearly");
    await userEvent.type(within(dialog).getByLabelText("Days before"), "3");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add subscription" }));

    await waitFor(() => expect(created).not.toBeNull());
    expect(created!.body).toMatchObject({
      kind: "subscription",
      name: "ChatGPT Plus",
      amount: 199_900,
      currency: "INR",
      frequency: "yearly",
      next_due_date: TODAY,
      auto_renew: true,
      reminder: { days_before: 3, time_of_day: "09:00" },
    });
  });

  it("asks before cancelling a subscription and keeps it listed as cancelled", async () => {
    const changes: unknown[] = [];
    mockApi({
      ...routes(),
      [`GET ${FINANCE}/recurring-payments`]: json({
        recurring_payments: [subscription({ overdue: 2, next_due_date: "2020-01-15" })],
      }),
      [`PATCH ${FINANCE}/recurring-payments/sub-1`]: (request) => {
        changes.push(request.body);
        return Response.json(subscription({ status: "cancelled", next_due_date: null }));
      },
    });
    await renderSignedIn(<FinancePanel />);
    await openTab("Subscriptions");

    const list = await screen.findByRole("list", { name: "Active subscriptions" });
    expect(within(list).getByText("Overdue")).toBeInTheDocument();
    expect(within(list).getByText("2 payments not recorded")).toBeInTheDocument();
    expect(screen.getByText("Subscriptions in INR").nextSibling).toHaveTextContent(
      formatMoney(64_900, "INR"),
    );

    const more = within(list).getByRole("button", { name: "More actions for “Netflix”" });
    await userEvent.click(more);
    await userEvent.click(screen.getByRole("menuitem", { name: "Cancel subscription…" }));
    const confirm = within(list).getByRole("group", { name: "Cancel “Netflix”?" });
    await userEvent.keyboard("{Escape}");
    expect(changes).toEqual([]);
    expect(confirm).not.toBeInTheDocument();

    await userEvent.click(within(list).getByRole("button", { name: "More actions for “Netflix”" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Cancel subscription…" }));
    await userEvent.click(within(list).getByRole("button", { name: "Cancel subscription" }));
    await waitFor(() => expect(changes).toEqual([{ state: "cancelled" }]));
  });

  it("groups upcoming payments and records a bill paid without a transaction", async () => {
    const item = (overrides: Partial<PaymentItem>): PaymentItem => ({
      kind: "bill",
      commitment_id: "bill-1",
      occurrence_id: null,
      name: "Electricity",
      counterparty: "BESCOM",
      amount: 180_000,
      estimated: true,
      currency: "INR",
      due_date: "2020-01-10",
      status: "overdue",
      account_id: null,
      paid_on: null,
      transaction_ids: [],
      principal: null,
      interest: null,
      ...overrides,
    });
    let recorded: MockRequest | null = null;
    const api = mockApi({
      ...routes(),
      [`GET ${FINANCE}/payments`]: json({
        today: TODAY,
        date_from: TODAY,
        date_to: TODAY,
        payments: [
          item({}),
          item({
            kind: "loan",
            commitment_id: "loan-1",
            occurrence_id: "inst-4",
            name: "Car loan",
            amount: 5_270_000,
            estimated: false,
            due_date: TODAY,
            status: "due",
            principal: 4_923_100,
            interest: 346_900,
          }),
          item({
            kind: "subscription",
            commitment_id: "sub-1",
            name: "Netflix",
            amount: 64_900,
            estimated: false,
            due_date: "2020-01-01",
            status: "paid",
            occurrence_id: "occ-1",
            paid_on: "2020-01-01",
          }),
        ],
      }),
      [`POST ${FINANCE}/recurring-payments/bill-1/occurrences`]: (request) => {
        recorded = request;
        return Response.json({}, { status: 201 });
      },
    });
    await renderSignedIn(<FinancePanel />);
    await openTab("Upcoming");

    const overdue = await screen.findByRole("region", { name: /Overdue/ });
    expect(within(overdue).getByText(`≈ ${formatMoney(180_000, "INR")}`)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Due today/ })).toHaveTextContent("Car loan");
    const paid = screen.getByRole("region", { name: /Recently paid/ });
    expect(within(paid).getByText("Netflix")).toBeInTheDocument();
    expect(within(paid).queryByRole("button", { name: "Record" })).not.toBeInTheDocument();

    await chooseOption(userEvent, screen.getByLabelText("Payment type"), "Bills");
    await waitFor(() => {
      const last = api.mock.calls.at(-1);
      expect(new URL(String(last?.[0])).searchParams.getAll("kind")).toEqual(["bill"]);
    });

    await userEvent.click(within(overdue).getByRole("button", { name: "Record" }));
    const dialog = await screen.findByRole("dialog", { name: "Record payment: Electricity" });
    await userEvent.click(within(dialog).getByLabelText(/Mark paid only/));
    await userEvent.type(within(dialog).getByLabelText("Amount paid (INR)"), "2134.50");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));

    await waitFor(() => expect(recorded).not.toBeNull());
    expect(recorded!.body).toEqual({
      due_date: "2020-01-10",
      paid_on: TODAY,
      mode: "manual",
      amount: 213_450,
      account_id: null,
      transaction_id: null,
    });
  });

  it("asks before deleting a loan and removes it from the list", async () => {
    let loans = [loan];
    mockApi({
      ...routes(),
      [`GET ${FINANCE}/loans`]: () => Response.json({ loans }),
      [`DELETE ${FINANCE}/loans/loan-1`]: () => {
        loans = [];
        return new Response(null, { status: 204 });
      },
    });
    await renderSignedIn(<FinancePanel />);
    await openTab("Loans");

    const list = await screen.findByRole("list", { name: "Active loans" });
    await userEvent.click(
      within(list).getByRole("button", { name: "More actions for “Car loan”" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /Delete loan…/ }));
    const confirm = within(list).getByRole("group", {
      name: "Delete “Car loan” and its EMI schedule?",
    });
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete loan" }));

    expect(await screen.findByText("No loans yet")).toBeInTheDocument();
  });

  it("explains why a loan with recorded payments can't be deleted", async () => {
    const reason =
      "This loan has recorded payments. Undo them first, or close and archive the loan to keep its history.";
    mockApi({ ...routes(), [`DELETE ${FINANCE}/loans/loan-1`]: status(409, reason) });
    await renderSignedIn(<FinancePanel />);
    await openTab("Loans");

    const list = await screen.findByRole("list", { name: "Active loans" });
    await userEvent.click(
      within(list).getByRole("button", { name: "More actions for “Car loan”" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /Delete loan…/ }));
    await userEvent.click(within(list).getByRole("button", { name: "Delete loan" }));

    expect(await within(list).findByText(reason)).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: /Car loan/ })).toBeInTheDocument();
  });

  it("shows the API's reason when a payment can't be recorded", async () => {
    mockApi({
      ...routes(),
      [`POST ${FINANCE}/loans/loan-1/installments/inst-4/pay`]: status(
        409,
        "This installment is already paid.",
      ),
    });
    await renderSignedIn(<FinancePanel />);
    await openTab("Loans");
    await userEvent.click(await screen.findByRole("button", { name: "Record EMI" }));
    const dialog = await screen.findByRole("dialog", { name: "Record payment: Car loan" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));
    expect(
      await within(dialog).findByText("This installment is already paid."),
    ).toBeInTheDocument();
  });
});
