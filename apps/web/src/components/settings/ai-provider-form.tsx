"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { AiConnectionTest, AiProvider } from "@orbit/contracts";
import { Cloud, HardDrive, PlugZap } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { useProviderMutations } from "@/hooks/use-ai";
import { processingLabel, PROVIDER_KINDS, providerSchema } from "@/lib/ai";

type ProviderFormProps = {
  /** Editing a saved connection; its kind can't change, and an empty key keeps the stored one. */
  provider?: AiProvider;
  onDone: () => void;
};

type Values = InferType<typeof providerSchema>;

/** Add or edit a provider connection, with a connection test that saves nothing. */
export function ProviderForm({ provider, onDone }: ProviderFormProps) {
  const { create, update, test } = useProviderMutations();
  const [result, setResult] = useState<AiConnectionTest | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: yupResolver(providerSchema),
    defaultValues: {
      name: provider?.name ?? "Ollama",
      kind: provider?.kind ?? "ollama",
      base_url: provider?.base_url ?? "",
      api_key: "",
    },
  });
  const kind = useWatch({ control, name: "kind" });
  const info = PROVIDER_KINDS.find((option) => option.value === kind) ?? PROVIDER_KINDS[0];

  async function save(values: Values) {
    try {
      if (provider) {
        await update.mutateAsync({
          id: provider.id,
          body: {
            name: values.name,
            base_url: values.base_url || null,
            ...(values.api_key ? { api_key: values.api_key } : {}),
          },
        });
      } else {
        await create.mutateAsync({
          name: values.name,
          kind: values.kind,
          base_url: values.base_url || null,
          api_key: values.api_key || null,
        });
      }
      onDone();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the provider. Try again."),
      });
    }
  }

  async function runTest() {
    const values = getValues();
    setResult(null);
    try {
      setResult(
        await test.mutateAsync({
          kind: values.kind,
          base_url: values.base_url || null,
          api_key: values.api_key || null,
          provider_id: provider?.id ?? null,
        }),
      );
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t test the connection."),
      });
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(save)(event)}
      className="space-y-4 rounded-xl border bg-card p-4"
      aria-label={provider ? `Edit ${provider.name}` : "Add a provider"}
    >
      {provider ? null : (
        <SelectField
          control={control}
          name="kind"
          label="Provider"
          options={PROVIDER_KINDS.map((option) => ({ value: option.value, label: option.label }))}
          hint={info?.hint}
        />
      )}
      <FormField
        label="Name"
        autoComplete="off"
        {...register("name")}
        error={errors.name?.message}
      />
      <FormField
        label={info?.needsUrl ? "Server address" : "Server address (optional)"}
        placeholder={
          kind === "ollama"
            ? "http://localhost:11434"
            : kind === "openai_compatible"
              ? "http://localhost:1234/v1"
              : "Leave empty for the provider’s own"
        }
        autoComplete="off"
        inputMode="url"
        {...register("base_url")}
        error={errors.base_url?.message}
      />
      <FormField
        label={info?.needsKey ? "API key" : "API key (optional)"}
        type="password"
        autoComplete="off"
        hint={
          provider?.has_api_key
            ? "A key is stored. Leave empty to keep it. Keys are encrypted on the server and never shown again."
            : "Stored encrypted on the Orbit server. It never reaches this browser again."
        }
        {...register("api_key")}
        error={errors.api_key?.message}
      />
      <FormAlert message={errors.root?.server?.message ?? null} />
      {result ? <TestResult result={result} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : provider ? "Save" : "Add provider"}
        </Button>
        <Button variant="outline" onClick={() => void runTest()} disabled={test.isPending}>
          <PlugZap aria-hidden="true" />
          {test.isPending ? "Testing…" : "Test connection"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function TestResult({ result }: { result: AiConnectionTest }) {
  const Icon = result.processing === "local" ? HardDrive : Cloud;
  return (
    <p
      role="status"
      className={result.ok ? "text-sm text-success" : "text-sm font-medium text-destructive"}
    >
      {result.message}{" "}
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {processingLabel(result.processing)}
      </span>
    </p>
  );
}
