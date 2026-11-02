"use client";

import type { AiProvider, AiSettings, UpdateAiSettingsRequest } from "@orbit/contracts";
import { Cloud, HardDrive, KeyRound, Plus } from "lucide-react";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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

import { ProviderForm } from "./ai-provider-form";

const NONE = "";

/**
 * AI settings: on or off, providers and models, which modules AI may read, cloud consent,
 * indexing, and usage. Each change saves at once.
 */
export function AiSettingsPanel() {
  const settings = useAiSettings();
  const providers = useAiProviders();
  const update = useUpdateAiSettings();
  const [error, setError] = useState<string | null>(null);

  if (settings.status === "loading" || providers.status === "loading") {
    return <Skeleton className="h-96 w-full rounded-xl" />;
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

  const save = (body: UpdateAiSettingsRequest) => {
    setError(null);
    update.mutate(body, {
      onError: (cause) => setError(describeApiError(cause, "Couldn’t save AI settings.")),
    });
  };
  const current = settings.data;
  const list = providers.data.providers;

  return (
    <div className="space-y-8">
      {!current.server_enabled ? (
        <p role="status" className="rounded-xl border bg-muted/40 p-4 text-sm">
          AI is turned off on this Orbit server (
          <code className="font-mono text-xs">ORBIT_AI_ENABLED</code>
          ). The rest of Orbit works as usual.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <Toggle
        label="Use AI in Orbit"
        description="Off by default. Turning it off stops every AI feature; your data and other modules are unaffected."
        checked={current.enabled}
        onChange={(enabled) => save({ enabled })}
      />

      <Providers providers={list} />

      {list.length ? <Models settings={current} providers={list} onSave={save} /> : null}

      <Privacy settings={current} providers={list} onSave={save} />

      <section aria-labelledby="ai-behaviour" className="space-y-3">
        <h2 id="ai-behaviour" className="text-sm font-semibold">
          Answers and limits
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <LabelledSelect
            label="Response style"
            value={current.response_style}
            options={RESPONSE_STYLES}
            onChange={(response_style) => save({ response_style })}
          />
          <TokenLimit
            value={current.monthly_token_limit}
            onSave={(monthly_token_limit) => save({ monthly_token_limit })}
          />
        </div>
      </section>

      <Indexing settings={current} onSave={save} />
      <Usage />
    </div>
  );
}

function Providers({ providers }: { providers: AiProvider[] }) {
  const [editing, setEditing] = useState<AiProvider | "new" | null>(
    providers.length ? null : "new",
  );
  const { remove } = useProviderMutations();
  const { confirm, confirmDialog } = useConfirm();
  return (
    <section aria-labelledby="ai-providers" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ai-providers" className="text-sm font-semibold">
          Providers
        </h2>
        {editing === null ? (
          <Button variant="soft" size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            Add provider
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        A local provider (Ollama, LM Studio) keeps everything on your machine. Cloud providers
        receive the question and the records needed to answer it, and only if you allow cloud
        processing below.
      </p>
      {editing === "new" ? <ProviderForm onDone={() => setEditing(null)} /> : null}
      <ul className="space-y-2">
        {providers.map((provider) =>
          editing !== "new" && editing?.id === provider.id ? (
            <li key={provider.id}>
              <ProviderForm provider={provider} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li
              key={provider.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3"
            >
              {provider.processing === "local" ? (
                <HardDrive className="size-4 text-success" aria-hidden="true" />
              ) : (
                <Cloud className="size-4 text-brand" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{provider.name}</p>
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
              <Button variant="ghost" size="sm" onClick={() => setEditing(provider)}>
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void confirm({
                    title: `Delete ${provider.name}?`,
                    description: "Its stored key is deleted, and settings that use it are cleared.",
                    confirmLabel: "Delete",
                    destructive: true,
                  }).then((yes) => yes && remove.mutate(provider.id))
                }
              >
                Delete
              </Button>
            </li>
          ),
        )}
      </ul>
      {confirmDialog}
    </section>
  );
}

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
    <section aria-labelledby="ai-models" className="space-y-4">
      <h2 id="ai-models" className="text-sm font-semibold">
        Models
      </h2>
      <ModelChoice
        label="Answers"
        hint="Used by the assistant and the AI actions in each module."
        providers={providers}
        providerId={settings.chat_provider_id}
        model={settings.chat_model}
        want="chat"
        onSave={(provider, model) => onSave({ chat_provider_id: provider, chat_model: model })}
      />
      <ModelChoice
        label="Semantic search (embeddings)"
        hint="Optional. Finds records by meaning. Without it, search uses keywords only."
        providers={embedders}
        providerId={settings.embedding_provider_id}
        model={settings.embedding_model}
        want="embeddings"
        onSave={(provider, model) =>
          onSave({ embedding_provider_id: provider, embedding_model: model })
        }
      />
      <ModelChoice
        label="Fallback (optional)"
        hint="Used only when the main provider can’t be reached. Orbit never switches providers unless you choose one here."
        providers={providers}
        providerId={settings.fallback_provider_id}
        model={settings.fallback_model}
        want="chat"
        onSave={(provider, model) =>
          onSave({ fallback_provider_id: provider, fallback_model: model })
        }
      />
    </section>
  );
}

function ModelChoice({
  label,
  hint,
  providers,
  providerId,
  model,
  want,
  onSave,
}: {
  label: string;
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
    <fieldset className="space-y-2" aria-describedby={`${id}-hint`}>
      <legend className="text-sm font-medium">{label}</legend>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          aria-label={`${label}: provider`}
          value={providerId ?? NONE}
          onValueChange={(value) => onSave(value || null, null)}
          options={[
            { value: NONE, label: "None" },
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
  return (
    <section aria-labelledby="ai-privacy" className="space-y-4">
      <h2 id="ai-privacy" className="text-sm font-semibold">
        Privacy
      </h2>
      <p className="rounded-xl border bg-muted/40 p-3 text-xs text-pretty">
        {chat
          ? chat.processing === "local"
            ? `Answers are generated by ${chat.name}, on this device or your network.`
            : `Answers are generated by ${chat.name}, a cloud provider: your question and the records needed to answer it are sent to it.`
          : "Choose a provider to see where your data is processed."}
      </p>
      <Toggle
        label="Allow cloud processing"
        description="Lets Orbit send questions and relevant records to cloud providers. Off means only local providers are used, and cloud requests are refused."
        checked={settings.allow_cloud}
        onChange={(allow_cloud) => onSave({ allow_cloud })}
      />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What AI may read</legend>
        <p className="text-xs text-muted-foreground">
          Checked before anything is read. Switching a module off also removes it from the search
          index right away.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {AI_MODULES.map((module) => (
            <li key={module.value}>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={settings.modules.includes(module.value)}
                  onChange={(event) => toggleModule(module.value, event.target.checked)}
                />
                {module.label}
                {module.sensitive ? (
                  <span className="text-xs text-muted-foreground">(sensitive)</span>
                ) : null}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </section>
  );
}

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
    <section aria-labelledby="ai-index" className="space-y-3">
      <h2 id="ai-index" className="text-sm font-semibold">
        Search index (this workspace)
      </h2>
      <Toggle
        label="Keep an index for semantic search"
        description="The background worker embeds new and changed records with your embedding model. Unchanged records are never embedded twice."
        checked={settings.indexing_enabled}
        onChange={(indexing_enabled) => onSave({ indexing_enabled })}
      />
      {resource.status === "success" ? (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p role="status">
            {resource.data.active
              ? `Indexing with ${resource.data.embedding_model}.`
              : "Not indexing: choose an embedding model (and allow cloud processing if it’s a cloud provider)."}{" "}
            {resource.data.counts.indexed} indexed, {resource.data.counts.pending} waiting,{" "}
            {resource.data.counts.failed} failed.
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
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("clear")}>
              Delete index
            </Button>
          </div>
        </div>
      ) : resource.status === "error" ? (
        <p className="text-xs text-destructive">{resource.message}</p>
      ) : null}
    </section>
  );
}

function Usage() {
  const usage = useAiUsage();
  return (
    <section aria-labelledby="ai-usage" className="space-y-3">
      <h2 id="ai-usage" className="text-sm font-semibold">
        Usage (last 30 days)
      </h2>
      {usage.status === "loading" ? (
        <Skeleton className="h-16 w-full" />
      ) : usage.status === "error" ? (
        <p className="text-xs text-destructive">{usage.message}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {usage.data.month_tokens.toLocaleString()} tokens this month
            {usage.data.monthly_token_limit
              ? ` of ${usage.data.monthly_token_limit.toLocaleString()}`
              : ""}
            . Only counts and timings are kept, never your questions or answers.
          </p>
          {usage.data.near_limit ? (
            <p role="status" className="text-xs font-medium text-warning">
              You’re close to this month’s token limit.
            </p>
          ) : null}
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
            <p className="text-xs text-muted-foreground">No AI requests yet.</p>
          )}
        </>
      )}
    </section>
  );
}

function Toggle({
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
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={`${id}-description`}
        className="mt-0.5"
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p id={`${id}-description`} className="text-xs text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function LabelledSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <Select id={id} value={value} onValueChange={onChange} options={options} />
    </div>
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
      <div className="flex gap-2">
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
