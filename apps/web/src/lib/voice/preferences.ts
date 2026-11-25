/**
 * Voice choices that belong to this device, saved in this browser only: the microphone, the
 * speaker, the volume, and a browser voice (device names and browser voices differ per device).
 */
export const VOICE_DEVICE_KEY = "orbit:voice-device";

export type VoiceDevicePreference = {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  /** 0–1. */
  volume: number;
  browserVoice: string | null;
};

export const defaultVoiceDevicePreference: VoiceDevicePreference = {
  inputDeviceId: null,
  outputDeviceId: null,
  volume: 1,
  browserVoice: null,
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 300 ? value : null;
}

export function parseVoiceDevicePreference(raw: string | null): VoiceDevicePreference {
  if (!raw) return defaultVoiceDevicePreference;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return defaultVoiceDevicePreference;
    const volume = Reflect.get(value, "volume");
    return {
      inputDeviceId: text(Reflect.get(value, "inputDeviceId")),
      outputDeviceId: text(Reflect.get(value, "outputDeviceId")),
      volume:
        typeof volume === "number" && Number.isFinite(volume)
          ? Math.min(1, Math.max(0, volume))
          : 1,
      browserVoice: text(Reflect.get(value, "browserVoice")),
    };
  } catch {
    return defaultVoiceDevicePreference;
  }
}

let cachedRaw: string | null | undefined;
let cached = defaultVoiceDevicePreference;
const listeners = new Set<() => void>();

/** For `useSyncExternalStore`: the same object until the saved value changes. */
export function readVoiceDevicePreference(): VoiceDevicePreference {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(VOICE_DEVICE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseVoiceDevicePreference(raw);
  }
  return cached;
}

export function writeVoiceDevicePreference(change: Partial<VoiceDevicePreference>): void {
  const next = { ...readVoiceDevicePreference(), ...change };
  try {
    localStorage.setItem(VOICE_DEVICE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page only.
    cachedRaw = JSON.stringify(next);
    cached = next;
  }
  for (const listener of listeners) listener();
}

export function subscribeVoiceDevicePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
