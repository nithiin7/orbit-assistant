"use client";

import type {
  IntegrationCapability,
  IntegrationConnection,
  IntegrationProvider,
} from "@orbit/contracts";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  FolderOpen,
  Link2,
  type LucideIcon,
  Mail,
  PencilLine,
  Plug,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAuthorizeIntegration,
  useConnections,
  useIntegrationProviders,
} from "@/hooks/use-integrations";
import {
  capabilityName,
  connectionHref,
  DEFAULT_CAPABILITIES,
  formatSynced,
  PROVIDER_NAMES,
  SERVICE_CAPABILITIES,
  STATUS_LABELS,
} from "@/lib/integrations";
import { cn } from "@/utils/common";

import { ConflictList } from "./conflict-list";
import { ConnectionDetails } from "./connection-details";
import { ProviderMark } from "./provider-mark";
import { ErrorText, Section } from "./section";

/** Settings → Integrations: connected accounts and connecting one, or one connection's page. */
export function IntegrationsSettings() {
  return (
    <Suspense fallback={<Loading />}>
      <IntegrationsView />
    </Suspense>
  );
}

function IntegrationsView() {
  const connectionId = useSearchParams().get("connection");
  return connectionId ? (
    <ConnectionDetails key={connectionId} connectionId={connectionId} />
  ) : (
    <Overview />
  );
}

function Loading() {
  return (
    <div aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading integrations…</span>
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}

function Overview() {
  const connections = useConnections();
  const providers = useIntegrationProviders();
  if (connections.status === "loading" || providers.status === "loading") return <Loading />;
  if (connections.status === "error" || providers.status === "error") {
    const message =
      connections.status === "error"
        ? connections.message
        : providers.status === "error"
          ? providers.message
          : "";
    return <ErrorText message={message} />;
  }
  const list = connections.data.connections;
  return (
    <div className="grid items-start gap-6 @5xl/panel:grid-cols-[minmax(0,1fr)_20rem] @min-[110rem]/panel:grid-cols-[minmax(0,1fr)_24rem] @min-[110rem]/panel:gap-8">
      <div className="min-w-0 space-y-6">
        <ConflictList />
        <Section
          id="connected"
          icon={Link2}
          title="Connected accounts"
          description="Calendars, mail, and files from other services, brought into Orbit on your terms."
        >
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No accounts connected yet. Connect one below; nothing is synchronized until you choose
              what.
            </p>
          ) : (
            <ul className="divide-y overflow-hidden rounded-xl border">
              {list.map((connection) => (
                <ConnectionRow key={connection.id} connection={connection} />
              ))}
            </ul>
          )}
        </Section>
        <ConnectAccount providers={providers.data.providers} />
      </div>
      <PrivacyNote pushes={providers.data.webhooks} />
    </div>
  );
}

