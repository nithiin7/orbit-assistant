import type { AiProposal, VoiceSettings } from "@orbit/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiStreamEvent } from "@/api/ai";
import type { VoiceChat } from "@/hooks/use-voice-conversation";
import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { VoicePanel } from "./voice-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/assistant",
  useSearchParams: () => new URLSearchParams(),
}));

const WS = `/api/v1/workspaces/${personal.id}`;

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

const browserVoice: VoiceSettings = {
  stt_engine: "browser",
  stt_provider_id: null,
  stt_model: null,
  tts_engine: "browser",
  tts_provider_id: null,
  tts_model: null,
  tts_voice: null,
  recognition_language: "en-IN",
  response_language: null,
  listening_mode: "continuous",
  silence_ms: 900,
  sensitivity: 5,
  auto_speak: true,
  speaking_rate: 100,
  history_days: null,
  updated_at: null,
  server_enabled: true,
  ai_enabled: true,
  allow_cloud: false,
  stt_processing: "browser",
  tts_processing: "browser",
  providers: [],
  stores_audio: false,
};

// Browser audio, faked: the microphone, the audio graph, recognition, and synthesis.

type FakeTrack = { stop: ReturnType<typeof vi.fn>; enabled: boolean; addEventListener: () => void };
let tracks: FakeTrack[] = [];
const getUserMedia = vi.fn();

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  say(text: string, isFinal = true) {
    this.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal, length: 1, 0: { transcript: text } } },
    });
  }
}

class FakeUtterance {
  rate = 1;
  volume = 1;
  lang = "";
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(readonly text: string) {}
}

const spoken: FakeUtterance[] = [];
const synthesis = {
  speak: vi.fn((utterance: FakeUtterance) => spoken.push(utterance)),
  cancel: vi.fn(() => {
    for (const u of spoken) u.onerror?.({ error: "interrupted" });
  }),
  pause: vi.fn(),
  resume: vi.fn(),
  getVoices: () => [],
};

/** Finish the utterance being spoken, as the browser would. */
async function finishSpeaking() {
  await act(async () => {
    spoken.at(-1)?.onend?.();
    await Promise.resolve();
  });
}

class FakeAudioContext {
  createMediaStreamSource = () => ({ connect: vi.fn() });
  createAnalyser = () => ({ fftSize: 1024, getFloatTimeDomainData: vi.fn() });
  close = vi.fn(() => Promise.resolve());
}

