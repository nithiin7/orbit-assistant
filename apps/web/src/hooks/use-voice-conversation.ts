"use client";

import type { AiInputMode, AiProposal, VoiceSettings } from "@orbit/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type { AiStreamEvent } from "@/api/ai";
import { describeApiError } from "@/api/client";
import { confirmByVoice, synthesizeSpeech, transcribeAudio } from "@/api/voice";
import { useActiveWorkspaceId, useViewerTimeZone } from "@/hooks/use-calendar";
import { useVoiceDevicePreference } from "@/hooks/use-voice";
import {
  AudioSpeechOutput,
  browserLanguage,
  BrowserRecognizer,
  BrowserSpeechOutput,
  closeStream,
  LevelMeter,
  microphoneError,
  openMicrophone,
  proposalPrompt,
  SentenceSplitter,
  type SpeechOutput,
  SpeechQueue,
  UtteranceRecorder,
  VoiceActivityDetector,
  type VoicePhase,
  voiceSupport,
} from "@/lib/voice";
import { useAuth } from "@/providers/auth";

/** The assistant chat voice speaks through: the same one typed questions use. */
export type VoiceChat = {
  send: (
    question: string,
    options: { inputMode: AiInputMode; onEvent: (event: AiStreamEvent) => void },
  ) => Promise<void>;
  stop: () => void;
};

/** Measured on this device, in milliseconds; `null` until it has happened. */
export type VoiceMetrics = {
  /** Asking for the microphone until listening. */
  connectMs: number | null;
  /** End of speech until the first words of the answer arrive. */
  responseMs: number | null;
  /** End of speech until the answer is heard. */
  firstAudioMs: number | null;
  /** Speaking over Orbit until its audio stops. */
  interruptMs: number | null;
  turns: number;
  failures: number;
};

const EMPTY_METRICS: VoiceMetrics = {
  connectMs: null,
  responseMs: null,
  firstAudioMs: null,
  interruptMs: null,
  turns: 0,
  failures: 0,
};

const TICK_MS = 50;
/** A single utterance is cut here, so a stuck noise can't record forever. */
const MAX_UTTERANCE_MS = 30_000;
/** Recordings smaller than this are clicks or breaths, not speech. */
const MIN_RECORDING_BYTES = 1_500;
/** Unclear replies to "Shall I go ahead?" before the question is left on screen. */
const MAX_CONFIRM_TRIES = 2;

type Awaiting = { proposal: AiProposal; conversationId: string; armed: boolean; tries: number };

type Session = {
  stream: MediaStream;
  meter: LevelMeter;
  vad: VoiceActivityDetector;
  queue: SpeechQueue<unknown>;
  recorder: UtteranceRecorder | null;
  recognizer: BrowserRecognizer | null;
  timer: number;
  muted: boolean;
  /** The current turn's answer is still streaming. */
  answering: boolean;
  turn: Promise<void> | null;
  /** Bumped for every turn and interruption; events of older turns are ignored. */
  generation: number;
  conversationId: string | null;
  awaiting: Awaiting | null;
  speechStartedAt: number | null;
  speechEndedAt: number | null;
  heardAudio: boolean;
  bargedIn: boolean;
  pushing: boolean;
  pushText: string;
};

