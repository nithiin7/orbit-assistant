import { type ClassValue, clsx } from "clsx";
import type { Ref, RefCallback } from "react";
import { twMerge } from "tailwind-merge";

/** Merges conditional class names and resolves Tailwind conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
