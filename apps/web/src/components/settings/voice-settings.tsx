"use client";

import type {
  UpdateVoiceSettingsRequest,
  VoiceSettings,
  VoiceSpeechEngine,
} from "@orbit/contracts";
import { AudioLines, Languages, Mic, ShieldCheck, Volume2, Waypoints } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import {
  PrivacyNote,
  SettingsCard,
  SettingsLoading,
  SettingsSwitch,
} from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ProcessingBadge } from "@/components/voice/voice-panel";
import {
  useClearVoiceHistory,
  useProviderVoices,
  useTestVoice,
  useUpdateVoiceSettings,
  useVoiceDevicePreference,
  useVoiceSettings,
} from "@/hooks/use-voice";
import { settingsHref, settingsSectionsClassName } from "@/lib/settings";
import {
  type AudioDevices,
  browserVoices,
  listAudioDevices,
  microphonePermission,
  voiceLanguages,
  voiceSupport,
} from "@/lib/voice";

const retentionOptions = [
  { value: "keep", label: "Until I delete them" },
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const silenceOptions = [
  { value: "600", label: "Short (0.6 s)" },
  { value: "900", label: "Normal (0.9 s)" },
  { value: "1400", label: "Long (1.4 s)" },
  { value: "2200", label: "Very long (2.2 s)" },
];

const rateOptions = [
  { value: "75", label: "Slower" },
  { value: "90", label: "A little slower" },
  { value: "100", label: "Normal" },
  { value: "115", label: "A little faster" },
  { value: "130", label: "Faster" },
];

function bodyOf(settings: VoiceSettings): UpdateVoiceSettingsRequest {
  return {
    stt_engine: settings.stt_engine,
    stt_provider_id: settings.stt_provider_id,
    stt_model: settings.stt_model,
    tts_engine: settings.tts_engine,
    tts_provider_id: settings.tts_provider_id,
    tts_model: settings.tts_model,
    tts_voice: settings.tts_voice,
    recognition_language: settings.recognition_language,
    response_language: settings.response_language,
    listening_mode: settings.listening_mode,
    silence_ms: settings.silence_ms,
    sensitivity: settings.sensitivity,
    auto_speak: settings.auto_speak,
    speaking_rate: settings.speaking_rate,
    history_days: settings.history_days,
  };
}

export function VoiceSettingsPanel() {
  const settings = useVoiceSettings();
  if (settings.status === "loading") {
    return <SettingsLoading label="Loading voice settings" className="h-96" />;
  }
  if (settings.status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {settings.message}
      </p>
    );
  }
  return <VoiceSettingsForm settings={settings.data} />;
}

/**
 * Settings that take effect at once. A provider engine is saved only once it has what it needs
 * (provider, model, and voice), so the draft for it is kept here until then.
 */
