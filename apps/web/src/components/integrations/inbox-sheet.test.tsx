import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { connection, INTEGRATIONS } from "@/test/integrations";
import { renderSignedIn } from "@/test/session";

import { InboxButton } from "./inbox-sheet";

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
const replace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => search.params,
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const mail = {
  [`GET ${INTEGRATIONS}/connections/c1/mail/labels`]: json({
    labels: [{ id: "INBOX", name: "Inbox", system: true, selected: true }],
  }),
  [`GET ${INTEGRATIONS}/connections/c1/mail/messages`]: json({
    messages: [
      {
        id: "m1",
        thread_id: "t1",
        subject: "Invoice 42",
        sender: "Shop <shop@example.com>",
        received_at: "2030-01-02T10:00:00Z",
        snippet: "Amount due",
        url: null,
      },
    ],
    next_page: null,
  }),
};

beforeEach(() => {
  search.params = new URLSearchParams();
  replace.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InboxButton", () => {
  it("shows nothing until an account with mail is connected", async () => {
    const api = mockApi({
      ...session,
      [`GET ${INTEGRATIONS}/connections`]: json({
        connections: [connection({ capabilities: ["calendar"] })],
      }),
    });
    await renderSignedIn(<InboxButton />);
    await vi.waitFor(() =>
      expect(api.mock.calls.some(([url]) => String(url).endsWith("/connections"))).toBe(true),
    );
    expect(screen.queryByRole("button", { name: "Gmail" })).not.toBeInTheDocument();
  });

  it("opens connected mail beside the page", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${INTEGRATIONS}/connections`]: json({ connections: [connection()] }),
      ...mail,
    });
    await renderSignedIn(<InboxButton />);
    await user.click(await screen.findByRole("button", { name: "Gmail" }));
    const sheet = await screen.findByRole("dialog", { name: "Gmail" });
    expect(await within(sheet).findByRole("button", { name: /Invoice 42/ })).toHaveTextContent(
      "Shop",
    );
    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("opens from the address and clears it on close", async () => {
    const user = userEvent.setup();
    search.params = new URLSearchParams({ inbox: "c1" });
    mockApi({
      ...session,
      [`GET ${INTEGRATIONS}/connections`]: json({ connections: [connection()] }),
      ...mail,
    });
    await renderSignedIn(<InboxButton />);
    const sheet = await screen.findByRole("dialog", { name: "Gmail" });
    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(replace).toHaveBeenCalledWith("/tasks");
  });
});
