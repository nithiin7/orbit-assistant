import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { QuickCaptureButton, QuickCaptureProvider } from "./quick-capture";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const NOTES = `/api/v1/workspaces/${personal.id}/notes`;

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function capture(text: string): Promise<unknown> {
  const sent: MockRequest[] = [];
  mockApi({
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: true }),
    "GET /api/v1/me": json(ada),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
    [`POST ${NOTES}`]: (request) => {
      sent.push(request);
      return Response.json({ id: "cccccccc-0000-4000-8000-000000000001" }, { status: 201 });
    },
  });
  const user = userEvent.setup();
  await renderSignedIn(
    <QuickCaptureProvider>
      <QuickCaptureButton />
    </QuickCaptureProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Quick note" }));
  await user.type(screen.getByLabelText("Note"), text);
  await user.click(screen.getByRole("button", { name: "Save to Inbox" }));
  await screen.findByText("Saved to your Inbox");
  return sent[0]?.body;
}

describe("Quick capture", () => {
  it("saves plain text as text", async () => {
    expect(await capture("Call the bank")).toEqual({
      title: "",
      note_type: "quick",
      text: "Call the bank",
    });
  });

  it("converts Markdown to the editor's document, loading the converter on demand", async () => {
    const body = await capture("# Groceries");

    expect(body).toMatchObject({
      note_type: "quick",
      content: {
        type: "doc",
        content: [{ type: "heading", attrs: { level: 1 }, content: [{ text: "Groceries" }] }],
      },
    });
  });
});