function ConnectionRow({ connection }: { connection: IntegrationConnection }) {
  const healthy = connection.status === "active";
  return (
    <li>
      <Link
        href={connectionHref(connection.id)}
        className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
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
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

const CAPABILITY_ICONS: Readonly<Record<IntegrationCapability, LucideIcon>> = {
  calendar: CalendarDays,
  calendar_write: PencilLine,
  mail: Mail,
  files: FolderOpen,
};

/** Choose a provider and what Orbit may access, then continue to the provider's consent page. */
export function ConnectAccount({
  providers,
  reconnect,
}: {
  providers: IntegrationProvider[];
  /** Reconnecting an existing connection (renewing access or adding permissions). */
  reconnect?: {
    connectionId: string;
    provider: IntegrationProvider["provider"];
    granted: IntegrationCapability[];
  };
}) {
  const shown = reconnect ? providers.filter((p) => p.provider === reconnect.provider) : providers;
  return (
    <Section
      id={reconnect ? "reconnect" : "connect"}
      icon={Plug}
      title={reconnect ? "Reconnect or add permissions" : "Connect an account"}
      description={
        reconnect
          ? "Renew Orbit’s access, or allow more. You’ll confirm with the provider."
          : "Pick a service, choose what Orbit may access, then sign in with that provider to confirm."
      }
    >
      {/* Providers sit side by side once there's room, as equal-height cards. */}
      <div className="@container/connect">
        <div className={cn("grid gap-4", shown.length > 1 && "@3xl/connect:grid-cols-2")}>
          {shown.map((provider) => (
            <ProviderChoice key={provider.provider} provider={provider} reconnect={reconnect} />
          ))}
        </div>
      </div>
    </Section>
  );
}

function ProviderHeader({
  provider,
  status,
}: {
  provider: IntegrationProvider["provider"];
  status?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <ProviderMark provider={provider} size="lg" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-base font-semibold">{PROVIDER_NAMES[provider]}</p>
        <p className="truncate text-xs text-muted-foreground">
          {SERVICE_CAPABILITIES.map((c) => capabilityName(provider, c)).join(" · ")}
        </p>
      </div>
      {status}
    </div>
  );
}

function ProviderChoice({
  provider,
  reconnect,
}: {
  provider: IntegrationProvider;
  reconnect?: { connectionId: string; granted: IntegrationCapability[] };
}) {
  const id = useId();
  const authorize = useAuthorizeIntegration();
  const [chosen, setChosen] = useState<IntegrationCapability[]>(
    reconnect ? reconnect.granted : [...DEFAULT_CAPABILITIES],
  );
  const [error, setError] = useState<string | null>(null);
  const name = PROVIDER_NAMES[provider.provider];

  if (!provider.configured) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-dashed bg-muted/30 p-4 sm:p-5">
        <ProviderHeader
          provider={provider.provider}
          status={<Badge variant="outline">Unavailable</Badge>}
        />
        <p className="text-sm text-pretty text-muted-foreground">
          Not set up on this Orbit server. Whoever runs it can add a {name} OAuth app (see the
          integrations guide), and it will appear here ready to connect.
        </p>
      </div>
    );
  }

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
        onSuccess: ({ authorization_url }) => window.location.assign(authorization_url),
        onError: (cause) => setError(describeApiError(cause, `Couldn’t start connecting ${name}.`)),
      },
    );
  };

  return (
    <fieldset className="flex flex-col gap-4 rounded-xl border bg-background/40 p-4 sm:p-5">
      <legend className="sr-only">{name}: what Orbit may access</legend>
      <ProviderHeader provider={provider.provider} />
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">What Orbit may access</p>
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {provider.capabilities.map(({ capability, purpose }) => {
            const inputId = `${id}-${capability}`;
            const Icon = CAPABILITY_ICONS[capability];
            // Editing events builds on reading them, so it sits under the calendar row.
            const nested = capability === "calendar_write";
            return (
              <li key={capability}>
                <label
                  htmlFor={inputId}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors duration-150 hover:bg-accent has-checked:bg-brand-subtle/40",
                    nested && "pl-14",
                  )}
                >
                  {nested ? null : (
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                    >
                      <Icon className="size-4" />
                    </span>
                  )}
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
                    className="mt-1.5"
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mt-auto space-y-3">
        <ErrorText message={error} />
        <p className="text-xs text-pretty text-muted-foreground">
          {chosen.length === 0
            ? "Choose at least one thing Orbit may access."
            : `${name} will ask you to sign in and approve. Nothing syncs until you pick what to bring in.`}
        </p>
        <Button
          onClick={start}
          disabled={chosen.length === 0 || authorize.isPending}
          className="w-full"
        >
          {authorize.isPending ? "Opening…" : `Continue to ${name}`}
          <ArrowUpRight aria-hidden="true" />
        </Button>
      </div>
    </fieldset>
  );
}

function PrivacyNote({ pushes }: { pushes: boolean }) {
  return (
    <aside
      aria-label="Privacy"
      className="flex gap-3 rounded-2xl border bg-card p-4 text-sm shadow-elevation-1 sm:p-5 @5xl/panel:sticky @5xl/panel:top-10"
    >
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
      <div className="space-y-1 text-pretty text-muted-foreground">
        <p className="font-medium text-foreground">How Orbit handles your accounts</p>
        <p>
          Sign-in tokens stay on the Orbit server, encrypted, and never reach this browser. Orbit
          reads only the calendars, labels, and files you choose; mail is shown when you open it and
          isn’t copied into Orbit.
        </p>
        <p>
          {pushes
            ? "Providers tell Orbit about calendar changes as they happen."
            : "Calendars are checked on the schedule you set for each one."}
        </p>
      </div>
    </aside>
  );
}
