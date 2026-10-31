"use client";

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Code,
  FileCode,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Minus,
  NotebookText,
  Quote,
  Redo2,
  Strikethrough,
  Table,
  Underline,
  Undo2,
} from "lucide-react";
import { type KeyboardEvent, useRef } from "react";

import { useIsMac } from "@/components/shortcut-hint";
import { Menu } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/utils/common";

type ToolbarProps = {
  editor: Editor;
  /** Opens the dialog for a web or email link. */
  onLink: () => void;
  /** Opens the picker for a link to another note. */
  onNoteLink: () => void;
};

type Tool = {
  id: string;
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  run: () => void;
};

/**
 * The editor's formatting controls, in an ARIA toolbar: one tab stop, then arrow keys move
 * between buttons. Every action also has a keyboard shortcut or Markdown-style input rule
 * (`# `, `- `, `[ ] `, `> `, three backticks), so the toolbar is optional.
 */
/** "Mod+Shift+B" as shown to the user ("⌘⇧B" or "Ctrl+Shift+B") and as `aria-keyshortcuts`. */
function shortcutLabels(shortcut: string, isMac: boolean): { shown: string; aria: string } {
  const keys = shortcut.split("+");
  const aria = keys.map((key) => (key === "Mod" ? (isMac ? "Meta" : "Control") : key)).join("+");
  if (!isMac) return { shown: keys.map((key) => (key === "Mod" ? "Ctrl" : key)).join("+"), aria };
  const symbols: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥" };
  return { shown: keys.map((key) => symbols[key] ?? key).join(""), aria };
}

