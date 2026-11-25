"use client";

import type { VoiceSettings } from "@orbit/contracts";
import {
  CircleAlert,
  Cloud,
  Hand,
  HardDrive,
  Keyboard,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneOff,
  Play,
  Send,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useVoiceDevicePreference } from "@/hooks/use-voice";
import { useVoiceConversation, type VoiceChat } from "@/hooks/use-voice-conversation";
import { settingsHref } from "@/lib/settings";
import {
  type AudioDevices,
  isLive,
  listAudioDevices,
  voicePhaseHints,
  voicePhaseLabels,
} from "@/lib/voice";

import { VoiceOrb } from "./voice-orb";

/** Where each half of voice runs, so it's always clear what leaves the device. */
export function ProcessingBadge({
  label,
  processing,
}: {
  label: string;
  processing: VoiceSettings["stt_processing"];
}) {
  const Icon = processing === "cloud" ? Cloud : HardDrive;
  const text =
    processing === "browser"
      ? "in this browser"
      : processing === "local"
        ? "on your server"
        : processing === "cloud"
          ? "in the cloud"
          : "not set up";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
      <Icon className="size-3" aria-hidden="true" />
      {label} {text}
    </span>
  );
}

function deviceOptions(devices: MediaDeviceInfo[], fallback: string) {
  return [
    { value: "default", label: "System default" },
    ...devices
      .filter((d) => d.deviceId && d.deviceId !== "default")
      .map((d, index) => ({ value: d.deviceId, label: d.label || `${fallback} ${index + 1}` })),
  ];
}

/**
 * The voice conversation, in place of the composer. It speaks through the same chat as typing:
 * questions and answers land in the open conversation, so switching back to text loses nothing.
 */
