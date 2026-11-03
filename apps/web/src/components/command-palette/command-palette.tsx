"use client";

import type { UniversalSearchModule } from "@orbit/contracts";
import {
  AlarmClock,
  BookOpen,
  Bot,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  Check,
  CheckSquare,
  Clock,
  CornerDownLeft,
  Droplets,
  Dumbbell,
  FileText,
  FileUp,
  Folder,
  HeartPulse,
  Hourglass,
  ListTodo,
  type LucideIcon,
  Monitor,
  Moon,
  NotebookPen,
  Play,
  Receipt,
  Repeat2,
  Search,
  Sun,
  Wallet,
  Zap,
} from "lucide-react";
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

import { useQuickCapture } from "@/components/notes/quick-capture";
import { useQuickActions } from "@/components/quick-actions/quick-actions";
import { Kbd } from "@/components/ui/kbd";
import { useCalendarCommands } from "@/hooks/use-calendar-commands";
import { useDocumentCommands } from "@/hooks/use-document-commands";
import { useHydrated } from "@/hooks/use-hydrated";
import { useNoteFolders, useNoteList, useNoteMutations } from "@/hooks/use-notes";
import {
  useRecentSearches,
  useSearchHistoryMutations,
  useUniversalSearch,
} from "@/hooks/use-universal-search";
import { filterCommands, SEARCH_GROUP_LABELS } from "@/lib/command-search";
import { habitsHref } from "@/lib/habits";
import { isActivePath, navItems } from "@/lib/navigation";
import { journalToday, noteDisplayTitle, notesHref } from "@/lib/notes";
import {
  describeHit,
  EMPTY_SEARCH,
  hitTitle,
  SEARCH_PATH,
  searchHref,
  searchResultHref,
} from "@/lib/search";
import { useCurrentUser } from "@/providers/auth";
import { useWorkspaces } from "@/providers/workspace";
import { cn } from "@/utils/common";
import { isMacPlatform, matchesModShiftShortcut, matchesModShortcut } from "@/utils/keyboard";

type CommandGroup =
  | "Create"
  | "Notes"
  | "Documents"
  | "Recent documents"
  | "Calendar"
  | "Recent notes"
  | "Folders"
  | "Go to"
  | "Theme"
  | "Search"
  | "Recent searches"
  | (typeof SEARCH_GROUP_LABELS)[UniversalSearchModule];

type Command = {
  id: string;
  group: CommandGroup;
  label: string;
  description?: string;
  keywords: readonly string[];
  icon: LucideIcon;
  /** Shown as a check mark, e.g. the current page or theme. */
  current: boolean;
  /** Already matched by the API's search; shown whatever the query. */
  matched?: boolean;
  run: () => void;
};

const GROUPS: readonly CommandGroup[] = [
  ...Object.values(SEARCH_GROUP_LABELS),
  "Recent searches",
  "Create",
  "Notes",
  "Go to",
  "Calendar",
  "Documents",
  "Recent notes",
  "Recent documents",
  "Folders",
  "Theme",
  "Search",
];

/**
 * Notes commands for the palette: create, capture, journal, search, recent notes, and folders.
 * Data loads only while the palette is open. Matching notes come from the workspace search.
 */
function useNoteCommands(open: boolean, query: string): Command[] {
  const router = useRouter();
  const { state } = useWorkspaces();
  const user = useCurrentUser();
  const workspaceId = state.status === "ready" ? state.active.id : null;
  const quickCapture = useQuickCapture();
  const mutations = useNoteMutations(workspaceId ?? "");
  const recent = useNoteList(workspaceId, { sort: "recent", limit: 5 }, open);
  const { folders } = useNoteFolders(open ? workspaceId : null);

  const openNote = (id: string) => router.push(notesHref({ noteId: id }));
  const recentNotes = recent.state.status === "success" ? recent.state.data.notes : [];

  if (!workspaceId) return [];
  const commands: Command[] = [
    {
      id: "notes-new",
      group: "Notes",
      label: "New note",
      description: "Start a note in the Inbox",
      keywords: ["create", "add", "write", "note"],
      icon: NotebookPen,
      current: false,
      run: () => {
        mutations.create.mutateAsync({ title: "", note_type: "note" }).then(
          (note) => router.push(notesHref({ view: "inbox", noteId: note.id })),
          () => router.push(notesHref({ view: "inbox" })),
        );
      },
    },
    {
      id: "notes-quick",
      group: "Notes",
      label: "Quick note",
      description: "Capture a thought without leaving this page",
      keywords: ["capture", "jot", "inbox", "note", "quick"],
      icon: Zap,
      current: false,
      run: quickCapture.open,
    },
    {
      id: "notes-journal",
      group: "Notes",
      label: "Open today’s journal",
      keywords: ["journal", "diary", "daily", "today", "entry"],
      icon: BookOpen,
      current: false,
      run: () => {
        mutations.openJournal.mutateAsync(journalToday(user.timezone)).then(
          (entry) => router.push(notesHref({ view: "journal", noteId: entry.id })),
          () => router.push(notesHref({ view: "journal" })),
        );
      },
    },
  ];
  if (query.trim()) {
    commands.push({
      id: "notes-search",
      group: "Search",
      label: `Search notes for “${query.trim()}”`,
      keywords: [],
      icon: Search,
      current: false,
      matched: true,
      run: () => router.push(notesHref({ view: "all", search: query.trim() })),
    });
  }
  if (!query.trim()) {
    for (const note of recentNotes) {
      commands.push({
        id: `note-recent-${note.id}`,
        group: "Recent notes",
        label: noteDisplayTitle(note),
        keywords: [],
        icon: FileText,
        current: false,
        run: () => openNote(note.id),
      });
    }
  }
  for (const folder of folders) {
    commands.push({
      id: `note-folder-${folder.id}`,
      group: "Folders",
      label: folder.name,
      description: "Notes folder",
      keywords: ["folder", "notes"],
      icon: Folder,
      current: false,
      run: () => router.push(notesHref({ folderId: folder.id })),
    });
  }
  return commands;
}

