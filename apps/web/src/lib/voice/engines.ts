/**
 * Browser audio: the microphone, its level, recording an utterance, the browser's own speech
 * recognition and synthesis, and playing provider audio. Everything here is released by the
 * caller (`close`, `stop`); nothing keeps the microphone open on its own.
 */

import type { SpeechOutput } from "./playback";
import { rmsOf } from "./vad";

// Speech recognition is not in TypeScript's DOM library; this is the part Orbit uses.
type RecognitionAlternative = { transcript: string };
type RecognitionResult = {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternative;
};
type RecognitionEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
};
type RecognitionErrorEvent = { error: string };
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => RecognitionLike;

function isConstructor(value: unknown): value is RecognitionConstructor {
  return typeof value === "function";
}

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const value: unknown =
    Reflect.get(window, "SpeechRecognition") ?? Reflect.get(window, "webkitSpeechRecognition");
  return isConstructor(value) ? value : null;
}

export type VoiceSupport = {
  microphone: boolean;
  recorder: boolean;
  recognition: boolean;
  synthesis: boolean;
  /** Choosing a speaker (`HTMLMediaElement.setSinkId`); Chrome and Edge, not Safari. */
  outputSelection: boolean;
};

export function voiceSupport(): VoiceSupport {
  if (typeof window === "undefined") {
    return {
      microphone: false,
      recorder: false,
      recognition: false,
      synthesis: false,
      outputSelection: false,
    };
  }
  return {
    microphone: Boolean(navigator.mediaDevices?.getUserMedia),
    recorder: typeof window.MediaRecorder === "function",
    recognition: recognitionConstructor() !== null,
    synthesis: "speechSynthesis" in window,
    outputSelection:
      typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype,
  };
}

// Microphone

export async function openMicrophone(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      // Echo cancellation keeps Orbit's own voice from counting as the person interrupting.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

/** Stop every track, which turns the browser's microphone indicator off. */
export function closeStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export function microphoneError(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is blocked. Allow it in your browser's site settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Connect one or choose another in Settings → Voice.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone is in use by another app or couldn't start.";
    default:
      return "The microphone couldn't start.";
  }
}

export type AudioDevices = { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] };

/** Device names are only shown after microphone permission is granted. */
export async function listAudioDevices(): Promise<AudioDevices> {
  if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [] };
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: devices.filter((d) => d.kind === "audioinput"),
    outputs: devices.filter((d) => d.kind === "audiooutput"),
  };
}

/** Microphone permission without asking, where the browser can tell. */
export async function microphonePermission(): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

/** Reads the microphone's level (RMS, 0–1) for voice activity and the visualization. */
export class LevelMeter {
  private readonly context: AudioContext;
  private readonly analyser: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;

  constructor(stream: MediaStream) {
    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.samples = new Float32Array(this.analyser.fftSize);
    source.connect(this.analyser);
  }

  read(): number {
    this.analyser.getFloatTimeDomainData(this.samples);
    return rmsOf(this.samples);
  }

  close(): void {
    void this.context.close().catch(() => undefined);
  }
}

// Recording one utterance (for a provider's transcription)

function recordingType(): string {
  for (const type of ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return "";
}

export class UtteranceRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(private readonly stream: MediaStream) {}

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  start(): void {
    if (this.recording) return;
    const type = recordingType();
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(250);
  }

  /** Finish and return the recording (empty when nothing was recorded). */
  stop(): Promise<Blob> {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder || recorder.state === "inactive") return Promise.resolve(new Blob());
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const type = (recorder.mimeType || "audio/webm").split(";")[0];
        resolve(new Blob(this.chunks, { type }));
        this.chunks = [];
      };
      recorder.stop();
    });
  }

  /** Throw away a recording in progress. */
  discard(): void {
    const recorder = this.recorder;
    this.recorder = null;
    this.chunks = [];
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
  }
}

// The browser's speech recognition

export type RecognizerCallbacks = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string, fatal: boolean) => void;
};

/** Continuous browser recognition that restarts itself between phrases until stopped. */
export class BrowserRecognizer {
  private recognition: RecognitionLike | null = null;
  private wanted = false;

  constructor(
    private readonly language: string,
    private readonly callbacks: RecognizerCallbacks,
  ) {}

  static supported(): boolean {
    return recognitionConstructor() !== null;
  }