export function EditorToolbar({ editor, onLink, onNoteLink }: ToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isMac = useIsMac();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      blockquote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  const groups: Tool[][] = [
    [
      {
        id: "undo",
        label: "Undo",
        shortcut: "Mod+Z",
        icon: Undo2,
        disabled: !state.canUndo,
        run: () => chain().undo().run(),
      },
      {
        id: "redo",
        label: "Redo",
        shortcut: "Mod+Shift+Z",
        icon: Redo2,
        disabled: !state.canRedo,
        run: () => chain().redo().run(),
      },
    ],
    [
      {
        id: "h1",
        label: "Heading 1",
        shortcut: "Mod+Alt+1",
        icon: Heading1,
        active: state.h1,
        run: () => chain().toggleHeading({ level: 1 }).run(),
      },
      {
        id: "h2",
        label: "Heading 2",
        shortcut: "Mod+Alt+2",
        icon: Heading2,
        active: state.h2,
        run: () => chain().toggleHeading({ level: 2 }).run(),
      },
      {
        id: "h3",
        label: "Heading 3",
        shortcut: "Mod+Alt+3",
        icon: Heading3,
        active: state.h3,
        run: () => chain().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      {
        id: "bold",
        label: "Bold",
        shortcut: "Mod+B",
        icon: Bold,
        active: state.bold,
        run: () => chain().toggleBold().run(),
      },
      {
        id: "italic",
        label: "Italic",
        shortcut: "Mod+I",
        icon: Italic,
        active: state.italic,
        run: () => chain().toggleItalic().run(),
      },
      {
        id: "underline",
        label: "Underline",
        shortcut: "Mod+U",
        icon: Underline,
        active: state.underline,
        run: () => chain().toggleUnderline().run(),
      },
      {
        id: "strike",
        label: "Strikethrough",
        shortcut: "Mod+Shift+S",
        icon: Strikethrough,
        active: state.strike,
        run: () => chain().toggleStrike().run(),
      },
      {
        id: "code",
        label: "Inline code",
        shortcut: "Mod+E",
        icon: Code,
        active: state.code,
        run: () => chain().toggleCode().run(),
      },
    ],
    [
      {
        id: "bullets",
        label: "Bulleted list",
        shortcut: "Mod+Shift+8",
        icon: List,
        active: state.bulletList,
        run: () => chain().toggleBulletList().run(),
      },
      {
        id: "numbers",
        label: "Numbered list",
        shortcut: "Mod+Shift+7",
        icon: ListOrdered,
        active: state.orderedList,
        run: () => chain().toggleOrderedList().run(),
      },
      {
        id: "checklist",
        label: "Checklist",
        shortcut: "Mod+Shift+9",
        icon: ListChecks,
        active: state.taskList,
        run: () => chain().toggleTaskList().run(),
      },
      {
        id: "quote",
        label: "Quote",
        shortcut: "Mod+Shift+B",
        icon: Quote,
        active: state.blockquote,
        run: () => chain().toggleBlockquote().run(),
      },
      {
        id: "codeblock",
        label: "Code block",
        shortcut: "Mod+Alt+C",
        icon: FileCode,
        active: state.codeBlock,
        run: () => chain().toggleCodeBlock().run(),
      },
      {
        id: "divider",
        label: "Divider",
        icon: Minus,
        run: () => chain().setHorizontalRule().run(),
      },
    ],
    [
      {
        id: "link",
        label: state.link ? "Edit link" : "Link",
        icon: Link2,
        active: state.link,
        run: onLink,
      },
      { id: "note-link", label: "Link to a note", icon: NotebookText, run: onNoteLink },
    ],
  ];

  // Roving focus: arrow keys, Home, and End move between the toolbar's buttons.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>("[data-tool]:not(:disabled)") ?? []),
    ];
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % buttons.length
        : event.key === "ArrowLeft"
          ? (index - 1 + buttons.length) % buttons.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  // The toolbar is one tab stop: its first enabled button.
  const tabStop = groups.flat().find((tool) => !tool.disabled)?.id;
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Formatting"
      onKeyDown={onKeyDown}
      className="-mx-1 flex flex-wrap items-center gap-y-0.5 px-1 py-1"
    >
      {groups.map((group, groupIndex) => (
        <div key={group[0]?.id} className="flex shrink-0 items-center gap-0.5">
          {groupIndex > 0 ? (
            <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
          ) : null}
          {group.map((tool) => {
            const Icon = tool.icon;
            const tabIndex = tool.id === tabStop ? 0 : -1;
            const keys = tool.shortcut ? shortcutLabels(tool.shortcut, isMac === true) : null;
            return (
              <Tooltip key={tool.id} label={tool.label} shortcut={keys?.shown} side="bottom">
                <button
                  type="button"
                  data-tool
                  aria-keyshortcuts={keys?.aria}
                  tabIndex={tabIndex}
                  aria-label={tool.label}
                  aria-pressed={tool.active ?? undefined}
                  disabled={tool.disabled}
                  // Keep the editor's selection while clicking a tool.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={tool.run}
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                    tool.active &&
                      "bg-brand-subtle text-brand hover:bg-brand-subtle hover:text-brand",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            );
          })}
        </div>
      ))}
      <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
      <Menu
        aria-label="Table"
        variant="ghost"
        size="sm"
        className="shrink-0 text-muted-foreground"
        items={[
          {
            id: "insert",
            label: "Insert table",
            disabled: state.table,
            onSelect: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
          },
          {
            id: "row-above",
            label: "Add row above",
            disabled: !state.table,
            group: "Rows",
            onSelect: () => chain().addRowBefore().run(),
          },
          {
            id: "row-below",
            label: "Add row below",
            disabled: !state.table,
            group: "Rows",
            onSelect: () => chain().addRowAfter().run(),
          },
          {
            id: "row-delete",
            label: "Delete row",
            disabled: !state.table,
            group: "Rows",
            onSelect: () => chain().deleteRow().run(),
          },
          {
            id: "col-left",
            label: "Add column before",
            disabled: !state.table,
            group: "Columns",
            onSelect: () => chain().addColumnBefore().run(),
          },
          {
            id: "col-right",
            label: "Add column after",
            disabled: !state.table,
            group: "Columns",
            onSelect: () => chain().addColumnAfter().run(),
          },
          {
            id: "col-delete",
            label: "Delete column",
            disabled: !state.table,
            group: "Columns",
            onSelect: () => chain().deleteColumn().run(),
          },
          {
            id: "delete",
            label: "Delete table",
            destructive: true,
            disabled: !state.table,
            onSelect: () => chain().deleteTable().run(),
          },
        ]}
      >
        <Table aria-hidden="true" />
      </Menu>
    </div>
  );
}
