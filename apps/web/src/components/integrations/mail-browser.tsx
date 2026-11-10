"use client";

import type { IntegrationConnection, MailLabel, MailMessage } from "@orbit/contracts";
import {
  AlarmClock,
  ArrowLeft,
  CheckSquare,
  ExternalLink,
  Inbox,
  type LucideIcon,
  Search,
  StickyNote,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import type { RecordFromMessage } from "@/api/integrations";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useConnectionMutations,
  useMailLabels,
  useMessage,
  useMessages,
} from "@/hooks/use-integrations";
import {
  capabilityName,
  connectionHref,
  ENTITY_LABELS,
  linkedRecordHref,
  MAIL_PERIODS,
} from "@/lib/integrations";
import { cn } from "@/utils/common";
import { addDays, localDateString } from "@/utils/dates";

import { ErrorText } from "./section";

const TITLE_LIMIT = 200;
const DESCRIPTION_LIMIT = 5000;
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const value = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
  return { value, label: value };
});

/** Settings for a connection's mail: which labels Orbit may list, and how far back. */
export function MailSettings({ connection }: { connection: IntegrationConnection }) {
  const labels = useMailLabels(connection.id);
  if (labels.status === "loading") return <Skeleton className="h-24 w-full rounded-xl" />;
  if (labels.status === "error") return <ErrorText message={labels.message} />;
  return <MailScope connection={connection} labels={labels.data.labels} />;
}