  start(): void {
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      this.callbacks.onError("This browser can't recognize speech.", true);
      return;
    }
    this.wanted = true;
    const recognition = new Recognition();
    recognition.lang = this.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) this.callbacks.onFinal(text.trim());
        else partial += text;
      }
      this.callbacks.onPartial(partial.trim());
    };
    recognition.onerror = (event) => {
      switch (event.error) {
        case "no-speech":
        case "aborted":
          return;
        case "not-allowed":
        case "service-not-allowed":
          this.wanted = false;
          this.callbacks.onError("Speech recognition isn't allowed in this browser.", true);
          return;
        case "network":
          this.callbacks.onError("Speech recognition lost its connection.", false);
          return;
        case "language-not-supported":
          this.wanted = false;
          this.callbacks.onError("This browser can't recognize the chosen language.", true);
          return;
        default:
          this.callbacks.onError("Speech recognition stopped unexpectedly.", false);
      }
    };
    // Browsers end recognition after a pause or a minute; keep it going while wanted.
    recognition.onend = () => {
      if (this.wanted && this.recognition === recognition) {
        try {
          recognition.start();
        } catch {
          this.callbacks.onError("Speech recognition stopped unexpectedly.", false);
        }
      }
    };
    this.recognition = recognition;
    recognition.start();
  }

  stop(): void {
    this.wanted = false;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.abort();
    }
  }
}

// Speaking

export type SpeakingOptions = { rate: number; volume: number; language: string };

/** The browser's own voices. Some are on the device, some are its vendor's cloud voices. */
export function browserVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices();
}

export class BrowserSpeechOutput implements SpeechOutput<SpeechSynthesisUtterance> {
  constructor(private readonly options: () => SpeakingOptions & { voiceName: string | null }) {}

  prepare(text: string): Promise<SpeechSynthesisUtterance> {
    const { rate, volume, language, voiceName } = this.options();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.volume = volume;
    utterance.lang = language;
    const voice = browserVoices().find((v) => v.name === voiceName);
    if (voice) utterance.voice = voice;
    return Promise.resolve(utterance);
  }

  play(utterance: SpeechSynthesisUtterance, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return resolve();
      const done = () => {
        signal.removeEventListener("abort", done);
        resolve();
      };
      utterance.onend = done;
      utterance.onerror = (event) => {
        signal.removeEventListener("abort", done);
        if (event.error === "interrupted" || event.error === "canceled") resolve();
        else reject(new Error("The browser couldn't speak."));
      };
      signal.addEventListener("abort", done);
      window.speechSynthesis.speak(utterance);
    });
  }

  pause(): void {
    window.speechSynthesis?.pause();
  }

  resume(): void {
    window.speechSynthesis?.resume();
  }

  stop(): void {
    window.speechSynthesis?.cancel();
  }
}

/** Plays audio a provider generated, one chunk at a time, through one reused audio element. */
export class AudioSpeechOutput implements SpeechOutput<string> {
  private readonly element: HTMLAudioElement;

  constructor(
    private readonly fetchAudio: (text: string, signal: AbortSignal) => Promise<Blob>,
    private readonly options: () => { volume: number; outputDeviceId: string | null },
  ) {
    this.element = new Audio();
    this.element.preload = "auto";
  }

  async prepare(text: string, signal: AbortSignal): Promise<string> {
    const blob = await this.fetchAudio(text, signal);
    return URL.createObjectURL(blob);
  }

  async play(url: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const { volume, outputDeviceId } = this.options();
    const element = this.element;
    element.volume = volume;
    if (outputDeviceId && "setSinkId" in element) {
      await element.setSinkId(outputDeviceId).catch(() => undefined);
    }
    element.src = url;
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        element.onended = null;
        element.onerror = null;
        signal.removeEventListener("abort", finish);
        resolve();
      };
      element.onended = finish;
      element.onerror = () => {
        signal.removeEventListener("abort", finish);
        reject(new Error("The audio couldn't play."));
      };
      signal.addEventListener("abort", finish);
      element.play().catch(reject);
    });
  }

  pause(): void {
    this.element.pause();
  }

  resume(): void {
    void this.element.play().catch(() => undefined);
  }

  stop(): void {
    this.element.pause();
    this.element.removeAttribute("src");
    this.element.load();
  }

  release(url: string): void {
    URL.revokeObjectURL(url);
  }
}
