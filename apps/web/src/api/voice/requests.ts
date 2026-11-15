import type {
  SpeakVoiceRequest,
  UpdateVoiceSettingsRequest,
  VoiceConfirmation,
  VoiceConfirmationRequest,
  VoiceHistoryClear,
  VoiceOptionList,
  VoiceSettings,
  VoiceTest,
  VoiceTranscript,
} from "@orbit/contracts";

import { request, send, type Signal, toQueryString, workspacePath } from "../client";

const ME = "/api/v1/me/voice";

// Settings (per person)

export function getVoiceSettings(token: string, { signal }: Signal = {}): Promise<VoiceSettings> {
  return request<VoiceSettings>(`${ME}/settings`, { token, signal });
}

export function updateVoiceSettings(
  token: string,
  body: UpdateVoiceSettingsRequest,
): Promise<VoiceSettings> {
  return request<VoiceSettings>(`${ME}/settings`, { method: "PUT", body, token });
}

export function listProviderVoices(
  token: string,
  providerId: string,
  { signal }: Signal = {},
): Promise<VoiceOptionList> {
  return request<VoiceOptionList>(`${ME}/providers/${encodeURIComponent(providerId)}/voices`, {
    token,
    signal,
  });
}

// Speech (per workspace, for usage)

/** Transcribe one recorded utterance. The audio is sent to the person's provider, never stored. */
export function transcribeAudio(
  token: string,
  workspaceId: string,
  audio: Blob,
  { language, signal }: { language?: string } & Signal = {},
): Promise<VoiceTranscript> {
  const query = toQueryString({ language });
  return request<VoiceTranscript>(workspacePath(workspaceId, `/voice/transcriptions${query}`), {
    method: "POST",
    body: audio,
    token,
    signal,
  });
}

/** One sentence spoken by the person's speech provider, as MP3. Aborting stops the download. */
export async function synthesizeSpeech(
  token: string,
  workspaceId: string,
  body: SpeakVoiceRequest,
  { signal }: Signal = {},
): Promise<Blob> {
  const response = await send(workspacePath(workspaceId, "/voice/speech"), {
    method: "POST",
    body,
    token,
    signal,
  });
  return response.blob();
}

export function testVoice(token: string, workspaceId: string): Promise<VoiceTest> {
  return request<VoiceTest>(workspacePath(workspaceId, "/voice/test"), { method: "POST", token });
}

/** A spoken reply to a pending action, read and checked on the server. */
export function confirmByVoice(
  token: string,
  workspaceId: string,
  body: VoiceConfirmationRequest,
): Promise<VoiceConfirmation> {
  return request<VoiceConfirmation>(workspacePath(workspaceId, "/voice/confirmations"), {
    method: "POST",
    body,
    token,
  });
}

export function clearVoiceHistory(token: string, workspaceId: string): Promise<VoiceHistoryClear> {
  return request<VoiceHistoryClear>(workspacePath(workspaceId, "/voice/history"), {
    method: "DELETE",
    token,
  });
}
