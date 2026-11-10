"use client";

import type {
  IntegrationCapability,
  IntegrationConnection,
  IntegrationProvider,
} from "@orbit/contracts";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  Eye,
  FolderOpen,
  KeyRound,
  type LucideIcon,
  Mail,
  PencilLine,
  Plug,
  Unplug,
} from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuthorizeIntegration } from "@/hooks/use-integrations";
import {
  capabilityName,
  connectionHref,
  DEFAULT_CAPABILITIES,
  formatSynced,
  PROVIDER_NAMES,
  rememberConnectReturn,
  SERVICE_CAPABILITIES,
  STATUS_LABELS,
} from "@/lib/integrations";
import { cn } from "@/utils/common";

import { ProviderMark } from "./provider-mark";
import { ErrorText, Section } from "./section";

const CAPABILITY_ICONS: Readonly<Record<IntegrationCapability, LucideIcon>> = {
  calendar: CalendarDays,
  calendar_write: PencilLine,
  mail: Mail,
  files: FolderOpen,
};

function serviceLine(provider: IntegrationProvider["provider"]): string {
  return SERVICE_CAPABILITIES.map((c) => capabilityName(provider, c)).join(" · ");
}

/**
 * Connect a Google or Microsoft account: pick a provider, choose what Orbit may access, then
 * continue to the provider's consent page. With `reconnect`, only that provider is offered and
 * its current permissions start chosen.
 */
export function ConnectAccount({
  providers,
  reconnect,
  returnTo,
  connected = [],
  onCancel,
}: {
  providers: IntegrationProvider[];
  /** Reconnecting an existing connection (renewing access or adding permissions). */
  reconnect?: {
    connectionId: string;
    provider: IntegrationProvider["provider"];
    granted: IntegrationCapability[];
  };
  /** A page to open once the connection completes, instead of the connection's settings. */
  returnTo?: string;
  /** Accounts already connected, so each provider can say how many it has. */
  connected?: IntegrationConnection[];
  /** Shows a Cancel action, for when connecting another account was opened on request. */
  onCancel?: () => void;
}) {
  const shown = reconnect ? providers.filter((p) => p.provider === reconnect.provider) : providers;
  const configured = shown.filter((p) => p.configured);
  const [selected, setSelected] = useState(configured[0]?.provider ?? null);
  const chosen = configured.find((p) => p.provider === selected);

  return (
    <Section
      id={reconnect ? "reconnect" : "connect"}
      icon={Plug}
      title={
        reconnect
          ? "Reconnect or add permissions"
          : connected.length > 0
            ? "Connect another account"
            : "Connect an account"
      }
      description={
        reconnect
          ? "Renew access or allow more."
          : "Bring your calendar, mail, and files into Orbit. You choose what it may read."
      }
      action={
        onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : undefined
      }
    >
      {configured.length === 0 ? (
        <NotConfigured providers={shown} />
      ) : (
        <div className="space-y-5">
          {shown.length > 1 ? (
            <ProviderPicker
              providers={shown}
              selected={selected}
              onSelect={setSelected}
              connected={connected}
            />
          ) : null}
          {chosen ? (
            <Permissions
              key={chosen.provider}
              provider={chosen}
              reconnect={reconnect}
              returnTo={returnTo}
            />
          ) : null}
        </div>
      )}
    </Section>
  );
}

