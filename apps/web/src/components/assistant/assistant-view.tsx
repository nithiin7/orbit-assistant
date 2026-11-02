"use client";

import type { AiMessage, AiProposal, AiSettings } from "@orbit/contracts";
import {
  ArrowUp,
  Bot,
  CircleAlert,
  Cloud,
  HardDrive,
  MessageSquarePlus,
  MoreHorizontal,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  type PendingTurn,
  useAiSettings,
  useAssistantChat,
  useConversation,
  useConversationMutations,
  useConversations,
} from "@/hooks/use-ai";
import { processingLabel, suggestedQuestions } from "@/lib/ai";
import { settingsHref } from "@/lib/settings";
import { cn } from "@/utils/common";

import { Answer, Sources } from "./answer";
import { InsightsPanel } from "./insights-panel";
import { ProposalCard } from "./proposal-card";
import { RenameDialog } from "./rename-dialog";

/** The assistant page: conversations beside the open one. The open conversation is in the URL. */
export function AssistantView() {
  const settings = useAiSettings();
  if (settings.status === "loading") {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }
  if (settings.status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {settings.message}
      </p>
    );
  }
  const ready =
    settings.data.server_enabled &&
    settings.data.enabled &&
    settings.data.chat_provider_id !== null &&
    settings.data.chat_model !== null;
  if (!ready) return <SetupNotice settings={settings.data} />;
  return <Assistant settings={settings.data} />;
}

function SetupNotice({ settings }: { settings: AiSettings }) {
  if (!settings.server_enabled) {
    return (
      <EmptyState
        icon={Bot}
        title="AI is turned off on this server"
        description="The person who runs this Orbit server has disabled AI. Everything else works as usual."
      />
    );
  }
  return (
    <EmptyState
      icon={Bot}
      title={settings.enabled ? "Choose a model to start" : "AI is off"}
      description="Turn on AI and choose a provider in Settings. You decide which modules it may read, and whether anything leaves this device."
    >
      <Link
        href={settingsHref("ai")}
        className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Set up AI
      </Link>
    </EmptyState>
  );
}

function Assistant({ settings }: { settings: AiSettings }) {
  const params = useSearchParams();
  const router = useRouter();
  const conversationId = params.get("c");
  const initialQuestion = params.get("q");
  // Changes only when the person opens a conversation or starts a new one, not when a new
  // conversation's first answer reports its ID, so a streaming answer isn't remounted away.
  const [chatKey, setChatKey] = useState(() => conversationId ?? "new");

  const show = (id: string | null) => {
    router.replace(id ? `/assistant?c=${encodeURIComponent(id)}` : "/assistant", { scroll: false });
  };
  const open = (id: string | null) => {
    setChatKey(id ?? `new-${Date.now()}`);
    show(id);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <ConversationList activeId={conversationId} onOpen={open} />
      <Chat
        key={chatKey}
        conversationId={conversationId}
        initialQuestion={conversationId ? null : initialQuestion}
        settings={settings}
        onConversation={show}
      />
    </div>
  );
}