export function VoicePanel({
  settings,
  conversationId,
  chat,
  onUseText,
}: {
  settings: VoiceSettings;
  conversationId: string | null;
  chat: VoiceChat;
  onUseText: () => void;
}) {
  const voice = useVoiceConversation({ settings, conversationId, chat });
  const [device, setDevice] = useVoiceDevicePreference();
  const [devices, setDevices] = useState<AudioDevices>({ inputs: [], outputs: [] });
  const live = isLive(voice.phase);

  // Device names appear once the microphone is allowed; refresh them when devices change.
  useEffect(() => {
    if (!live || !navigator.mediaDevices) return;
    let active = true;
    const refresh = () =>
      void listAudioDevices().then((found) => {
        if (active) setDevices(found);
      });
    refresh();
    const media = navigator.mediaDevices;
    media.addEventListener?.("devicechange", refresh);
    return () => {
      active = false;
      media.removeEventListener?.("devicechange", refresh);
    };
  }, [live]);

  const busy = voice.phase === "speaking" || voice.phase === "processing";
  const status = voice.muted && live ? "Microphone off" : voicePhaseLabels[voice.phase];
  const hint =
    voice.phase === "error"
      ? voice.error
      : voice.muted && live
        ? "Turn the microphone on to keep talking."
        : voice.pushToTalk && voice.phase === "listening"
          ? "Hold the talk button (or Space) while you speak."
          : voicePhaseHints[voice.phase];

  return (
    <section
      aria-label="Voice conversation"
      className="rounded-3xl border bg-card p-4 shadow-elevation-2"
      onKeyDown={(event) => {
        if (!voice.pushToTalk || !live || event.code !== "Space" || event.repeat) return;
        if (event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        voice.pressTalk();
      }}
      onKeyUp={(event) => {
        if (!voice.pushToTalk || event.code !== "Space") return;
        if (event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        voice.releaseTalk();
      }}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <VoiceOrb phase={voice.phase} level={voice.level} muted={voice.muted} />
        <div role="status" aria-live="polite" className="space-y-1">
          <p className="text-base font-semibold" data-phase={voice.phase}>
            {status}
          </p>
          {hint ? (
            <p
              className={
                voice.phase === "error"
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {hint}
            </p>
          ) : null}
        </div>
        {voice.partial || voice.heard ? (
          <p className="max-w-prose text-sm text-pretty" aria-live="polite">
            <span className="sr-only">You said: </span>
            <span className={voice.partial ? "text-muted-foreground italic" : undefined}>
              “{voice.partial || voice.heard}”
            </span>
          </p>
        ) : null}
        {voice.awaiting ? (
          <p className="max-w-prose rounded-xl border bg-brand-subtle/50 px-3 py-2 text-sm">
            Waiting for a yes or no: <span className="font-medium">{voice.awaiting.summary}</span>.
            You can also use the buttons on the proposal.
          </p>
        ) : null}
        {voice.notice ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-warning/40 px-3 py-2 text-left text-sm"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <span className="flex-1">{voice.notice}</span>
            <button
              type="button"
              className="rounded text-xs text-muted-foreground underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={voice.dismissNotice}
            >
              Dismiss
            </button>
          </p>
        ) : null}
      </div>

      {voice.pushToTalk && voice.draft !== null && live ? (
        <form
          className="mt-4 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            voice.submitDraft();
          }}
        >
          <label htmlFor="voice-draft" className="text-sm font-medium">
            Check what was heard, then send
          </label>
          <Textarea
            id="voice-draft"
            value={voice.draft}
            onChange={(event) => voice.setDraft(event.target.value)}
            rows={2}
            maxLength={4000}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => voice.setDraft(null)}>
              Discard
            </Button>
            <Button type="submit" size="sm" disabled={!voice.draft.trim()}>
              <Send aria-hidden="true" />
              Send
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {!live ? (
          <Button onClick={() => void voice.start()}>
            <Phone aria-hidden="true" />
            {voice.phase === "error" ? "Try again" : "Start voice"}
          </Button>
        ) : (
          <>
            {voice.pushToTalk ? (
              <Button
                aria-label="Hold to talk"
                disabled={voice.muted}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  voice.pressTalk();
                }}
                onPointerUp={voice.releaseTalk}
                onPointerCancel={voice.releaseTalk}
              >
                <Mic aria-hidden="true" />
                Hold to talk
              </Button>
            ) : null}
            <Button variant="soft" aria-pressed={voice.muted} onClick={voice.toggleMute}>
              {voice.muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
              {voice.muted ? "Turn microphone on" : "Mute"}
            </Button>
            <Button variant="ghost" onClick={voice.interrupt} disabled={!busy}>
              <Hand aria-hidden="true" />
              Interrupt
            </Button>
            <Button
              variant="ghost"
              onClick={voice.togglePause}
              disabled={voice.phase !== "speaking"}
              aria-pressed={voice.paused}
            >
              {voice.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              {voice.paused ? "Resume" : "Pause"}
            </Button>
            <Button variant="destructive" onClick={voice.end}>
              <PhoneOff aria-hidden="true" />
              End
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            voice.end();
            onUseText();
          }}
        >
          <Keyboard aria-hidden="true" />
          Type instead
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 border-t pt-3">
        <ProcessingBadge label="Hearing" processing={settings.stt_processing} />
        <ProcessingBadge label="Speaking" processing={settings.tts_processing} />
        <span className="text-xs text-muted-foreground">Audio is never stored.</span>
        <Link
          href={settingsHref("voice")}
          className="inline-flex items-center gap-1 rounded text-xs text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings2 className="size-3" aria-hidden="true" />
          Voice settings
        </Link>
      </div>

      {live &&
      (devices.inputs.length > 1 ||
        (voice.support.outputSelection && devices.outputs.length > 1)) ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {devices.inputs.length > 1 ? (
            <Select
              aria-label="Microphone"
              value={device.inputDeviceId ?? "default"}
              options={deviceOptions(devices.inputs, "Microphone")}
              onValueChange={(value) => {
                const id = value === "default" ? null : value;
                setDevice({ inputDeviceId: id });
                voice.setInputDevice(id);
              }}
            />
          ) : null}
          {voice.support.outputSelection && devices.outputs.length > 1 ? (
            <Select
              aria-label="Speaker"
              value={device.outputDeviceId ?? "default"}
              options={deviceOptions(devices.outputs, "Speaker")}
              onValueChange={(value) =>
                setDevice({ outputDeviceId: value === "default" ? null : value })
              }
            />
          ) : null}
        </div>
      ) : null}

      {voice.metrics.turns > 0 ? (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Response times on this device
          </summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <Metric label="Microphone ready" value={voice.metrics.connectMs} />
            <Metric label="First words" value={voice.metrics.responseMs} />
            <Metric label="First audio" value={voice.metrics.firstAudioMs} />
            <Metric label="Interruption" value={voice.metrics.interruptMs} />
            <dt>Turns</dt>
            <dd>{voice.metrics.turns}</dd>
            <dt>Failures</dt>
            <dd>{voice.metrics.failures}</dd>
          </dl>
        </details>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value === null ? "—" : `${value} ms`}</dd>
    </>
  );
}
