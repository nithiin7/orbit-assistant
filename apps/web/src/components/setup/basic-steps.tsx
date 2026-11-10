"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { Check, CheckSquare, NotebookPen, Repeat, Settings } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { updateMe } from "@/api/profile";
import { FormAlert, FormField } from "@/components/form-field";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { ProfilePhoto } from "@/components/settings/profile-photo";
import { TimeZonePreference } from "@/components/settings/time-zone-preference";
import { Button } from "@/components/ui/button";
import { displayNameSchema } from "@/lib/auth/validation";
import { SETUP_AREAS, type SetupArea } from "@/lib/setup";
import { useAuth, useCurrentUser } from "@/providers/auth";

import { StepActions, StepFrame, type StepNav } from "./step-frame";

export function ProfileStep({ nav }: { nav: StepNav }) {
  const { withToken, setUser } = useAuth();
  const user = useCurrentUser();
  const formId = useId();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(displayNameSchema),
    defaultValues: { displayName: user.display_name },
  });

  const onSubmit = handleSubmit(async ({ displayName }) => {
    if (displayName.trim() !== user.display_name) {
      try {
        setUser(await withToken((token) => updateMe(token, { display_name: displayName })));
      } catch (reason) {
        setError("root.server", {
          message: describeApiError(reason, "Couldn’t save your name. Try again."),
        });
        return;
      }
    }
    nav.next();
  });

  return (
    <StepFrame
      title="Welcome to Orbit"
      description="A few optional steps to make Orbit yours. Skip anything, and change it later in Settings."
    >
      <form id={formId} noValidate onSubmit={onSubmit} className="space-y-3">
        <FormField
          label="What should we call you?"
          autoComplete="name"
          {...register("displayName")}
          error={errors.displayName?.message}
        />
        <FormAlert message={errors.root?.server?.message ?? null} />
      </form>
      <ProfilePhoto />
      <TimeZonePreference />
      <StepActions nav={nav} form={formId} pending={isSubmitting} />
    </StepFrame>
  );
}

export function AppearanceStep({ nav }: { nav: StepNav }) {
  return (
    <StepFrame
      title="Make it feel right"
      description="Pick a mode, colors, and font. Changes apply at once and stay in this browser."
    >
      <AppearanceSettings />
      <StepActions nav={nav} />
    </StepFrame>
  );
}

export function AreasStep({
  nav,
  areas,
  onChange,
}: {
  nav: StepNav;
  areas: readonly SetupArea[];
  onChange: (areas: SetupArea[]) => void;
}) {
  const toggle = (area: SetupArea, on: boolean) =>
    onChange(SETUP_AREAS.map((a) => a.value).filter((a) => (a === area ? on : areas.includes(a))));

  return (
    <StepFrame
      title="What would you like to set up?"
      description="Tasks, notes, habits, and the calendar are ready to use. Choose anything else to set up now."
    >
      <fieldset>
        <legend className="sr-only">Areas to set up</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {SETUP_AREAS.map((area) => (
            <label
              key={area.value}
              className="group relative flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4 shadow-elevation-1 transition-[border-color,box-shadow] duration-150 select-none hover:border-foreground/20 has-checked:border-brand has-checked:ring-1 has-checked:ring-brand has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background"
            >
              <input
                type="checkbox"
                checked={areas.includes(area.value)}
                onChange={(event) => toggle(area.value, event.target.checked)}
                className="sr-only"
              />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block text-sm font-medium">{area.label}</span>
                <span className="block text-xs text-pretty text-muted-foreground">
                  {area.description}
                </span>
              </span>
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-full border text-transparent transition-colors duration-150 group-has-checked:border-brand group-has-checked:bg-brand group-has-checked:text-white"
              >
                <Check className="size-3.5" />
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <StepActions nav={nav} />
    </StepFrame>
  );
}

const NEXT_IDEAS = [
  { href: "/tasks", icon: CheckSquare, label: "Add your first task" },
  { href: "/notes", icon: NotebookPen, label: "Write a note" },
  { href: "/habits", icon: Repeat, label: "Start a habit" },
  { href: "/settings", icon: Settings, label: "Look through Settings" },
] as const;

export function DoneStep({
  nav,
  onFinish,
  finishing,
  error,
}: {
  nav: StepNav;
  onFinish: (href: string) => void;
  finishing: boolean;
  error: string | null;
}) {
  return (
    <StepFrame
      title="You’re all set"
      description="Everything you skipped is in Settings whenever you want it. Here are a few places to start."
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {NEXT_IDEAS.map(({ href, icon: Icon, label }) => (
          <li key={href}>
            <Link
              href={href}
              onClick={(event) => {
                event.preventDefault();
                onFinish(href);
              }}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm font-medium shadow-elevation-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand"
              >
                <Icon className="size-4" />
              </span>
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <FormAlert message={error} />
      <div className="flex flex-wrap items-center gap-2 border-t pt-5">
        {nav.back ? (
          <Button variant="ghost" onClick={nav.back} disabled={finishing}>
            Back
          </Button>
        ) : null}
        <Button className="ml-auto" onClick={() => onFinish("/")} disabled={finishing}>
          {finishing ? "Finishing…" : "Go to the dashboard"}
        </Button>
      </div>
    </StepFrame>
  );
}
