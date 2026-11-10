"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { FitnessProfile, IntegrationConnection, IntegrationProvider } from "@orbit/contracts";
import { CircleCheck, Plus } from "lucide-react";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { saveFitnessProfile } from "@/api/fitness";
import { AccountDialog } from "@/components/finance/account-dialog";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { ConnectAccount, ConnectedAccounts } from "@/components/integrations/connect-account";
import { ProviderForm } from "@/components/settings/ai-provider-form";
import { ModelChoice } from "@/components/settings/ai-settings";
import { FinanceSettings } from "@/components/settings/finance-settings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAiProviders, useAiSettings, useUpdateAiSettings } from "@/hooks/use-ai";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { useFinanceSetup } from "@/hooks/use-finance";
import { useFitnessAction, useFitnessProfile } from "@/hooks/use-fitness";
import { useConnections, useIntegrationProviders } from "@/hooks/use-integrations";
import { accountTypeLabel } from "@/lib/finance";
import {
  IMPERIAL_UNITS,
  METRIC_UNITS,
  type ProfileFormValues,
  profileSchema,
  toProfileFormValues,
  toProfileRequest,
} from "@/lib/fitness";
import { SETUP_CONNECT_PATH } from "@/lib/setup";

import { StepActions, StepFrame, type StepNav } from "./step-frame";

function Loading({ label }: { label: string }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  );
}

/** A quiet note for an area this server can't offer, so the step can simply be skipped. */
function Unavailable({ children }: { children: string }) {
  return (
    <p role="status" className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm">
      {children}
    </p>
  );
}

// ─── Finance ────────────────────────────────────────────────────────────────────────────────────

export function FinanceStep({ nav }: { nav: StepNav }) {
  const workspaceId = useActiveWorkspaceId();
  return (
    <StepFrame
      title="Set up your money"
      description="Add the accounts you want to track, such as a bank account, cash, or a credit card. Balances stay on this server."
    >
      {workspaceId ? (
        <FinanceAccounts workspaceId={workspaceId} />
      ) : (
        <Loading label="Loading accounts…" />
      )}
      <FinanceSettings />
      <StepActions nav={nav} skip />
    </StepFrame>
  );
}

