"use client";

import type { AiMessage, AiProposal, AiSettings } from "@orbit/contracts";
import {
  ArrowUp,
  Bot,
  CircleAlert,
  Cloud,
  HardDrive,
  Mic,
  PanelLeft,
  Plus,
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
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { VoicePanel } from "@/components/voice/voice-panel";
import {
  type PendingTurn,
  useAiSettings,
  useAssistantChat,
  useChatModelCatalog,
  useConversation,
  useConversations,
  useUpdateAiSettings,
} from "@/hooks/use-ai";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { useVoiceSettings } from "@/hooks/use-voice";
import {
  chatModelOptions,
  chatModelValue,
  parseChatModelValue,
  processingLabel,
  type QuickAddTemplate,
  quickAddTemplates,
  suggestedQuestions,
} from "@/lib/ai";
import { settingsHref } from "@/lib/settings";
import { cn } from "@/utils/common";

import { Answer, Sources } from "./answer";
import { ConversationDrawer, ConversationList } from "./conversation-list";
import { InsightsPanel } from "./insights-panel";
import { ProposalCard } from "./proposal-card";

/** The assistant page: conversations beside the open one. The open conversation is in the URL. */
export function AssistantView() {
  const settings = useAiSettings();
  if (settings.status === "loading") return <AssistantSkeleton />;
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
        title="AI is off on this server"
        description="Everything else works as usual."
      />
    );
  }
  return (
    <EmptyState
      icon={Bot}
      title={settings.enabled ? "Choose a model to start" : "AI is off"}
      description="Turn it on and pick a model in Settings."
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
/**
 * The assistant while its settings load: the same conversation rail, header, and chat column
 * (with the composer at the bottom) as the real page, so it fills in without moving.
 */
function AssistantSkeleton() {
  return (
    <div className="@container/assistant" aria-busy="true" aria-label="Loading the assistant">
      <div
        aria-hidden="true"
        className="grid gap-8 @4xl/assistant:grid-cols-[15rem_minmax(0,1fr)] @7xl/assistant:grid-cols-[17rem_minmax(0,1fr)]"
      >
        <div className="hidden min-w-0 space-y-3 p-0.5 @4xl/assistant:block">
          <Skeleton className="h-9 w-full" />
          <div className="space-y-1.5 px-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-4/5" />
            <Skeleton className="h-7 w-full" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="flex min-h-9 items-center px-1">
            <SkeletonText className="w-40 text-sm" />
          </div>
          <div className="flex min-h-[70dvh] flex-col">
            <div className="mx-auto w-full max-w-3xl flex-1 pt-6 pb-8" />
            <div className="mx-auto w-full max-w-3xl pt-6 pb-3">
              <Skeleton className="h-28 w-full rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
    conversations.status === "success"
      ? conversations.data.conversations.find((c) => c.id === conversationId)?.title
      : undefined;

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
  const [voiceMode, setVoiceMode] = useState(false);
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
  const composer = voiceMode ? (
    <Voice conversationId={conversationId} chat={chat} onUseText={() => setVoiceMode(false)} />
  ) : (
    <Composer
      settings={settings}
      streaming={chat.streaming}
      onSend={(text) => void chat.send(text)}
      onStop={chat.stop}
      onVoice={() => setVoiceMode(true)}
    />
  );

  // Both layouts share one element shape, with the composer at the same place in it, so the
  // first question doesn't remount the composer: a live voice session would end mid-answer.
  return (
    <section
      aria-label={empty ? "Start a chat" : "Conversation"}
      className={cn(
        "flex min-h-[70dvh] flex-col",
        empty && "mx-auto w-full max-w-3xl justify-center gap-8 py-10",
      )}
    >
      <div className={cn(!empty && "mx-auto w-full max-w-3xl flex-1 pt-6 pb-8")}>
        {empty ? (
          <WelcomeIntro />
        ) : detail.status === "loading" && conversationId !== null && chat.pending === null ? (
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
              <MessageItem
                key={message.id}
                message={message}
                proposals={proposals}
                offerAlways={!settings.auto_capture}
              />
            ))}
            {chat.pending ? <PendingItem pending={chat.pending} /> : null}
            {chat.proposals
              .filter((p) => !proposals.some((known) => known.id === p.id))
              .map((proposal) => (
                <li key={proposal.id} className="pl-11">
                  <ProposalCard proposal={proposal} offerAlways={!settings.auto_capture} />
                </li>
              ))}
          </ol>
        )}
      </div>
      {/* Pinned to the bottom of the screen; the fade lets the conversation scroll beneath it. */}
      <div
        className={cn(
          !empty &&
            "sticky bottom-0 bg-linear-to-t from-background from-70% to-transparent pt-6 pb-3",
        )}
      >
        <div className={cn(empty ? "space-y-3" : "mx-auto w-full max-w-3xl space-y-2")}>
          {composer}
          {empty ? (
            <SuggestedQuestions
              settings={settings}
              onAsk={(question) => void chat.send(question)}
            />
          ) : (
            <Disclaimer />
          )}
        </div>
      </div>
      {empty ? <InsightsPanel /> : <div ref={endRef} />}
    </section>
  );
}

