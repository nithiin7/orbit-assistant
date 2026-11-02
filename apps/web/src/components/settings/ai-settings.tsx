"use client";

import type { AiProvider, AiSettings, UpdateAiSettingsRequest } from "@orbit/contracts";
import {
  ArrowRight,
  Bot,
  Check,
  Cloud,
  Cpu,
  DatabaseZap,
  Gauge,
  HardDrive,
  KeyRound,
  type LucideIcon,
  Plug,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useAiIndex,
  useAiModels,
  useAiProviders,
  useAiSettings,
  useAiUsage,
  useProviderMutations,
  useUpdateAiSettings,
} from "@/hooks/use-ai";
import { AI_MODULES, processingLabel, PROVIDER_KINDS, RESPONSE_STYLES } from "@/lib/ai";
import { cn } from "@/utils/common";

import { ProviderForm } from "./ai-provider-form";

const NONE = "";

/**
 * AI settings, in the order someone sets AI up: a status card with the remaining setup steps,
 * then providers, models, privacy, answers and limits, the search index, and usage. Each change
 * saves at once.
 */
export function AiSettingsPanel() {
  const settings = useAiSettings();
  const providers = useAiProviders();
  const update = useUpdateAiSettings();
  const [error, setError] = useState<string | null>(null);

  if (settings.status === "loading" || providers.status === "loading") {
    return (
      <div aria-busy="true" className="space-y-4">
        <span className="sr-only">Loading AI settings…</span>
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }
  if (settings.status === "error" || providers.status === "error") {
    const message =
      settings.status === "error"
        ? settings.message
        : providers.status === "error"
          ? providers.message
          : "";
    return (
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
    );
  }

  const current = settings.data;
  const list = providers.data.providers;

  if (!current.server_enabled) {
    return (
      <div role="status" className="flex gap-3 rounded-2xl border bg-card p-5 shadow-elevation-1">
        <IconTile icon={Bot} muted />
        <div className="space-y-1">
          <p className="text-sm font-semibold">AI is turned off on this Orbit server</p>
          <p className="text-sm text-pretty text-muted-foreground">
            The person who runs this server has disabled it (
            <code className="font-mono text-xs">ORBIT_AI_ENABLED</code>
            ). The rest of Orbit works as usual.
          </p>
        </div>
      </div>
    );
  }

  const save = (body: UpdateAiSettingsRequest) => {
    setError(null);
    update.mutate(body, {
      onError: (cause) => setError(describeApiError(cause, "Couldn’t save AI settings.")),
    });
  };

  return (
    <div className="space-y-6">
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}
      <Overview settings={current} providers={list} onSave={save} />
      <Providers providers={list} settings={current} />
      <Models settings={current} providers={list} onSave={save} />
      <Privacy settings={current} providers={list} onSave={save} />
      <AnswersAndLimits settings={current} onSave={save} />
      <Indexing settings={current} onSave={save} />
      <Usage />
    </div>
  );
}

// ─── Layout pieces ──────────────────────────────────────────────────────────────────────────────

function IconTile({ icon: Icon, muted = false }: { icon: LucideIcon; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl",
        muted ? "bg-muted text-muted-foreground" : "bg-brand-subtle text-brand",
      )}
    >
      <Icon className="size-4.5" />
    </span>
  );
}

/** A settings card: an icon, a title, one line on what it's for, then its controls. */
function Section({
  id,
  icon,
  title,
  description,
  action,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 rounded-2xl border bg-card shadow-elevation-1"
    >
      <header className="flex flex-wrap items-start gap-3 border-b px-4 py-4 sm:px-5">
        <IconTile icon={icon} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 id={`${id}-title`} className="text-base font-semibold">
            {title}
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">{description}</p>
        </div>
        {action}
      </header>
      <div className="space-y-5 px-4 py-5 sm:px-5">{children}</div>
    </section>
  );
}

/** A labelled on/off setting with a sentence on what it does. */
function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p id={`${id}-description`} className="text-xs text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={`${id}-description`}
      />
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────────────────────────

