"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { CreateTaskRequest, TaskListDetail } from "@orbit/contracts";
import {
  CalendarDays,
  CircleHelp,
  Flag,
  type LucideIcon,
  Plus,
  Repeat,
  Tag,
  X,
} from "lucide-react";
import { type Ref, useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import {
  newTaskSchema,
  parseQuickAdd,
  type QuickAddKind,
  type QuickAddToken,
  repeatLabel,
} from "@/lib/tasks";
import { cn, mergeRefs } from "@/utils/common";
import { localDateString } from "@/utils/dates";

import { ListSelect, NO_LIST } from "./list-select";
import { PrioritySelect } from "./priority-select";

type TaskComposerProps = {
  onCreate: (draft: CreateTaskRequest) => Promise<void>;
  /** Lets the page focus the title field from its keyboard shortcut. */
  titleRef?: Ref<HTMLInputElement>;
  /** The workspace's lists; the picker only shows once there is one. */
  lists?: readonly TaskListDetail[];
  /** The list new tasks start on: the one in view, if any. */
  defaultListId?: string | null;
};

const TOKEN_ICONS: Record<QuickAddKind, LucideIcon> = {
  date: CalendarDays,
  repeat: Repeat,
  priority: Flag,
  list: Tag,
};

/**
 * Quick entry: type a title, optionally set a due date, priority, and list, press Enter. Words
 * in the title can set them too ("Pay rent fri every month !high #home", see `parseQuickAdd`);
 * chips show what was understood, each with a button to keep its words in the title instead.
 * A picker the user set wins over typed words.
 */
export function TaskComposer({
  onCreate,
  titleRef,
  lists = [],
  defaultListId = null,
}: TaskComposerProps) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(newTaskSchema),
    defaultValues: {
      title: "",
      dueDate: "",
      priority: "none" as const,
      list: defaultListId ?? NO_LIST,
    },
  });

  // Kinds the user dismissed for this task; their words stay in the title.
  const [ignored, setIgnored] = useState<ReadonlySet<QuickAddKind>>(new Set());
  const [helpOpen, setHelpOpen] = useState(false);
  const startList = defaultListId ?? NO_LIST;
  const [typed, pickedDue, pickedPriority, pickedList] = useWatch({
    control,
    name: ["title", "dueDate", "priority", "list"],
  });
  // What the pickers set isn't read from the title, so those words stay in it.
  const skip = new Set(ignored);
  if (pickedDue) skip.add("date");
  if (pickedPriority !== "none") skip.add("priority");
  if (pickedList !== startList) skip.add("list");
  const parsed = parseQuickAdd(typed, { today: localDateString(), lists, ignore: skip });
  // With a picked due date, a typed repeat counts from that date, not the one it implied.
  const tokens = parsed.tokens.map((token) =>
    token.kind === "repeat" && pickedDue && parsed.recurrence
      ? { ...token, label: repeatLabel(parsed.recurrence) }
      : token,
  );
  const understood = (kind: QuickAddKind) => tokens.some((token) => token.kind === kind);
  if (typed === "" && ignored.size > 0) setIgnored(new Set());

  const onSubmit = handleSubmit(async ({ title, dueDate, priority, list }) => {
    const dueFromTitle = understood("date") || (understood("repeat") && !dueDate);
    const listFromTitle = understood("list") ? parsed.listId : null;
    try {
      await onCreate({
        title: tokens.length > 0 ? parsed.title : title,
        description: "",
        priority: understood("priority") && parsed.priority ? parsed.priority : priority,
        due_date: (dueFromTitle ? parsed.dueDate : null) ?? (dueDate || null),
        list_id: listFromTitle ?? (list === NO_LIST ? null : list),
        ...(understood("repeat") ? { recurrence: parsed.recurrence } : {}),
      });
      // Ready for the next task; focus stays in the title field. The list stays as chosen.
      reset({ title: "", dueDate: "", priority: "none", list });
      setIgnored(new Set());
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t add the task. Try again."),
      });
    }
  });

  const titleField = register("title");
  const fieldError = errors.title?.message;
  const errorId = `${id}-error`;
  const tokensId = `${id}-understood`;
  const helpId = `${id}-help`;
  const describedBy = [fieldError ? errorId : null, tokens.length > 0 ? tokensId : null]
    .filter(Boolean)
    .join(" ");
  return (
    <form
      noValidate
      onSubmit={(event) => {
        // Enter in the title field submits even while the button is disabled.
        if (isSubmitting) event.preventDefault();
        else void onSubmit(event);
      }}
      aria-label="Add a task"
      className="space-y-2 rounded-2xl border bg-card p-2 shadow-elevation-2 transition-[border-color,box-shadow] duration-150 focus-within:border-ring/60 focus-within:shadow-elevation-3 has-[[aria-invalid=true]]:border-destructive/60"
    >
      <div className="flex flex-col gap-2 @2xl/list:flex-row @2xl/list:items-center">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Plus
            aria-hidden="true"
            className="pointer-events-none absolute left-3 size-5 text-brand"
          />
          <label htmlFor={`${id}-title`} className="sr-only">
            Task title
          </label>
          <Input
            {...titleField}
            ref={mergeRefs(titleField.ref, titleRef)}
            id={`${id}-title`}
            autoComplete="off"
            placeholder="Add a task… try “Call mom fri !high”"
            aria-keyshortcuts="N"
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={describedBy || undefined}
            // The card draws the field's frame and focus state.
            className="h-11 border-transparent bg-transparent pr-11 pl-11 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0 aria-invalid:border-transparent sm:pr-16 @2xl/list:text-sm dark:bg-transparent"
          />
          <Kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-10 hidden sm:inline-flex"
          >
            N
          </Kbd>
          <span className="absolute right-1.5">
            <Tooltip label="Quick add tips" side="top">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Quick add tips"
                aria-expanded={helpOpen}
                aria-controls={helpId}
                onClick={() => setHelpOpen((open) => !open)}
                className={cn(
                  "size-8 text-muted-foreground",
                  helpOpen && "bg-accent text-foreground",
                )}
              >
                <CircleHelp aria-hidden="true" />
              </Button>
            </Tooltip>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-2 @2xl/list:border-t-0 @2xl/list:border-l @2xl/list:pt-0 @2xl/list:pl-2">
          <label htmlFor={`${id}-due`} className="sr-only">
            Due date
          </label>
          <Controller
            control={control}
            name="dueDate"
            render={({ field }) => (
              <DatePicker
                id={`${id}-due`}
                ref={field.ref}
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                placeholder="Due date"
                clearable
                className="min-w-32 flex-1 @2xl/list:w-40 @2xl/list:flex-none"
              />
            )}
          />
          <Controller
            control={control}
            name="priority"
            render={({ field }) => (
              <PrioritySelect
                id={`${id}-priority`}
                value={field.value}
                onChange={field.onChange}
                className="min-w-32 flex-1 @2xl/list:w-36 @2xl/list:flex-none"
                hiddenLabel
              />
            )}
          />
          {lists.length > 0 ? (
            <Controller
              control={control}
              name="list"
              render={({ field }) => (
                <ListSelect
                  id={`${id}-list`}
                  lists={lists}
                  value={field.value}
                  onChange={field.onChange}
                  className="min-w-32 flex-1 @2xl/list:w-36 @2xl/list:flex-none"
                  hiddenLabel
                />
              )}
            />
          ) : null}
          <Button type="submit" disabled={isSubmitting} className="flex-1 @md/list:flex-none">
            {isSubmitting ? "Adding…" : "Add task"}
          </Button>
        </div>
      </div>
      {helpOpen ? <QuickAddHelp id={helpId} listName={lists[0]?.name ?? null} /> : null}
      {tokens.length > 0 ? (
        <UnderstoodChips
          id={tokensId}
          tokens={tokens}
          onDismiss={(kind) => setIgnored((current) => new Set(current).add(kind))}
        />
      ) : null}
      {fieldError ? (
        <p id={errorId} className="px-3 pb-1 text-xs font-medium text-destructive">
          {fieldError}
        </p>
      ) : null}
      <FormAlert message={errors.root?.server?.message ?? null} />
    </form>
  );
}

