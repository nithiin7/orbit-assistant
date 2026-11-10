"use client";

import type {
  IntegrationCalendar,
  IntegrationConnection,
  IntegrationConnectionDetail,
  IntegrationSyncRun,
  UpdateIntegrationCalendarRequest,
} from "@orbit/contracts";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  FolderOpen,
  KeyRound,
  type LucideIcon,
  Mail,
  RefreshCw,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useActiveWorkspaceId, useCalendarCategories } from "@/hooks/use-calendar";
import {
  useConnection,
  useConnectionMutations,
  useIntegrationProviders,
} from "@/hooks/use-integrations";
import {
  capabilityName,
  DIRECTIONS,
  driveHref,
  formatSynced,
  inboxHref,
  PROVIDER_NAMES,
  runKindLabel,
  runStatusLabel,
  runSummary,
  STATUS_LABELS,
  SYNC_INTERVALS,
} from "@/lib/integrations";

import { ConnectAccount } from "./integrations-settings";
import { MailSettings } from "./mail-browser";
import { ProviderMark } from "./provider-mark";
import { ErrorText, Section } from "./section";

const NO_CATEGORY = "none";

/**
 * One connected account: its status, where each service lives in Orbit (the calendar, the inbox
 * beside Tasks, the drive inside Documents), their settings, activity, and access.
 */
export function ConnectionDetails({ connectionId }: { connectionId: string }) {
  const detail = useConnection(connectionId);
  return (
    <div className="space-y-6">
      <Link
        href="/settings/integrations"
        className="-ml-1 inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        All integrations
      </Link>
      {detail.status === "loading" ? (
        <div aria-busy="true" className="space-y-4">
          <span className="sr-only">Loading the connection…</span>
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      ) : detail.status === "error" ? (
        <ErrorText message={detail.message} />
      ) : (
        <Details detail={detail.data} />
      )}
    </div>
  );
}

function Details({ detail }: { detail: IntegrationConnectionDetail }) {
  const { connection } = detail;
  const has = (capability: IntegrationConnection["capabilities"][number]) =>
    connection.capabilities.includes(capability);
  return (
    <>
      <Header detail={detail} />
      <Services detail={detail} />
      {has("calendar") ? <Calendars detail={detail} /> : null}
      {has("mail") ? (
        <Section
          id="mail"
          icon={Mail}
          title={`${capabilityName(connection.provider, "mail")} settings`}
          description="What the inbox beside Tasks shows. Mail is read when you open it; nothing is copied."
        >
          <MailSettings connection={connection} />
        </Section>
      ) : null}
      <SyncActivity detail={detail} />
      <Permissions connection={connection} />
      <Disconnect connection={connection} />
    </>
  );
}

function Header({ detail }: { detail: IntegrationConnectionDetail }) {
  const { connection } = detail;
  const actions = useConnectionMutations(connection.id);
  const [error, setError] = useState<string | null>(null);
  const syncing = detail.runs.some((run) => run.status === "queued" || run.status === "running");
  const needsReconnect = connection.status === "reauth_required";

  return (
    <section
      aria-label="Connection"
      className="space-y-4 rounded-2xl border bg-card p-4 shadow-elevation-1 sm:p-5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <ProviderMark provider={connection.provider} />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="truncate text-base font-semibold">{connection.account_email}</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge
              variant={connection.status === "active" ? "brand" : "outline"}
              className={connection.status === "active" ? undefined : "text-destructive"}
            >
              {STATUS_LABELS[connection.status]}
            </Badge>
            {PROVIDER_NAMES[connection.provider]} · synced{" "}
            {formatSynced(connection.last_synced_at).toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="soft"
            size="sm"
            disabled={needsReconnect || syncing || actions.sync.isPending}
            onClick={() => {
              setError(null);
              actions.sync.mutate(undefined, {
                onError: (cause) => setError(describeApiError(cause, "Couldn’t start syncing.")),
              });
            }}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={actions.check.isPending}
            onClick={() => {
              setError(null);
              actions.check.mutate(undefined, {
                onError: (cause) => setError(describeApiError(cause, "Couldn’t check it.")),
              });
            }}
          >
            Check connection
          </Button>
        </div>
      </div>
      {needsReconnect ? (
        <p
          role="alert"
          className="flex gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Orbit lost access to this account, so it stopped synchronizing. Your imported data is
          kept. Reconnect below to continue.
        </p>
      ) : connection.last_error ? (
        <p className="text-sm text-destructive">{connection.last_error}</p>
      ) : null}
      {detail.conflicts > 0 ? (
        <p className="text-sm">
          {detail.conflicts === 1 ? "1 event" : `${detail.conflicts} events`} changed in both
          places.{" "}
          <Link href="/settings/integrations" className="font-medium text-brand hover:underline">
            Review conflicts
          </Link>
        </p>
      ) : null}
      <ErrorText message={error} />
    </section>
  );
}

/** Each granted service, with a way to where it's used in Orbit. */
function Services({ detail }: { detail: IntegrationConnectionDetail }) {
  const { connection } = detail;
  const has = (capability: IntegrationConnection["capabilities"][number]) =>
    connection.capabilities.includes(capability);
  const shown = detail.resources.filter((calendar) => calendar.enabled).length;
  const tiles: ServiceTileProps[] = [];
  if (has("calendar")) {
    tiles.push({
      icon: CalendarDays,
      title: capabilityName(connection.provider, "calendar"),
      text:
        detail.resources.length === 0
          ? "No calendars found yet."
          : `${shown} of ${detail.resources.length} calendars shown in Orbit.`,
      href: "/calendar",
      linkLabel: "Open Calendar",
    });
  }
  if (has("mail")) {
    tiles.push({
      icon: Mail,
      title: capabilityName(connection.provider, "mail"),
      text: "Opens beside Tasks. Turn an email into a task, note, or reminder.",
      href: inboxHref(connection.id),
      linkLabel: "Open inbox",
    });
  }
  if (has("files")) {
    tiles.push({
      icon: FolderOpen,
      title: capabilityName(connection.provider, "files"),
      text: "Browse it in Documents and import the files you want to keep.",
      href: driveHref(connection.id),
      linkLabel: "Browse in Documents",
    });
  }
  if (tiles.length === 0) return null;
  return (
    <section aria-label="Services" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tiles.map((tile) => (
        <ServiceTile key={tile.title} {...tile} />
      ))}
    </section>
  );
}

