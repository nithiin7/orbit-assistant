"use client";

import { Check } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { FONTS, PALETTES } from "@/lib/appearance-preference";

import { setAppFont, setPalette, useAppFont, usePalette } from "./appearance-state";
import { SidebarSettings } from "./sidebar-settings";
import { ThemeSelector } from "./theme-selector";

/** Mode, color theme, font, and sidebar links. Every choice is saved in this browser only. */
export function AppearanceSettings() {
  return (
    <div className="space-y-8">
      <AppearanceSection
        id="appearance-mode"
        title="Mode"
        description="Light, dark, or match your device."
      >
        <ThemeSelector />
      </AppearanceSection>
      <AppearanceSection
        id="appearance-palette"
        title="Color theme"
        description="Surfaces and accent colors. Status colors keep their meaning in every theme."
      >
        <PaletteSelector />
      </AppearanceSection>
      <AppearanceSection
        id="appearance-font"
        title="Font"
        description="The typeface used across Orbit."
      >
        <FontSelector />
      </AppearanceSection>
      <AppearanceSection
        id="appearance-sidebar"
        title="Sidebar"
        description="Choose which pages show in the sidebar. Hidden pages stay one search away."
      >
        <SidebarSettings />
      </AppearanceSection>
    </div>
  );
}

function AppearanceSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 space-y-3">
      <div className="space-y-0.5">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function PaletteSelector() {
  const palette = usePalette();

  if (!palette) return <OptionsSkeleton label="Loading color themes…" count={PALETTES.length} />;

  return (
    <fieldset>
      <legend className="sr-only">Color theme</legend>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {PALETTES.map((option) => (
          <OptionCard
            key={option.value}
            name="palette"
            checked={palette === option.value}
            onSelect={() => setPalette(option.value)}
            label={option.label}
            description={option.description}
            preview={
              <span className="flex -space-x-1.5" aria-hidden="true">
                {option.swatch.map((color) => (
                  <span
                    key={color}
                    className="size-6 rounded-full border border-foreground/10 shadow-elevation-1"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
            }
          />
        ))}
      </div>
    </fieldset>
  );
}

function FontSelector() {
  const font = useAppFont();

  if (!font) return <OptionsSkeleton label="Loading fonts…" count={FONTS.length} />;

  return (
    <fieldset>
      <legend className="sr-only">Font</legend>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {FONTS.map((option) => {
          const style: CSSProperties = {
            fontFamily: option.family ? `var(${option.family})` : "system-ui",
          };
          return (
            <OptionCard
              key={option.value}
              name="font"
              checked={font === option.value}
              onSelect={() => setAppFont(option.value)}
              label={option.label}
              description={option.description}
              labelStyle={style}
              preview={
                <span
                  className="flex size-8 items-center justify-center rounded-md border bg-background text-base font-medium"
                  style={style}
                  aria-hidden="true"
                >
                  Aa
                </span>
              }
            />
          );
        })}
      </div>
    </fieldset>
  );
}

/** A radio styled as a card, matching the mode options in ThemeSelector. */
function OptionCard({
  name,
  checked,
  onSelect,
  label,
  description,
  preview,
  labelStyle,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  description: string;
  preview: ReactNode;
  labelStyle?: CSSProperties;
}) {
  return (
    <label className="group relative flex cursor-pointer flex-col gap-3 rounded-lg border bg-card p-4 shadow-elevation-1 transition-[border-color,box-shadow] duration-150 select-none hover:border-foreground/20 has-checked:border-brand has-checked:ring-1 has-checked:ring-brand has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background">
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      <span className="flex items-center justify-between">
        {preview}
        <Check
          className="size-4 text-brand opacity-0 transition-opacity duration-150 group-has-checked:opacity-100"
          aria-hidden="true"
        />
      </span>
      <span className="space-y-0.5">
        <span className="block text-sm font-medium" style={labelStyle}>
          {label}
        </span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function OptionsSkeleton({ label, count }: { label: string; count: number }) {
  return (
    <div aria-busy="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-[6.5rem] rounded-lg" />
      ))}
    </div>
  );
}
