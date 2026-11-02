"use client";

import { MoreHorizontal, Pencil, SquarePen, Trash2, X } from "lucide-react";
import { useState } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useConversationMutations, useConversations } from "@/hooks/use-ai";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/utils/common";

import { RenameDialog } from "./rename-dialog";

type ConversationListProps = {
  activeId: string | null;
  /** Opens a conversation, or a new chat for `null`. */
  onOpen: (id: string | null) => void;
};

/** "New chat" and the person's past conversations, newest first, each with rename and delete. */
export function ConversationList({ activeId, onOpen }: ConversationListProps) {
  const conversations = useConversations();
  const { rename, remove } = useConversationMutations();
  const { confirm, confirmDialog } = useConfirm();
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  return (
    <nav aria-label="Conversations" className="flex flex-col gap-4">
      <Button variant="soft" className="w-full justify-start" onClick={() => onOpen(null)}>
        <SquarePen aria-hidden="true" />
        New chat
      </Button>
      <div className="space-y-1">
        <h2 className="px-2.5 text-xs font-medium text-muted-foreground">Recent</h2>
        {conversations.status === "loading" ? (
          <div className="space-y-1.5 px-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-4/5" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : conversations.status === "error" ? (
          <p role="alert" className="px-2.5 text-xs text-destructive">
            {conversations.message}
          </p>
        ) : conversations.data.conversations.length === 0 ? (
          <p className="px-2.5 text-xs text-muted-foreground">
            No conversations yet. Questions you ask are kept here.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.data.conversations.map((conversation) => {
              const active = conversation.id === activeId;
              return (
                <li
                  key={conversation.id}
                  className={cn(
                    "group/conversation relative rounded-lg hover:bg-accent",
                    active && "bg-accent",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(conversation.id)}
                    aria-current={active ? "page" : undefined}
                    title={conversation.title}
                    className={cn(
                      "block w-full truncate rounded-lg py-2 pr-9 pl-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "font-medium text-foreground" : "text-foreground/85",
                    )}
                  >
                    {conversation.title}
                  </button>
                  <Menu
                    aria-label={`Options for ${conversation.title}`}
                    variant="ghost"
                    size="icon"
                    chevron={false}
                    align="end"
                    // Shown for the hovered, focused, or open row; always on touch screens.
                    className={cn(
                      "absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground hover:bg-background/70 hover:text-foreground aria-expanded:opacity-100 pointer-coarse:opacity-100",
                      active
                        ? "opacity-100"
                        : "opacity-0 group-focus-within/conversation:opacity-100 group-hover/conversation:opacity-100",
                    )}
                    items={[
                      {
                        id: "rename",
                        label: "Rename",
                        icon: Pencil,
                        onSelect: () =>
                          setRenaming({ id: conversation.id, title: conversation.title }),
                      },
                      {
                        id: "delete",
                        label: "Delete",
                        icon: Trash2,
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
                            if (active) onOpen(null);
                          });
                        },
                      },
                    ]}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Menu>
                </li>
              );
            })}
          </ul>
        )}
      </div>
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

/** The conversation list as a drawer from the left edge, for screens too narrow for the rail. */
export function ConversationDrawer({
  activeId,
  onOpen,
  onClose,
}: ConversationListProps & { onClose: () => void }) {
  const { dialogProps, close } = useModalDialog({ onClose });
  return (
    <dialog
      {...dialogProps}
      aria-label="Conversations"
      className="dialog-motion dialog-drawer m-0 h-dvh max-h-none w-80 max-w-[calc(100%-3rem)] border-r bg-background p-0 text-foreground shadow-elevation-3"
    >
      <div className="flex h-full flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between pr-2 pl-4">
          <p className="text-sm font-semibold">Chats</p>
          <Button variant="ghost" size="icon" aria-label="Close conversations" onClick={close}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <ConversationList
            activeId={activeId}
            onOpen={(id) => {
              onOpen(id);
              close();
            }}
          />
        </div>
      </div>
    </dialog>
  );
}
