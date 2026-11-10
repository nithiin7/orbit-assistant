"use client";

import type { IntegrationConnection, IntegrationProvider } from "@orbit/contracts";
import { Link2, Plus, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnections, useIntegrationProviders } from "@/hooks/use-integrations";

import { ConflictList } from "./conflict-list";
import { ConnectAccount, ConnectedAccounts } from "./connect-account";
import { ConnectionDetails } from "./connection-details";
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
        {list.length === 0 ? (
          <ConnectAccount providers={providers.data.providers} />
        ) : (
          <Connected connections={list} providers={providers.data.providers} />
        )}
      </div>
      <PrivacyNote />
    </div>
  );
}

/**
 * Connected accounts first; connecting another (a second Google account, or Microsoft) opens on
 * request so the page stays about the accounts already there.
 */
function Connected({
  connections,
  providers,
}: {
  connections: IntegrationConnection[];
  providers: IntegrationProvider[];
}) {
  const [adding, setAdding] = useState(false);
  const canAdd = providers.some((p) => p.configured);
  return (
    <>
      <Section
        id="connected"
        icon={Link2}
        title="Connected accounts"
        action={
          canAdd && !adding ? (
            <Button variant="soft" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              Add account
            </Button>
          ) : undefined
        }
      >
        <ConnectedAccounts connections={connections} linked />
      </Section>
      {adding ? (
        <ConnectAccount
          providers={providers}
          connected={connections}
          onCancel={() => setAdding(false)}
        />
      ) : null}
    </>
  );
}

function PrivacyNote() {
  return (
    <aside
      aria-label="Privacy"
      className="flex gap-3 rounded-2xl border bg-card p-4 text-sm shadow-elevation-1 sm:p-5 @5xl/panel:sticky @5xl/panel:top-10"
    >
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
      <div className="space-y-1 text-pretty text-muted-foreground">
        <p className="font-medium text-foreground">Private by default</p>
        <p>
          Tokens stay encrypted on the server. Orbit reads only what you choose, and mail isn’t
          copied.
        </p>
      </div>
    </aside>
  );
}
