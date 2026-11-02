import type { AiProvider, AiSettings } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { AiSettingsPanel } from "./ai-settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/ai",
  useSearchParams: () => new URLSearchParams(),
}));

const WS = `/api/v1/workspaces/${personal.id}`;
const SECRET = "sk-test-should-never-render";

const off: AiSettings = {
  server_enabled: true,
  enabled: false,
  chat_provider_id: null,
  chat_model: null,
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

const openai: AiProvider = {
  id: "p1",
  name: "OpenAI",
  kind: "openai",
  base_url: null,
  effective_base_url: "https://api.openai.com/v1",
  has_api_key: true,
  processing: "cloud",
  capabilities: {
    chat: true,
    streaming: true,
    structured_output: true,
    embeddings: true,
    model_listing: true,
    usage_reporting: true,
  },
  input_price: null,
  output_price: null,
  created_at: "2026-11-02T10:00:00Z",
};

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
  "GET /api/v1/me/ai/usage": json({
    since: "2026-10-03T00:00:00Z",
    lines: [],
    month_tokens: 0,
    monthly_token_limit: null,
    near_limit: false,
  }),
  [`GET ${WS}/ai/index`]: json({
    active: false,
    embedding_model: null,
    counts: { pending: 0, indexed: 0, failed: 0, skipped: 0 },
    last_indexed_at: null,
  }),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiSettingsPanel", () => {
  it("adds a local provider after testing the connection, without saving the test", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      "GET /api/v1/me/ai/settings": json(off),
      "GET /api/v1/me/ai/providers": json({ providers: [] }),
      "POST /api/v1/me/ai/providers/test": json({
        ok: true,
        processing: "local",
        model_count: 3,
        message: "Connected. 3 model(s) available.",
      }),
      "POST /api/v1/me/ai/providers": json(
        { ...openai, id: "p2", name: "Ollama", kind: "ollama" },
        201,
      ),
    });
    await renderSignedIn(<AiSettingsPanel />);
    const form = await screen.findByRole("form", { name: "Add a provider" });

    await user.click(within(form).getByRole("button", { name: "Test connection" }));
    expect(await within(form).findByRole("status")).toHaveTextContent(
      "Connected. 3 model(s) available. On this device or network",
    );
    const saves = () =>
      api.mock.calls.filter(
        ([url, init]) => String(url).endsWith("/me/ai/providers") && init?.method === "POST",
      );
    expect(saves()).toHaveLength(0);

    await user.click(within(form).getByRole("button", { name: "Add provider" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(JSON.parse(String(saves()[0]?.[1]?.body))).toEqual({
      name: "Ollama",
      kind: "ollama",
      base_url: null,
      api_key: null,
    });
  });

  it("never shows a stored key and says where data goes", async () => {
    mockApi({
      ...session,
      "GET /api/v1/me/ai/settings": json({
        ...off,
        enabled: true,
        chat_provider_id: "p1",
        chat_model: "gpt",
      }),
      "GET /api/v1/me/ai/providers": json({ providers: [openai] }),
      "GET /api/v1/me/ai/providers/p1/models": json({
        models: [{ id: "gpt", chat: true, embeddings: false }],
      }),
    });
    await renderSignedIn(<AiSettingsPanel />);
    expect(await screen.findByText(/key stored/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(
      screen.getByText(/OpenAI, a cloud provider: your question and the records/),
    ).toBeInTheDocument();
  });

  it("saves module permissions and cloud consent as they change", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      "GET /api/v1/me/ai/settings": json(off),
      "GET /api/v1/me/ai/providers": json({ providers: [] }),
      "PATCH /api/v1/me/ai/settings": (request) =>
        Response.json({ ...off, ...(request.body as Partial<AiSettings>) }),
    });
    await renderSignedIn(<AiSettingsPanel />);
    await user.click(await screen.findByRole("checkbox", { name: /Finance/ }));
    await user.click(screen.getByRole("checkbox", { name: "Allow cloud processing" }));

    const patches = api.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)) as object);
    expect(patches[0]).toEqual({
      modules: ["tasks", "notes", "calendar", "reminders", "habits", "finance"],
    });
    expect(patches[1]).toEqual({ allow_cloud: true });
  });
});
