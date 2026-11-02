import type { AiSettings } from "@orbit/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ASSIST_ACTIONS } from "@/lib/ai";
import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { AssistMenu } from "./assist-menu";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/notes",
  useSearchParams: () => new URLSearchParams(),
}));

const WS = `/api/v1/workspaces/${personal.id}`;

const settings: AiSettings = {
  server_enabled: true,
  enabled: true,
  chat_provider_id: "p1",
  chat_model: "llama3",
  embedding_provider_id: null,
  embedding_model: null,
  fallback_provider_id: null,
  fallback_model: null,
  allow_cloud: false,
  modules: ["notes"],
  response_style: "balanced",
  monthly_token_limit: null,
  indexing_enabled: true,
};

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AssistMenu", () => {
  it("stays hidden for modules AI may not read", async () => {
    mockApi({ ...session, "GET /api/v1/me/ai/settings": json(settings) });
    await renderSignedIn(
      <>
        <AssistMenu module="finance" actions={ASSIST_ACTIONS.finance} />
        <span>loaded</span>
      </>,
    );
    await screen.findByText("loaded");
    // Give the settings query a moment to answer.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: "AI actions" })).not.toBeInTheDocument();
  });

  it("extracts tasks from a note as drafts to approve", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      "GET /api/v1/me/ai/settings": json(settings),
      [`POST ${WS}/ai/assist`]: json({
        kind: "note_action_items",
        text: "",
        items: [{ label: "Create task “Send the deck”", detail: "", confidence: null, ref: null }],
        facts: [],
        citations: [],
        proposals: [
          {
            id: "pr1",
            kind: "create_task",
            payload: { title: "Send the deck" },
            summary: "Create task “Send the deck”",
            status: "pending",
            from_untrusted_context: true,
            result_kind: null,
            result_id: null,
            error: null,
            message_id: null,
            created_at: "2026-11-02T10:00:00Z",
          },
        ],
        provider_name: "Ollama",
        model: "llama3",
        processing: "local",
      }),
    });
    await renderSignedIn(<AssistMenu module="notes" actions={ASSIST_ACTIONS.note} targetId="n1" />);
    await user.click(await screen.findByRole("button", { name: "AI actions" }));
    await user.click(screen.getByRole("menuitem", { name: /Extract tasks/ }));

    const dialog = await screen.findByRole("dialog", { name: "Extract tasks" });
    expect(
      await within(dialog).findByRole("region", { name: "Proposed: Create task “Send the deck”" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Ollama · llama3 · On this device or network/),
    ).toBeInTheDocument();
    const call = api.mock.calls.find(([url]) => String(url).endsWith("/ai/assist"));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      kind: "note_action_items",
      target_id: "n1",
      start: null,
      end: null,
      timezone: "UTC",
    });
  });
});
