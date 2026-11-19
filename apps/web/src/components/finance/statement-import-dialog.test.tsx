import type { FinanceAccount, FinanceCategory, StatementRow } from "@orbit/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption } from "@/test/controls";
import { renderSignedIn } from "@/test/session";

import { StatementImportDialog } from "./statement-import-dialog";

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
const STATEMENTS = `/api/v1/workspaces/${personal.id}/finance/statements`;
const STAMP = "2026-10-01T09:00:00Z";

const icici: FinanceAccount = {
  id: "acc-icici",
  workspace_id: personal.id,
  name: "ICICI Savings",
  type: "bank",
  account_class: "asset",
  currency: "INR",
  opening_balance: 0,
  balance: 1_000_000,
  notes: "",
  is_default: true,
  archived: false,
  archived_at: null,
  created_at: STAMP,
  updated_at: STAMP,
};
const dining: FinanceCategory = {
  id: "cat-dining",
  workspace_id: personal.id,
  name: "Food and dining",
  type: "expense",
  is_default: true,
  created_at: STAMP,
  updated_at: STAMP,
};

function row(overrides: Partial<StatementRow> & Pick<StatementRow, "fingerprint">): StatementRow {
  return {
    line: 1,
    occurred_on: "2026-10-01",
    description: "UPI/6274/SWIGGY/okaxis/",
    amount: 45_000,
    direction: "out",
    balance: 955_000,
    action: "create",
    reason: "new",
    type: "expense",
    category_id: null,
    payment: null,
    duplicate_of: null,
    ...overrides,
  };
}

const swiggy = row({ fingerprint: "a".repeat(64) });
const mismatch = row({
  fingerprint: "b".repeat(64),
  description: "BOOKS",
  action: "skip",
  reason: "balance_mismatch",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StatementImportDialog", () => {
  it("unlocks a PDF, imports the reviewed rows, and can undo them", async () => {
    const user = userEvent.setup();
    const previews: MockRequest[] = [];
    const imports: unknown[] = [];
    mockApi({
      ...session,
      [`POST ${STATEMENTS}/preview`]: (request) => {
        previews.push(request);
        const password = request.headers["X-Statement-Password"];
        if (!password) return Response.json(preview("password_required", []));
        return Response.json(preview("ready", [swiggy, mismatch]));
      },
      [`POST ${STATEMENTS}/imports`]: (request) => {
        imports.push(request.body);
        return Response.json(
          { batch_id: "batch-1", created: 1, settled: 0, already_imported: 0 },
          { status: 201 },
        );
      },
      [`DELETE ${STATEMENTS}/imports/batch-1`]: json({ removed: 1, kept: 0 }),
    });
    const onAnnounce = vi.fn();

    await renderSignedIn(
      <StatementImportDialog
        workspaceId={personal.id}
        accounts={[icici]}
        categories={[dining]}
        onAnnounce={onAnnounce}
        onClose={vi.fn()}
      />,
    );
    const file = new File(["%PDF-1.7"], "statement.pdf", { type: "application/pdf" });
    await user.upload(await screen.findByLabelText("Statement file"), file);
    await user.click(screen.getByRole("button", { name: "Read statement" }));

    await user.type(await screen.findByLabelText("PDF password"), "AB12");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText(/2 rows: 1 to import, 1 skipped/)).toBeInTheDocument();
    expect(screen.getByText(/won’t be imported/)).toBeInTheDocument();
    expect(previews.at(-1)?.headers["X-Statement-Password"]).toBe(btoa("AB12"));
    await chooseOption(
      user,
      screen.getByRole("combobox", { name: /Category for 2026-10-01 UPI/ }),
      "Food and dining",
    );
    await user.click(screen.getByRole("button", { name: "Import 1" }));

    expect(await screen.findByText("Added 1 transactions.")).toBeInTheDocument();
    expect(imports).toEqual([
      {
        account_id: icici.id,
        today: expect.any(String) as unknown,
        rows: [
          {
            fingerprint: swiggy.fingerprint,
            occurred_on: "2026-10-01",
            description: swiggy.description,
            amount: 45_000,
            direction: "out",
            action: "create",
            type: "expense",
            category_id: dining.id,
            to_account_id: null,
            settle: null,
          },
        ],
      },
    ]);

    await user.click(screen.getByRole("button", { name: "Undo import" }));
    expect(await screen.findByText(/Undid the import: removed 1 transactions/)).toBeInTheDocument();
  });

  it("says when the password is wrong", async () => {
    const user = userEvent.setup();
    let calls = 0;
    mockApi({
      ...session,
      [`POST ${STATEMENTS}/preview`]: () => {
        calls += 1;
        return Response.json(preview(calls === 1 ? "password_required" : "wrong_password", []));
      },
    });
    await renderSignedIn(
      <StatementImportDialog
        workspaceId={personal.id}
        accounts={[icici]}
        categories={[]}
        onAnnounce={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.upload(
      await screen.findByLabelText("Statement file"),
      new File(["%PDF"], "s.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Read statement" }));
    await user.type(await screen.findByLabelText("PDF password"), "nope");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() =>
      expect(screen.getByText("That password didn’t open the PDF.")).toBeInTheDocument(),
    );
  });

  it("asks for a file before reading", async () => {
    const user = userEvent.setup();
    mockApi(session);
    await renderSignedIn(
      <StatementImportDialog
        workspaceId={personal.id}
        accounts={[icici]}
        categories={[]}
        onAnnounce={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Read statement" }));
    expect(await screen.findByText("Choose a statement file.")).toBeInTheDocument();
  });
});

function preview(status: string, rows: StatementRow[]) {
  return {
    status,
    source: status === "ready" ? "pdf" : null,
    headers: [],
    header_row: null,
    columns: null,
    needs_date_order: false,
    rows,
  };
}
