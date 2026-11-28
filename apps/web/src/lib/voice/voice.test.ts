import type { AiProposal } from "@orbit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proposalPrompt } from "./confirmation";
import { browserLanguage } from "./languages";
import { type SpeechOutput, SpeechQueue } from "./playback";
import {
  parseVoiceDevicePreference,
  readVoiceDevicePreference,
  VOICE_DEVICE_KEY,
  writeVoiceDevicePreference,
} from "./preferences";
import { MAX_CHUNK_CHARS, SentenceSplitter, speakableText } from "./sentences";
import { rmsOf, VoiceActivityDetector } from "./vad";

describe("speakable text", () => {
  it("drops citations, Markdown, code, and URLs", () => {
    expect(
      speakableText(
        "**Tomorrow** you have a [dentist visit](/calendar) [S1, S2].\n- Pay rent [S3]",
      ),
    ).toBe("Tomorrow you have a dentist visit .\nPay rent ");
    expect(speakableText("Run `ls` then\n```sh\nrm -rf /\n```\nSee https://example.com/x ok")).toBe(
      "Run ls then\n \nSee ok",
    );
  });
});

describe("sentence splitter", () => {
  it("emits sentences in order as they complete across deltas", () => {
    const splitter = new SentenceSplitter();
    const spoken: string[] = [];
    for (const delta of [
      "You have two meetings tomor",
      "row. The first is at 9 am with ",
      "Priya! Anything else",
      "?",
    ]) {
      spoken.push(...splitter.push(delta));
    }
    spoken.push(...splitter.flush());
    expect(spoken).toEqual([
      "You have two meetings tomorrow.",
      "The first is at 9 am with Priya!",
      "Anything else?",
    ]);
  });

  it("joins very short sentences and splits very long ones", () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push("Sure. ")).toEqual([]);
    expect(splitter.push("Here is what is pending this week. ")).toEqual([
      "Sure. Here is what is pending this week.",
    ]);
    const long = `${"word ".repeat(120)}end.`;
    const chunks = [...splitter.push(`${long} `), ...splitter.flush()];
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= MAX_CHUNK_CHARS)).toBe(true);
    expect(chunks.join(" ")).toBe(long);
  });

  it("splits Hindi at the danda", () => {
    const splitter = new SentenceSplitter();
    expect([...splitter.push("कल आपकी दो मीटिंग हैं और एक रिमाइंडर। "), ...splitter.flush()]).toEqual([
      "कल आपकी दो मीटिंग हैं और एक रिमाइंडर।",
    ]);
  });
});