beforeEach(() => {
  tracks = [];
  spoken.length = 0;
  FakeRecognition.instances = [];
  getUserMedia.mockImplementation(() => {
    const track: FakeTrack = { stop: vi.fn(), enabled: true, addEventListener: () => undefined };
    tracks.push(track);
    return Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] });
  });
  vi.stubGlobal("navigator", {
    ...navigator,
    language: "en-IN",
    mediaDevices: {
      getUserMedia,
      enumerateDevices: () => Promise.resolve([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", synthesis);
  Object.defineProperty(window, "speechSynthesis", { value: synthesis, configurable: true });
  vi.stubGlobal("MediaRecorder", class {});
  synthesis.speak.mockClear();
  synthesis.cancel.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function proposal(): AiProposal {
  return {
    id: "pr1",
    kind: "create_task",
    payload: { title: "Book photos" },
    summary: "Create task “Book photos”",
    status: "pending",
    from_untrusted_context: false,
    result_kind: null,
    result_id: null,
    error: null,
    message_id: "m2",
    created_at: "2026-11-15T10:00:00Z",
  };
}

/** A chat whose answer is streamed when the test says so. */
function fakeChat() {
  let emit: ((event: AiStreamEvent) => void) | null = null;
  let finish: (() => void) | null = null;
  const chat: VoiceChat & { send: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } = {
    send: vi.fn(
      (_question: string, options: { onEvent: (event: AiStreamEvent) => void }) =>
        new Promise<void>((resolve) => {
          emit = options.onEvent;
          finish = resolve;
        }),
    ),
    stop: vi.fn(() => finish?.()),
  };
  const stream = async (...events: AiStreamEvent[]) => {
    await act(async () => {
      for (const event of events) emit?.(event);
      await Promise.resolve();
    });
  };
  const done = async (proposals: AiProposal[] = []) => {
    await stream({
      type: "done",
      data: {
        message: {
          id: "m2",
          role: "assistant",
          content: "",
          citations: [],
          status: "complete",
          provider_name: null,
          model: null,
          processing: null,
          input_tokens: null,
          output_tokens: null,
          created_at: "2026-11-15T10:00:00Z",
          input_mode: "text",
        },
        proposals,
      },
    });
    await act(async () => {
      finish?.();
      await Promise.resolve();
    });
  };
  return { chat, stream, done };
}

const started = {
  type: "start",
  data: {
    conversation: {
      id: "c1",
      title: "Tomorrow",
      created_at: "2026-11-15T10:00:00Z",
      updated_at: "2026-11-15T10:00:00Z",
    },
    provider_name: "Ollama",
    model: "llama3",
    processing: "local",
  },
} satisfies AiStreamEvent;

async function startVoice(settings = browserVoice, chat = fakeChat().chat, routes = {}) {
  mockApi({ ...session, ...routes });
  const onUseText = vi.fn();
  const view = await renderSignedIn(
    <VoicePanel settings={settings} conversationId={null} chat={chat} onUseText={onUseText} />,
  );
  await userEvent.click(await screen.findByRole("button", { name: "Start voice" }));
  return { view, onUseText };
}

describe("VoicePanel", () => {
  it("opens the microphone, listens, and releases it when ended", async () => {
    await startVoice();
    expect(await screen.findByText("Listening")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ echoCancellation: true }),
    });
    expect(FakeRecognition.instances[0]?.lang).toBe("en-IN");
    expect(screen.getByText("Hearing in this browser")).toBeInTheDocument();
    expect(screen.getByText("Audio is never stored.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "End" }));
    expect(tracks[0]?.stop).toHaveBeenCalled();
    expect(FakeRecognition.instances[0]?.abort).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start voice" })).toBeInTheDocument();
  });

  it("explains a denied microphone and holds nothing open", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await startVoice();
    expect(await screen.findByText(/Microphone access is blocked/)).toBeInTheDocument();
    expect(screen.getByText("Voice stopped")).toBeInTheDocument();
    expect(tracks).toEqual([]);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("asks the assistant with the transcript and speaks the answer sentence by sentence", async () => {
    const { chat, stream, done } = fakeChat();
    await startVoice(browserVoice, chat);
    await screen.findByText("Listening");
    act(() => FakeRecognition.instances[0]?.say("what do I have tomorrow", false));
    expect(screen.getByText("“what do I have tomorrow”")).toBeInTheDocument();
    act(() => FakeRecognition.instances[0]?.say("What do I have tomorrow?"));
    await waitFor(() =>
      expect(chat.send).toHaveBeenCalledWith(
        "What do I have tomorrow?",
        expect.objectContaining({ inputMode: "voice" }),
      ),
    );
    expect(await screen.findByText("Thinking…")).toBeInTheDocument();
    await stream(started, { type: "delta", text: "You have a **dentist** visit at 9 am [S1]. " });
    await stream({ type: "delta", text: "Then lunch with Priya at noon." });
    await done();
    expect(await screen.findByText("Speaking")).toBeInTheDocument();
    expect(spoken.map((u) => u.text)).toEqual(["You have a dentist visit at 9 am ."]);
    await finishSpeaking();
    await waitFor(() =>
      expect(spoken.map((u) => u.text)).toEqual([
        "You have a dentist visit at 9 am .",
        "Then lunch with Priya at noon.",
      ]),
    );
    await finishSpeaking();
    expect(await screen.findByText("Listening")).toBeInTheDocument();
  });

  it("stops speaking and cancels the answer when interrupted, without stale audio", async () => {
    const { chat, stream } = fakeChat();
    await startVoice(browserVoice, chat);
    await screen.findByText("Listening");
    act(() => FakeRecognition.instances[0]?.say("Summarize my week"));
    await waitFor(() => expect(chat.send).toHaveBeenCalled());
    await stream(started, { type: "delta", text: "This week you have a lot going on. " });
    await screen.findByText("Speaking");
    await userEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    expect(synthesis.cancel).toHaveBeenCalled();
    expect(chat.stop).toHaveBeenCalled();
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    // Text the old answer still produces is never spoken.
    await stream({ type: "delta", text: "Here is an old sentence that must stay silent. " });
    expect(spoken.map((u) => u.text)).toEqual(["This week you have a lot going on."]);
  });

  it("ignores what recognition hears while Orbit speaks, unless interrupted", async () => {
    const { chat, stream } = fakeChat();
    await startVoice(browserVoice, chat);
    await screen.findByText("Listening");
    act(() => FakeRecognition.instances[0]?.say("First question"));
    await waitFor(() => expect(chat.send).toHaveBeenCalled());
    await stream(started, { type: "delta", text: "A reasonably long first sentence here. " });
    await screen.findByText("Speaking");
    act(() => FakeRecognition.instances[0]?.say("A reasonably long first sentence here."));
    expect(chat.send).toHaveBeenCalledTimes(1);
  });

  it("reads a proposal back and sends a spoken yes to the server for checking", async () => {
    const { chat, stream, done } = fakeChat();
    const confirm = vi.fn(() =>
      Response.json({
        outcome: "approved",
        reply: "confirm",
        message: "Done.",
        proposal: { ...proposal(), status: "executed" },
        approval: null,
      }),
    );
    await startVoice(browserVoice, chat, { [`POST ${WS}/voice/confirmations`]: confirm });
    await screen.findByText("Listening");
    act(() => FakeRecognition.instances[0]?.say("Create a task to book photos"));
    await waitFor(() => expect(chat.send).toHaveBeenCalled());
    await stream(started, { type: "delta", text: "I can do that for you right away." });
    await done([proposal()]);
    expect(await screen.findByText(/Waiting for a yes or no/)).toBeInTheDocument();
    // A reply before the question has been asked out loud isn't an answer.
    act(() => FakeRecognition.instances[0]?.say("yes"));
    expect(confirm).not.toHaveBeenCalled();
    await finishSpeaking();
    await waitFor(() =>
      expect(spoken.at(-1)?.text).toBe(
        "I've prepared this: Create task “Book photos”. Shall I go ahead?",
      ),
    );
    await finishSpeaking();
    await screen.findByText("Listening");
    act(() => FakeRecognition.instances[0]?.say("Yes, go ahead"));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    const [request] = confirm.mock.calls[0] as unknown as [{ body: unknown }];
    expect(request.body).toMatchObject({
      target: "proposal",
      id: "pr1",
      conversation_id: "c1",
      transcript: "Yes, go ahead",
    });
    await waitFor(() => expect(spoken.at(-1)?.text).toBe("Done."));
    expect(screen.queryByText(/Waiting for a yes or no/)).not.toBeInTheDocument();
    // Approval went through the server; the chat wasn't asked to do it.
    expect(chat.send).toHaveBeenCalledTimes(1);
  });

  it("mutes the microphone and keeps it muted when the tab is hidden", async () => {
    await startVoice();
    await screen.findByText("Listening");
    await userEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(tracks[0]?.enabled).toBe(false);
    expect(screen.getByText("Microphone off")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Turn microphone on" }));
    expect(tracks[0]?.enabled).toBe(true);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(tracks[0]?.enabled).toBe(false);
    expect(screen.getByText(/paused while this tab was in the background/)).toBeInTheDocument();
  });

  it("releases the microphone when the panel goes away", async () => {
    const { view } = await startVoice();
    await screen.findByText("Listening");
    view.unmount();
    expect(tracks[0]?.stop).toHaveBeenCalled();
  });

  it("switches back to typing", async () => {
    const { onUseText } = await startVoice();
    await screen.findByText("Listening");
    await userEvent.click(screen.getByRole("button", { name: "Type instead" }));
    expect(onUseText).toHaveBeenCalled();
    expect(tracks[0]?.stop).toHaveBeenCalled();
  });

  it("says when the browser can't recognize speech", async () => {
    vi.stubGlobal("SpeechRecognition", undefined);
    await startVoice();
    expect(await screen.findByText(/can't recognize speech/)).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
