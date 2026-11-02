"use client";

import type { IntegrationConnection, MailLabel, MailMessage } from "@orbit/contracts";
import { ExternalLink, Search } from "lucide-react";
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
import { capabilityName, ENTITY_LABELS, linkedRecordHref, MAIL_PERIODS } from "@/lib/integrations";
import { addDays, localDateString } from "@/utils/dates";

import { ErrorText } from "./section";

const TITLE_LIMIT = 200;
const DESCRIPTION_LIMIT = 5000;
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const value = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
  return { value, label: value };
});

export function MailBrowser({ connection }: { connection: IntegrationConnection }) {
  const labels = useMailLabels(connection.id);
  if (labels.status === "loading") return <Skeleton className="h-24 w-full rounded-xl" />;
  if (labels.status === "error") return <ErrorText message={labels.message} />;
  const selected = labels.data.labels.filter((label) => label.selected);
  return (
    <div className="space-y-5">
      <MailScope connection={connection} labels={labels.data.labels} />
      {selected.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Choose at least one label above to see its messages here.
        </p>
      ) : (
        <Messages connection={connection} labels={selected} />
      )}
    </div>
  );
}

/** Which labels Orbit may list, and how far back. */
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

  return (
    <div className="space-y-4">
      <form role="search" onSubmit={submit} className="flex flex-wrap gap-2">
        <Select
          aria-label="Label"
          className="w-44"
          value={current}
          options={labels.map((l) => ({ value: l.id, label: l.name }))}
          onValueChange={(value) => {
            setLabelId(value);
            setOpen(null);
          }}
        />
        <Input
          aria-label="Search mail"
          placeholder="Search mail"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="ghost" size="icon" aria-label="Search">
          <Search className="size-4" aria-hidden="true" />
        </Button>
      </form>
      {messages.status === "loading" ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : messages.status === "error" ? (
        <ErrorText message={messages.message} />
      ) : messages.data.messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {search ? "No messages match." : "No messages in this period."}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {messages.data.messages.map((message) => (
            <li key={message.id}>
              <MessageRow
                message={message}
                expanded={open === message.id}
                onToggle={() => setOpen(open === message.id ? null : message.id)}
              />
              {open === message.id ? (
                <MessageView connection={connection} messageId={message.id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageRow({
  message,
  expanded,
  onToggle,
}: {
  message: MailMessage;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="flex w-full flex-col gap-0.5 px-4 py-3 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium">{message.subject || "(No subject)"}</span>
        <time dateTime={message.received_at} className="shrink-0 text-xs text-muted-foreground">
          {new Date(message.received_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </time>
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {message.sender} — {message.snippet}
      </span>
    </button>
  );
}

/** One message, read from the provider when opened, with actions that turn it into records. */
function MessageView({
  connection,
  messageId,
}: {
  connection: IntegrationConnection;
  messageId: string;
}) {
  const detail = useMessage(connection.id, messageId);
  const actions = useConnectionMutations(connection.id);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [reminding, setReminding] = useState(false);

  if (detail.status === "loading") return <Skeleton className="m-4 h-24 rounded-xl" />;
  if (detail.status === "error") {
    return (
      <div className="px-4 pb-4">
        <ErrorText message={detail.message} />
      </div>
    );
  }
  const { message, body, recipients, links } = detail.data;
  const title = (message.subject || "Email").slice(0, TITLE_LIMIT);
  const context = [`From ${message.sender}`, message.url ?? ""].filter(Boolean).join("\n");

  const create = (record: RecordFromMessage, done: string) => {
    setError(null);
    setCreated(null);
    actions.createFromMessage.mutate(
      { messageId, record },
      {
        onSuccess: () => {
          setCreated(done);
          setReminding(false);
        },
        onError: (cause) => setError(describeApiError(cause, "Couldn’t create it.")),
      },
    );
  };

  return (
    <article
      aria-label={message.subject || "Message"}
      className="space-y-3 border-t bg-muted/30 px-4 py-4"
    >
      <div className="space-y-0.5 text-xs text-muted-foreground">
        <p>From {message.sender}</p>
        {recipients.length ? <p>To {recipients.join(", ")}</p> : null}
      </div>
      <p className="max-h-72 overflow-y-auto text-sm whitespace-pre-wrap">
        {body || message.snippet}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="soft"
          disabled={actions.createFromMessage.isPending}
          onClick={() =>
            create(
              { kind: "task", body: { title, description: context.slice(0, DESCRIPTION_LIMIT) } },
              "Task created.",
            )
          }
        >
          Create task
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={actions.createFromMessage.isPending}
          onClick={() =>
            create(
              { kind: "note", body: { title, text: `${context}\n\n${body}`.slice(0, 20_000) } },
              "Note created in your Inbox.",
            )
          }
        >
          Save as note
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={reminding}
          onClick={() => setReminding(!reminding)}
        >
          Remind me
        </Button>
        {message.url ? (
          <a
            href={message.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-md px-3 text-sm text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open in {capabilityName(connection.provider, "mail")}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </div>
      {reminding ? (
        <ReminderForm
          pending={actions.createFromMessage.isPending}
          onSubmit={(date, time) =>
            create(
              {
                kind: "reminder",
                body: {
                  title,
                  start_date: date,
                  time_of_day: time,
                  description: context.slice(0, 2000),
                },
              },
              "Reminder set.",
            )
          }
        />
      ) : null}
      {created ? (
        <p role="status" className="text-sm text-brand">
          {created}
        </p>
      ) : null}
      <ErrorText message={error} />
      {links.length ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Made from this email</p>
          <ul className="flex flex-wrap gap-2">
            {links.map((link) => (
              <li key={link.id}>
                <Link
                  href={linkedRecordHref(link.entity_type, link.entity_id)}
                  className="text-sm text-brand hover:underline"
                >
                  {ENTITY_LABELS[link.entity_type]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
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
      className="flex flex-wrap items-center gap-2"
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
