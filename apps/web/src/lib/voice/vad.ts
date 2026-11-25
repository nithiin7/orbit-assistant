/**
 * Voice activity detection from input levels: when speech starts, and when it has ended
 * (silence for `silenceMs`). It runs on the microphone's level (RMS, 0–1) a few dozen times a
 * second, adapting to the room's background noise, so it works without any model.
 */

export type VadEvent = "start" | "end";

export type VadOptions = {
  /** 1 (needs loud speech) to 10 (picks up quiet speech). */
  sensitivity: number;
  /** Silence after speech that ends the utterance. */
  silenceMs: number;
  /** Sound shorter than this (a click, a cough) doesn't count as speech. */
  minSpeechMs?: number;
};

/** The base level that counts as speech for a sensitivity, before the noise floor. */
export function speechThreshold(sensitivity: number): number {
  const clamped = Math.min(10, Math.max(1, sensitivity));
  return 0.065 - (clamped - 1) * 0.0055;
}

export class VoiceActivityDetector {
  private readonly threshold: number;
  private readonly silenceMs: number;
  private readonly minSpeechMs: number;
  private floor = 0;
  private speaking = false;
  private loudSince: number | null = null;
  private quietSince: number | null = null;

  constructor({ sensitivity, silenceMs, minSpeechMs = 180 }: VadOptions) {
    this.threshold = speechThreshold(sensitivity);
    this.silenceMs = silenceMs;
    this.minSpeechMs = minSpeechMs;
  }

  get active(): boolean {
    return this.speaking;
  }

  /** The level that counts as speech now: the base threshold, or well above the room's noise. */
  get level(): number {
    return Math.max(this.threshold, this.floor * 2.5);
  }

  /** Feed one level reading at time `now` (ms); returns an event when speech starts or ends. */
  update(rms: number, now: number): VadEvent | null {
    const loud = rms >= this.level;
    // Track the room's background noise: quickly while it's quiet, very slowly otherwise, so
    // speech barely raises it but a steady hum (a fan) eventually stops counting as speech.
    const rate = !loud ? 0.05 : this.speaking ? 0.002 : 0.01;
    this.floor = this.floor === 0 ? rms : this.floor * (1 - rate) + rms * rate;
    if (!this.speaking) {
      if (!loud) {
        this.loudSince = null;
        return null;
      }
      this.loudSince ??= now;
      if (now - this.loudSince >= this.minSpeechMs) {
        this.speaking = true;
        this.quietSince = null;
        return "start";
      }
      return null;
    }
    if (loud) {
      this.quietSince = null;
      return null;
    }
    this.quietSince ??= now;
    if (now - this.quietSince >= this.silenceMs) {
      this.speaking = false;
      this.loudSince = null;
      this.quietSince = null;
      return "end";
    }
    return null;
  }

  reset(): void {
    this.speaking = false;
    this.loudSince = null;
    this.quietSince = null;
  }
}

/** Root-mean-square level of time-domain samples in [-1, 1]. */
export function rmsOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}
