/** What a voice conversation is doing, shown as text and color, never only by animation. */
export type VoicePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "processing"
  | "speaking"
  | "interrupted"
  | "reconnecting"
  | "error";

export const voicePhaseLabels: Readonly<Record<VoicePhase, string>> = {
  idle: "Ready",
  connecting: "Connecting…",
  listening: "Listening",
  processing: "Thinking…",
  speaking: "Speaking",
  interrupted: "Interrupted",
  reconnecting: "Reconnecting…",
  error: "Voice stopped",
};

export const voicePhaseHints: Readonly<Record<VoicePhase, string>> = {
  idle: "Start a voice conversation when you're ready.",
  connecting: "Asking for your microphone.",
  listening: "Go ahead, I'm listening.",
  processing: "Working on an answer.",
  speaking: "Speak any time to interrupt.",
  interrupted: "Stopped. Go ahead.",
  reconnecting: "Getting the microphone or connection back.",
  error: "",
};

/** Phases in which the microphone is open. */
export function isLive(phase: VoicePhase): boolean {
  return phase !== "idle" && phase !== "error";
}
