"use client";

import { Check, CornerDownLeft, type LucideIcon, Monitor, Moon, Search, Sun } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Kbd } from "@/components/ui/kbd";
import { useHydrated } from "@/hooks/use-hydrated";
import { filterCommands } from "@/lib/command-search";
import { isActivePath, navItems } from "@/lib/navigation";
import { cn } from "@/utils/common";
import { isMacPlatform, matchesModShortcut } from "@/utils/keyboard";

type CommandGroup = "Go to" | "Theme";

type Command = {
  id: string;
  group: CommandGroup;
  label: string;
  description?: string;
  keywords: readonly string[];
  icon: LucideIcon;
  /** Shown as a check mark, e.g. the current page or theme. */
  current: boolean;
  run: () => void;
};

const GROUPS: readonly CommandGroup[] = ["Go to", "Theme"];

const THEMES = [
  { value: "light", label: "Light theme", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
  { value: "system", label: "System theme", icon: Monitor },
] as const;

type CommandPaletteContextValue = { open: () => void };

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette(): CommandPaletteContextValue {
  const context = useContext(CommandPaletteContext);
  if (!context) throw new Error("useCommandPalette must be used within CommandPaletteProvider.");
  return context;
}

/**
 * Provides a keyboard-first command palette (Cmd+K on macOS, Ctrl+K elsewhere) for jumping
 * between sections and switching theme. Built on the native modal <dialog>, which supplies focus
 * containment, Escape to close, and an inert background; the search field follows the ARIA
 * combobox pattern with `aria-activedescendant`.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  // The stored theme is only known on the client; avoid a hydration mismatch on the check marks.
  const hydrated = useHydrated();
  const listboxId = useId();

  const open = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActiveIndex(0);
    dialog.showModal();
    inputRef.current?.focus();
  }, []);

  const close = useCallback(() => dialogRef.current?.close(), []);

  useEffect(() => {
    const isMac = isMacPlatform(navigator.userAgent);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!matchesModShortcut(event, "k", isMac)) return;
      event.preventDefault();
      if (dialogRef.current?.open) close();
      else open();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const commands = useMemo<Command[]>(
    () => [
      ...navItems.map((item) => ({
        id: `nav${item.href.replaceAll("/", "-")}`,
        group: "Go to" as const,
        label: item.title,
        description: item.description,
        keywords: ["go", "open", "page", item.description],
        icon: item.icon,
        current: isActivePath(pathname, item.href),
        run: () => router.push(item.href),
      })),
      ...THEMES.map(({ value, label, icon }) => ({
        id: `theme-${value}`,
        group: "Theme" as const,
        label,
        keywords: ["theme", "appearance", "color", "mode"],
        icon,
        current: hydrated && theme === value,
        run: () => setTheme(value),
      })),
    ],
    [pathname, router, hydrated, theme, setTheme],
  );

  // Order results by group so arrow-key order matches what is on screen.
  const results = useMemo(() => {
    const matches = filterCommands(commands, query);
    return GROUPS.flatMap((group) => matches.filter((command) => command.group === group));
  }, [commands, query]);

  const active = results.length > 0 ? Math.min(activeIndex, results.length - 1) : -1;
  const optionId = (command: Command) => `${listboxId}-${command.id}`;
  const activeCommand = results[active];
  const activeOptionId = activeCommand ? optionId(activeCommand) : undefined;

  useEffect(() => {
    if (!activeOptionId || !dialogRef.current?.open) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);

  const runCommand = (command: Command) => {
    close();
    command.run();
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = results.length;
    if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault();
      setActiveIndex((active + 1) % count);
    } else if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault();
      setActiveIndex((active - 1 + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeCommand) runCommand(activeCommand);
    }
  };

  const contextValue = useMemo(() => ({ open }), [open]);

  return (
    <CommandPaletteContext.Provider value={contextValue}>
      {children}
      <dialog
        ref={dialogRef}
        aria-label="Command palette"
        className="dialog-motion dialog-pop mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
        onClose={() => {
          returnFocusRef.current?.focus();
          returnFocusRef.current = null;
        }}
        onClick={(event) => {
          // A click on the dialog element itself (not its content) is a backdrop click.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search pages and actions"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search pages and actions…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div
          id={listboxId}
          role="listbox"
          aria-label="Results"
          className={cn(
            "max-h-80 scroll-py-2 overflow-y-auto p-2",
            results.length === 0 && "hidden",
          )}
        >
          {GROUPS.map((group) => {
            const groupResults = results.filter((command) => command.group === group);
            if (groupResults.length === 0) return null;
            return (
              <div key={group} role="group" aria-label={group} className="not-first:mt-2">
                <div
                  aria-hidden="true"
                  className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground"
                >
                  {group}
                </div>
                {groupResults.map((command) => {
                  const index = results.indexOf(command);
                  const isActive = index === active;
                  const Icon = command.icon;
                  return (
                    // Keyboard interaction is handled by the combobox input (aria-activedescendant).
                    <div
                      key={command.id}
                      id={optionId(command)}
                      role="option"
                      tabIndex={-1}
                      aria-selected={isActive}
                      onClick={() => runCommand(command)}
                      onPointerMove={() => {
                        if (!isActive) setActiveIndex(index);
                      }}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors duration-100 select-none",
                        isActive && "bg-accent text-accent-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground",
                          isActive && "text-foreground",
                        )}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{command.label}</span>
                        {command.description ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {command.description}
                          </span>
                        ) : null}
                      </span>
                      {command.current ? (
                        <>
                          <Check className="size-4 shrink-0 text-brand" aria-hidden="true" />
                          <span className="sr-only">(current)</span>
                        </>
                      ) : null}
                      <CornerDownLeft
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground",
                          !isActive && "invisible",
                        )}
                        aria-hidden="true"
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No results for “{query.trim()}”
          </p>
        ) : null}

        <p role="status" className="sr-only">
          {results.length === 1 ? "1 result" : `${results.length} results`}
        </p>

        <footer
          aria-hidden="true"
          className="hidden items-center gap-4 border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground sm:flex"
        >
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            Select
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
            Close
          </span>
        </footer>
      </dialog>
    </CommandPaletteContext.Provider>
  );
}
