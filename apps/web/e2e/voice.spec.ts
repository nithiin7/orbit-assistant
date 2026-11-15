import { expect, type Page, test } from "@playwright/test";

import { signUpAndSkipSetup } from "./support";

/**
 * The primary voice journey in a real browser: open voice in the assistant, speak, hear the
 * answer, see the spoken question in the conversation, and end. Chromium's fake microphone
 * supplies audio; speech recognition and synthesis are replaced in the page (they need a cloud
 * service or system voices), and the assistant's AI answer is stubbed at the network edge, since
 * the test server has no AI provider. Everything else is the real app and API.
 */
test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

async function fakeSpeechEngines(page: Page) {
  await page.addInitScript(() => {
    type Handler = ((event: unknown) => void) | null;
    const state = { spoken: [] as string[], recognizers: [] as { onresult: Handler }[] };
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: Handler = null;
      onerror: Handler = null;
      onend: (() => void) | null = null;
      start() {
        state.recognizers.push(this);
      }
      stop() {}
      abort() {}
    }
    class FakeUtterance {
      onend: (() => void) | null = null;
      onerror: Handler = null;
      rate = 1;
      volume = 1;
      lang = "";
      voice: unknown = null;
      constructor(readonly text: string) {}
    }
    const synthesis = {
      speak(utterance: FakeUtterance) {
        state.spoken.push(utterance.text);
        setTimeout(() => utterance.onend?.(), 50);
      },
      cancel() {},
      pause() {},
      resume() {},
      getVoices: () => [],
      addEventListener() {},
      removeEventListener() {},
    };
    Object.assign(window, {
      SpeechRecognition: FakeRecognition,
      webkitSpeechRecognition: FakeRecognition,
      SpeechSynthesisUtterance: FakeUtterance,
      __voice: {
        spoken: state.spoken,
        say(text: string) {
          state.recognizers.at(-1)?.onresult?.({
            resultIndex: 0,
            results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: text } } },
          });
        },
      },
    });
    Object.defineProperty(window, "speechSynthesis", { value: synthesis, configurable: true });
  });
}

const now = "2026-11-15T10:00:00Z";
const conversation = {
  id: "c-voice",
  title: "What do I have tomorrow?",
  created_at: now,
  updated_at: now,
};
const answer = "Tomorrow you have a dentist visit at 9 am. Nothing else is planned.";

function message(id: string, role: string, content: string, inputMode: string) {
  return {
    id,
    role,
    content,
    citations: [],
    status: "complete",
    provider_name: role === "assistant" ? "Local" : null,
    model: role === "assistant" ? "llama3" : null,
    processing: role === "assistant" ? "local" : null,
    input_tokens: null,
    output_tokens: null,
    created_at: now,
    input_mode: inputMode,
  };
}

async function stubAssistant(page: Page) {
  let asked: unknown = null;
  await page.route("**/api/v1/me/ai/settings", (route) =>
    route.fulfill({
      json: {
        server_enabled: true,
        enabled: true,
        chat_provider_id: "p1",
        chat_model: "llama3",
        embedding_provider_id: null,
        embedding_model: null,
        fallback_provider_id: null,
        fallback_model: null,
        allow_cloud: false,
        modules: ["tasks", "calendar"],
        response_style: "balanced",
        monthly_token_limit: null,
        indexing_enabled: false,
      },
    }),
  );
  await page.route("**/api/v1/me/ai/providers", (route) =>
    route.fulfill({ json: { providers: [] } }),
  );
  await page.route("**/api/v1/workspaces/*/ai/insights*", (route) =>
    route.fulfill({ json: { insights: [] } }),
  );
  await page.route("**/api/v1/workspaces/*/ai/conversations", (route) =>
    route.fulfill({ json: { conversations: asked ? [conversation] : [] } }),
  );
  await page.route("**/api/v1/workspaces/*/ai/conversations/c-voice", (route) =>
    route.fulfill({
      json: {
        ...conversation,
        messages: [
          message("m1", "user", "What do I have tomorrow?", "voice"),
          message("m2", "assistant", answer, "text"),
        ],
        proposals: [],
      },
    }),
  );
  await page.route("**/api/v1/workspaces/*/ai/messages", async (route) => {
    asked = route.request().postDataJSON();
    const events = [
      ["start", { conversation, provider_name: "Local", model: "llama3", processing: "local" }],
      ["sources", { citations: [] }],
      ["delta", { text: "Tomorrow you have a dentist visit at 9 am. " }],
      ["delta", { text: "Nothing else is planned." }],
      ["done", { message: message("m2", "assistant", answer, "text"), proposals: [] }],
    ];
    await route.fulfill({
      headers: { "Content-Type": "text/event-stream" },
      body: events
        .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
        .join(""),
    });
  });
  return () => asked;
}

test("a spoken question is answered aloud and kept in the conversation", async ({ page }) => {
  await fakeSpeechEngines(page);
  await signUpAndSkipSetup(page);
  const asked = await stubAssistant(page);
  await page.goto("/assistant");

  await page.getByRole("button", { name: "Talk with voice" }).click();
  await page.getByRole("button", { name: "Start voice" }).click();
  const voice = page.getByRole("region", { name: "Voice conversation" });
  await expect(voice.getByText("Listening", { exact: true })).toBeVisible();
  await expect(voice.getByText("Hearing in this browser")).toBeVisible();

  await page.evaluate(() =>
    (window as unknown as { __voice: { say: (t: string) => void } }).__voice.say(
      "What do I have tomorrow?",
    ),
  );

  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __voice: { spoken: string[] } }).__voice.spoken),
    )
    .toEqual(["Tomorrow you have a dentist visit at 9 am.", "Nothing else is planned."]);
  expect(asked()).toMatchObject({ content: "What do I have tomorrow?", input_mode: "voice" });
  await expect(page.getByText("Spoken", { exact: true })).toBeVisible();
  await expect(voice.getByText("Listening", { exact: true })).toBeVisible();

  // Back to typing in the same conversation.
  await voice.getByRole("button", { name: "Type instead" }).click();
  await expect(page.getByLabel("Ask Orbit")).toBeVisible();
  await expect(page.getByText(answer)).toBeVisible();
});