type ServiceTileProps = {
  icon: LucideIcon;
  title: string;
  text: string;
  href: string;
  linkLabel: string;
};

function ServiceTile({ icon: Icon, title, text, href, linkLabel }: ServiceTileProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-elevation-1">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand"
        >
          <Icon className="size-4.5" />
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="flex-1 text-sm text-pretty text-muted-foreground">{text}</p>
      <Link
        href={href}
        className="inline-flex items-center gap-1 self-start rounded-md text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {linkLabel}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function Calendars({ detail }: { detail: IntegrationConnectionDetail }) {
  const { connection } = detail;
  const actions = useConnectionMutations(connection.id);
  const [error, setError] = useState<string | null>(null);
  return (
    <Section
      id="calendars"
      icon={CalendarDays}
      title={capabilityName(connection.provider, "calendar")}
      description="Choose which calendars to show."
      action={
        <Button
          variant="ghost"
          size="sm"
          disabled={actions.refreshCalendars.isPending}
          onClick={() => {
            setError(null);
            actions.refreshCalendars.mutate(undefined, {
              onError: (cause) => setError(describeApiError(cause, "Couldn’t list calendars.")),
            });
          }}
        >
          Refresh list
        </Button>
      }
    >
      <ErrorText message={error} />
      {detail.resources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No calendars found in this account.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {detail.resources.map((calendar) => (
            <CalendarRow key={calendar.id} connection={connection} calendar={calendar} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function CalendarRow({
  connection,
  calendar,
}: {
  connection: IntegrationConnection;
  calendar: IntegrationCalendar;
}) {
  const id = useId();
  const actions = useConnectionMutations(connection.id);
  const { categories } = useCalendarCategories(useActiveWorkspaceId());
  const [error, setError] = useState<string | null>(null);
  const canWrite = calendar.writable && connection.capabilities.includes("calendar_write");

  const save = (body: Partial<UpdateIntegrationCalendarRequest>) => {
    setError(null);
    actions.updateCalendar.mutate(
      { id: calendar.id, body: { clear_category: false, ...body } },
      { onError: (cause) => setError(describeApiError(cause, "Couldn’t save this calendar.")) },
    );
  };

  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {calendar.name}
            {!calendar.writable ? <Badge variant="outline">Read only</Badge> : null}
          </label>
          <p className="text-xs text-muted-foreground">
            {calendar.enabled
              ? `Synced ${formatSynced(calendar.last_synced_at).toLowerCase()}${calendar.push ? " · live updates" : ""}`
              : "Not shown in Orbit"}
          </p>
          {calendar.last_error ? (
            <p className="text-xs text-destructive">{calendar.last_error}</p>
          ) : null}
        </div>
        <Switch
          id={id}
          checked={calendar.enabled}
          disabled={actions.updateCalendar.isPending}
          onCheckedChange={(enabled) => save({ enabled })}
        />
      </div>
      {calendar.enabled ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Changes</p>
            <Select
              aria-label={`Sync direction for ${calendar.name}`}
              value={calendar.direction}
              disabled={!canWrite}
              options={DIRECTIONS}
              onValueChange={(direction) => save({ direction })}
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Checks</p>
            <Select
              aria-label={`How often to sync ${calendar.name}`}
              value={
                String(calendar.sync_interval_minutes) as (typeof SYNC_INTERVALS)[number]["value"]
              }
              options={SYNC_INTERVALS}
              onValueChange={(value) =>
                save({ sync_interval_minutes: Number(value) as 0 | 15 | 30 | 60 | 360 | 1440 })
              }
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Category in Orbit</p>
            <Select
              aria-label={`Category for events from ${calendar.name}`}
              value={calendar.category_id ?? NO_CATEGORY}
              options={[
                { value: NO_CATEGORY, label: "None" },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
              onValueChange={(value) =>
                save(value === NO_CATEGORY ? { clear_category: true } : { category_id: value })
              }
            />
          </div>
          <p className="text-xs text-pretty text-muted-foreground sm:col-span-3">
            {calendar.direction === "two_way"
              ? "Edits you make in Orbit to single events go back to this calendar. Repeating events and deletions stay in Orbit."
              : canWrite
                ? "Edits you make in Orbit stay in Orbit."
                : "Edits you make in Orbit stay in Orbit. To send them back, reconnect with permission to edit events."}
          </p>
        </div>
      ) : null}
      <ErrorText message={error} />
    </li>
  );
}

function SyncActivity({ detail }: { detail: IntegrationConnectionDetail }) {
  const actions = useConnectionMutations(detail.connection.id);
  const names = new Map(detail.resources.map((r) => [r.id, r.name]));
  const [all, setAll] = useState(false);
  const recent = detail.runs.slice(0, 10);
  const runs = all ? recent : recent.slice(0, 3);
  return (
    <Section
      id="activity"
      icon={Activity}
      title="Sync activity"
      action={
        recent.length > 3 ? (
          <Button variant="ghost" size="sm" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? "Show less" : `Show ${recent.length - 3} more`}
          </Button>
        ) : null
      }
    >
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has been synchronized yet.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              name={runKindLabel(run, run.resource_id ? names.get(run.resource_id) : undefined)}
              onRetry={() => actions.retryRun.mutate(run.id)}
              onCancel={() => actions.cancelRun.mutate(run.id)}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function RunRow({
  run,
  name,
  onRetry,
  onCancel,
}: {
  run: IntegrationSyncRun;
  name: string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const open = run.status === "queued" || run.status === "running";
  const summary = runSummary(run);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">
          {name} <span className="font-normal text-muted-foreground">· {runStatusLabel(run)}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {formatSynced(run.finished_at ?? run.created_at)}
          {summary ? ` · ${summary}` : ""}
          {run.skipped ? ` · ${run.skipped} unchanged` : ""}
        </p>
        {run.error ? <p className="text-xs text-destructive">{run.error}</p> : null}
      </div>
      {open ? (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      ) : run.status === "failed" || run.status === "partial" ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </li>
  );
}

function Permissions({ connection }: { connection: IntegrationConnection }) {
  const providers = useIntegrationProviders();
  const offered = providers.status === "success" ? providers.data.providers : [];
  const info = offered.find((p) => p.provider === connection.provider);
  return (
    <>
      <Section
        id="permissions"
        icon={KeyRound}
        title="What Orbit can access"
        description="Granted when you connected."
      >
        <ul className="space-y-2">
          {connection.capabilities.map((capability) => (
            <li key={capability} className="text-sm">
              <span className="font-medium">{capabilityName(connection.provider, capability)}</span>
              <span className="text-muted-foreground">
                {" "}
                — {info?.capabilities.find((c) => c.capability === capability)?.purpose ?? ""}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      {info ? (
        <ConnectAccount
          providers={[info]}
          reconnect={{
            connectionId: connection.id,
            provider: connection.provider,
            granted: connection.capabilities,
          }}
        />
      ) : null}
    </>
  );
}

function Disconnect({ connection }: { connection: IntegrationConnection }) {
  const id = useId();
  const router = useRouter();
  const actions = useConnectionMutations(connection.id);
  const { confirm, confirmDialog } = useConfirm();
  const [removeImported, setRemoveImported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = PROVIDER_NAMES[connection.provider];

  const run = async () => {
    const kept = removeImported
      ? "The events it imported are deleted and imported documents move to the trash."
      : "Imported events and documents stay in Orbit.";
    const revocation =
      connection.provider === "microsoft"
        ? `Orbit deletes its tokens. ${provider} doesn’t let apps revoke their own access, so also remove Orbit from your account’s app permissions.`
        : `Orbit revokes its access at ${provider} and deletes its tokens.`;
    const confirmed = await confirm({
      title: `Disconnect ${connection.account_email}?`,
      description: `${revocation} ${kept}`,
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!confirmed) return;
    setError(null);
    actions.disconnect.mutate(removeImported, {
      onSuccess: () => router.push("/settings/integrations"),
      onError: (cause) => setError(describeApiError(cause, "Couldn’t disconnect.")),
    });
  };

  return (
    <Section id="disconnect" icon={Unplug} title="Disconnect">
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={removeImported}
          onChange={(event) => setRemoveImported(event.currentTarget.checked)}
          className="mt-0.5"
        />
        <label htmlFor={id} className="text-sm">
          Also remove the events and documents imported from this account
        </label>
      </div>
      <ErrorText message={error} />
      <Button
        variant="destructive"
        onClick={() => void run()}
        disabled={actions.disconnect.isPending}
      >
        Disconnect account
      </Button>
      {confirmDialog}
    </Section>
  );
}
