"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { type ComponentPropsWithRef, type CSSProperties, type ReactNode, useId } from "react";

import { cn } from "@/utils/common";

export type SortableMove<T> = {
  item: T;
  /** Where the item was and where it went, as indexes into `items`. */
  from: number;
  to: number;
  /** Every item, in the new order. */
  order: T[];
};

type SortableListProps<T extends { id: string }> = {
  items: readonly T[];
  /** How screen readers name an item while it moves, such as its title. */
  itemLabel: (item: T) => string;
  onMove: (move: SortableMove<T>) => void;
  /** The list itself, whose rows call `useSortableItem`. */
  children: ReactNode;
};

const INSTRUCTIONS =
  "To move an item, press Space or Enter on its handle, use the arrow keys to move it, then " +
  "press Space or Enter to drop it, or Escape to cancel.";

/**
 * A vertical list whose rows can be dragged into a new order by their handles: with a mouse, a
 * finger, or the keyboard (Space to pick up, arrows to move, Space to drop). Moves are announced.
 */
export function SortableList<T extends { id: string }>({
  items,
  itemLabel,
  onMove,
  children,
}: SortableListProps<T>) {
  // A stable ID keeps the server and client markup the same.
  const id = useId();
  const sensors = useSensors(
    // A few pixels of movement before a drag starts, so a click on the handle stays a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const indexOf = (itemId: UniqueIdentifier) => items.findIndex((item) => item.id === itemId);
  const labelOf = (itemId: UniqueIdentifier) => {
    const item = items[indexOf(itemId)];
    return item ? `“${itemLabel(item)}”` : "The item";
  };
  const place = (itemId: UniqueIdentifier) => `position ${indexOf(itemId) + 1} of ${items.length}`;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = indexOf(active.id);
    const to = indexOf(over.id);
    const item = items[from];
    if (!item || to < 0) return;
    onMove({ item, from, to, order: arrayMove([...items], from, to) });
  };

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: INSTRUCTIONS },
        announcements: {
          onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}, ${place(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over ? `${labelOf(active.id)} is now at ${place(over.id)}.` : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? `Dropped ${labelOf(active.id)} at ${place(over.id)}.`
              : `Dropped ${labelOf(active.id)}.`,
          onDragCancel: ({ active }) => `Cancelled. ${labelOf(active.id)} stays where it was.`,
        },
      }}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export type SortableItem = ReturnType<typeof useSortableItem>;

/** For a row inside `SortableList`: spread `row` on the row element, `handle` on `DragHandle`. */
export function useSortableItem(id: string) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return {
    row: { ref: setNodeRef, style },
    handle: { ref: setActivatorNodeRef, ...attributes, ...listeners },
    dragging: isDragging,
  };
}

type DragHandleProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  /** Names what it moves, such as `Move “Buy milk”`. */
  "aria-label": string;
};

/** The grip a sortable row is dragged by. */
export function DragHandle({ className, ...props }: DragHandleProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        // `touch-none` lets a finger drag the row instead of scrolling the page.
        "flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        className,
      )}
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
}
