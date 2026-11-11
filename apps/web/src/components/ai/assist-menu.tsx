"use client";

import type { AiAssistResult, AiModule } from "@orbit/contracts";
import { CircleAlert, Cloud, HardDrive, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { Answer, Sources } from "@/components/assistant/answer";
import { ProposalCard } from "@/components/assistant/proposal-card";
import { type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogCloseButton } from "@/components/ui/dialog";
import { Menu } from "@/components/ui/menu";
import { useAiSettings, useAssist } from "@/hooks/use-ai";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { type AssistAction, processingLabel, recordHref } from "@/lib/ai";

type AssistMenuProps = {
  module: AiModule;
  actions: readonly AssistAction[];
  /** The record the actions are about (a note, a document), when there is one. */
  targetId?: string;
  start?: string;
  end?: string;
  variant?: ButtonProps["variant"];
  /** Match the buttons beside it; small by default, for toolbars. */
  size?: ButtonProps["size"];
};

/**
 * A small "AI" menu of contextual actions. Shown only when AI is on, a model is chosen, and the
 * person lets AI read this module, so it never clutters a module for people who don't use AI.
 */
export function AssistMenu({
  module,
  actions,
  targetId,
  start,
  end,
  variant = "ghost",
  size = "sm",
}: AssistMenuProps) {
  const settings = useAiSettings();
  const [running, setRunning] = useState<AssistAction | null>(null);
  if (settings.status !== "success") return null;
  const ready =
    settings.data.server_enabled &&
    settings.data.enabled &&
    settings.data.chat_model !== null &&
    settings.data.modules.includes(module);
  if (!ready) return null;
  return (
    <>
      <Menu
        variant={variant}
        size={size}
        aria-label="AI actions"
        items={actions.map((action) => ({
          id: action.kind,
          label: action.label,
          description: action.description,
          onSelect: () => setRunning(action),
        }))}
      >
        <Sparkles aria-hidden="true" />
        AI
      </Menu>
      {running ? (
        <AssistDialog
          action={running}
          targetId={targetId}
          start={start}
          end={end}
          onClose={() => setRunning(null)}
        />
      ) : null}
    </>
  );
}

function AssistDialog({
  action,
  targetId,
  start,
  end,
  onClose,
}: {
  action: AssistAction;
  targetId?: string;
  start?: string;
  end?: string;
  onClose: () => void;
}) {
  const id = useId();
  const assist = useAssist();
  const { close, dialogProps } = useModalDialog({ onClose });
  const { mutate } = assist;

  useEffect(() => {
    mutate({
      kind: action.kind,
      target_id: targetId ?? null,
      start: start ?? null,
      end: end ?? null,
    });
  }, [action.kind, end, mutate, start, targetId]);

  return (
    <Dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      aria-busy={assist.isPending}
      className="mt-[8vh] max-h-[84vh] max-w-xl overflow-y-auto"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <h2 id={`${id}-heading`} className="flex items-center gap-1.5 text-base font-semibold">
              <Sparkles className="size-4 text-brand" aria-hidden="true" />
              {action.label}
            </h2>
            <p className="text-xs text-muted-foreground">{action.description}</p>
          </div>
          <DialogCloseButton onClick={close} />
        </div>
        {assist.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Working on it…
          </p>
        ) : assist.isError ? (
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <CircleAlert className="size-4" aria-hidden="true" />
            {describeApiError(assist.error, "That didn’t work. Try again.")}
          </p>
        ) : assist.data ? (
          <AssistResultView id={id} result={assist.data} />
        ) : null}
      </div>
    </Dialog>
  );
}

function AssistResultView({ id, result }: { id: string; result: AiAssistResult }) {
  return (
    <div className="space-y-4">
      {result.facts.length ? (
        <ul
          className="space-y-1 rounded-lg bg-muted/40 p-3 text-xs"
          aria-label="Calculated by Orbit"
        >
          {result.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      ) : null}
      {result.text ? <Answer id={id} text={result.text} citations={result.citations} /> : null}
      {result.items.length ? (
        <ul className="space-y-1.5">
          {result.items.map((item, index) => {
            const href = item.ref ? recordHref(item.ref) : null;
            return (
              <li key={`${item.label}-${index}`} className="rounded-lg border p-2 text-sm">
                {href ? (
                  <Link href={href} className="font-medium text-brand hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span className="font-medium">{item.label}</span>
                )}
                {item.detail ? (
                  <span className="block text-xs text-muted-foreground">{item.detail}</span>
                ) : null}
                {item.confidence !== null ? (
                  <span className="block text-xs text-muted-foreground">
                    Confidence: {Math.round(item.confidence * 100)}%
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {result.proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
      {result.text && result.citations.length ? (
        <Sources id={id} citations={result.citations} />
      ) : null}
      {result.provider_name && result.processing ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {result.processing === "local" ? (
            <HardDrive className="size-3.5" aria-hidden="true" />
          ) : (
            <Cloud className="size-3.5" aria-hidden="true" />
          )}
          {result.provider_name}
          {result.model ? ` · ${result.model}` : ""} · {processingLabel(result.processing)}
        </p>
      ) : null}
    </div>
  );
}
