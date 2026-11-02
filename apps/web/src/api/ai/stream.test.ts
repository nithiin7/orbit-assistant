import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../client";
import { type AiStreamEvent, parseEvent, streamAiMessage } from "./stream";

const conversation = {
  id: "c1",
  title: "Hi",
  created_at: "2026-11-02T10:00:00Z",
  updated_at: "2026-11-02T10:00:00Z",
};

function sse(events: [string, unknown][]): string {
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseEvent", () => {
  it("reads known events and skips malformed ones", () => {
    expect(parseEvent('event: delta\ndata: {"text": "Hi"}')).toEqual({ type: "delta", text: "Hi" });
    expect(parseEvent("event: delta\ndata: not json")).toBeNull();
    expect(parseEvent('event: delta\ndata: {"text": 1}')).toBeNull();
    expect(parseEvent('event: surprise\ndata: {"x": 1}')).toBeNull();
  });
});

describe("streamAiMessage", () => {
  it("delivers events as they arrive, even when split across chunks", async () => {
    const body = sse([
      ["start", { conversation, provider_name: "Ollama", model: "m", processing: "local" }],
      ["delta", { text: "Hel" }],
      ["delta", { text: "lo" }],
    ]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body.slice(0, 40)));
        controller.enqueue(encoder.encode(body.slice(40)));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () => new Response(stream, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const events: AiStreamEvent[] = [];
    await streamAiMessage("token", "w1", { content: "hi" }, (event) => events.push(event));

    expect(events.map((e) => e.type)).toEqual(["start", "delta", "delta"]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ content: "hi" });
  });

  it("throws the API's error before streaming starts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ detail: "AI is turned off." }, { status: 409 })),
    );
    await expect(streamAiMessage("t", "w1", { content: "hi" }, () => {})).rejects.toEqual(
      new ApiError(409, "/api/v1/workspaces/w1/ai/messages", "AI is turned off."),
    );
  });
});