/**
 * Voice in place of the composer, over the same chat. Keyed by workspace, so switching
 * workspaces ends the voice session and releases the microphone.
 */
function Voice({
  conversationId,
  chat,
  onUseText,
}: {
  conversationId: string | null;
  chat: ReturnType<typeof useAssistantChat>;
  onUseText: () => void;
}) {
  const settings = useVoiceSettings();
  const workspaceId = useActiveWorkspaceId();
  if (settings.status === "loading") return <Skeleton className="h-72 w-full rounded-3xl" />;
  if (settings.status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {settings.message}
      </p>
    );
  }
  return (
    <VoicePanel
      key={workspaceId ?? "none"}
      settings={settings.data}
      conversationId={conversationId}
      chat={chat}
      onUseText={onUseText}
    />
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
      Reads only what you allow in{" "}
      <Link href={settingsHref("ai")} className="text-brand hover:underline">
        AI settings
      </Link>
      . Check important details.
    </p>
  );
}

/** A new chat: a greeting, the composer, and suggestions, centered like a blank page. */
/** The greeting above the composer while a chat is empty. */
function WelcomeIntro() {
  return (
    <div className="space-y-3 text-center">
      <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-brand-subtle text-brand">
        <Sparkles className="size-5" aria-hidden="true" />
      </span>
      <h2 className="text-2xl font-semibold tracking-tight text-balance">How can I help?</h2>
    </div>
  );
}

function SuggestedQuestions({
  settings,
  onAsk,
}: {
  settings: AiSettings;
  onAsk: (q: string) => void;
}) {
  const questions = suggestedQuestions(settings.modules);
  if (!questions.length) return null;
  return (
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

function UserTurn({ text, spoken = false }: { text: string; spoken?: boolean }) {
  return (
    <li className="flex flex-col items-end gap-1">
      <p className="max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
        {text}
      </p>
      {spoken ? (
        <span className="flex items-center gap-1 pr-2 text-xs text-muted-foreground">
          <Mic className="size-3" aria-hidden="true" />
          Spoken
        </span>
      ) : null}
    </li>
  );
}

function MessageItem({
  message,
  proposals,
  offerAlways,
}: {
  message: AiMessage;
  proposals: AiProposal[];
  offerAlways: boolean;
}) {
  if (message.role === "user") {
    return <UserTurn text={message.content} spoken={message.input_mode === "voice"} />;
  }
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
          <ProposalCard key={proposal.id} proposal={proposal} offerAlways={offerAlways} />
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
  settings,
  streaming,
  onSend,
  onStop,
  onVoice,
}: {
  settings: AiSettings;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onVoice: () => void;
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
  const startFrom = (template: QuickAddTemplate) => {
    const next = `${template.text}${text.trim()}`;
    setText(next);
    // After the menu has closed and handed focus back to its button.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.length, next.length);
    });
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
        placeholder="Ask anything"
        rows={1}
        maxLength={4000}
        className="block field-sizing-content max-h-60 min-h-11 w-full resize-none bg-transparent px-3 pt-2 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
      />
      <div className="flex items-center justify-between gap-2">
        <Menu
          aria-label="Quick add"
          variant="ghost"
          size="icon"
          chevron={false}
          className="rounded-full"
          items={quickAddTemplates(settings.modules).map((template) => ({
            id: template.id,
            label: template.label,
            group: template.group,
            onSelect: () => startFrom(template),
          }))}
        >
          <Plus aria-hidden="true" />
        </Menu>
        <ModelPicker settings={settings} disabled={streaming} />
        <span className="flex-1" />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="rounded-full"
          onClick={onVoice}
          aria-label="Talk with voice"
        >
          <Mic aria-hidden="true" />
        </Button>
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

/** Switches the chat model; the choice is saved as the answers model in AI settings. */
function ModelPicker({ settings, disabled }: { settings: AiSettings; disabled: boolean }) {
  const catalog = useChatModelCatalog();
  const update = useUpdateAiSettings();
  const current =
    settings.chat_provider_id && settings.chat_model
      ? { providerId: settings.chat_provider_id, model: settings.chat_model }
      : null;
  const options = chatModelOptions(catalog.status === "success" ? catalog.data : [], current);
  return (
    <Select
      variant="ghost"
      aria-label="Model"
      className="max-w-60"
      value={current ? chatModelValue(current) : ""}
      placeholder={settings.chat_model ?? "Model"}
      options={options}
      disabled={disabled || update.isPending}
      onValueChange={(value) => {
        const choice = parseChatModelValue(value);
        if (choice)
          update.mutate({ chat_provider_id: choice.providerId, chat_model: choice.model });
      }}
    />
  );
}
