"use client";

import { Menu, X } from "lucide-react";
import { useRef } from "react";

import { CommandPaletteTrigger } from "@/components/command-palette/command-palette-trigger";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";

import { NavLinks } from "./nav-links";

/**
 * Top bar with a slide-in navigation drawer for small screens. Uses the native
 * <dialog> element, which provides focus containment, Escape to close, and an inert
 * background without extra dependencies.
 */
export function MobileNav() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = () => dialogRef.current?.showModal();
  const close = () => dialogRef.current?.close();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b bg-background/90 px-2 backdrop-blur-sm md:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open navigation"
        aria-haspopup="dialog"
        onClick={open}
      >
        <Menu aria-hidden="true" />
      </Button>
      <Logo className="ml-1" />
      <div className="ml-auto flex items-center gap-1">
        <CommandPaletteTrigger />
        <ThemeToggle />
      </div>

      <dialog
        ref={dialogRef}
        aria-label="Navigation"
        className="dialog-motion dialog-drawer m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground shadow-elevation-3"
        onClick={(event) => {
          // A click on the dialog element itself (not its content) is a backdrop click.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between pr-2 pl-4">
            <Logo />
            <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={close}>
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="px-2 pb-2">
            <WorkspaceSwitcher onNavigate={close} />
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            <NavLinks onNavigate={close} />
          </div>
        </div>
      </dialog>
    </header>
  );
}
