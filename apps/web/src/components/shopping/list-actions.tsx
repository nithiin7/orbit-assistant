"use client";

import type { ShoppingListOverview } from "@orbit/contracts";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type ListActionsProps = {
  list: ShoppingListOverview;
  onRename: () => void;
  /** Resolves once the deletion has finished or failed; the page reports errors. */
  onDelete: (list: ShoppingListOverview) => Promise<void>;
};

/** Rename and delete for the selected list. The default list can be renamed but not deleted. */
export function ListActions({ list, onRename, onDelete }: ListActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const cancel = () => {
    setConfirming(false);
    requestAnimationFrame(() => deleteRef.current?.focus());
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

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={onRename}>
        <Pencil aria-hidden="true" />
        Rename
      </Button>
      {list.is_default ? null : (
        <Button
          ref={deleteRef}
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      )}
    </div>
  );
}