const CALENDAR_ICONS = {
  new: CalendarPlus,
  today: CalendarCheck,
  month: CalendarDays,
  week: CalendarRange,
  day: CalendarClock,
  agenda: ListTodo,
  schedule: CalendarClock,
  notes: NotebookPen,
} as const;

/** Calendar commands from `useCalendarCommands`, in the palette's shape. */
function useCalendarPaletteCommands(open: boolean): Command[] {
  return useCalendarCommands(open).map((command) => ({
    id: command.id,
    group: "Calendar",
    label: command.label,
    description: command.description,
    keywords: command.keywords,
    icon: CALENDAR_ICONS[command.icon],
    current: false,
    run: command.run,
  }));
}

const DOCUMENT_ICONS = {
  upload: FileUp,
  search: Search,
  expiring: Hourglass,
  category: Folder,
  document: FileText,
} as const;

/** Documents commands from `useDocumentCommands`, in the palette's shape. */
function useDocumentPaletteCommands(open: boolean, query: string): Command[] {
  return useDocumentCommands(open, query).map((command) => ({
    id: command.id,
    group: command.icon === "search" ? "Search" : command.recent ? "Recent documents" : "Documents",
    label: command.label,
    description: command.description,
    keywords: command.keywords,
    icon: DOCUMENT_ICONS[command.icon],
    current: false,
    matched: command.matched,
    run: command.run,
  }));
}

const SEARCH_ICONS: Record<UniversalSearchModule, LucideIcon> = {
  tasks: CheckSquare,
  notes: FileText,
  calendar: CalendarDays,
  reminders: AlarmClock,
  finance: Wallet,
  habits: Repeat2,
  documents: FileText,
  health: HeartPulse,
};

/** The best matches the palette shows; "See all results" opens the search page for more. */
const PALETTE_SEARCH_LIMIT = 8;

/**
 * Records matching the query across every module, from one universal search once typing
 * pauses, grouped by module in ranked order. Each opens the record in its own module. With no
 * query, the person's recent searches are offered instead.
 */
function useSearchPaletteCommands(
  open: boolean,
  query: string,
): { commands: Command[]; searching: boolean; failed: boolean } {
  const router = useRouter();
  const search = useUniversalSearch(
    { ...EMPTY_SEARCH, q: query },
    { enabled: open, limit: PALETTE_SEARCH_LIMIT },
  );
  const recent = useRecentSearches(open);
  const { remember } = useSearchHistoryMutations();
  const text = query.trim();
  const commands: Command[] = [];
  // Hits for an older query are hidden once the text no longer matches it.
  const current = search.query !== "" && text.startsWith(search.query);
  for (const hit of current ? search.hits : []) {
    commands.push({
      id: `search-${hit.entity_type}-${hit.id}`,
      group: SEARCH_GROUP_LABELS[hit.module],
      label: hitTitle(hit),
      description: hit.snippet || describeHit(hit).join(" · "),
      keywords: [],
      icon: SEARCH_ICONS[hit.module],
      current: false,
      matched: true,
      run: () => {
        remember(text);
        router.push(searchResultHref(hit));
      },
    });
  }
  if (text.length >= 2) {
    commands.push({
      id: "search-all",
      group: "Search",
      label: `See all results for “${text}”`,
      description: "Filter by module, date, and more.",
      keywords: [],
      icon: Search,
      current: false,
      matched: true,
      run: () => {
        remember(text);
        router.push(searchHref({ q: text }));
      },
    });
  }
  if (!text) {
    for (const item of recent.searches.slice(0, 5)) {
      commands.push({
        id: `recent-search-${item.id}`,
        group: "Recent searches",
        label: item.query,
        keywords: [],
        icon: Clock,
        current: false,
        matched: true,
        run: () => router.push(searchHref({ q: item.query })),
      });
    }
  }
  return { commands, searching: search.searching, failed: search.failed };
}

