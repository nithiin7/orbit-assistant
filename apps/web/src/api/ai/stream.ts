import type {
  AiCitation,
  AiStreamDone,
  AiTurnStarted,
  SendAiMessageRequest,
} from "@orbit/contracts";

import { send, workspacePath } from "../client";

/** One event of a streamed answer, as the API sends them (server-sent events). */
export type AiStreamEvent =
  | { type: "start"; data: AiTurnStarted }
  | { type: "sources"; citations: AiCitation[] }
  | { type: "delta"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; data: AiStreamDone };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTurnStarted(value: unknown): value is AiTurnStarted {
  return isRecord(value) && isRecord(value.conversation) && typeof value.model === "string";
}

function isCitations(value: unknown): value is AiCitation[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && isRecord(item.ref));
}

function isStreamDone(value: unknown): value is AiStreamDone {
  return isRecord(value) && isRecord(value.message) && Array.isArray(value.proposals);
}

/** Read one event block (`event:` and `data:` lines). Unknown or malformed events are skipped. */
export function parseEvent(block: string): AiStreamEvent | null {
  let name = "";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  let value: unknown;
  try {
    value = JSON.parse(data.join("\n"));
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  switch (name) {
    case "start":
      return isTurnStarted(value) ? { type: "start", data: value } : null;
    case "sources":
      return isCitations(value.citations) ? { type: "sources", citations: value.citations } : null;
    case "delta":
      return typeof value.text === "string" ? { type: "delta", text: value.text } : null;
    case "error":
      return typeof value.message === "string" ? { type: "error", message: value.message } : null;
    case "done":
      return isStreamDone(value) ? { type: "done", data: value } : null;
    default:
      return null;
  }
}

/**
 * Ask the assistant and receive its answer as it is written. Failures before the stream starts
 * (AI off, no provider, limit reached) throw `ApiError` like any request. Aborting `signal`
 * stops generation; the API keeps what was written.
 */
export async function streamAiMessage(
  token: string,
  workspaceId: string,
  body: SendAiMessageRequest,
  onEvent: (event: AiStreamEvent) => void,
  { signal }: { signal?: AbortSignal } = {},
): Promise<void> {
  const response = await send(workspacePath(workspaceId, "/ai/messages"), {
    method: "POST",
    body,
    token,
    signal,
  });
  if (!response.body) {
    for (const block of (await response.text()).split("\n\n")) {
      const event = parseEvent(block);
      if (event) onEvent(event);
    }
    return;
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end = buffer.indexOf("\n\n");
    while (end !== -1) {
      const event = parseEvent(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (event) onEvent(event);
      end = buffer.indexOf("\n\n");
    }
  }
  const last = parseEvent(buffer);
  if (last) onEvent(last);
}
