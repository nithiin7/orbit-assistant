"use client";

import type { AiMessage, AiProposal, AiSettings } from "@orbit/contracts";
import {
  ArrowUp,
  Bot,
  CircleAlert,
  Cloud,
  HardDrive,
  PanelLeft,
  Sparkles,
  Square,
  SquarePen,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type PendingTurn,
  useAiSettings,
  useAssistantChat,
  useConversation,
  useConversations,
} from "@/hooks/use-ai";
import { processingLabel, suggestedQuestions } from "@/lib/ai";
import { settingsHref } from "@/lib/settings";

import { Answer, Sources } from "./answer";
import { ConversationDrawer, ConversationList } from "./conversation-list";
import { InsightsPanel } from "./insights-panel";
import { ProposalCard } from "./proposal-card";

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

/**
 * A chat layout: past conversations in a rail on wide screens (a drawer on narrow ones) beside
 * the open conversation, which reads in one centered column above a composer pinned to the bottom.
 */
function Assistant({ settings }: { settings: AiSettings }) {
  const params = useSearchParams();
  const router = useRouter();
  const conversations = useConversations();
  const conversationId = params.get("c");
  const initialQuestion = params.get("q");
  // Changes only when the person opens a conversation or starts a new one, not when a new
  // conversation's first answer reports its ID, so a streaming answer isn't remounted away.
  const [chatKey, setChatKey] = useState(() => conversationId ?? "new");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const show = (id: string | null) => {
    router.replace(id ? `/assistant?c=${encodeURIComponent(id)}` : "/assistant", { scroll: false });
  };
  const open = (id: string | null) => {
    setChatKey(id ?? `new-${Date.now()}`);
    show(id);
  };

  const title =
    (conversations.status === "success"
      ? conversations.data.conversations.find((c) => c.id === conversationId)?.title
      : undefined) ?? (conversationId ? "" : "New chat");

  return (
    <div className="@container/assistant">
      <div className="grid gap-8 @4xl/assistant:grid-cols-[15rem_minmax(0,1fr)] @7xl/assistant:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="hidden min-w-0 @4xl/assistant:sticky @4xl/assistant:top-6 @4xl/assistant:block @4xl/assistant:max-h-[calc(100dvh-3rem)] @4xl/assistant:self-start @4xl/assistant:overflow-y-auto @4xl/assistant:p-0.5">
          <ConversationList activeId={conversationId} onOpen={open} />
        </aside>
        <div className="flex min-w-0 flex-col">
          <header className="flex min-h-9 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="@4xl/assistant:hidden"
              aria-label="Show conversations"
              aria-haspopup="dialog"
              onClick={() => setDrawerOpen(true)}
            >
              <PanelLeft aria-hidden="true" />
            </Button>
            <div className="min-w-0 flex-1 px-1">
              {title ? (
                <h2 className="truncate text-sm font-medium text-muted-foreground">{title}</h2>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="@4xl/assistant:hidden"
              aria-label="New chat"
              onClick={() => open(null)}
            >
              <SquarePen aria-hidden="true" />
            </Button>
          </header>
          <Chat
            key={chatKey}
            conversationId={conversationId}
            initialQuestion={conversationId ? null : initialQuestion}
            settings={settings}
            onConversation={show}
          />
        </div>
      </div>
      {drawerOpen ? (
        <ConversationDrawer
          activeId={conversationId}
          onOpen={open}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </div>
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
  const composer = (
    <Composer
      model={settings.chat_model}
      streaming={chat.streaming}
      onSend={(text) => void chat.send(text)}
      onStop={chat.stop}
    />
  );

  if (empty) {
    return (
      <Welcome settings={settings} onAsk={(question) => void chat.send(question)}>
        {composer}
      </Welcome>
    );
  }

  return (
    <section aria-label="Conversation" className="flex min-h-[70dvh] flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1 pt-6 pb-8">
        {detail.status === "loading" && conversationId !== null && chat.pending === null ? (
          <div className="space-y-6">
            <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ) : detail.status === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {detail.message}
          </p>
        ) : (
          <ol className="space-y-8" aria-live="polite" aria-busy={chat.streaming}>
            {visibleMessages(messages, chat.pending).map((message) => (
              <MessageItem key={message.id} message={message} proposals={proposals} />
            ))}
            {chat.pending ? <PendingItem pending={chat.pending} /> : null}
            {chat.proposals
              .filter((p) => !proposals.some((known) => known.id === p.id))
              .map((proposal) => (
                <li key={proposal.id} className="pl-11">
                  <ProposalCard proposal={proposal} />
                </li>
              ))}
          </ol>
        )}
      </div>
      {/* Pinned to the bottom of the screen; the fade lets the conversation scroll beneath it. */}
      <div className="sticky bottom-0 bg-linear-to-t from-background from-70% to-transparent pt-6 pb-3">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          {composer}
          <Disclaimer />
        </div>
      </div>
      <div ref={endRef} />
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

function Disclaimer() {
  return (
    <p className="text-center text-xs text-pretty text-muted-foreground">
      Answers use only the modules you allow in{" "}
      <Link href={settingsHref("ai")} className="text-brand hover:underline">
        AI settings
      </Link>
      , and nothing changes without your approval. Check important details against the sources.
    </p>
  );
}

/** A new chat: a greeting, the composer, and suggestions, centered like a blank page. */
function Welcome({
  settings,
  onAsk,
  children,
}: {
  settings: AiSettings;
  onAsk: (q: string) => void;
  /** The composer. */
  children: ReactNode;
}) {
  const questions = suggestedQuestions(settings.modules);
  return (
    <section
      aria-label="New chat"
      className="mx-auto flex min-h-[70dvh] w-full max-w-3xl flex-col justify-center gap-8 py-10"
    >
      <div className="space-y-3 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-brand-subtle text-brand">
          <Sparkles className="size-5" aria-hidden="true" />
        </span>
        <h2 className="text-2xl font-semibold tracking-tight text-balance">
          What would you like to know?
        </h2>
        <p className="mx-auto max-w-prose text-sm text-pretty text-muted-foreground">
          Ask about your tasks, schedule, notes, and anything else you’ve allowed. Orbit answers
          from your own records and shows where each fact came from.
        </p>
      </div>
      <div className="space-y-3">
        {children}
        {questions.length ? (
          <ul className="flex flex-wrap justify-center gap-2" aria-label="Suggested questions">
            {questions.map((question) => (
              <li key={question}>
                <button
                  type="button"
                  onClick={() => onAsk(question)}
                  className="rounded-full border bg-card px-3.5 py-1.5 text-sm text-foreground/85 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {question}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <InsightsPanel />
      <Disclaimer />
    </section>
  );
}

/** The assistant's side of the conversation: a small Orbit mark beside unboxed text. */
function AssistantTurn({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand"
      >
        <Sparkles className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-3">{children}</div>
    </div>
  );
}

function UserTurn({ text }: { text: string }) {
  return (
    <li className="flex justify-end">
      <p className="max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
        {text}
      </p>
    </li>
  );
}

function MessageItem({ message, proposals }: { message: AiMessage; proposals: AiProposal[] }) {
  if (message.role === "user") return <UserTurn text={message.content} />;
  const own = proposals.filter((p) => p.message_id === message.id);
  return (
    <li>
      <AssistantTurn>
        {message.status === "error" ? (
          <ErrorLine text={message.content} />
        ) : (
          <Answer id={message.id} text={message.content} citations={message.citations} />
        )}
        {message.status === "stopped" ? (
          <p className="text-xs text-muted-foreground">Stopped before finishing.</p>
        ) : null}
        {message.status !== "error" ? (
          <div className="rounded-xl border bg-card/60 p-2.5">
            <Sources id={message.id} citations={message.citations} />
          </div>
        ) : null}
        <ProviderLine
          name={message.provider_name}
          model={message.model}
          processing={message.processing}
        />
        {own.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} />
        ))}
      </AssistantTurn>
    </li>
  );
}

function PendingItem({ pending }: { pending: PendingTurn }) {
  return (
    <>
      <UserTurn text={pending.question} />
      <li>
        <AssistantTurn>
          {pending.status === "error" ? (
            <ErrorLine text={pending.error} />
          ) : pending.text ? (
            <Answer id="pending" text={pending.text} citations={pending.citations} />
          ) : (
            <p className="animate-pulse py-1 text-sm text-muted-foreground">
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
        </AssistantTurn>
      </li>
    </>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {text}
    </p>
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
  model,
  streaming,
  onSend,
  onStop,
}: {
  model: string | null;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The composer moves from the centered new-chat screen to the bottom once a question is sent;
  // keep typing where the person was. Skipped on touch screens, where it would raise the keyboard.
  useEffect(() => {
    if (window.matchMedia?.("(pointer: fine)").matches) inputRef.current?.focus();
  }, []);

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
      className="rounded-3xl border bg-card p-2 shadow-elevation-2 transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20"
    >
      <label htmlFor="assistant-input" className="sr-only">
        Ask Orbit
      </label>
      <textarea
        ref={inputRef}
        id="assistant-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about your tasks, schedule, notes…"
        rows={1}
        maxLength={4000}
        className="block field-sizing-content max-h-60 min-h-11 w-full resize-none bg-transparent px-3 pt-2 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
      />
      <div className="flex items-center justify-between gap-2 pl-3">
        <span className="truncate text-xs text-muted-foreground">
          {model ?? ""}
          <span className="hidden sm:inline"> · Shift+Enter for a new line</span>
        </span>
        {streaming ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="rounded-full"
            onClick={onStop}
            aria-label="Stop answering"
          >
            <Square className="size-3.5 fill-current" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="rounded-full"
            aria-label="Send"
            disabled={!text.trim()}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        )}
      </div>
    </form>
  );
}
