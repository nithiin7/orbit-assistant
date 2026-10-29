"use client";

import { Search } from "lucide-react";

import { useIsMac } from "@/components/shortcut-hint";
import { Button } from "@/components/ui/button";
import { modKeyShortcut } from "@/lib/keyboard";

import { useCommandPalette } from "./command-palette";

/** Icon-only entry point to the command palette, for tight spaces such as the mobile top bar. */
export function CommandPaletteTrigger({ className }: { className?: string }) {
  const { open } = useCommandPalette();
  const isMac = useIsMac();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Search"
      aria-haspopup="dialog"
      aria-keyshortcuts={modKeyShortcut("k", isMac)}
      onClick={open}
      className={className}
    >
      <Search aria-hidden="true" />
    </Button>
  );
}