function ConversationList({
  activeId,
  onOpen,
}: {
  activeId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const conversations = useConversations();
  const { rename, remove } = useConversationMutations();
  const { confirm, confirmDialog } = useConfirm();
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  return (
    <nav aria-label="Conversations" className="space-y-2">
      <Button variant="soft" className="w-full justify-start" onClick={() => onOpen(null)}>
        <MessageSquarePlus aria-hidden="true" />
        New conversation
      </Button>
      {conversations.status === "loading" ? (
        <Skeleton className="h-24 w-full" />
      ) : conversations.status === "error" ? (
        <p role="alert" className="text-xs text-destructive">
          {conversations.message}
        </p>
      ) : conversations.data.conversations.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">No conversations yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {conversations.data.conversations.map((conversation) => (
            <li key={conversation.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => onOpen(conversation.id)}
                aria-current={conversation.id === activeId ? "page" : undefined}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                  conversation.id === activeId && "bg-accent font-medium",
                )}
              >
                {conversation.title}
              </button>
              <Menu
                aria-label={`Options for ${conversation.title}`}
                variant="ghost"
                size="icon"
                align="end"
                className="size-7 opacity-60 group-hover:opacity-100"
                items={[
                  {
                    id: "rename",
                    label: "Rename",
                    onSelect: () => setRenaming({ id: conversation.id, title: conversation.title }),
                  },
                  {
                    id: "delete",
                    label: "Delete",
                    destructive: true,
                    onSelect: () => {
                      void confirm({
                        title: "Delete this conversation?",
                        description: "Its messages are deleted. Records created from it stay.",
                        confirmLabel: "Delete",
                        destructive: true,
                      }).then((yes) => {
                        if (!yes) return;
                        remove.mutate(conversation.id);
                        if (conversation.id === activeId) onOpen(null);
                      });
                    },
                  },
                ]}
              >
                <MoreHorizontal aria-hidden="true" />
              </Menu>
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
      {renaming ? (
        <RenameDialog
          initialTitle={renaming.title}
          onSave={(title) => rename.mutateAsync({ id: renaming.id, title })}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </nav>
  );
}

function Chat({
  conversationId,
  initialQuestion,
  settings,
  onConversation,
}: {
  conversationId: string | null;
  initialQuestion: string | null;
  settings: AiSettings;
  onConversation: (id: string) => void;
}) {
  const detail = useConversation(conversationId);
  const chat = useAssistantChat(conversationId, onConversation);
  const sentInitial = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  const { ready, send } = chat;
  useEffect(() => {
    if (initialQuestion && ready && !sentInitial.current) {
      sentInitial.current = true;
      void send(initialQuestion);
    }
  }, [initialQuestion, ready, send]);

  const pendingText = chat.pending?.text;
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [pendingText, detail.status]);

  const messages = detail.status === "success" ? detail.data.messages : [];
  const proposals = detail.status === "success" ? detail.data.proposals : [];
  const empty = conversationId === null && chat.pending === null;

  return (
    <section aria-label="Conversation" className="flex min-h-[60vh] flex-col gap-4">
      {empty ? (
        <Welcome settings={settings} onAsk={(question) => void chat.send(question)} />
      ) : detail.status === "loading" && conversationId !== null && chat.pending === null ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : detail.status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {detail.message}
        </p>
      ) : (
        <ol className="space-y-5" aria-live="polite" aria-busy={chat.streaming}>
          {visibleMessages(messages, chat.pending).map((message) => (
            <MessageItem key={message.id} message={message} proposals={proposals} />
          ))}
          {chat.pending ? <PendingItem pending={chat.pending} /> : null}
          {chat.proposals
            .filter((p) => !proposals.some((known) => known.id === p.id))
            .map((proposal) => (
              <li key={proposal.id}>
                <ProposalCard proposal={proposal} />
              </li>
            ))}
        </ol>
      )}
      <div ref={endRef} />
      <Composer
        streaming={chat.streaming}
        onSend={(text) => void chat.send(text)}
        onStop={chat.stop}
      />
      <p className="text-xs text-muted-foreground">
        Answers use only the modules you allow in{" "}
        <Link href={settingsHref("ai")} className="text-brand hover:underline">
          AI settings
        </Link>
        . Check important details against the sources.
      </p>
    </section>
  );
}

/** Saved messages, without the question the pending turn is still answering (it shows there). */
function visibleMessages(messages: AiMessage[], pending: PendingTurn | null): AiMessage[] {
  if (!pending) return messages;
  const last = messages.at(-1);
  return last && last.role === "user" && last.content === pending.question
    ? messages.slice(0, -1)
    : messages;
}