/** Create or record something without leaving the page, through the shared quick actions. */
function useCreateCommands(): Command[] {
  const { run, waterLabel } = useQuickActions();
  const router = useRouter();
  const create = (
    id: string,
    label: string,
    icon: LucideIcon,
    keywords: readonly string[],
    action: () => void,
  ): Command => ({
    id: `create-${id}`,
    group: "Create",
    label,
    keywords: ["new", "add", "create", ...keywords],
    icon,
    current: false,
    run: action,
  });
  return [
    create("task", "Create task", ListTodo, ["task", "todo", "to-do"], () => run("task")),
    create("reminder", "Create reminder", AlarmClock, ["reminder", "remind", "alert"], () =>
      run("reminder"),
    ),
    create("expense", "Record expense", Receipt, ["expense", "spend", "money", "payment"], () =>
      run("expense"),
    ),
    create("workout", "Log workout", Dumbbell, ["workout", "exercise", "gym", "health"], () =>
      run("workout"),
    ),
    create("water", `Record ${waterLabel} of water`, Droplets, ["water", "drink", "health"], () =>
      run("water"),
    ),
    create("routine", "Start a routine", Play, ["routine", "habit", "start"], () =>
      router.push(habitsHref({ kind: "view", view: "routines" })),
    ),
  ];
}

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
  const [isOpen, setIsOpen] = useState(false);
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
    setIsOpen(true);
    dialog.showModal();
    inputRef.current?.focus();
  }, []);

  const close = useCallback(() => dialogRef.current?.close(), []);

  useEffect(() => {
    const isMac = isMacPlatform(navigator.userAgent);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (matchesModShiftShortcut(event, "f", isMac)) {
        // The full search page, from anywhere.
        event.preventDefault();
        close();
        router.push(SEARCH_PATH);
        return;
      }
      if (!matchesModShortcut(event, "k", isMac)) return;
      event.preventDefault();
      if (dialogRef.current?.open) close();
      else open();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close, router]);

  const noteCommands = useNoteCommands(isOpen, query);
  const calendarCommands = useCalendarPaletteCommands(isOpen);
  const documentCommands = useDocumentPaletteCommands(isOpen, query);
  const createCommands = useCreateCommands();
  const search = useSearchPaletteCommands(isOpen, query);

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
      {
        id: "nav-search",
        group: "Go to" as const,
        label: "Search everything",
        description: "Find records in every module, with filters and saved searches.",
        keywords: ["search", "find", "filter", "saved", "recent"],
        icon: Search,
        current: isActivePath(pathname, SEARCH_PATH),
        run: () => router.push(SEARCH_PATH),
      },
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

  // Order results by group so arrow-key order matches what is on screen. Records the API already
  // matched, and the offers to search a module, skip the local filter.
  const local = [
    ...createCommands,
    ...noteCommands,
    ...calendarCommands,
    ...documentCommands,
    ...commands,
  ];
  const question = query.trim();
  const ask: Command[] =
    question.length >= 3
      ? [
          {
            id: "ask-orbit",
            group: "Search",
            label: `Ask Orbit: “${question}”`,
            description: "Answer from your own records, with sources.",
            keywords: [],
            icon: Bot,
            current: false,
            matched: true,
            run: () => router.push(`/assistant?q=${encodeURIComponent(question)}`),
          },
        ]
      : [];
  const matches = [
    ...search.commands,
    ...local.filter((command) => command.matched),
    ...ask,
    ...filterCommands(
      local.filter((command) => !command.matched),
      query,
    ),
  ];
  const results = GROUPS.flatMap((group) => matches.filter((command) => command.group === group));

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
          setIsOpen(false);
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
            aria-label="Search Orbit and run actions"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search everything, or run an action…"
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
            {search.searching ? "Searching…" : `No results for “${query.trim()}”`}
          </p>
        ) : null}
        {search.failed ? (
          <p role="alert" className="border-t px-4 py-2 text-xs text-muted-foreground">
            Couldn’t search your records just now. Pages and actions still work.
          </p>
        ) : null}

        <p role="status" className="sr-only">
          {search.searching
            ? "Searching…"
            : results.length === 1
              ? "1 result"
              : `${results.length} results`}
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