describe("voice activity", () => {
  it("starts after sustained sound and ends after the silence threshold", () => {
    const vad = new VoiceActivityDetector({ sensitivity: 5, silenceMs: 600, minSpeechMs: 100 });
    const events: (string | null)[] = [];
    let now = 0;
    const feed = (level: number, ms: number) => {
      for (let t = 0; t < ms; t += 50) {
        events.push(vad.update(level, now));
        now += 50;
      }
    };
    feed(0.005, 500); // room noise
    feed(0.2, 50); // a click: too short
    feed(0.005, 200);
    expect(events.filter(Boolean)).toEqual([]);
    feed(0.2, 400); // speech
    expect(events.filter(Boolean)).toEqual(["start"]);
    feed(0.005, 300); // a pause inside the sentence
    feed(0.2, 200);
    feed(0.005, 700);
    expect(events.filter(Boolean)).toEqual(["start", "end"]);
    expect(vad.active).toBe(false);
  });

  it("adapts to background noise and to sensitivity", () => {
    const quiet = new VoiceActivityDetector({ sensitivity: 10, silenceMs: 500 });
    const strict = new VoiceActivityDetector({ sensitivity: 1, silenceMs: 500 });
    expect(quiet.level).toBeLessThan(strict.level);
    // In a noisy room, sound just above the base threshold no longer counts as speech.
    const noisy = new VoiceActivityDetector({ sensitivity: 10, silenceMs: 500 });
    for (let t = 0; t < 2000; t += 50) noisy.update(0.012, t);
    expect(noisy.level).toBeGreaterThan(0.025);
    const events = [];
    for (let t = 2000; t < 3000; t += 50) events.push(noisy.update(0.025, t));
    expect(events.filter(Boolean)).toEqual([]);
  });

  it("measures RMS", () => {
    expect(rmsOf([])).toBe(0);
    expect(rmsOf([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5);
  });
});

/** A speech output that plays instantly unless told to wait, recording what it did. */
function fakeOutput() {
  const played: string[] = [];
  const released: string[] = [];
  let hold: (() => void) | null = null;
  const output: SpeechOutput<string> = {
    prepare: (text) => Promise.resolve(text),
    play: (text, signal) =>
      new Promise<void>((resolve) => {
        played.push(text);
        if (text.startsWith("slow")) {
          hold = resolve;
          signal.addEventListener("abort", () => resolve());
        } else resolve();
      }),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    release: (text) => released.push(text),
  };
  return { output, played, released, finish: () => hold?.() };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("speech queue", () => {
  it("plays chunks in order and reports when idle", async () => {
    const { output, played } = fakeOutput();
    const onIdle = vi.fn();
    const queue = new SpeechQueue(output, { onIdle });
    queue.enqueue("one");
    queue.enqueue("two");
    queue.enqueue("three");
    await settle();
    expect(played).toEqual(["one", "two", "three"]);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("never plays stale chunks after an interruption", async () => {
    const { output, played } = fakeOutput();
    const queue = new SpeechQueue(output);
    queue.enqueue("slow first answer");
    queue.enqueue("rest of first answer");
    await settle();
    queue.cancel();
    queue.enqueue("second answer");
    await settle();
    expect(played).toEqual(["slow first answer", "second answer"]);
    expect(output.stop).toHaveBeenCalled();
  });

  it("drops a chunk whose audio arrives after it was interrupted", async () => {
    const late: { deliver?: (text: string) => void } = {};
    const played: string[] = [];
    const released: string[] = [];
    const output: SpeechOutput<string> = {
      prepare: (text) =>
        text === "late"
          ? new Promise<string>((resolve) => {
              late.deliver = resolve;
            })
          : Promise.resolve(text),
      play: (text) => {
        played.push(text);
        return Promise.resolve();
      },
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      release: (text) => released.push(text),
    };
    const queue = new SpeechQueue(output);
    queue.enqueue("late");
    queue.cancel();
    late.deliver?.("late");
    await settle();
    expect(played).toEqual([]);
    expect(released).toEqual(["late"]);
  });

  it("pauses and resumes playback", async () => {
    const { output, finish } = fakeOutput();
    const queue = new SpeechQueue(output);
    queue.enqueue("slow sentence");
    await settle();
    queue.pause();
    expect(queue.paused).toBe(true);
    expect(output.pause).toHaveBeenCalledOnce();
    queue.resume();
    expect(output.resume).toHaveBeenCalledOnce();
    finish();
    await settle();
    expect(queue.busy).toBe(false);
  });

  it("reports a failed chunk and carries on", async () => {
    const onError = vi.fn();
    const played: string[] = [];
    const output: SpeechOutput<string> = {
      prepare: (text) => (text === "bad" ? Promise.reject(new Error("no")) : Promise.resolve(text)),
      play: (text) => {
        played.push(text);
        return Promise.resolve();
      },
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const queue = new SpeechQueue(output, { onError });
    queue.enqueue("bad");
    queue.enqueue("good");
    await settle();
    expect(onError).toHaveBeenCalledOnce();
    expect(played).toEqual(["good"]);
  });
});

describe("device preference", () => {
  afterEach(() => localStorage.clear());

  it("round-trips and survives corrupt values", () => {
    writeVoiceDevicePreference({ inputDeviceId: "mic-2", volume: 0.4 });
    expect(readVoiceDevicePreference()).toEqual({
      inputDeviceId: "mic-2",
      outputDeviceId: null,
      volume: 0.4,
      browserVoice: null,
    });
    expect(readVoiceDevicePreference()).toBe(readVoiceDevicePreference());
    localStorage.setItem(VOICE_DEVICE_KEY, "{oops");
    expect(readVoiceDevicePreference().volume).toBe(1);
    expect(parseVoiceDevicePreference(JSON.stringify({ volume: 7 })).volume).toBe(1);
  });
});

describe("languages", () => {
  it("uses the browser's language for auto", () => {
    expect(browserLanguage("auto", "en-IN")).toBe("en-IN");
    expect(browserLanguage("hi-IN", "en-IN")).toBe("hi-IN");
  });
});

function proposal(id: string, status: AiProposal["status"] = "pending"): AiProposal {
  return {
    id,
    message_id: "m1",
    kind: "create_task",
    payload: {},
    summary: `Create task “${id}”`,
    status,
    from_untrusted_context: false,
    result_kind: null,
    result_id: null,
    error: null,
    created_at: "2026-11-15T00:00:00Z",
  };
}

describe("proposal prompts", () => {
  it("reads one pending proposal back and leaves several for the screen", () => {
    expect(proposalPrompt([])).toBeNull();
    expect(proposalPrompt([proposal("a", "executed")])).toBeNull();
    const one = proposalPrompt([proposal("a")]);
    expect(one?.text).toBe("I've prepared this: Create task “a”. Shall I go ahead?");
    expect(one?.awaiting?.id).toBe("a");
    const two = proposalPrompt([proposal("a"), proposal("b")]);
    expect(two).toEqual({
      text: "I've prepared 2 actions. Please review them on screen.",
      awaiting: null,
    });
  });
});