function MailScope({
  connection,
  labels,
}: {
  connection: IntegrationConnection;
  labels: MailLabel[];
}) {
  const id = useId();
  const actions = useConnectionMutations(connection.id);
  const [chosen, setChosen] = useState(() => labels.filter((l) => l.selected).map((l) => l.id));
  const [error, setError] = useState<string | null>(null);
  const changed =
    chosen.length !== labels.filter((l) => l.selected).length ||
    labels.some((l) => l.selected !== chosen.includes(l.id));

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">
        Labels Orbit may show from {capabilityName(connection.provider, "mail")}
      </legend>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {labels.map((label) => (
          <li key={label.id} className="flex items-center gap-2">
            <Checkbox
              id={`${id}-${label.id}`}
              checked={chosen.includes(label.id)}
              onChange={(event) => {
                const on = event.currentTarget.checked;
                setChosen((current) =>
                  on ? [...current, label.id] : current.filter((value) => value !== label.id),
                );
              }}
            />
            <label htmlFor={`${id}-${label.id}`} className="text-sm">
              {label.name}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="soft"
          disabled={!changed || actions.selectLabels.isPending}
          onClick={() => {
            setError(null);
            actions.selectLabels.mutate(chosen, {
              onError: (cause) => setError(describeApiError(cause, "Couldn’t save labels.")),
            });
          }}
        >
          Save labels
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Show mail from</span>
          <Select
            aria-label="How far back to show mail"
            className="w-40"
            value={String(connection.mail_days) as (typeof MAIL_PERIODS)[number]["value"]}
            options={MAIL_PERIODS}
            onValueChange={(value) =>
              actions.update.mutate(Number(value) as 7 | 30 | 90 | 365, {
                onError: (cause) => setError(describeApiError(cause, "Couldn’t save the period.")),
              })
            }
          />
        </div>
      </div>
      <ErrorText message={error} />
    </fieldset>
  );
}

/**
 * Mail from connected accounts, read on demand: switch account and label, search, open a
 * message, and turn it into a task, note, or reminder without leaving the page.
 */
export function MailInbox({
  connections,
  initialConnectionId,
}: {
  connections: IntegrationConnection[];
  initialConnectionId?: string | null;
}) {
  const [connectionId, setConnectionId] = useState(
    () => connections.find((c) => c.id === initialConnectionId)?.id ?? connections[0]?.id ?? "",
  );
  const connection = connections.find((c) => c.id === connectionId) ?? connections[0];
  if (!connection) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {connections.length > 1 ? (
        <Select
          aria-label="Account"
          value={connection.id}
          options={connections.map((c) => ({ value: c.id, label: c.account_email }))}
          onValueChange={setConnectionId}
        />
      ) : null}
      <AccountMail key={connection.id} connection={connection} />
    </div>
  );
}

function AccountMail({ connection }: { connection: IntegrationConnection }) {
  const labels = useMailLabels(connection.id);
  if (labels.status === "loading") {
    return (
      <div aria-busy="true" className="space-y-2">
        <span className="sr-only">Loading mail…</span>
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  if (labels.status === "error") return <ErrorText message={labels.message} />;
  const selected = labels.data.labels.filter((label) => label.selected);
  if (selected.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
        <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-pretty text-muted-foreground">
          Choose which labels Orbit may show, and your mail appears here.
        </p>
        <Link
          href={`${connectionHref(connection.id)}#mail`}
          className="text-sm font-medium text-brand hover:underline"
        >
          Choose labels
        </Link>
      </div>
    );
  }
  return <Messages connection={connection} labels={selected} />;
}

function Messages({
  connection,
  labels,
}: {
  connection: IntegrationConnection;
  labels: MailLabel[];
}) {
  const [labelId, setLabelId] = useState(labels[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const current = labels.some((l) => l.id === labelId) ? labelId : (labels[0]?.id ?? "");
  const messages = useMessages(
    connection.id,
    current ? { labelId: current, search: search || undefined } : null,
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSearch(draft.trim());
    setOpen(null);
  };

  if (open) {
    return <MessageView connection={connection} messageId={open} onBack={() => setOpen(null)} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {labels.length > 1 ? (
        <div
          role="group"
          aria-label="Label"
          className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1"
        >
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              aria-pressed={label.id === current}
              onClick={() => setLabelId(label.id)}
              className={cn(
                "h-8 shrink-0 rounded-full px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                label.id === current
                  ? "bg-brand-subtle text-brand"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {label.name}
            </button>
          ))}
        </div>
      ) : null}
      <form role="search" onSubmit={submit} className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          aria-label="Search mail"
          placeholder="Search mail"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          className="pl-9"
        />
      </form>
      {search ? (
        <p className="text-sm text-muted-foreground">
          Results for “{search}”.{" "}
          <button
            type="button"
            className="font-medium text-brand hover:underline"
            onClick={() => {
              setSearch("");
              setDraft("");
            }}
          >
            Clear search
          </button>
        </p>
      ) : null}
      {messages.status === "loading" ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">Loading messages…</span>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : messages.status === "error" ? (
        <ErrorText message={messages.message} />
      ) : messages.data.messages.length === 0 ? (
        <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          {search ? "No messages match." : "No messages in this period."}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {messages.data.messages.map((message) => (
            <li key={message.id}>
              <MessageRow message={message} onOpen={() => setOpen(message.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Shop <shop@example.com>" → "Shop"; a bare address stays as it is. */
function senderName(sender: string): string {
  const name = sender
    .replace(/<[^>]*>/, "")
    .replaceAll('"', "")
    .trim();
  return name || sender;
}

function receivedLabel(at: string, now: Date = new Date()): string {
  const date = new Date(at);
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MessageRow({ message, onOpen }: { message: MailMessage; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 px-4 py-3 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-semibold">{senderName(message.sender)}</span>
        <time dateTime={message.received_at} className="shrink-0 text-xs text-muted-foreground">
          {receivedLabel(message.received_at)}
        </time>
      </span>
      <span className="truncate text-sm">{message.subject || "(No subject)"}</span>
      <span className="truncate text-xs text-muted-foreground">{message.snippet}</span>
    </button>
  );
}

type Made = { kind: RecordFromMessage["kind"]; id: string };

const MADE_TEXT: Readonly<Record<RecordFromMessage["kind"], string>> = {
  task: "Added to your tasks.",
  note: "Saved to your notes Inbox.",
  reminder: "Reminder set.",
};

/** One message, read from the provider when opened, with actions that turn it into records. */
function MessageView({
  connection,
  messageId,
  onBack,
}: {
  connection: IntegrationConnection;
  messageId: string;
  onBack: () => void;
}) {
  const detail = useMessage(connection.id, messageId);
  const actions = useConnectionMutations(connection.id);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [reminding, setReminding] = useState(false);

  const back = (
    <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={onBack}>
      <ArrowLeft aria-hidden="true" />
      All messages
    </Button>
  );

  if (detail.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  if (detail.status === "error") {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <ErrorText message={detail.message} />
      </div>
    );
  }
  const { message, body, recipients, links } = detail.data;
  const title = (message.subject || "Email").slice(0, TITLE_LIMIT);
  const context = [`From ${message.sender}`, message.url ?? ""].filter(Boolean).join("\n");

  const create = (record: RecordFromMessage) => {
    setError(null);
    setMade(null);
    actions.createFromMessage.mutate(
      { messageId, record },
      {
        onSuccess: (created) => {
          setMade({ kind: record.kind, id: created.id });
          setReminding(false);
        },
        onError: (cause) => setError(describeApiError(cause, "Couldn’t create it.")),
      },
    );
  };
  const pending = actions.createFromMessage.isPending;

  return (
    <article aria-label={message.subject || "Message"} className="flex min-h-0 flex-col gap-4">
      {back}
      <header className="space-y-1">
        <h3 className="text-base font-semibold text-balance">
          {message.subject || "(No subject)"}
        </h3>
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>
            From {message.sender} ·{" "}
            <time dateTime={message.received_at}>
              {new Date(message.received_at).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </p>
          {recipients.length ? <p className="truncate">To {recipients.join(", ")}</p> : null}
        </div>
      </header>

      <div
        role="group"
        aria-label="Make something from this email"
        className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-2"
      >
        <ActionButton
          icon={CheckSquare}
          label="Add as task"
          primary
          disabled={pending}
          onClick={() =>
            create({
              kind: "task",
              body: { title, description: context.slice(0, DESCRIPTION_LIMIT) },
            })
          }
        />
        <ActionButton
          icon={StickyNote}
          label="Save as note"
          disabled={pending}
          onClick={() =>
            create({
              kind: "note",
              body: { title, text: `${context}\n\n${body}`.slice(0, 20_000) },
            })
          }
        />
        <ActionButton
          icon={AlarmClock}
          label="Remind me"
          expanded={reminding}
          onClick={() => setReminding(!reminding)}
        />
        {message.url ? (
          <a
            href={message.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open in {capabilityName(connection.provider, "mail")}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        ) : null}
        {reminding ? (
          <ReminderForm
            pending={pending}
            onSubmit={(date, time) =>
              create({
                kind: "reminder",
                body: {
                  title,
                  start_date: date,
                  time_of_day: time,
                  description: context.slice(0, 2000),
                },
              })
            }
          />
        ) : null}
      </div>

      <p role="status" className="text-sm empty:hidden">
        {made ? (
          <span className="flex flex-wrap items-center gap-x-2 text-success">
            {MADE_TEXT[made.kind]}
            <Link
              href={linkedRecordHref(made.kind, made.id)}
              className="font-medium text-brand hover:underline"
            >
              View {ENTITY_LABELS[made.kind].toLowerCase()}
            </Link>
          </span>
        ) : null}
      </p>
      <ErrorText message={error} />

      {links.length ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">Made from this email:</span>
          {links.map((link) => (
            <Link
              key={link.id}
              href={linkedRecordHref(link.entity_type, link.entity_id)}
              className="rounded-full bg-brand-subtle px-2 py-0.5 font-medium text-brand hover:underline"
            >
              {ENTITY_LABELS[link.entity_type]}
            </Link>
          ))}
        </div>
      ) : null}

      <p className="text-sm leading-relaxed whitespace-pre-wrap">{body || message.snippet}</p>
    </article>
  );
}

function ActionButton({
  icon: Icon,
  label,
  primary = false,
  expanded,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  primary?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={primary ? "default" : "soft"}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
      {label}
    </Button>
  );
}

function ReminderForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (date: string, time: string) => void;
}) {
  const [date, setDate] = useState(() => addDays(localDateString(), 1));
  const [time, setTime] = useState("09:00");
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(date, time);
      }}
    >
      <DatePicker
        aria-label="Reminder date"
        value={date}
        onValueChange={setDate}
        className="w-44"
      />
      <Select
        aria-label="Reminder time"
        value={time}
        options={TIMES}
        onValueChange={setTime}
        className="w-28"
      />
      <Button type="submit" size="sm" disabled={pending || !date}>
        Set reminder
      </Button>
    </form>
  );
}
