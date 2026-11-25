import type { FinanceAccount, FinanceCategory, FinanceTransaction } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption } from "@/test/controls";
import { renderSignedIn } from "@/test/session";

import { TransactionDialog } from "./transaction-dialog";

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
const WS = `/api/v1/workspaces/${personal.id}`;
const STAMP = "2030-02-01T09:00:00Z";

const bank: FinanceAccount = {
  id: "bank",
  workspace_id: personal.id,
  name: "HDFC",
  type: "bank",
  account_class: "asset",
  currency: "INR",
  opening_balance: 0,
  balance: 0,
  notes: "",
  is_default: true,
  archived: false,
  archived_at: null,
  created_at: STAMP,
  updated_at: STAMP,
};
const food: FinanceCategory = {
  id: "food",
  workspace_id: personal.id,
  name: "Food and dining",
  type: "expense",
  is_default: true,
  created_at: STAMP,
  updated_at: STAMP,
};
const priya = {
  id: "p1",
  name: "Priya",
  relationship: "friend",
  phone: "",
  email: "",
  note: "",
  favorite: false,
  dates: [],
  reminder_time: "09:00:00",
  timezone: "UTC",
  created_at: STAMP,
  updated_at: STAMP,
};

describe("TransactionDialog splitting", () => {
  it("records an expense and each person's share, linked to it", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const shares: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${WS}/people`]: json({ people: [priya] }),
      [`POST ${WS}/finance/transactions`]: (request: MockRequest) => {
        const body = request.body as Record<string, unknown>;
        return Response.json(
          {
            ...body,
            id: "t1",
            workspace_id: personal.id,
            currency: "INR",
            created_at: STAMP,
            updated_at: STAMP,
          } satisfies Partial<FinanceTransaction>,
          { status: 201 },
        );
      },
      [`POST ${WS}/people/p1/ledger`]: (request: MockRequest) => {
        shares.push(request.body);
        return Response.json({ id: "e1" }, { status: 201 });
      },
    });

    await renderSignedIn(
      <TransactionDialog
        workspaceId={personal.id}
        type="expense"
        accounts={[bank]}
        categories={[food]}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Record a transaction" });
    await user.type(within(dialog).getByRole("textbox", { name: /Amount/ }), "1000");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Dinner");
    await user.click(within(dialog).getByRole("button", { name: "Split with someone" }));
    await chooseOption(
      user,
      await within(dialog).findByRole("combobox", { name: "Person 1" }),
      "Priya",
    );
    await user.click(within(dialog).getByRole("button", { name: "Split equally" }));
    expect(within(dialog).getByRole("textbox", { name: "Share for person 1" })).toHaveValue(
      "500.00",
    );

    await user.click(within(dialog).getByRole("button", { name: "Record" }));

    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith("Recorded “Dinner”. Split with 1 person."),
    );
    expect(shares).toEqual([
      {
        kind: "they_owe",
        amount: 50_000,
        currency: "INR",
        occurred_on: expect.any(String),
        description: "Dinner",
        transaction_id: "t1",
        record_in_finance: null,
      },
    ]);
  });

  it("won't record shares above the expense", async () => {
    const user = userEvent.setup();
    let posted = false;
    mockApi({
      ...session,
      [`GET ${WS}/people`]: json({ people: [priya] }),
      [`POST ${WS}/finance/transactions`]: () => {
        posted = true;
        return new Response(null, { status: 500 });
      },
    });

    await renderSignedIn(
      <TransactionDialog
        workspaceId={personal.id}
        type="expense"
        accounts={[bank]}
        categories={[food]}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Record a transaction" });
    await user.type(within(dialog).getByRole("textbox", { name: /Amount/ }), "100");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Cab");
    await user.click(within(dialog).getByRole("button", { name: "Split with someone" }));
    await chooseOption(
      user,
      await within(dialog).findByRole("combobox", { name: "Person 1" }),
      "Priya",
    );
    await user.type(within(dialog).getByRole("textbox", { name: "Share for person 1" }), "150");
    await user.click(within(dialog).getByRole("button", { name: "Record" }));

    expect(
      await within(dialog).findByText("The shares add up to more than the expense."),
    ).toBeInTheDocument();
    expect(posted).toBe(false);
  });
});
