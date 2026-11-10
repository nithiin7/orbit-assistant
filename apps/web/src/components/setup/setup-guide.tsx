"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";

import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { ALL_AREAS, parseSetupStep, type SetupArea, type SetupStep, setupSteps } from "@/lib/setup";

import { AiStep, ConnectStep, FinanceStep, HealthStep } from "./area-steps";
import { AppearanceStep, AreasStep, DoneStep, ProfileStep } from "./basic-steps";
import type { StepNav } from "./step-frame";

/**
 * The first-run setup guide. Every step is optional and saves through the same APIs as
 * Settings, so leaving part-way keeps whatever was already saved. Opening it moves a new user
 * from `pending` to `deferred`, which stops the automatic redirect and shows the dashboard card.
 */
export function SetupGuide() {
  const router = useRouter();
  const params = useSearchParams();
  const setup = useSetupStatus();
  const [areas, setAreas] = useState<SetupArea[]>([...ALL_AREAS]);
  const [step, setStep] = useState<SetupStep>(() => parseSetupStep(params.get("step")));
  const [leaving, setLeaving] = useState(false);

  const markOpened = useEffectEvent(() => {
    if (setup.status === "pending") void setup.save("deferred");
  });
  useEffect(() => {
    markOpened();
  }, []);

  const steps = setupSteps(areas);
  // An area step left out after the address named it starts the guide from the area choice.
  const index = Math.max(0, steps.indexOf(step));
  const current = steps[index] ?? "profile";
  const nav: StepNav = {
    back: index > 0 ? () => setStep(steps[index - 1] ?? "profile") : undefined,
    next: () => setStep(steps[index + 1] ?? "done"),
  };

  async function leave(href: string, status: "deferred" | "done") {
    setLeaving(true);
    // A user who already finished keeps `done` when they look through the guide again.
    const saved = setup.status === "done" || setup.status === status || (await setup.save(status));
    if (saved) router.push(href);
    else setLeaving(false);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Step {index + 1} of {steps.length}
          </p>
          <div className="flex gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <span
                key={s}
                className={
                  i <= index
                    ? "h-1 flex-1 rounded-full bg-brand transition-colors duration-300"
                    : "h-1 flex-1 rounded-full bg-muted transition-colors duration-300"
                }
              />
            ))}
          </div>
        </div>
        {current === "done" ? null : (
          <Button
            variant="ghost"
            size="sm"
            disabled={leaving}
            onClick={() => void leave("/", "deferred")}
          >
            Finish later
          </Button>
        )}
      </div>

      {current === "done" ? null : <FormAlert message={setup.error} />}

      <div key={current}>
        {current === "profile" ? <ProfileStep nav={nav} /> : null}
        {current === "appearance" ? <AppearanceStep nav={nav} /> : null}
        {current === "areas" ? <AreasStep nav={nav} areas={areas} onChange={setAreas} /> : null}
        {current === "finance" ? <FinanceStep nav={nav} /> : null}
        {current === "health" ? <HealthStep nav={nav} /> : null}
        {current === "connect" ? <ConnectStep nav={nav} /> : null}
        {current === "ai" ? <AiStep nav={nav} /> : null}
        {current === "done" ? (
          <DoneStep
            nav={nav}
            onFinish={(href) => void leave(href, "done")}
            finishing={leaving}
            error={setup.error}
          />
        ) : null}
      </div>
    </div>
  );
}
