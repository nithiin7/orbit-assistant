import type { FinanceAccount, Holding, InvestmentAccount } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption } from "@/test/controls";
import { renderSignedIn } from "@/test/session";

import { AddInvestmentDialog } from "./add-investment-dialog";
import { SipDialog, TradeDialog } from "./investment-dialogs";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/finance",
}));

const FINANCE = `/api/v1/workspaces/${personal.id}/finance`;
const STAMP = "2026-02-01T09:00:00Z";
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

const coin: InvestmentAccount = {
  account_id: "acc-coin",
  workspace_id: personal.id,
  name: "Coin",
  currency: "INR",
  kind: "mutual_fund",
  provider: "",
  linked_account_id: null,
  notes: "",
  archived: false,
  ledger_balance: 0,
  cash: 0,
  holdings_value: 0,
  deposits_value: 0,
  value: 0,
  created_at: STAMP,
  updated_at: STAMP,
};

const fund: Holding = {
  id: "h-ppfas",
  workspace_id: personal.id,
  account_id: "acc-coin",
  currency: "INR",
  kind: "mutual_fund",
  name: "Parag Parikh Flexi Cap Fund",
  symbol: "122639",
  exchange: "",
  isin: "",
  issuer: "",
  category: "",
  folio: "",
  notes: "",
  quantity: "41.152",
  cost: 500_000,
  average_cost: "121.5",
  invested_total: 500_000,
  price: null,
  market_value: null,
  value: 500_000,
  unrealized_gain: null,
  realized_gain: 0,
  dividends: 0,
  fees: 0,
  freshness: "missing",
  created_at: STAMP,
  updated_at: STAMP,
};

function recorder(response: unknown, code = 201) {
  const requests: MockRequest[] = [];
  const handler = (request: MockRequest) => {
    requests.push(request);
    return json(response, code)(request);
  };
  return { requests, handler };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Adding an investment you own", () => {
  it("finds a fund by name and works its units out from the NAV", async () => {
    const created = recorder(fund);
    const onSaved = vi.fn();
    mockApi({
      ...session,
      [`GET ${FINANCE}/market-data`]: json({ available: true, enabled: true }),
      [`GET ${FINANCE}/market-data/search`]: json({
        instruments: [
          {
            kind: "mutual_fund",
            name: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth",
            symbol: "122639",
            exchange: "",
            isin: "",
            issuer: "",
            category: "",
            currency: "INR",
          },
        ],
      }),
      [`POST ${FINANCE}/holdings`]: created.handler,
    });
    await renderSignedIn(
      <AddInvestmentDialog
        workspaceId={personal.id}
        investmentAccounts={[coin]}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Add an investment" });
    expect(within(dialog).getByRole("combobox", { name: "Held in" })).toHaveTextContent("Coin");

    await userEvent.type(
      await within(dialog).findByRole("searchbox", { name: "Find the fund" }),
      "parag",
    );
    const results = await within(dialog).findByRole("list", { name: "Search results" });
    await userEvent.click(within(results).getByRole("button", { name: /Parag Parikh/ }));
    expect(within(dialog).getByText("Scheme code 122639")).toBeVisible();

    await userEvent.type(within(dialog).getByLabelText(/Amount invested/), "5000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add investment" }));

    await waitFor(() => expect(created.requests).toHaveLength(1));
    expect(created.requests[0]?.body).toMatchObject({
      account_id: "acc-coin",
      kind: "mutual_fund",
      name: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth",
      symbol: "122639",
      opening: { amount: 500_000, quantity: null },
    });
    expect(onSaved).toHaveBeenCalledWith(expect.stringContaining("41.152 units"));
  });

  it("creates the account it sits in when there is none, and needs units for shares", async () => {
    const account = recorder({ ...coin, account_id: "acc-new", name: "Zerodha" });
    const created = recorder({ ...fund, kind: "stock", name: "Infosys", quantity: "10" });
    mockApi({
      ...session,
      [`GET ${FINANCE}/market-data`]: json({ available: true, enabled: false }),
      [`POST ${FINANCE}/investment-accounts`]: account.handler,
      [`POST ${FINANCE}/holdings`]: created.handler,
    });
    await renderSignedIn(
      <AddInvestmentDialog
        workspaceId={personal.id}
        investmentAccounts={[]}
        defaultKind="stock"
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Add an investment" });
    expect(within(dialog).getByRole("combobox", { name: "Held in" })).toHaveTextContent(
      "A new account",
    );
    const accountName = within(dialog).getByLabelText("New account’s name");
    await userEvent.clear(accountName);
    await userEvent.type(accountName, "Zerodha");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Infosys");
    await userEvent.type(within(dialog).getByLabelText("Symbol (optional)"), "INFY");
    await userEvent.type(within(dialog).getByLabelText(/Amount invested/), "15000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add investment" }));
    expect(await within(dialog).findByText(/Enter the units you hold/)).toBeVisible();
    expect(account.requests).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText("Units held"), "10");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add investment" }));
    await waitFor(() => expect(created.requests).toHaveLength(1));
    expect(account.requests[0]?.body).toMatchObject({ name: "Zerodha", kind: "brokerage" });
    expect(created.requests[0]?.body).toMatchObject({
      account_id: "acc-new",
      kind: "stock",
      symbol: "INFY",
      opening: { amount: 1_500_000, quantity: "10" },
    });
  });
});

