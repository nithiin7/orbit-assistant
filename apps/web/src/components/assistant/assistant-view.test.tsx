import type { AiConversationDetail, AiProposal, AiSettings } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { AssistantView } from "./assistant-view";

const navigation = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    search: "",
    listeners,
    replace: vi.fn((url: string) => {
      state.search = url.split("?")[1] ?? "";
      listeners.forEach((listener) => listener());
    }),
  };
  return state;
});

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    navigation.listeners.add(listener);
    return () => navigation.listeners.delete(listener);
  };
  return {
    useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
    usePathname: () => "/assistant",
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(subscribe, () => navigation.search)),
  };
});

const WS = `/api/v1/workspaces/${personal.id}`;
const TASK_ID = "7a1b2c3d-0000-4000-8000-000000000001";

const enabled: AiSettings = {
  server_enabled: true,
  enabled: true,
  chat_provider_id: "p1",
  chat_model: "llama3",
  embedding_provider_id: null,
  embedding_model: null,
  fallback_provider_id: null,
  fallback_model: null,
  allow_cloud: false,
  modules: ["tasks", "notes", "calendar", "reminders", "habits"],
  response_style: "balanced",
  monthly_token_limit: null,
  indexing_enabled: true,
};

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
  [`GET ${WS}/ai/conversations`]: json({ conversations: [] }),
  [`GET ${WS}/ai/insights`]: json({ insights: [] }),
};

const citation = {
  number: 1,
  ref: { kind: "task", id: TASK_ID, title: "Renew passport", day: "2026-11-01", detail: "" },
  cited: true,
};

const proposal: AiProposal = {
  id: "pr1",
  kind: "create_task",
  payload: { title: "Book photos", priority: "high" },
  summary: "Create task “Book photos”",
  status: "pending",
  from_untrusted_context: true,
  result_kind: null,
  result_id: null,
  error: null,
  message_id: "m2",
  created_at: "2026-11-02T10:00:00Z",
};

function stream(events: [string, unknown][]) {
  const body = events.map(([n, d]) => `event: ${n}\ndata: ${JSON.stringify(d)}\n\n`).join("");
  return () => new Response(body, { headers: { "content-type": "text/event-stream" } });
}

const conversation = {
  id: "c1",
  title: "What tasks are overdue?",
  created_at: "2026-11-02T10:00:00Z",
  updated_at: "2026-11-02T10:00:00Z",
};

const saved = (content: string, proposals: AiProposal[] = []): AiConversationDetail => ({
  ...conversation,
  messages: [
    {
      id: "m1",
      role: "user",
      content: "What tasks are overdue?",
      citations: [],
      status: "complete",
      provider_name: null,
      model: null,
      processing: null,
      input_tokens: null,
      output_tokens: null,
      created_at: "2026-11-02T10:00:00Z",
    },
    {
      id: "m2",
      role: "assistant",
      content,
      citations: [citation],
      status: "complete",
      provider_name: "Ollama",
      model: "llama3",
      processing: "local",
      input_tokens: 10,
      output_tokens: 5,
      created_at: "2026-11-02T10:00:01Z",
    },
  ],
  proposals,
});

afterEach(() => {
  vi.unstubAllGlobals();
  navigation.search = "";
  navigation.replace.mockClear();
});

describe("AssistantView", () => {
  it("explains how to set up AI while it is off", async () => {
    mockApi({ ...session, "GET /api/v1/me/ai/settings": json({ ...enabled, enabled: false }) });
    await renderSignedIn(<AssistantView />);
    expect(await screen.findByRole("heading", { name: "AI is off" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up AI" })).toHaveAttribute("href", "/settings/ai");
  });

  it("suggests questions only for modules AI may read", async () => {
    mockApi({ ...session, "GET /api/v1/me/ai/settings": json({ ...enabled, modules: ["tasks"] }) });
    await renderSignedIn(<AssistantView />);
    const list = await screen.findByRole("list", { name: "Suggested questions" });
    expect(
      within(list)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["What tasks are overdue?", "What have I been working on recently?"]);
  });

  it("streams an answer and links its citations to the sources", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      "GET /api/v1/me/ai/settings": json(enabled),
      [`POST ${WS}/ai/messages`]: stream([
        ["start", { conversation, provider_name: "Ollama", model: "llama3", processing: "local" }],
        ["sources", { citations: [citation] }],
        ["delta", { text: "Renew your passport [S1]." }],
        ["done", { message: saved("Renew your passport [S1].").messages[1], proposals: [] }],
      ]),
      [`GET ${WS}/ai/conversations/c1`]: json(saved("Renew your passport [S1].")),
    });
    await renderSignedIn(<AssistantView />);
    await user.type(await screen.findByLabelText("Ask Orbit"), "What tasks are overdue?{Enter}");

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/assistant?c=c1", { scroll: false }),
    );
    const sent = api.mock.calls.find(([url]) => String(url).endsWith("/ai/messages"));
    expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({
      content: "What tasks are overdue?",
      timezone: "UTC",
    });
    // The saved answer replaces the streamed one: its citation links to its numbered source.
    expect(await screen.findByRole("link", { name: "Source 1: Renew passport" })).toHaveAttribute(
      "href",
      "#m2-source-1",
    );
    expect(screen.getByText(/Ollama · llama3 · On this device or network/)).toBeInTheDocument();
  });

  it("shows a saved conversation with sources, provider, and a proposal to approve", async () => {
    const user = userEvent.setup();
    navigation.search = "c=c1";
    const api = mockApi({
      ...session,
      "GET /api/v1/me/ai/settings": json(enabled),
      [`GET ${WS}/ai/conversations/c1`]: json(saved("Renew your passport [S1].", [proposal])),
      [`POST ${WS}/ai/proposals/pr1/approve`]: json({
        ...proposal,
        status: "executed",
        result_kind: "task",
        result_id: TASK_ID,
      }),
    });
    await renderSignedIn(<AssistantView />);

    const source = await screen.findByRole("link", { name: /^1\s*Renew passport/ });
    expect(source).toHaveAttribute("href", `/tasks?task=${TASK_ID}`);
    const card = screen.getByRole("region", { name: "Proposed: Create task “Book photos”" });
    expect(within(card).getByText(/Check the details before approving/)).toBeInTheDocument();
    expect(within(card).getByText("high")).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Approve" }));
    expect(await within(card).findByRole("link", { name: "Open it" })).toHaveAttribute(
      "href",
      `/tasks?task=${TASK_ID}`,
    );
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining("/ai/proposals/pr1/approve"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows the API's reason when the assistant can't answer", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      "GET /api/v1/me/ai/settings": json(enabled),
      [`POST ${WS}/ai/messages`]: status(
        409,
        "The selected provider runs in the cloud. Allow cloud processing in Settings → AI, or choose a local provider.",
      ),
    });
    await renderSignedIn(<AssistantView />);
    await user.type(await screen.findByLabelText("Ask Orbit"), "hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Allow cloud processing/);
  });

  it("sends a question handed over from the command palette", async () => {
    navigation.search = "q=What+is+overdue%3F";
    const api = mockApi({
      ...session,
      "GET /api/v1/me/ai/settings": json(enabled),
      [`POST ${WS}/ai/messages`]: stream([["error", { message: "down" }]]),
    });
    await renderSignedIn(<AssistantView />);
    await waitFor(() =>
      expect(api.mock.calls.some(([url]) => String(url).endsWith("/ai/messages"))).toBe(true),
    );
    expect(await screen.findByText("What is overdue?")).toBeInTheDocument();
  });
});