function ProviderPicker({
  providers,
  selected,
  onSelect,
  connected,
}: {
  providers: IntegrationProvider[];
  selected: IntegrationProvider["provider"] | null;
  onSelect: (provider: IntegrationProvider["provider"]) => void;
  connected: IntegrationConnection[];
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium text-muted-foreground">Provider</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map((provider) => {
          const count = connected.filter((c) => c.provider === provider.provider).length;
          return (
            <label
              key={provider.provider}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl border bg-card p-3.5 transition-[border-color,box-shadow,background-color] duration-150 select-none",
                provider.configured
                  ? "cursor-pointer hover:border-foreground/20 has-checked:border-brand has-checked:bg-brand-subtle/30 has-checked:ring-1 has-checked:ring-brand has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background"
                  : "cursor-not-allowed border-dashed bg-muted/30",
              )}
            >
              <input
                type="radio"
                name={name}
                value={provider.provider}
                checked={selected === provider.provider}
                disabled={!provider.configured}
                onChange={() => onSelect(provider.provider)}
                className="sr-only"
              />
              <ProviderMark
                provider={provider.provider}
                size="lg"
                className={cn(!provider.configured && "opacity-50 grayscale")}
              />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{PROVIDER_NAMES[provider.provider]}</span>
                  {!provider.configured ? (
                    <Badge variant="outline">Unavailable</Badge>
                  ) : count > 0 ? (
                    <Badge>{count} connected</Badge>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {serviceLine(provider.provider)}
                </span>
              </span>
              {provider.configured ? (
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full border text-transparent transition-colors duration-150 group-has-checked:border-brand group-has-checked:bg-brand group-has-checked:text-white"
                >
                  <Check className="size-3.5" />
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      {providers.some((p) => !p.configured) ? (
        <p className="mt-2 text-xs text-pretty text-muted-foreground">
          Unavailable providers are not set up on this Orbit server. Whoever runs it can add one
          from the integrations guide.
        </p>
      ) : null}
    </fieldset>
  );
}

const TRUST: readonly { icon: LucideIcon; text: string }[] = [
  { icon: KeyRound, text: "Access is encrypted on this server" },
  { icon: Eye, text: "Read-only unless you allow edits" },
  { icon: Unplug, text: "Disconnect any time" },
];

function Permissions({
  provider,
  reconnect,
  returnTo,
}: {
  provider: IntegrationProvider;
  reconnect?: { connectionId: string; granted: IntegrationCapability[] };
  returnTo?: string;
}) {
  const id = useId();
  const authorize = useAuthorizeIntegration();
  const [chosen, setChosen] = useState<IntegrationCapability[]>(
    reconnect ? reconnect.granted : [...DEFAULT_CAPABILITIES],
  );
  const [error, setError] = useState<string | null>(null);
  const name = PROVIDER_NAMES[provider.provider];

  const toggle = (capability: IntegrationCapability, on: boolean) => {
    setChosen((current) => {
      const next = new Set(current);
      if (on) {
        next.add(capability);
        if (capability === "calendar_write") next.add("calendar");
      } else {
        next.delete(capability);
        if (capability === "calendar") next.delete("calendar_write");
      }
      return provider.capabilities.map((c) => c.capability).filter((c) => next.has(c));
    });
  };

  const start = () => {
    setError(null);
    authorize.mutate(
      { provider: provider.provider, capabilities: chosen, connectionId: reconnect?.connectionId },
      {
        onSuccess: ({ authorization_url }) => {
          rememberConnectReturn(returnTo ?? null);
          window.location.assign(authorization_url);
        },
        onError: (cause) => setError(describeApiError(cause, `Couldn’t start connecting ${name}.`)),
      },
    );
  };

  return (
    <fieldset className="space-y-4">
      <legend className="sr-only">{name}: what Orbit may access</legend>
      <p aria-hidden="true" className="text-xs font-medium text-muted-foreground">
        What Orbit may access
      </p>
      <ul className="grid gap-2">
        {provider.capabilities.map(({ capability, purpose }) => {
          const inputId = `${id}-${capability}`;
          const Icon = CAPABILITY_ICONS[capability];
          // Editing events builds on reading them, so it sits inset under the calendar row.
          const nested = capability === "calendar_write";
          return (
            <li key={capability} className={cn(nested && "-mt-1 pl-6 sm:pl-12")}>
              <label
                htmlFor={inputId}
                className={cn(
                  "group flex cursor-pointer items-start gap-3 rounded-xl border bg-card px-3.5 py-3 transition-[border-color,background-color] duration-150 hover:border-foreground/20 has-checked:border-brand/50 has-checked:bg-brand-subtle/40",
                  nested && "border-dashed py-2.5",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors duration-150 group-has-checked:bg-brand group-has-checked:text-white",
                    nested ? "size-7" : "size-9",
                  )}
                >
                  <Icon className={nested ? "size-3.5" : "size-4"} />
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span id={`${inputId}-name`} className="block text-sm font-medium">
                    {capabilityName(provider.provider, capability)}
                  </span>
                  <span
                    id={`${inputId}-purpose`}
                    className="block text-xs text-pretty text-muted-foreground"
                  >
                    {purpose}
                  </span>
                </span>
                <Checkbox
                  id={inputId}
                  checked={chosen.includes(capability)}
                  onChange={(event) => toggle(capability, event.currentTarget.checked)}
                  aria-labelledby={`${inputId}-name`}
                  aria-describedby={`${inputId}-purpose`}
                  className="mt-1"
                />
              </label>
            </li>
          );
        })}
      </ul>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {TRUST.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-1.5">
            <Icon className="size-3.5 text-brand" aria-hidden="true" />
            {text}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-3.5 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-xs text-pretty text-muted-foreground">
          {chosen.length === 0
            ? "Choose at least one thing Orbit may access."
            : `${name} will ask you to sign in and approve. Nothing syncs until you pick what to bring in.`}
        </p>
        <Button
          onClick={start}
          disabled={chosen.length === 0 || authorize.isPending}
          className="shrink-0"
        >
          {authorize.isPending ? "Opening…" : `Continue to ${name}`}
          <ArrowUpRight aria-hidden="true" />
        </Button>
      </div>
      <ErrorText message={error} />
    </fieldset>
  );
}

/** Shown when no provider is set up on this server, so there is nothing to connect yet. */
function NotConfigured({ providers }: { providers: IntegrationProvider[] }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-muted/30 px-4 py-8 text-center">
      <span className="flex -space-x-2">
        {providers.map((p) => (
          <ProviderMark
            key={p.provider}
            provider={p.provider}
            size="lg"
            className="opacity-60 grayscale"
          />
        ))}
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold">Not set up on this Orbit server yet</p>
        <p className="mx-auto max-w-sm text-sm text-pretty text-muted-foreground">
          Whoever runs this server can add a Google or Microsoft OAuth app from the integrations
          guide. They’ll then appear here, ready to connect.
        </p>
      </div>
    </div>
  );
}

/**
 * Connected accounts with their services, status, and last sync. With `linked`, each row opens
 * the account's settings.
 */
export function ConnectedAccounts({
  connections,
  linked = false,
}: {
  connections: IntegrationConnection[];
  linked?: boolean;
}) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {connections.map((connection) => {
        const healthy = connection.status === "active";
        const content = (
          <>
            <ProviderMark provider={connection.provider} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{connection.account_email}</span>
                <Badge
                  variant={healthy ? "brand" : "outline"}
                  className={cn(!healthy && "text-destructive")}
                >
                  {STATUS_LABELS[connection.status]}
                </Badge>
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {connection.capabilities
                  .filter((c) => c !== "calendar_write")
                  .map((c) => capabilityName(connection.provider, c))
                  .join(" · ")}{" "}
                — synced {formatSynced(connection.last_synced_at).toLowerCase()}
              </span>
            </span>
          </>
        );
        return (
          <li key={connection.id}>
            {linked ? (
              <Link
                href={connectionHref(connection.id)}
                className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                {content}
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
