import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { connection, INTEGRATIONS } from "@/test/integrations";
import { renderSignedIn } from "@/test/session";

import { MailInbox, MailSettings } from "./mail-browser";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/integrations",
  useSearchParams: () => new URLSearchParams(),
}));

const MAIL = `${INTEGRATIONS}/connections/c1/mail`;
const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const summary = {
  id: "m1",
  thread_id: "t1",
  subject: "Invoice 42",
  sender: "Shop <shop@example.com>",
  received_at: "2030-01-02T10:00:00Z",
  snippet: "Amount due",
  url: "https://mail.google.com/mail/#all/m1",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MailSettings", () => {
  it("saves which labels Orbit may show", async () => {
    const user = userEvent.setup();
    let selected: string[] = [];
    const labels = () =>
      Response.json({
        labels: [
          { id: "INBOX", name: "Inbox", system: true, selected: selected.includes("INBOX") },
          { id: "L1", name: "Receipts", system: false, selected: selected.includes("L1") },
        ],
      });
    const fetchMock = mockApi({
      ...session,
      [`GET ${MAIL}/labels`]: labels,
      [`PUT ${MAIL}/labels`]: ({ body }) => {
        selected = (body as { label_ids: string[] }).label_ids;
        return labels();
      },
    });
    await renderSignedIn(<MailSettings connection={connection()} />);
    const save = await screen.findByRole("button", { name: "Save labels" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Receipts" }));
    await user.click(save);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Receipts" })).toBeChecked());
    expect(screen.getByRole("button", { name: "Save labels" })).toBeDisabled();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ label_ids: ["L1"] });
  });
});

describe("MailInbox", () => {
  it("points to Settings until a label is chosen", async () => {
    mockApi({
      ...session,
      [`GET ${MAIL}/labels`]: json({
        labels: [{ id: "INBOX", name: "Inbox", system: true, selected: false }],
      }),
    });
    await renderSignedIn(<MailInbox connections={[connection()]} />);
    expect(await screen.findByRole("link", { name: "Choose labels" })).toHaveAttribute(
      "href",
      "/settings/integrations?connection=c1#mail",
    );
  });

  it("opens a message as text and turns it into a linked task", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...session,
      [`GET ${MAIL}/labels`]: json({
        labels: [{ id: "INBOX", name: "Inbox", system: true, selected: true }],
      }),
      [`GET ${MAIL}/messages`]: json({ messages: [summary], next_page: null }),
      [`GET ${MAIL}/messages/m1`]: json({
        message: summary,
        recipients: ["ada@gmail.example"],
        body: "<b>Pay</b> by Friday",
        links: [],
      }),
      [`POST ${MAIL}/messages/m1/task`]: json({ kind: "task", id: "t9", title: "Invoice 42" }, 201),
    });
    await renderSignedIn(<MailInbox connections={[connection()]} />);
    await user.click(await screen.findByRole("button", { name: /Invoice 42/ }));
    // HTML-looking text stays text: never rendered as markup.
    expect(await screen.findByText("<b>Pay</b> by Friday")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open in Gmail/ })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    await user.click(screen.getByRole("button", { name: "Add as task" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added to your tasks.");
    expect(screen.getByRole("link", { name: "View task" })).toHaveAttribute(
      "href",
      "/tasks?task=t9",
    );
    const created = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/m1/task"));
    expect(JSON.parse(String(created?.[1]?.body))).toEqual({
      title: "Invoice 42",
      description: "From Shop <shop@example.com>\nhttps://mail.google.com/mail/#all/m1",
    });
    await user.click(screen.getByRole("button", { name: "All messages" }));
    expect(await screen.findByRole("button", { name: /Invoice 42/ })).toBeInTheDocument();
  });

  it("searches within the chosen label", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...session,
      [`GET ${MAIL}/labels`]: json({
        labels: [{ id: "INBOX", name: "Inbox", system: true, selected: true }],
      }),
      [`GET ${MAIL}/messages`]: json({ messages: [], next_page: null }),
    });
    await renderSignedIn(<MailInbox connections={[connection()]} />);
    await user.type(await screen.findByRole("textbox", { name: "Search mail" }), "invoice{Enter}");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("label_id=INBOX&q=invoice")),
      ).toBe(true),
    );
    expect(await screen.findByText("No messages match.")).toBeInTheDocument();
  });
});
