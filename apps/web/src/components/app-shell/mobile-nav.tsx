"use client";

import { Menu, X } from "lucide-react";
import { useRef } from "react";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

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
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur md:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open navigation"
        aria-haspopup="dialog"
        onClick={open}
      >
        <Menu aria-hidden="true" />
      </Button>
      <Logo />
      <div className="ml-auto">
        <ThemeToggle />
      </div>

      <dialog
        ref={dialogRef}
        aria-label="Navigation"
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground backdrop:bg-black/40"
        onClick={(event) => {
          // A click on the dialog element itself (not its content) is a backdrop click.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center justify-between px-4">
            <Logo />
            <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={close}>
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            <NavLinks onNavigate={close} />
          </div>
        </div>
      </dialog>
    </header>
  );
}
