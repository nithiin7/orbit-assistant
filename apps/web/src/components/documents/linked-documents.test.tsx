import type { DocumentSummary } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { LinkedDocuments } from "./linked-documents";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(),
}));

const WS = `/api/v1/workspaces/${personal.id}`;
const TASK = "eeeeeeee-0000-4000-8000-000000000001";

function document(id: string, title: string): DocumentSummary {
  return {
    id,
    workspace_id: personal.id,
    title,
    folder_id: null,
    category_id: null,
    description: "",
    issuing_authority: null,
    provider: null,
    issue_date: null,
    expiry_date: null,
    renewal_date: null,
    review_date: null,
    expiry_status: "none",
    is_favorite: false,
    state: "active",
    archived_at: null,
    trashed_at: null,
    file: null,
    version_count: 0,
    tags: [],
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    last_opened_at: null,
  };
}

const receipt = document("aaaaaaaa-0000-4000-8000-000000000001", "Receipt");
const warranty = document("aaaaaaaa-0000-4000-8000-000000000002", "Warranty");

afterEach(() => vi.unstubAllGlobals());

describe("LinkedDocuments", () => {
  it("lists a record's documents, links more from the vault, and unlinks", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
      "GET /api/v1/me": json(ada),
      "GET /api/v1/me/avatar": status(204),
      "GET /api/v1/workspaces": json({ workspaces: [personal] }),
      [`GET ${WS}/documents`]: json({ documents: [receipt], total: 1 }),
      [`PUT ${WS}/documents/${warranty.id}/links/task/${TASK}`]: status(204),
      [`DELETE ${WS}/documents/${receipt.id}/links/task/${TASK}`]: status(204),
    });
    await renderSignedIn(<LinkedDocuments workspaceId={personal.id} kind="task" recordId={TASK} />);

    const link = await screen.findByRole("link", { name: "Receipt" });
    expect(link).toHaveAttribute("href", `/documents?document=${receipt.id}`);
    const listed = api.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((u) => u.pathname === `${WS}/documents`);
    expect(listed?.searchParams.get("linked_kind")).toBe("task");
    expect(listed?.searchParams.get("linked_id")).toBe(TASK);

    // The picker searches the vault; already-linked documents can't be linked twice.
    api.mockImplementationOnce(async () =>
      Response.json({ documents: [receipt, warranty], total: 2 }),
    );
    await user.click(screen.getByRole("button", { name: "Link document" }));
    const dialog = await screen.findByRole("dialog", { name: "Link a document" });
    const warrantyButton = await within(dialog).findByRole("button", { name: /Warranty/ });
    expect(within(dialog).getByRole("button", { name: /Receipt/ })).toBeDisabled();
    await user.click(warrantyButton);
    await waitFor(() =>
      expect(
        api.mock.calls.some(
          ([input, init]) =>
            init?.method === "PUT" &&
            new URL(String(input)).pathname === `${WS}/documents/${warranty.id}/links/task/${TASK}`,
        ),
      ).toBe(true),
    );
    await user.click(within(dialog).getByRole("button", { name: "Done" }));

    await user.click(screen.getByRole("button", { name: "Unlink “Receipt”" }));
    await waitFor(() =>
      expect(api.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true),
    );
  });
});