function FinanceAccounts({ workspaceId }: { workspaceId: string }) {
  const { accounts } = useFinanceSetup(workspaceId);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (accounts.status === "loading") return <Loading label="Loading accounts…" />;
  if (accounts.status === "error") return <FormAlert message={accounts.message} />;

  const active = accounts.data.accounts.filter((account) => !account.archived);
  return (
    <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-elevation-1 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Accounts</h2>
        <Button variant="soft" size="sm" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" />
          Add an account
        </Button>
      </div>
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">No accounts yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {active.map((account) => (
            <li key={account.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="truncate text-sm font-medium">{account.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {accountTypeLabel(account.type)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
      {adding ? (
        <AccountDialog
          workspaceId={workspaceId}
          onSaved={(text) => {
            setMessage(text);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

// ─── Health ─────────────────────────────────────────────────────────────────────────────────────

export function HealthStep({ nav }: { nav: StepNav }) {
  const workspaceId = useActiveWorkspaceId();
  const profile = useFitnessProfile(workspaceId);
  const title = "Health basics";
  const description =
    "Units and a few targets for the health pages. Your health records are private to you.";

  if (!workspaceId || profile.state.status === "loading") {
    return (
      <StepFrame title={title} description={description}>
        <Loading label="Loading your health settings…" />
        <StepActions nav={nav} skip />
      </StepFrame>
    );
  }
  if (profile.state.status === "error") {
    return (
      <StepFrame title={title} description={description}>
        <FormAlert message={profile.state.message} />
        <StepActions nav={nav} skip />
      </StepFrame>
    );
  }
  return (
    <StepFrame title={title} description={description}>
      <HealthForm workspaceId={workspaceId} profile={profile.state.data} nav={nav} />
    </StepFrame>
  );
}

function HealthForm({
  workspaceId,
  profile,
  nav,
}: {
  workspaceId: string;
  profile: FitnessProfile;
  nav: StepNav;
}) {
  const run = useFitnessAction(workspaceId);
  const formId = useId();
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: yupResolver(profileSchema),
    defaultValues: toProfileFormValues(profile),
  });
  const [lengthUnit, energyUnit, waterUnit] = useWatch({
    control,
    name: ["lengthUnit", "energyUnit", "waterUnit"],
  });

  const applySystem = (system: string) => {
    const units = system === "imperial" ? IMPERIAL_UNITS : METRIC_UNITS;
    setValue("weightUnit", units.weight_unit);
    setValue("lengthUnit", units.length_unit);
    setValue("distanceUnit", units.distance_unit);
    setValue("energyUnit", units.energy_unit);
    setValue("waterUnit", units.water_unit);
  };

  async function save(values: ProfileFormValues) {
    try {
      await run((token) => saveFitnessProfile(token, workspaceId, toProfileRequest(values)));
      nav.next();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save your health settings."),
      });
    }
  }

  return (
    <>
      <form
        id={formId}
        noValidate
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="grid gap-4 rounded-2xl border bg-card p-4 shadow-elevation-1 sm:grid-cols-2 sm:p-5"
      >
        <SelectField
          control={control}
          name="unitSystem"
          label="Units"
          options={[
            { value: "metric", label: "Metric" },
            { value: "imperial", label: "Imperial (US)" },
          ]}
          onValueChange={applySystem}
        />
        <FormField
          label={`Height (${lengthUnit})`}
          inputMode="decimal"
          {...register("height")}
          error={errors.height?.message}
        />
        <DateField control={control} name="dateOfBirth" label="Date of birth" clearable />
        <FormField
          label={`Daily water (${waterUnit === "fl_oz" ? "fl oz" : waterUnit})`}
          inputMode="decimal"
          {...register("waterTarget")}
          error={errors.waterTarget?.message}
        />
        <FormField
          label={`Daily energy (${energyUnit === "kcal" ? "kcal" : "kJ"})`}
          inputMode="decimal"
          {...register("energyTarget")}
          error={errors.energyTarget?.message}
        />
        <div className="sm:col-span-2">
          <FormAlert message={errors.root?.server?.message ?? null} />
        </div>
      </form>
      <StepActions nav={nav} form={formId} pending={isSubmitting} skip />
    </>
  );
}

// ─── Connected accounts ─────────────────────────────────────────────────────────────────────────

export function ConnectStep({ nav }: { nav: StepNav }) {
  const providers = useIntegrationProviders();
  const connections = useConnections();

  let body;
  if (providers.status === "loading" || connections.status === "loading") {
    body = <Loading label="Loading accounts…" />;
  } else if (providers.status === "error") {
    body = <FormAlert message={providers.message} />;
  } else if (connections.status === "error") {
    body = <FormAlert message={connections.message} />;
  } else {
    body = (
      <ConnectChoices
        providers={providers.data.providers}
        connections={connections.data.connections}
      />
    );
  }

  return (
    <StepFrame
      title="Connect your accounts"
      description="See your calendar, mail, and files in Orbit. You choose what Orbit may read, and can disconnect any time in Settings."
    >
      {body}
      <StepActions nav={nav} skip />
    </StepFrame>
  );
}

/** Accounts already connected lead; connecting another opens on request. */
function ConnectChoices({
  providers,
  connections,
}: {
  providers: IntegrationProvider[];
  connections: IntegrationConnection[];
}) {
  const [adding, setAdding] = useState(false);
  if (connections.length === 0) {
    return <ConnectAccount providers={providers} returnTo={SETUP_CONNECT_PATH} />;
  }
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <CircleCheck className="size-4 text-success" aria-hidden="true" />
            Connected
          </h2>
          {!adding && providers.some((p) => p.configured) ? (
            <Button variant="soft" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              Connect another
            </Button>
          ) : null}
        </div>
        <ConnectedAccounts connections={connections} />
      </div>
      {adding ? (
        <ConnectAccount
          providers={providers}
          connected={connections}
          returnTo={SETUP_CONNECT_PATH}
          onCancel={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

// ─── AI ─────────────────────────────────────────────────────────────────────────────────────────

export function AiStep({ nav }: { nav: StepNav }) {
  return (
    <StepFrame
      title="Set up the AI assistant"
      description="Optional. Use a local model with Ollama, or a cloud provider with your own key. Nothing is sent anywhere until you turn AI on."
    >
      <AiSetup />
      <StepActions nav={nav} skip />
    </StepFrame>
  );
}

function AiSetup() {
  const settings = useAiSettings();
  const providers = useAiProviders();
  const update = useUpdateAiSettings();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  if (settings.status === "loading" || providers.status === "loading") {
    return <Loading label="Loading AI settings…" />;
  }
  if (settings.status === "error") return <FormAlert message={settings.message} />;
  if (providers.status === "error") return <FormAlert message={providers.message} />;
  if (!settings.data.server_enabled) {
    return (
      <Unavailable>
        AI is turned off on this Orbit server, so there’s nothing to set up. The rest of Orbit works
        as usual.
      </Unavailable>
    );
  }

  const current = settings.data;
  const list = providers.data.providers;
  const save = (enabled: boolean) => {
    setError(null);
    update.mutate(
      { enabled },
      { onError: (cause) => setError(describeApiError(cause, "Couldn’t save AI settings.")) },
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-elevation-1 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">1. Connect a provider</h2>
          {adding ? null : (
            <Button variant="soft" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              Add a provider
            </Button>
          )}
        </div>
        {list.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {list.map((provider) => (
              <li key={provider.id} className="px-3 py-2 text-sm font-medium">
                {provider.name}
              </li>
            ))}
          </ul>
        ) : adding ? null : (
          <p className="text-sm text-muted-foreground">No providers yet.</p>
        )}
        {adding ? <ProviderForm onDone={() => setAdding(false)} /> : null}
      </div>

      {list.length > 0 ? (
        <div className="space-y-4 rounded-2xl border bg-card p-4 shadow-elevation-1 sm:p-5">
          <h2 className="text-base font-semibold">2. Choose a model and turn it on</h2>
          <ModelChoice
            label="Answers"
            required
            providers={list}
            providerId={current.chat_provider_id}
            model={current.chat_model}
            want="chat"
            onSave={(provider, model) =>
              update.mutate(
                { chat_provider_id: provider, chat_model: model },
                {
                  onError: (cause) => setError(describeApiError(cause, "Couldn’t save the model.")),
                },
              )
            }
          />
          <div className="flex items-start justify-between gap-4 border-t pt-4">
            <div className="space-y-0.5">
              <label htmlFor={`${id}-enabled`} className="text-sm font-medium">
                Use AI in Orbit
              </label>
              <p id={`${id}-hint`} className="text-xs text-pretty text-muted-foreground">
                Privacy, limits, and more are in Settings → AI.
              </p>
            </div>
            <Switch
              id={`${id}-enabled`}
              checked={current.enabled}
              disabled={update.isPending}
              onCheckedChange={save}
              aria-describedby={`${id}-hint`}
            />
          </div>
        </div>
      ) : null}
      <FormAlert message={error} />
    </div>
  );
}
