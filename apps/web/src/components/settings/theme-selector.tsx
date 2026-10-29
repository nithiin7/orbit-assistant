"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Skeleton } from "@/components/ui/skeleton";
import { useHydrated } from "@/hooks/use-hydrated";

const OPTIONS = [
  { value: "light", label: "Light", description: "Always use the light theme.", icon: Sun },
  { value: "dark", label: "Dark", description: "Always use the dark theme.", icon: Moon },
  { value: "system", label: "System", description: "Match your device setting.", icon: Monitor },
] as const;

/** Light, dark, or system theme, as a radio group. The choice is saved in this browser. */
export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  // The stored theme is only known after hydration; show a placeholder rather than a wrong choice.
  const hydrated = useHydrated();

  if (!hydrated || !theme) {
    return (
      <div aria-busy="true" className="grid gap-3 sm:grid-cols-3">
        <span className="sr-only">Loading theme options…</span>
        {OPTIONS.map(({ value }) => (
          <Skeleton key={value} className="h-[6.5rem] rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map(({ value, label, description, icon: Icon }) => (
          <label
            key={value}
            className="group relative flex cursor-pointer flex-col gap-3 rounded-lg border bg-card p-4 shadow-elevation-1 transition-[border-color,box-shadow] duration-150 select-none hover:border-foreground/20 has-checked:border-brand has-checked:ring-1 has-checked:ring-brand has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background"
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={theme === value}
              onChange={() => setTheme(value)}
              className="sr-only"
            />
            <span className="flex items-center justify-between">
              <span className="flex size-8 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors duration-150 group-has-checked:text-brand">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <Check
                className="size-4 text-brand opacity-0 transition-opacity duration-150 group-has-checked:opacity-100"
                aria-hidden="true"
              />
            </span>
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