/** Whether AI is on, what answers questions and where, and what's left to set up. */
function Overview({
  settings,
  providers,
  onSave,
}: {
  settings: AiSettings;
  providers: AiProvider[];
  onSave: (body: UpdateAiSettingsRequest) => void;
}) {
  const id = useId();
  const chat = providers.find((p) => p.id === settings.chat_provider_id);
  const hasModel = chat !== undefined && settings.chat_model !== null;
  const ready = settings.enabled && hasModel;
  const steps = [
    {
      done: providers.length > 0,
      label: "Connect a provider",
      hint: "A local one, like Ollama, keeps everything on your machine.",
      href: "#ai-providers",
    },
    {
      done: hasModel,
      label: "Choose a model for answers",
      hint: "Pick which of the provider’s models writes answers.",
      href: "#ai-models",
    },
    {
      done: settings.enabled,
      label: "Turn on AI",
      hint: "Use the switch at the top. You can turn it off at any time.",
      href: null,
    },
  ];

  const status = ready
    ? `Answers come from ${chat.name} · ${settings.chat_model}, ${
        chat.processing === "local" ? "on this device or your network" : "a cloud provider"
      }.`
    : settings.enabled
      ? "On, but it needs a provider and model before it can answer."
      : "Off. No AI feature runs, and nothing is sent anywhere.";

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="overflow-hidden rounded-2xl border bg-card shadow-elevation-1"
    >
      <div className="flex items-start gap-4 p-4 sm:p-5">
        <IconTile icon={Bot} muted={!settings.enabled} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`${id}-title`} className="text-base font-semibold">
              <label htmlFor={`${id}-switch`}>Use AI in Orbit</label>
            </h2>
            <Badge variant={ready ? "brand" : "default"}>
              {ready ? "Ready" : settings.enabled ? "Needs setup" : "Off"}
            </Badge>
          </div>
          <p id={`${id}-status`} className="text-sm text-pretty text-muted-foreground">
            {status}
          </p>
        </div>
        <Switch
          id={`${id}-switch`}
          checked={settings.enabled}
          onCheckedChange={(enabled) => onSave({ enabled })}
          aria-describedby={`${id}-status`}
          className="mt-1.5"
        />
      </div>
      {ready ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3 sm:px-5">
          <p className="text-xs text-muted-foreground">
            Changes on this page save as you make them.
          </p>
          <Link
            href="/assistant"
            className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open the assistant
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3 border-t bg-muted/30 px-4 py-4 sm:px-5">
          <p className="text-sm font-medium">Get started in three steps</p>
          <ol className="space-y-2.5">
            {steps.map((step, index) => (
              <li key={step.label} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    step.done
                      ? "bg-success/15 text-success"
                      : "border bg-card text-muted-foreground",
                  )}
                >
                  {step.done ? <Check className="size-3.5" /> : index + 1}
                </span>
                <div className="min-w-0 space-y-0.5">
                  <p className={cn("text-sm", step.done && "text-muted-foreground line-through")}>
                    {step.href && !step.done ? (
                      <a
                        href={step.href}
                        className="font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {step.label}
                      </a>
                    ) : (
                      <span className="font-medium">{step.label}</span>
                    )}
                    <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                  </p>
                  {step.done ? null : <p className="text-xs text-muted-foreground">{step.hint}</p>}
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            Changes on this page save as you make them.
          </p>
        </div>
      )}
    </section>
  );
}

// ─── Providers ──────────────────────────────────────────────────────────────────────────────────