function VoiceSettingsForm({ settings }: { settings: VoiceSettings }) {
  const update = useUpdateVoiceSettings();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<UpdateVoiceSettingsRequest>(() => bodyOf(settings));
  const [support] = useState(voiceSupport);
  const providerOptions = settings.providers.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.processing === "local" ? "local" : "cloud"})`,
  }));

  const save = (change: Partial<UpdateVoiceSettingsRequest>) => {
    const next = { ...draft, ...change };
    setDraft(next);
    const sttReady = next.stt_engine === "browser" || (next.stt_provider_id && next.stt_model);
    const ttsReady =
      next.tts_engine === "browser" || (next.tts_provider_id && next.tts_model && next.tts_voice);
    if (!sttReady || !ttsReady) return; // Finish choosing first.
    setError(null);
    update.mutate(next, {
      onError: (cause) => setError(describeApiError(cause, "Couldn’t save voice settings.")),
    });
  };

  return (
    <div className={settingsSectionsClassName}>
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive [column-span:all]"
        >
          {error}
        </p>
      ) : null}
      {!settings.ai_enabled ? (
        <p role="status" className="rounded-xl border px-4 py-3 text-sm [column-span:all]">
          Voice talks to the assistant, so it needs AI turned on.{" "}
          <Link href={settingsHref("ai")} className="text-brand hover:underline">
            Set up AI
          </Link>
          .
        </p>
      ) : null}
      <ProviderCard settings={settings} draft={draft} options={providerOptions} onSave={save} />
      <InputCard draft={draft} onSave={save} supportsRecognition={support.recognition} />
      <OutputCard settings={settings} draft={draft} onSave={save} />
      <LanguageCard draft={draft} onSave={save} />
      <PrivacyCard draft={draft} onSave={save} />
    </div>
  );
}

type CardProps = {
  draft: UpdateVoiceSettingsRequest;
  onSave: (change: Partial<UpdateVoiceSettingsRequest>) => void;
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="text-xs text-pretty text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A text box saved when it loses focus. */
function SavedInput({
  id,
  value,
  placeholder,
  onCommit,
}: {
  id: string;
  value: string | null;
  placeholder: string;
  onCommit: (value: string | null) => void;
}) {
  const [text, setText] = useState(value ?? "");
  return (
    <Input
      id={id}
      value={text}
      placeholder={placeholder}
      maxLength={200}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = text.trim() || null;
        if (next !== value) onCommit(next);
      }}
    />
  );
}

function ProviderCard({
  settings,
  draft,
  options,
  onSave,
}: CardProps & { settings: VoiceSettings; options: { value: string; label: string }[] }) {
  const titleId = useId();
  const test = useTestVoice();
  const engineOptions: { value: VoiceSpeechEngine; label: string }[] = [
    { value: "browser", label: "This browser" },
  ];
  if (options.length) engineOptions.push({ value: "provider", label: "An AI provider" });
  return (
    <SettingsCard
      titleId={titleId}
      icon={Waypoints}
      title="Provider"
      description="Who turns speech into text and answers into speech."
      action={
        <div className="flex flex-wrap gap-1.5">
          <ProcessingBadge label="Hearing" processing={settings.stt_processing} />
          <ProcessingBadge label="Speaking" processing={settings.tts_processing} />
        </div>
      }
    >
      <div className="space-y-4">
        <Field
          label="Speech recognition"
          hint="Browser recognition is free and quick, but Chrome and Edge send audio to Google or Microsoft; Safari may keep it on the device. A provider (OpenAI, or a local Whisper server) follows your AI privacy settings."
        >
          {(id) => (
            <Select
              id={id}
              value={draft.stt_engine}
              options={engineOptions}
              onValueChange={(value) => onSave({ stt_engine: value })}
            />
          )}
        </Field>
        {draft.stt_engine === "provider" ? (
          <div className="grid gap-3 @lg/panel:grid-cols-2">
            <Field label="Transcription provider">
              {(id) => (
                <Select
                  id={id}
                  value={draft.stt_provider_id ?? ""}
                  placeholder="Choose a provider"
                  options={options}
                  onValueChange={(value) => onSave({ stt_provider_id: value })}
                />
              )}
            </Field>
            <Field
              label="Transcription model"
              hint="For example whisper-1, or your server's model."
            >
              {(id) => (
                <SavedInput
                  id={id}
                  value={draft.stt_model}
                  placeholder="Model name"
                  onCommit={(value) => onSave({ stt_model: value })}
                />
              )}
            </Field>
          </div>
        ) : null}
        <Field
          label="Spoken answers"
          hint="Browser voices are free; some are on the device and some are the vendor's cloud voices."
        >
          {(id) => (
            <Select
              id={id}
              value={draft.tts_engine}
              options={engineOptions}
              onValueChange={(value) => onSave({ tts_engine: value })}
            />
          )}
        </Field>
        {draft.tts_engine === "provider" ? (
          <div className="grid gap-3 @lg/panel:grid-cols-2">
            <Field label="Speech provider">
              {(id) => (
                <Select
                  id={id}
                  value={draft.tts_provider_id ?? ""}
                  placeholder="Choose a provider"
                  options={options}
                  onValueChange={(value) => onSave({ tts_provider_id: value, tts_voice: null })}
                />
              )}
            </Field>
            <Field label="Speech model" hint="For example tts-1, or your server's model.">
              {(id) => (
                <SavedInput
                  id={id}
                  value={draft.tts_model}
                  placeholder="Model name"
                  onCommit={(value) => onSave({ tts_model: value })}
                />
              )}
            </Field>
            <ProviderVoice draft={draft} onSave={onSave} />
          </div>
        ) : null}
        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            To use a provider, add an OpenAI or OpenAI-compatible server in{" "}
            <Link href={settingsHref("ai")} className="text-brand hover:underline">
              AI settings
            </Link>
            .
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="soft" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? "Testing…" : "Test connection"}
          </Button>
          {test.data ? (
            <p role="status" className={test.data.ok ? "text-sm" : "text-sm text-destructive"}>
              {test.data.message}
              {test.data.speech_ms !== null ? ` Speech ${test.data.speech_ms} ms.` : ""}
              {test.data.transcription_ms !== null
                ? ` Transcription ${test.data.transcription_ms} ms.`
                : ""}
            </p>
          ) : test.error ? (
            <p role="alert" className="text-sm text-destructive">
              {describeApiError(test.error, "The test couldn’t run.")}
            </p>
          ) : null}
        </div>
      </div>
    </SettingsCard>
  );
}

function ProviderVoice({ draft, onSave }: CardProps) {
  const voices = useProviderVoices(draft.tts_provider_id);
  const listed = voices.status === "success" ? voices.data.voices : [];
  return (
    <Field
      label="Voice"
      hint={
        listed.length ? undefined : "This provider doesn't list its voices; type one it offers."
      }
    >
      {(id) =>
        listed.length ? (
          <Select
            id={id}
            value={draft.tts_voice ?? ""}
            placeholder="Choose a voice"
            options={listed.map((v) => ({ value: v.id, label: v.name }))}
            onValueChange={(value) => onSave({ tts_voice: value })}
          />
        ) : (
          <SavedInput
            key={draft.tts_provider_id ?? "none"}
            id={id}
            value={draft.tts_voice}
            placeholder="Voice name"
            onCommit={(value) => onSave({ tts_voice: value })}
          />
        )
      }
    </Field>
  );
}

function InputCard({
  draft,
  onSave,
  supportsRecognition,
}: CardProps & { supportsRecognition: boolean }) {
  const titleId = useId();
  const [device, setDevice] = useVoiceDevicePreference();
  const [devices, setDevices] = useState<AudioDevices>({ inputs: [], outputs: [] });
  const [permission, setPermission] = useState<string>("unknown");
  useEffect(() => {
    let active = true;
    void microphonePermission().then((state) => active && setPermission(state));
    void listAudioDevices()
      .then((found) => active && setDevices(found))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const permissionText =
    permission === "granted"
      ? "Allowed"
      : permission === "denied"
        ? "Blocked: allow it in your browser's site settings"
        : "Asked the first time you start voice";
  return (
    <SettingsCard
      titleId={titleId}
      icon={Mic}
      title="Input"
      description="How Orbit listens. The microphone is only on during a voice conversation."
    >
      <div className="space-y-4">
        <p className="text-sm">
          <span className="font-medium">Microphone permission:</span> {permissionText}
        </p>
        <Field label="Microphone" hint="Saved for this browser.">
          {(id) => (
            <Select
              id={id}
              value={device.inputDeviceId ?? "default"}
              options={[
                { value: "default", label: "System default" },
                ...devices.inputs
                  .filter((d) => d.deviceId && d.deviceId !== "default")
                  .map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
              ]}
              onValueChange={(value) =>
                setDevice({ inputDeviceId: value === "default" ? null : value })
              }
            />
          )}
        </Field>
        <Field
          label="Listening"
          hint="Continuous: speak naturally and interrupt any time. Push to talk: hold a button, then check the text before sending."
        >
          {(id) => (
            <Select
              id={id}
              value={draft.listening_mode}
              options={[
                { value: "continuous", label: "Continuous conversation" },
                { value: "push_to_talk", label: "Push to talk" },
              ]}
              onValueChange={(value) => onSave({ listening_mode: value })}
            />
          )}
        </Field>
        <div className="grid gap-3 @lg/panel:grid-cols-2">
          <Field label="End of speech after" hint="The pause that means you've finished.">
            {(id) => (
              <Select
                id={id}
                value={String(draft.silence_ms)}
                placeholder={`${draft.silence_ms} ms`}
                options={silenceOptions}
                onValueChange={(value) => onSave({ silence_ms: Number(value) })}
              />
            )}
          </Field>
          <Field label="Sensitivity" hint="Higher hears quieter speech, and more background noise.">
            {(id) => (
              <Select
                id={id}
                value={String(draft.sensitivity)}
                options={Array.from({ length: 10 }, (_, i) => ({
                  value: String(i + 1),
                  label: i + 1 === 5 ? "5 (default)" : String(i + 1),
                }))}
                onValueChange={(value) => onSave({ sensitivity: Number(value) })}
              />
            )}
          </Field>
        </div>
        {!supportsRecognition && draft.stt_engine === "browser" ? (
          <p className="text-xs text-destructive">
            This browser can’t recognize speech itself. Choose a provider for recognition.
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}

function OutputCard({ settings, draft, onSave }: CardProps & { settings: VoiceSettings }) {
  const titleId = useId();
  const [device, setDevice] = useVoiceDevicePreference();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [support] = useState(voiceSupport);
  useEffect(() => {
    if (!support.synthesis) return;
    const load = () => setVoices(browserVoices());
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    void listAudioDevices()
      .then((found) => setOutputs(found.outputs))
      .catch(() => undefined);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", load);
  }, [support.synthesis]);
  return (
    <SettingsCard
      titleId={titleId}
      icon={Volume2}
      title="Output"
      description="How Orbit answers out loud."
    >
      <div className="space-y-4">
        <SettingsSwitch
          label="Speak answers"
          hint="Off: answers appear as text while you keep talking."
          checked={draft.auto_speak}
          onCheckedChange={(checked) => onSave({ auto_speak: checked })}
        />
        <Field label="Speaking speed">
          {(id) => (
            <Select
              id={id}
              value={String(draft.speaking_rate)}
              placeholder={`${draft.speaking_rate}%`}
              options={rateOptions}
              onValueChange={(value) => onSave({ speaking_rate: Number(value) })}
            />
          )}
        </Field>
        <Field label="Volume" hint="Saved for this browser.">
          {(id) => (
            <input
              id={id}
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(device.volume * 100)}
              onChange={(event) => setDevice({ volume: Number(event.target.value) / 100 })}
              className="w-full accent-brand outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
        </Field>
        {settings.tts_engine === "browser" && voices.length ? (
          <Field
            label="Browser voice"
            hint="Saved for this browser. “Cloud” voices are your browser vendor's."
          >
            {(id) => (
              <Select
                id={id}
                value={device.browserVoice ?? "default"}
                options={[
                  { value: "default", label: "Browser default" },
                  ...voices.map((v) => ({
                    value: v.name,
                    label: `${v.name} (${v.lang}${v.localService ? "" : ", cloud"})`,
                  })),
                ]}
                onValueChange={(value) =>
                  setDevice({ browserVoice: value === "default" ? null : value })
                }
              />
            )}
          </Field>
        ) : null}
        {support.outputSelection && outputs.length > 1 ? (
          <Field label="Speaker" hint="Saved for this browser. Applies to provider voices.">
            {(id) => (
              <Select
                id={id}
                value={device.outputDeviceId ?? "default"}
                options={[
                  { value: "default", label: "System default" },
                  ...outputs
                    .filter((d) => d.deviceId && d.deviceId !== "default")
                    .map((d, i) => ({ value: d.deviceId, label: d.label || `Speaker ${i + 1}` })),
                ]}
                onValueChange={(value) =>
                  setDevice({ outputDeviceId: value === "default" ? null : value })
                }
              />
            )}
          </Field>
        ) : null}
      </div>
    </SettingsCard>
  );
}

function LanguageCard({ draft, onSave }: CardProps) {
  const titleId = useId();
  return (
    <SettingsCard
      titleId={titleId}
      icon={Languages}
      title="Language"
      description="Indian English, Hindi, and mixed speech are supported where the engine allows."
    >
      <div className="space-y-4">
        <Field
          label="Recognition language"
          hint="Detect automatically handles switching between Hindi and English best with Whisper."
        >
          {(id) => (
            <Select
              id={id}
              value={draft.recognition_language}
              placeholder={draft.recognition_language}
              options={voiceLanguages}
              onValueChange={(value) => onSave({ recognition_language: value })}
            />
          )}
        </Field>
        <Field
          label="Spoken answer language"
          hint="The voice's language; answers follow your question."
        >
          {(id) => (
            <Select
              id={id}
              value={draft.response_language ?? "auto"}
              options={[
                { value: "auto", label: "Same as recognition" },
                ...voiceLanguages.filter((l) => l.value !== "auto"),
              ]}
              onValueChange={(value) =>
                onSave({ response_language: value === "auto" ? null : value })
              }
            />
          )}
        </Field>
      </div>
    </SettingsCard>
  );
}

function PrivacyCard({ draft, onSave }: CardProps) {
  const titleId = useId();
  const clear = useClearVoiceHistory();
  const { confirm, confirmDialog } = useConfirm();
  return (
    <SettingsCard
      titleId={titleId}
      icon={ShieldCheck}
      title="Privacy"
      description="What's kept from voice conversations."
    >
      <div className="space-y-4">
        <PrivacyNote>
          Orbit never records or stores audio. What you say is kept only as text, in the
          conversation it belongs to, like a typed question.
        </PrivacyNote>
        <Field
          label="Keep spoken conversations"
          hint="Conversations with a spoken question are deleted this long after their last message. Typed-only conversations stay until you delete them."
        >
          {(id) => (
            <Select
              id={id}
              value={draft.history_days === null ? "keep" : String(draft.history_days)}
              placeholder={`${draft.history_days} days`}
              options={retentionOptions}
              onValueChange={(value) =>
                onSave({ history_days: value === "keep" ? null : Number(value) })
              }
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="destructive"
            size="sm"
            disabled={clear.isPending}
            onClick={() =>
              void confirm({
                title: "Delete spoken conversations?",
                description:
                  "Conversations in this workspace with a spoken question are deleted, with their answers. This can't be undone.",
                confirmLabel: "Delete",
                destructive: true,
              }).then((yes) => yes && clear.mutate())
            }
          >
            <AudioLines aria-hidden="true" />
            Clear voice history
          </Button>
          {clear.data ? (
            <p role="status" className="text-sm text-muted-foreground">
              Deleted {clear.data.removed} conversation{clear.data.removed === 1 ? "" : "s"}.
            </p>
          ) : null}
        </div>
      </div>
      {confirmDialog}
    </SettingsCard>
  );
}
