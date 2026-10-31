"use client";

import type { CalendarCategory, CalendarCategoryColor, Task } from "@orbit/contracts";
import { CalendarClock, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Resource } from "@/hooks/query-resource";
import { useCategoryMutations } from "@/hooks/use-calendar";
import { CATEGORY_COLORS, CATEGORY_STYLES } from "@/lib/calendar";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";

import { TASK_DRAG_TYPE } from "./month-view";

type CalendarSidebarProps = {
  workspaceId: string;
  categories: readonly CalendarCategory[];
  unscheduled: Resource<{ tasks: Task[]; total: number }> | null;
  onSchedule: (task: Task) => void;
};

/** Category filters and colors, and open tasks without a time to plan onto the calendar. */
export function CalendarSidebar({
  workspaceId,
  categories,
  unscheduled,
  onSchedule,
}: CalendarSidebarProps) {
  return (
    <div className="space-y-6">
      <CategoryList workspaceId={workspaceId} categories={categories} />
      {unscheduled ? <UnscheduledTasks state={unscheduled} onSchedule={onSchedule} /> : null}
    </div>
  );
}

function CategoryList({
  workspaceId,
  categories,
}: {
  workspaceId: string;
  categories: readonly CalendarCategory[];
}) {
  const id = useId();
  const mutations = useCategoryMutations(workspaceId);
  const { confirm, confirmDialog } = useConfirm();
  const [name, setName] = useState("");
  const [color, setColor] = useState<CalendarCategoryColor>("blue");
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(describeApiError(reason, fallback));
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    void run(async () => {
      await mutations.create.mutateAsync({ name: name.trim(), color });
      setName("");
    }, "Couldn’t add the category.");
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-2">
      <h2 id={`${id}-heading`} className="text-sm font-semibold">
        Categories
      </h2>
      {categories.length === 0 ? (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <ul className="space-y-0.5">
          {categories.map((category) => (
            <li
              key={category.id}
              className="group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-accent"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={category.is_visible}
                  onChange={(event) =>
                    void run(
                      () =>
                        mutations.update.mutateAsync({
                          id: category.id,
                          body: { is_visible: event.target.checked },
                        }),
                      "Couldn’t change the category.",
                    )
                  }
                  className="size-4"
                />
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    CATEGORY_STYLES[category.color].dot,
                  )}
                  aria-hidden="true"
                />
                <span className={cn("truncate", !category.is_visible && "text-muted-foreground")}>
                  {category.name}
                </span>
              </label>
              <Menu
                aria-label={`${category.name} options`}
                variant="ghost"
                size="icon"
                chevron={false}
                align="end"
                className="size-7 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                items={[
                  ...CATEGORY_COLORS.map((option) => ({
                    id: option.value,
                    label: option.label,
                    group: "Color",
                    checked: category.color === option.value,
                    onSelect: () =>
                      void run(
                        () =>
                          mutations.update.mutateAsync({
                            id: category.id,
                            body: { color: option.value },
                          }),
                        "Couldn’t change the color.",
                      ),
                  })),
                  {
                    id: "delete",
                    label: "Delete category",
                    destructive: true,
                    onSelect: () =>
                      void (async () => {
                        const confirmed = await confirm({
                          title: `Delete “${category.name}”?`,
                          description: "Its events stay on the calendar without a category.",
                          confirmLabel: "Delete",
                          destructive: true,
                        });
                        if (confirmed) {
                          await run(
                            () => mutations.remove.mutateAsync(category.id),
                            "Couldn’t delete the category.",
                          );
                        }
                      })(),
                  },
                ]}
              >
                <MoreHorizontal aria-hidden="true" />
              </Menu>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex items-center gap-1.5">
        <Input
          aria-label="New category name"
          placeholder="New category"
          maxLength={50}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-8 min-w-0 flex-1 text-sm"
        />
        <Select
          aria-label="New category color"
          value={color}
          onValueChange={setColor}
          options={CATEGORY_COLORS}
          className="h-8 w-24 text-xs"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Add category"
          disabled={!name.trim()}
        >
          <Plus aria-hidden="true" />
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {confirmDialog}
    </section>
  );
}

function UnscheduledTasks({
  state,
  onSchedule,
}: {
  state: Resource<{ tasks: Task[]; total: number }>;
  onSchedule: (task: Task) => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-2">
      <div>
        <h2 id={`${id}-heading`} className="text-sm font-semibold">
          Unscheduled tasks
        </h2>
        <p className="text-xs text-muted-foreground">
          Drag onto the week or day view, or choose Schedule.
        </p>
      </div>
      {state.status === "loading" ? (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : state.status === "error" ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {state.message}
        </p>
      ) : state.data.tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every open task has a time.</p>
      ) : (
        <ul className="space-y-1">
          {state.data.tasks.map((task) => (
            <li
              key={task.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              className="group flex cursor-grab items-center gap-1.5 rounded-md border border-dashed bg-card px-2 py-1.5 text-sm active:cursor-grabbing"
            >
              <GripVertical
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{task.title}</span>
                {task.due_date ? (
                  <span className="block text-xs text-muted-foreground">
                    Due {formatCalendarDate(task.due_date)}
                  </span>
                ) : null}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                aria-label={`Schedule ${task.title}`}
                onClick={() => onSchedule(task)}
              >
                <CalendarClock aria-hidden="true" />
                Schedule
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
