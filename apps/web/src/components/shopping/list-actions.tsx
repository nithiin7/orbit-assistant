"use client";

import type { ShoppingListOverview } from "@orbit/contracts";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";

type ListActionsProps = {
  list: ShoppingListOverview;
  onRename: () => void;
  /** Resolves once the deletion has finished or failed; the page reports errors. */
  onDelete: (list: ShoppingListOverview) => Promise<void>;
};

/**
 * Rename and delete for the selected list, in a menu so the page keeps one primary action. The
 * default list can be renamed but not deleted. Deleting asks for confirmation in place.
 */
export function ListActions({ list, onRename, onDelete }: ListActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const cancel = () => {
    setConfirming(false);
    // The confirmation unmounts; put focus back on the menu button that opened it.
    requestAnimationFrame(() => wrapperRef.current?.querySelector("button")?.focus());
  };

  if (confirming) {
    return (
      <div
        role="group"
        aria-label={`Delete “${list.name}” and its items?`}
        className="flex flex-wrap items-center gap-2"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            cancel();
          }
        }}
      >
        <span className="text-sm text-muted-foreground">Delete this list and its items?</span>
        <Button
          ref={confirmRef}
          variant="destructive"
          size="sm"
          disabled={deleting}
          onClick={() => {
            setDeleting(true);
            // On success the list disappears and this component unmounts.
            void onDelete(list).finally(() => {
              setDeleting(false);
              setConfirming(false);
            });
          }}
        >
          {deleting ? "Deleting…" : "Delete list"}
        </Button>
        <Button variant="ghost" size="sm" disabled={deleting} onClick={cancel}>
          Cancel
        </Button>
      </div>
    );
  }

  const items: MenuItem[] = [
    { id: "rename", label: "Rename list", icon: Pencil, onSelect: onRename },
    ...(list.is_default
      ? []
      : [
          {
            id: "delete",
            label: "Delete list",
            description: "Removes the list and its items.",
            icon: Trash2,
            onSelect: () => setConfirming(true),
          },
        ]),
  ];

  return (
    <div ref={wrapperRef}>
      <Menu items={items} variant="outline" align="end" aria-label="List options">
        <MoreHorizontal aria-hidden="true" />
        <span className="hidden @md/list:inline">Options</span>
      </Menu>
    </div>
  );
}