export function useVoiceConversation({
  settings,
  conversationId,
  chat,
}: {
  settings: VoiceSettings;
  conversationId: string | null;
  chat: VoiceChat;
}) {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const timezone = useViewerTimeZone();
  const queryClient = useQueryClient();
  const [device] = useVoiceDevicePreference();
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState("");
  const [heard, setHeard] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [awaiting, setAwaiting] = useState<AiProposal | null>(null);
  const [metrics, setMetrics] = useState<VoiceMetrics>(EMPTY_METRICS);
  const [support] = useState(voiceSupport);

  const sessionRef = useRef<Session | null>(null);
  // The latest props for callbacks that outlive a render (audio and stream events).
  const latest = useRef({ settings, conversationId, chat, device, workspaceId, timezone });
  useEffect(() => {
    latest.current = { settings, conversationId, chat, device, workspaceId, timezone };
  });

  const pushToTalk = settings.listening_mode === "push_to_talk";
  const browserStt = settings.stt_engine === "browser";

  function language(response: boolean): string {
    const s = latest.current.settings;
    const chosen = response
      ? (s.response_language ?? s.recognition_language)
      : s.recognition_language;
    return browserLanguage(chosen, typeof navigator === "undefined" ? "en-IN" : navigator.language);
  }

  function makeOutput(): SpeechOutput<unknown> {
    const s = latest.current.settings;
    if (s.tts_engine === "provider") {
      const output: SpeechOutput<string> = new AudioSpeechOutput(
        (text, signal) =>
          withToken((token) =>
            synthesizeSpeech(token, latest.current.workspaceId ?? "", { text }, { signal }),
          ),
        () => ({
          volume: latest.current.device.volume,
          outputDeviceId: latest.current.device.outputDeviceId,
        }),
      );
      return output;
    }
    const output: SpeechOutput<SpeechSynthesisUtterance> = new BrowserSpeechOutput(() => ({
      rate: latest.current.settings.speaking_rate / 100,
      volume: latest.current.device.volume,
      language: language(true),
      voiceName: latest.current.device.browserVoice,
    }));
    return output;
  }

  function fail(message: string) {
    teardown();
    setError(message);
    setPhase("error");
    setMetrics((m) => ({ ...m, failures: m.failures + 1 }));
  }

  /** Release everything: microphone, audio graph, recognition, playback, the stream. */
  function teardown() {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;
    window.clearInterval(session.timer);
    session.recognizer?.stop();
    session.recorder?.discard();
    session.queue.cancel();
    session.meter.close();
    closeStream(session.stream);
    if (session.answering) latest.current.chat.stop();
  }

  function speak(session: Session, text: string) {
    if (latest.current.settings.auto_speak) session.queue.enqueue(text);
  }

  function settle(session: Session) {
    if (sessionRef.current !== session) return;
    if (session.answering || session.queue.busy) return;
    setPhase("listening");
    setPaused(false);
    if (session.awaiting) session.awaiting.armed = true;
  }

  /** The person spoke over Orbit: stop its audio and answer at once. */
  function interrupt() {
    const session = sessionRef.current;
    if (!session || (!session.answering && !session.queue.busy)) return;
    const started = performance.now();
    session.generation += 1;
    session.queue.cancel();
    if (session.answering) latest.current.chat.stop();
    session.answering = false;
    session.bargedIn = true;
    setMetrics((m) => ({ ...m, interruptMs: Math.round(performance.now() - started) }));
    setPaused(false);
    setPhase("interrupted");
  }

  async function answerConfirmation(session: Session, text: string, pending: Awaiting) {
    setPhase("processing");
    try {
      const result = await withToken((token) =>
        confirmByVoice(token, latest.current.workspaceId ?? "", {
          target: "proposal",
          id: pending.proposal.id,
          conversation_id: pending.conversationId,
          transcript: text,
          arguments_hash: null,
          timezone: latest.current.timezone,
        }),
      );
      if (sessionRef.current !== session) return;
      pending.tries += 1;
      let reply = result.message;
      if (result.outcome !== "unclear" || pending.tries >= MAX_CONFIRM_TRIES) {
        if (result.outcome === "unclear") reply = "I'll leave it on screen for you.";
        session.awaiting = null;
        setAwaiting(null);
      } else {
        pending.armed = false;
      }
      speak(session, reply);
      void queryClient.invalidateQueries({ queryKey: ["workspaces", latest.current.workspaceId] });
    } catch (caught) {
      if (sessionRef.current !== session) return;
      session.awaiting = null;
      setAwaiting(null);
      setNotice(describeApiError(caught, "Couldn’t check that reply. Use the buttons on screen."));
    }
    settle(session);
  }

  async function ask(session: Session, text: string) {
    const generation = ++session.generation;
    session.queue.cancel();
    if (session.answering) latest.current.chat.stop();
    await session.turn?.catch(() => undefined);
    if (sessionRef.current !== session || session.generation !== generation) return;
    setPhase("processing");
    session.answering = true;
    session.heardAudio = false;
    session.bargedIn = false;
    const asked = session.speechEndedAt ?? performance.now();
    const splitter = new SentenceSplitter();
    let first = true;
    const current = () => sessionRef.current === session && session.generation === generation;
    const turn = latest.current.chat.send(text, {
      inputMode: "voice",
      onEvent: (event) => {
        if (!current()) return;
        switch (event.type) {
          case "start":
            session.conversationId = event.data.conversation.id;
            break;
          case "delta":
            if (first) {
              first = false;
              setMetrics((m) => ({ ...m, responseMs: Math.round(performance.now() - asked) }));
            }
            for (const sentence of splitter.push(event.text)) speak(session, sentence);
            break;
          case "error":
            speak(session, "Sorry, I couldn't answer that.");
            break;
          case "done": {
            for (const sentence of splitter.flush()) speak(session, sentence);
            const prompt = proposalPrompt(event.data.proposals);
            const conversation = session.conversationId ?? latest.current.conversationId;
            if (prompt) {
              speak(session, prompt.text);
              if (prompt.awaiting && conversation) {
                session.awaiting = {
                  proposal: prompt.awaiting,
                  conversationId: conversation,
                  armed: !latest.current.settings.auto_speak,
                  tries: 0,
                };
                setAwaiting(prompt.awaiting);
              }
            }
            break;
          }
          default:
            break;
        }
      },
    });
    session.turn = turn;
    try {
      await turn;
    } catch {
      // `send` reports its own errors in the conversation.
    }
    if (!current()) return;
    session.answering = false;
    setMetrics((m) => ({ ...m, turns: m.turns + 1 }));
    settle(session);
  }

  async function handleUtterance(session: Session, raw: string) {
    const text = raw.trim();
    setPartial("");
    if (!text) {
      settle(session);
      return;
    }
    setHeard(text);
    const pending = session.awaiting;
    if (pending) {
      if (!pending.armed) return; // Spoken before Orbit finished asking: not an answer.
      await answerConfirmation(session, text, pending);
      return;
    }
    await ask(session, text);
  }

  async function transcribe(session: Session, audio: Blob): Promise<string | null> {
    if (audio.size < MIN_RECORDING_BYTES) return null;
    try {
      const result = await withToken((token) =>
        transcribeAudio(token, latest.current.workspaceId ?? "", audio),
      );
      return result.text;
    } catch (caught) {
      if (sessionRef.current === session) {
        setNotice(describeApiError(caught, "Couldn’t understand that. Try again."));
        setMetrics((m) => ({ ...m, failures: m.failures + 1 }));
      }
      return null;
    }
  }

  async function finishRecording(session: Session) {
    if (!session.recorder?.recording) return;
    session.speechEndedAt = performance.now();
    const audio = await session.recorder.stop();
    if (sessionRef.current !== session) return;
    setPhase("processing");
    const text = await transcribe(session, audio);
    if (sessionRef.current !== session) return;
    await handleUtterance(session, text ?? "");
  }

  function tick(session: Session) {
    if (sessionRef.current !== session) return;
    const now = performance.now();
    const rms = session.muted ? 0 : session.meter.read();
    setLevel(Math.min(1, rms * 8));
    if (session.muted) return;
    const event = session.vad.update(rms, now);
    const continuous = latest.current.settings.listening_mode === "continuous";
    if (event === "start") {
      session.speechStartedAt = now;
      if (continuous) {
        // Speaking while Orbit answers interrupts it (echo cancellation keeps its own voice out).
        interrupt();
        session.recorder?.start();
        setPhase("listening");
      }
    } else if (event === "end") {
      session.speechEndedAt = now;
      if (continuous && session.recorder) void finishRecording(session);
    } else if (
      continuous &&
      session.recorder?.recording &&
      session.speechStartedAt !== null &&
      now - session.speechStartedAt > MAX_UTTERANCE_MS
    ) {
      session.vad.reset();
      void finishRecording(session);
    }
  }

  function makeRecognizer(session: Session): BrowserRecognizer {
    return new BrowserRecognizer(language(false), {
      onPartial: (text) => {
        if (sessionRef.current !== session || session.muted) return;
        if (session.pushing) setDraft([session.pushText, text].filter(Boolean).join(" "));
        else setPartial(text);
      },
      onFinal: (text) => {
        if (sessionRef.current !== session || session.muted || !text) return;
        if (session.pushing) {
          session.pushText = [session.pushText, text].filter(Boolean).join(" ");
          setDraft(session.pushText);
          return;
        }
        // While Orbit speaks, recognition also hears it; only speech that interrupted counts.
        if (session.queue.busy && !session.bargedIn) return;
        session.speechEndedAt = performance.now();
        void handleUtterance(session, text);
      },
      onError: (message, fatal) => {
        if (sessionRef.current !== session) return;
        if (fatal) fail(message);
        else setNotice(message);
      },
    });
  }

  function attach(session: Session) {
    for (const track of session.stream.getAudioTracks()) {
      // The microphone was unplugged or taken away: get one back.
      track.addEventListener("ended", () => void reconnect(session));
    }
  }

  async function reconnect(session: Session, deviceId: string | null = null) {
    if (sessionRef.current !== session) return;
    setPhase("reconnecting");
    session.recorder?.discard();
    session.meter.close();
    closeStream(session.stream);
    try {
      const stream = await openMicrophone(deviceId);
      if (sessionRef.current !== session) {
        closeStream(stream);
        return;
      }
      session.stream = stream;
      session.meter = new LevelMeter(stream);
      session.vad.reset();
      if (session.recorder) session.recorder = new UtteranceRecorder(stream);
      for (const track of stream.getAudioTracks()) track.enabled = !session.muted;
      attach(session);
      settle(session);
    } catch (caught) {
      fail(microphoneError(caught));
    }
  }

  async function start() {
    if (sessionRef.current) return;
    setError(null);
    setNotice(null);
    setHeard(null);
    setDraft(null);
    setAwaiting(null);
    if (!support.microphone || !window.isSecureContext) {
      setError("Voice needs a microphone and a secure (https or localhost) page.");
      setPhase("error");
      return;
    }
    if (browserStt && !support.recognition) {
      setError(
        "This browser can't recognize speech. Choose a transcription provider in Settings → Voice.",
      );
      setPhase("error");
      return;
    }
    if (!browserStt && !support.recorder) {
      setError("This browser can't record audio.");
      setPhase("error");
      return;
    }
    setPhase("connecting");
    const started = performance.now();
    let stream: MediaStream;
    try {
      stream = await openMicrophone(latest.current.device.inputDeviceId);
    } catch (caught) {
      if (latest.current.device.inputDeviceId) {
        // The saved microphone is gone; fall back to the default one.
        try {
          stream = await openMicrophone(null);
        } catch (again) {
          fail(microphoneError(again));
          return;
        }
      } else {
        fail(microphoneError(caught));
        return;
      }
    }
    const session: Session = {
      stream,
      meter: new LevelMeter(stream),
      vad: new VoiceActivityDetector({
        sensitivity: settings.sensitivity,
        silenceMs: settings.silence_ms,
      }),
      queue: new SpeechQueue<unknown>(makeOutput(), {
        onStart: () => {
          if (sessionRef.current !== session) return;
          if (!session.heardAudio) {
            session.heardAudio = true;
            const from = session.speechEndedAt;
            if (from !== null) {
              setMetrics((m) => ({ ...m, firstAudioMs: Math.round(performance.now() - from) }));
            }
          }
          setPhase("speaking");
        },
        onIdle: () => settle(session),
        onError: () => {
          if (sessionRef.current === session) setNotice("Couldn’t play the spoken answer.");
        },
      }),
      recorder: browserStt ? null : new UtteranceRecorder(stream),
      recognizer: null,
      timer: 0,
      muted: false,
      answering: false,
      turn: null,
      generation: 0,
      conversationId: latest.current.conversationId,
      awaiting: null,
      speechStartedAt: null,
      speechEndedAt: null,
      heardAudio: false,
      bargedIn: false,
      pushing: false,
      pushText: "",
    };
    sessionRef.current = session;
    attach(session);
    if (browserStt && !pushToTalk) {
      session.recognizer = makeRecognizer(session);
      session.recognizer.start();
    }
    session.timer = window.setInterval(() => tick(session), TICK_MS);
    setMuted(false);
    setMetrics((m) => ({ ...m, connectMs: Math.round(performance.now() - started) }));
    setPhase("listening");
  }

  function end() {
    teardown();
    setPhase("idle");
    setLevel(0);
    setPartial("");
    setMuted(false);
    setPaused(false);
    setAwaiting(null);
    setDraft(null);
  }

  function setMicrophone(next: boolean) {
    const session = sessionRef.current;
    if (!session) return;
    session.muted = next;
    for (const track of session.stream.getAudioTracks()) track.enabled = !next;
    session.vad.reset();
    if (next) {
      session.recognizer?.stop();
      session.recorder?.discard();
    } else if (session.recognizer && !pushToTalk) {
      session.recognizer = makeRecognizer(session);
      session.recognizer.start();
    }
    setMuted(next);
    setPartial("");
  }

  function togglePause() {
    const session = sessionRef.current;
    if (!session) return;
    if (session.queue.paused) session.queue.resume();
    else session.queue.pause();
    setPaused(session.queue.paused);
  }

  /** Push-to-talk: listen while held. */
  function pressTalk() {
    const session = sessionRef.current;
    if (!session || session.muted || session.pushing) return;
    interrupt();
    session.pushing = true;
    session.pushText = "";
    setDraft("");
    setPhase("listening");
    if (session.recorder) session.recorder.start();
    else {
      session.recognizer = makeRecognizer(session);
      session.recognizer.start();
    }
  }

  /** Push-to-talk: released; the transcript waits in the draft for corrections. */
  async function releaseTalk() {
    const session = sessionRef.current;
    if (!session || !session.pushing) return;
    session.pushing = false;
    session.speechEndedAt = performance.now();
    if (session.recorder) {
      const audio = await session.recorder.stop();
      setPhase("processing");
      const text = await transcribe(session, audio);
      if (sessionRef.current !== session) return;
      setDraft(text ?? "");
      setPhase("listening");
      return;
    }
    // Give recognition a moment to deliver its final result.
    window.setTimeout(() => {
      session.recognizer?.stop();
      session.recognizer = null;
      if (sessionRef.current === session) setDraft((d) => d ?? session.pushText);
    }, 400);
  }

  function submitDraft() {
    const session = sessionRef.current;
    const text = draft?.trim();
    setDraft(null);
    if (session && text) void handleUtterance(session, text);
  }

  function setInputDevice(deviceId: string | null) {
    const session = sessionRef.current;
    if (session) void reconnect(session, deviceId);
  }

  // Release the microphone when the voice view goes away (navigation, sign-out, workspace).
  useEffect(() => () => teardown(), []);

  // A hidden tab stops listening; the person turns the microphone back on.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && sessionRef.current && !sessionRef.current.muted) {
        setMicrophone(true);
        setNotice("Microphone paused while this tab was in the background.");
      }
    };
    const onOffline = () => {
      if (sessionRef.current) setPhase("reconnecting");
    };
    const onOnline = () => {
      const session = sessionRef.current;
      if (session) settle(session);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  });

  return {
    phase,
    error,
    notice,
    dismissNotice: () => setNotice(null),
    level,
    partial,
    heard,
    draft,
    setDraft,
    submitDraft,
    muted,
    paused,
    awaiting,
    metrics,
    support,
    pushToTalk,
    start,
    end,
    interrupt,
    toggleMute: () => setMicrophone(!muted),
    togglePause,
    pressTalk,
    releaseTalk: () => void releaseTalk(),
    setInputDevice,
  };
}

export type VoiceConversation = ReturnType<typeof useVoiceConversation>;
