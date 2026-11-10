"use client";

import type { IntegrationConnection } from "@orbit/contracts";
import { Mail, Settings2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { useConnectionsWith } from "@/hooks/use-integrations";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { capabilityName, connectionHref } from "@/lib/integrations";

import { MailInbox } from "./mail-browser";

/**
 * Opens connected mail beside the current page, so an email becomes a task, note, or reminder
 * where it's needed. Shows nothing until an account with mail is connected. `?inbox=<id>` in the
 * address opens it on that account (Settings links here).
 */
export function InboxButton() {
  const connections = useConnectionsWith("mail");
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("inbox");
  const [open, setOpen] = useState(requested !== null);

  if (connections.length === 0) return null;
  const first = connections[0];
  const name =
    first && connections.every((c) => c.provider === first.provider)
      ? capabilityName(first.provider, "mail")
      : "Mail";

  const close = () => {
    setOpen(false);
    if (requested !== null) router.replace(pathname);
  };

  return (
    <>
      <Button variant="soft" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Mail aria-hidden="true" />
        {name}
      </Button>
      {open ? (
        <InboxSheet
          title={name}
          connections={connections}
          initialConnectionId={requested}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function InboxSheet({
  title,
  connections,
  initialConnectionId,
  onClose,
}: {
  title: string;
  connections: IntegrationConnection[];
  initialConnectionId: string | null;
  onClose: () => void;
}) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose });
  const settingsFor =
    connections.find((c) => c.id === initialConnectionId) ?? connections[0] ?? null;
  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-title`}
      className="dialog-motion dialog-sheet my-0 mr-0 ml-auto h-dvh max-h-none w-[36rem] max-w-full border-l bg-background p-0 text-foreground shadow-elevation-3"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 border-b px-5 py-4">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand"
          >
            <Mail className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-title`} className="text-base font-semibold">
              {title}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              Read here, then add it as a task, note, or reminder. Nothing is copied until you do.
            </p>
          </div>
          {settingsFor ? (
            <Link
              href={`${connectionHref(settingsFor.id)}#mail`}
              aria-label="Mail settings"
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Settings2 className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
          <Button variant="ghost" size="icon" className="size-8" aria-label="Close" onClick={close}>
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 py-4">
          <MailInbox connections={connections} initialConnectionId={initialConnectionId} />
        </div>
      </div>
    </dialog>
  );
}