function Providers({ providers, settings }: { providers: AiProvider[]; settings: AiSettings }) {
  const [editing, setEditing] = useState<AiProvider | "new" | null>(
    providers.length ? null : "new",
  );
  const { remove } = useProviderMutations();
  const { confirm, confirmDialog } = useConfirm();

  /** What each provider is used for, so it's clear which one matters. */
  const roles = (provider: AiProvider) =>
    [
      settings.chat_provider_id === provider.id && "Answers",
      settings.embedding_provider_id === provider.id && "Search",
      settings.fallback_provider_id === provider.id && "Fallback",
    ].filter((role): role is string => Boolean(role));

  return (
    <Section
      id="ai-providers"
      icon={Plug}
      title="Providers"
      description="Where AI runs. A local provider (Ollama, LM Studio) keeps everything on your machine; a cloud provider receives questions and the records needed to answer them, and only if you allow it under Privacy."
      action={
        editing === null ? (
          <Button variant="soft" size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            Add provider
          </Button>
        ) : null
      }
    >
      {editing === "new" ? <ProviderForm onDone={() => setEditing(null)} /> : null}
      {providers.length ? (
        <ul className="divide-y rounded-xl border">
          {providers.map((provider) =>
            editing !== "new" && editing?.id === provider.id ? (
              <li key={provider.id} className="p-2">
                <ProviderForm provider={provider} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={provider.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    provider.processing === "local"
                      ? "bg-success/10 text-success"
                      : "bg-brand-subtle text-brand",
                  )}
                >
                  {provider.processing === "local" ? (
                    <HardDrive className="size-4" />
                  ) : (
                    <Cloud className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-medium">{provider.name}</p>
                    {roles(provider).map((role) => (
                      <Badge key={role} variant="brand">
                        {role}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {PROVIDER_KINDS.find((k) => k.value === provider.kind)?.label} ·{" "}
                    {processingLabel(provider.processing)}
                    {provider.has_api_key ? (
                      <>
                        {" · "}
                        <KeyRound className="inline size-3" aria-hidden="true" /> key stored
                      </>
                    ) : null}
                    {provider.capabilities.embeddings ? "" : " · no embeddings"}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(provider)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() =>
                      void confirm({
                        title: `Delete ${provider.name}?`,
                        description:
                          "Its stored key is deleted, and settings that use it are cleared.",
                        confirmLabel: "Delete",
                        destructive: true,
                      }).then((yes) => yes && remove.mutate(provider.id))
                    }
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      ) : editing === null ? (
        <p className="text-sm text-muted-foreground">No providers yet. Add one to start.</p>
      ) : null}
      {confirmDialog}
    </Section>
  );
}

// ─── Models ─────────────────────────────────────────────────────────────────────────────────────

function Models({
  settings,
  providers,
  onSave,
}: {
  settings: AiSettings;
  providers: AiProvider[];
  onSave: (body: UpdateAiSettingsRequest) => void;
}) {
  const embedders = providers.filter((p) => p.capabilities.embeddings);
  return (
    <Section
      id="ai-models"
      icon={Cpu}
      title="Models"
      description="Which model does which job. Only answers need a model; the others are optional."
    >
      {providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add a provider above, then choose its models here.
        </p>
      ) : (
        <div className="divide-y">
          <ModelChoice
            label="Answers"
            required
            hint="Writes the assistant’s answers and the AI actions in each module."
            providers={providers}
            providerId={settings.chat_provider_id}
            model={settings.chat_model}
            want="chat"
            onSave={(provider, model) => onSave({ chat_provider_id: provider, chat_model: model })}
          />
          <ModelChoice
            label="Semantic search (embeddings)"
            hint="Finds records by meaning. Without it, search matches keywords only."
            providers={embedders}
            providerId={settings.embedding_provider_id}
            model={settings.embedding_model}
            want="embeddings"
            onSave={(provider, model) =>
              onSave({ embedding_provider_id: provider, embedding_model: model })
            }
          />
          <ModelChoice
            label="Fallback"
            hint="Used only when the answers provider can’t be reached. Orbit never switches providers unless you choose one here."
            providers={providers}
            providerId={settings.fallback_provider_id}
            model={settings.fallback_model}
            want="chat"
            onSave={(provider, model) =>
              onSave({ fallback_provider_id: provider, fallback_model: model })
            }
          />
        </div>
      )}
    </Section>
  );
}

function ModelChoice({
  label,
  required = false,
  hint,
  providers,
  providerId,
  model,
  want,
  onSave,
}: {
  label: string;
  required?: boolean;
  hint: string;
  providers: AiProvider[];
  providerId: string | null;
  model: string | null;
  want: "chat" | "embeddings";
  onSave: (providerId: string | null, model: string | null) => void;
}) {
  const id = useId();
  const models = useAiModels(providerId);
  const [typed, setTyped] = useState(model ?? "");
  const listed =
    models.status === "success"
      ? models.data.models.filter((m) => (want === "chat" ? m.chat : m.embeddings)).map((m) => m.id)
      : [];
  const options = [...new Set([...(model ? [model] : []), ...listed])];
  return (
    <fieldset className="space-y-2.5 py-4 first:pt-0 last:pb-0" aria-describedby={`${id}-hint`}>
      <legend className="float-left flex w-full items-center gap-2 text-sm font-medium">
        {label}
        <Badge variant={required ? "brand" : "outline"}>{required ? "Required" : "Optional"}</Badge>
      </legend>
      <p id={`${id}-hint`} className="clear-left text-xs text-pretty text-muted-foreground">
        {hint}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          aria-label={`${label}: provider`}
          value={providerId ?? NONE}
          onValueChange={(value) => onSave(value || null, null)}
          options={[
            { value: NONE, label: required ? "Choose a provider" : "Not used" },
            ...providers.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        {providerId === null ? null : models.status === "success" && options.length ? (
          <Select
            aria-label={`${label}: model`}
            value={model ?? NONE}
            placeholder="Choose a model"
            onValueChange={(value) => onSave(providerId, value || null)}
            options={options.map((value) => ({ value, label: value }))}
          />
        ) : (
          <div className="flex gap-2">
            <Input
              aria-label={`${label}: model name`}
              value={typed}
              placeholder={models.status === "loading" ? "Loading models…" : "Model name"}
              onChange={(event) => setTyped(event.target.value)}
            />
            <Button variant="outline" onClick={() => onSave(providerId, typed.trim() || null)}>
              Save
            </Button>
          </div>
        )}
      </div>
      {models.status === "error" && providerId ? (
        <p className="text-xs text-muted-foreground">
          Couldn’t list models ({models.message}). Type the model’s name instead.
        </p>
      ) : null}
    </fieldset>
  );
}

// ─── Privacy ────────────────────────────────────────────────────────────────────────────────────

function Privacy({
  settings,
  providers,
  onSave,
}: {
  settings: AiSettings;
  providers: AiProvider[];
  onSave: (body: UpdateAiSettingsRequest) => void;
}) {
  const chat = providers.find((p) => p.id === settings.chat_provider_id);
  const toggleModule = (module: AiSettings["modules"][number], on: boolean) => {
    const next = new Set(settings.modules);
    if (on) next.add(module);
    else next.delete(module);
    onSave({ modules: [...next] });
  };
  const everyday = AI_MODULES.filter((m) => !m.sensitive);
  const sensitive = AI_MODULES.filter((m) => m.sensitive);
  const where = chat
    ? chat.processing === "local"
      ? `Answers are generated by ${chat.name}, on this device or your network.`
      : `Answers are generated by ${chat.name}, a cloud provider: your question and the records needed to answer it are sent to it.`
    : "Choose a provider for answers to see where your data is processed.";
  const WhereIcon = chat?.processing === "cloud" ? Cloud : HardDrive;

  const moduleTile = (module: (typeof AI_MODULES)[number]) => {
    const checked = settings.modules.includes(module.value);
    return (
      <li key={module.value}>
        <label
          className={cn(
            "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors hover:bg-accent/50",
            checked && "border-brand/40 bg-brand-subtle/50",
          )}
        >
          <Checkbox
            checked={checked}
            onChange={(event) => toggleModule(module.value, event.target.checked)}
          />
          {module.label}
        </label>
      </li>
    );
  };

  return (
    <Section
      id="ai-privacy"
      icon={ShieldCheck}
      title="Privacy"
      description="What AI may read, and whether anything may leave this device. Checked before anything is read."
    >
      <p
        className={cn(
          "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm text-pretty",
          chat?.processing === "cloud" ? "border-warning/40 bg-warning/5" : "bg-muted/40",
        )}
      >
        <WhereIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {where}
      </p>
      <SwitchRow
        label="Allow cloud processing"
        description="Lets Orbit send questions and relevant records to cloud providers. Off means only local providers are used, and cloud requests are refused."
        checked={settings.allow_cloud}
        onChange={(allow_cloud) => onSave({ allow_cloud })}
      />
      <fieldset className="space-y-3 border-t pt-5" aria-describedby="ai-modules-hint">
        <legend className="float-left w-full text-sm font-medium">
          What AI may read{" "}
          <span className="font-normal text-muted-foreground">
            ({settings.modules.length} of {AI_MODULES.length})
          </span>
        </legend>
        <p id="ai-modules-hint" className="clear-left text-xs text-pretty text-muted-foreground">
          Switching a module off also removes it from the search index right away.
        </p>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Everyday</p>
          <ul className="grid gap-2 sm:grid-cols-2">{everyday.map(moduleTile)}</ul>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Sensitive — off unless you choose them
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">{sensitive.map(moduleTile)}</ul>
        </div>
      </fieldset>
    </Section>
  );
}

// ─── Answers and limits ─────────────────────────────────────────────────────────────────────────

function AnswersAndLimits({
  settings,
  onSave,
}: {
  settings: AiSettings;
  onSave: (body: UpdateAiSettingsRequest) => void;
}) {
  return (
    <Section
      id="ai-answers"
      icon={SlidersHorizontal}
      title="Answers and limits"
      description="How long answers are, and an optional monthly cap on use."
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Response style</legend>
        <div className="inline-flex rounded-xl border bg-muted/40 p-1">
          {RESPONSE_STYLES.map((style) => (
            <label
              key={style.value}
              className={cn(
                "cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
                settings.response_style === style.value
                  ? "bg-card text-foreground shadow-elevation-1"
                  : "hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name="ai-response-style"
                value={style.value}
                checked={settings.response_style === style.value}
                onChange={() => onSave({ response_style: style.value })}
                className="sr-only"
              />
              {style.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="border-t pt-5">
        <TokenLimit
          value={settings.monthly_token_limit}
          onSave={(monthly_token_limit) => onSave({ monthly_token_limit })}
        />
      </div>
    </Section>
  );
}

function TokenLimit({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (value: number | null) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value ? String(value) : "");
  const parsed = text.trim() ? Number(text.replace(/[,\s]/g, "")) : null;
  const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed < 1000);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        Monthly token limit
      </label>
      <div className="flex max-w-sm gap-2">
        <Input
          id={id}
          inputMode="numeric"
          value={text}
          placeholder="No limit"
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setText(event.target.value)}
        />
        <Button variant="outline" disabled={invalid} onClick={() => onSave(parsed)}>
          Save
        </Button>
      </div>
      <p
        id={`${id}-hint`}
        className={invalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
      >
        {invalid
          ? "Enter a whole number of at least 1,000, or leave it empty."
          : "Requests stop once it’s reached, until next month."}
      </p>
    </div>
  );
}

// ─── Search index ───────────────────────────────────────────────────────────────────────────────

function Indexing({
  settings,
  onSave,
}: {
  settings: AiSettings;
  onSave: (body: UpdateAiSettingsRequest) => void;
}) {
  const { resource, change } = useAiIndex();
  const [busy, setBusy] = useState(false);
  const run = (action: "rebuild" | "retry" | "clear") => {
    setBusy(true);
    void change(action).finally(() => setBusy(false));
  };
  return (
    <Section
      id="ai-index"
      icon={DatabaseZap}
      title="Search index"
      description="For semantic search in this workspace. Needs an embedding model under Models."
    >
      <SwitchRow
        label="Keep an index for semantic search"
        description="The background worker embeds new and changed records with your embedding model. Unchanged records are never embedded twice."
        checked={settings.indexing_enabled}
        onChange={(indexing_enabled) => onSave({ indexing_enabled })}
      />
      {resource.status === "success" ? (
        <div className="space-y-3 border-t pt-5">
          <p role="status" className="flex items-start gap-2 text-sm">
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                resource.data.active ? "bg-success" : "bg-muted-foreground/50",
              )}
            />
            <span>
              {resource.data.active
                ? `Indexing with ${resource.data.embedding_model}.`
                : "Not indexing: choose an embedding model (and allow cloud processing if it’s a cloud provider)."}{" "}
              <span className="text-muted-foreground">
                {resource.data.counts.indexed} indexed, {resource.data.counts.pending} waiting,{" "}
                {resource.data.counts.failed} failed.
              </span>
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run("rebuild")}>
              Re-index everything
            </Button>
            {resource.data.counts.failed ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run("retry")}>
                Retry failed
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={busy}
              onClick={() => run("clear")}
            >
              Delete index
            </Button>
          </div>
        </div>
      ) : resource.status === "error" ? (
        <p className="text-xs text-destructive">{resource.message}</p>
      ) : null}
    </Section>
  );
}

// ─── Usage ──────────────────────────────────────────────────────────────────────────────────────

function Usage() {
  const usage = useAiUsage();
  return (
    <Section
      id="ai-usage"
      icon={Gauge}
      title="Usage"
      description="Requests and tokens in the last 30 days. Only counts and timings are kept, never your questions or answers."
    >
      {usage.status === "loading" ? (
        <Skeleton className="h-16 w-full" />
      ) : usage.status === "error" ? (
        <p className="text-xs text-destructive">{usage.message}</p>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-sm">
              <span className="text-2xl font-semibold tabular-nums">
                {usage.data.month_tokens.toLocaleString()}
              </span>{" "}
              <span className="text-muted-foreground">
                tokens this month
                {usage.data.monthly_token_limit
                  ? ` of ${usage.data.monthly_token_limit.toLocaleString()}`
                  : ""}
              </span>
            </p>
            {usage.data.monthly_token_limit ? (
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="meter"
                aria-label="Tokens used this month"
                aria-valuemin={0}
                aria-valuemax={usage.data.monthly_token_limit}
                aria-valuenow={Math.min(usage.data.month_tokens, usage.data.monthly_token_limit)}
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    usage.data.near_limit ? "bg-warning" : "bg-brand",
                  )}
                  style={{
                    width: `${Math.min(100, (usage.data.month_tokens / usage.data.monthly_token_limit) * 100)}%`,
                  }}
                />
              </div>
            ) : null}
            {usage.data.near_limit ? (
              <p role="status" className="text-xs font-medium text-warning">
                You’re close to this month’s token limit.
              </p>
            ) : null}
          </div>
          {usage.data.lines.length ? (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Provider · model</th>
                    <th className="px-3 py-2 font-medium">Use</th>
                    <th className="px-3 py-2 text-right font-medium">Requests</th>
                    <th className="px-3 py-2 text-right font-medium">Tokens in / out</th>
                    <th className="px-3 py-2 text-right font-medium">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.data.lines.map((line) => (
                    <tr
                      key={`${line.provider_name}-${line.model}-${line.operation}`}
                      className="border-t"
                    >
                      <td className="px-3 py-2">
                        {line.provider_name} · {line.model}
                      </td>
                      <td className="px-3 py-2 capitalize">{line.operation}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.requests}
                        {line.failures ? ` (${line.failures} failed)` : ""}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.input_tokens.toLocaleString()} / {line.output_tokens.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.cost_micros === null
                          ? "—"
                          : `$${(line.cost_micros / 1_000_000).toFixed(4)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No AI requests yet.</p>
          )}
        </>
      )}
    </Section>
  );
}