/** What the title set, as chips; dismissing one keeps its words in the title. */
function UnderstoodChips({
  id,
  tokens,
  onDismiss,
}: {
  id: string;
  tokens: readonly QuickAddToken[];
  onDismiss: (kind: QuickAddKind) => void;
}) {
  return (
    <div className="px-3 pb-1">
      <p id={id} className="sr-only">
        From the title: {tokens.map((token) => token.label).join(", ")}.
      </p>
      <ul aria-label="Set from the title" className="flex flex-wrap items-center gap-1.5">
        {tokens.map((token) => {
          const Icon = TOKEN_ICONS[token.kind];
          return (
            <li
              key={token.kind}
              className="inline-flex animate-popover-in items-center gap-1 rounded-full bg-brand-subtle py-0.5 pr-0.5 pl-2 text-xs font-medium text-brand"
            >
              <Icon aria-hidden="true" className="size-3" />
              <span>{token.label}</span>
              <button
                type="button"
                onClick={() => onDismiss(token.kind)}
                aria-label={`Keep “${token.text}” in the title`}
                className="ml-0.5 inline-flex size-4 items-center justify-center rounded-full outline-none hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const HELP_ROWS: readonly { kind: QuickAddKind; label: string; examples: readonly string[] }[] = [
  {
    kind: "date",
    label: "Due date",
    examples: ["tomorrow", "fri", "next week", "in 3 days", "dec 5", "on the 1st"],
  },
  {
    kind: "repeat",
    label: "Repeat",
    examples: ["every day", "every monday", "every other week", "monthly"],
  },
  { kind: "priority", label: "Priority", examples: ["!high", "!!", "!low", "p1"] },
];

/** What the title understands, with examples; opened from the composer's help button. */
function QuickAddHelp({ id, listName }: { id: string; listName: string | null }) {
  const listTag = listName ? `#${listName.toLowerCase().replace(/\s+/g, "")}` : null;
  const rows = listTag
    ? [...HELP_ROWS, { kind: "list" as const, label: "List", examples: [listTag] }]
    : HELP_ROWS;
  return (
    <section
      id={id}
      aria-label="Quick add tips"
      className="mx-1 animate-popover-in space-y-3 rounded-xl bg-muted/40 p-3 text-sm"
    >
      <p className="text-pretty text-muted-foreground">
        Type these anywhere in the title, like{" "}
        <span className="font-medium text-foreground">Pay rent on the 1st every month !high</span>.
      </p>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
        {rows.map(({ kind, label, examples }) => {
          const Icon = TOKEN_ICONS[kind];
          return (
            <div key={kind} className="contents">
              <dt className="flex items-center gap-1.5 font-medium">
                <Icon aria-hidden="true" className="size-3.5 text-brand" />
                {label}
              </dt>
              <dd className="flex flex-wrap gap-1">
                {examples.map((example) => (
                  <code
                    key={example}
                    className="rounded-md border bg-card px-1.5 py-0.5 font-mono text-xs"
                  >
                    {example}
                  </code>
                ))}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-xs text-pretty text-muted-foreground">
        Chips under the title show what was picked up; select × on one to keep those words in the
        title. A date, priority, or list you choose with the buttons wins over typed words.
      </p>
    </section>
  );
}
