import { type ClassValue, clsx } from "clsx";
import type { Ref, RefCallback } from "react";
import { twMerge } from "tailwind-merge";

/** One choice in a select, radio group, or segmented control. */
export type Option<T extends string> = { value: T; label: string };

/** Merges conditional class names and resolves Tailwind conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Items keyed by their `id`, for looking up related records by reference. */
export function byId<T extends { id: string }>(items: readonly T[]): ReadonlyMap<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** One ref callback that sets every given ref, for an element that several owners need. */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value);
      else if (ref) ref.current = value;
    }
  };
}