describe("Fund purchases and SIPs", () => {
  it("leaves a fund buy's units to the NAV", async () => {
    const recorded = recorder({ id: "tx-1", quantity: "41.152" });
    const onSaved = vi.fn();
    mockApi({ ...session, [`POST ${FINANCE}/investment-transactions`]: recorded.handler });
    await renderSignedIn(
      <TradeDialog
        workspaceId={personal.id}
        holding={fund}
        type="buy"
        account={coin}
        accounts={[bank]}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Record a purchase" });
    expect(within(dialog).getByLabelText("Units (optional)")).toBeVisible();
    await userEvent.type(within(dialog).getByLabelText(/Amount invested/), "5000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record" }));

    await waitFor(() => expect(recorded.requests).toHaveLength(1));
    expect(recorded.requests[0]?.body).toMatchObject({ type: "buy", quantity: null });
    expect(onSaved).toHaveBeenCalledWith(expect.stringContaining("at the NAV: 41.152 units"));
  });

  it("turns on auto-debit only with the account it's debited from", async () => {
    const created = recorder({});
    mockApi({ ...session, [`POST ${FINANCE}/sip-plans`]: created.handler });
    await renderSignedIn(
      <SipDialog
        workspaceId={personal.id}
        holding={fund}
        accounts={[bank]}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Schedule a SIP" });
    await userEvent.type(within(dialog).getByLabelText(/Amount/), "5000");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Auto-debit/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Schedule SIP" }));
    expect(await within(dialog).findByText("Choose the account it’s debited from.")).toBeVisible();

    await chooseOption(
      userEvent,
      within(dialog).getByRole("combobox", { name: "Debited from" }),
      "HDFC Savings",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Schedule SIP" }));
    await waitFor(() => expect(created.requests).toHaveLength(1));
    expect(created.requests[0]?.body).toMatchObject({
      holding_id: "h-ppfas",
      amount: 500_000,
      funding_account_id: "acc-bank",
      auto_debit: true,
    });
  });

  it("offers auto-debit for mutual funds only", async () => {
    mockApi(session);
    await renderSignedIn(
      <SipDialog
        workspaceId={personal.id}
        holding={{ ...fund, kind: "stock" }}
        accounts={[bank]}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Schedule a SIP" });
    expect(within(dialog).queryByRole("checkbox", { name: /Auto-debit/ })).toBeNull();
  });
});