function Welcome({ settings, onAsk }: { settings: AiSettings; onAsk: (q: string) => void }) {
  const questions = suggestedQuestions(settings.modules);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">What would you like to know?</h2>
        <p className="text-sm text-muted-foreground">
          Ask about your tasks, schedule, notes, and anything else you’ve allowed. Orbit answers
          from your own records and shows where each fact came from.
        </p>
      </div>
      {questions.length ? (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Suggested questions">
          {questions.map((question) => (
            <li key={question}>
              <button
                type="button"
                onClick={() => onAsk(question)}
                className="w-full rounded-xl border bg-card p-3 text-left text-sm shadow-elevation-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                {question}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <InsightsPanel />
    </div>
  );
}

function MessageItem({ message, proposals }: { message: AiMessage; proposals: AiProposal[] }) {
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-subtle px-4 py-2 text-sm whitespace-pre-wrap">
          {message.content}
        </p>
      </li>
    );
  }
  const own = proposals.filter((p) => p.message_id === message.id);
  return (
    <li className="space-y-3">
      <div
        className={cn(
          "space-y-3 rounded-2xl rounded-bl-sm border bg-card p-4 shadow-elevation-1",
          message.status === "error" && "border-destructive/40",
        )}
      >
        {message.status === "error" ? (
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <CircleAlert className="size-4" aria-hidden="true" />
            {message.content}
          </p>
        ) : (
          <Answer id={message.id} text={message.content} citations={message.citations} />
        )}
        {message.status === "stopped" ? (
          <p className="text-xs text-muted-foreground">Stopped before finishing.</p>
        ) : null}
        {message.status !== "error" ? (
          <Sources id={message.id} citations={message.citations} />
        ) : null}
        <ProviderLine
          name={message.provider_name}
          model={message.model}
          processing={message.processing}
        />
      </div>
      {own.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
    </li>
  );
}

function PendingItem({ pending }: { pending: PendingTurn }) {
  return (
    <>
      <li className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-subtle px-4 py-2 text-sm whitespace-pre-wrap">
          {pending.question}
        </p>
      </li>
      <li className="space-y-3 rounded-2xl rounded-bl-sm border bg-card p-4 shadow-elevation-1">
        {pending.status === "error" ? (
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <CircleAlert className="size-4" aria-hidden="true" />
            {pending.error}
          </p>
        ) : pending.text ? (
          <Answer id="pending" text={pending.text} citations={pending.citations} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {pending.citations.length
              ? `Reading ${pending.citations.length} source${pending.citations.length === 1 ? "" : "s"}…`
              : "Thinking…"}
          </p>
        )}
        {pending.provider ? (
          <ProviderLine
            name={pending.provider.name}
            model={pending.provider.model}
            processing={pending.provider.processing}
          />
        ) : null}
      </li>
    </>
  );
}

function ProviderLine({
  name,
  model,
  processing,
}: {
  name: string | null;
  model: string | null;
  processing: AiMessage["processing"];
}) {
  if (!name || !processing) return null;
  const Icon = processing === "local" ? HardDrive : Cloud;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5" aria-hidden="true" />
      {name}
      {model ? ` · ${model}` : ""} · {processingLabel(processing)}
    </p>
  );
}

function Composer({
  streaming,
  onSend,
  onStop,
}: {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const question = text.trim();
    if (!question || streaming) return;
    onSend(question);
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <form
      onSubmit={submit}
      className="sticky bottom-4 flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-elevation-2"
    >
      <label htmlFor="assistant-input" className="sr-only">
        Ask Orbit
      </label>
      <Textarea
        id="assistant-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about your tasks, schedule, notes…"
        rows={1}
        maxLength={4000}
        className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      {streaming ? (
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={onStop}
          aria-label="Stop answering"
        >
          <Square aria-hidden="true" />
        </Button>
      ) : (
        <Button type="submit" size="icon" aria-label="Send" disabled={!text.trim()}>
          <ArrowUp aria-hidden="true" />
        </Button>
      )}
    </form>
  );
}
