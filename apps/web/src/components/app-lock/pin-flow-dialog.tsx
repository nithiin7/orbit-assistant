"use client";

import { KeyRound, LockKeyhole, LockKeyholeOpen, ShieldCheck } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { ApiError, describeApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { useDisableAppLock, useSetAppLockPin } from "@/hooks/use-app-lock";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { DEFAULT_PIN_LENGTH, PIN_LENGTHS, type PinLength } from "@/lib/app-lock";
import { useToast } from "@/providers/toast";
import { cn } from "@/utils/common";

import { PinPad } from "./pin-pad";

/** `enable` chooses a first PIN, `change` replaces it, `disable` turns the lock off. */
export type PinFlowMode = "enable" | "change" | "disable";

type Step = "current" | "choose" | "confirm" | "confirm-off";

const SUCCESS_MS = 600;

function stepsFor(mode: PinFlowMode, recentlySignedIn: boolean): Step[] {
  if (mode === "enable") return ["choose", "confirm"];
  if (mode === "change")
    return recentlySignedIn ? ["choose", "confirm"] : ["current", "choose", "confirm"];
  return recentlySignedIn ? ["confirm-off"] : ["current"];
}

const titles: Record<PinFlowMode, string> = {
  enable: "Turn on app lock",
  change: "Change your PIN",
  disable: "Turn off app lock",
};

type PinFlowDialogProps = {
  mode: PinFlowMode;
  /** This session signed in moments ago, so the current PIN isn't needed. */
  recentlySignedIn: boolean;
  /** Digits in the current PIN, when there is one. */
  currentLength: number | null;
  onClose: () => void;
};

/**
 * Choosing, changing, or removing the PIN, one calm step at a time: the current PIN when it's
 * needed, then a new one, then the same again to confirm. A mismatch shakes and starts over.
 */
export function PinFlowDialog({
  mode,
  recentlySignedIn,
  currentLength,
  onClose,
}: PinFlowDialogProps) {
  const id = useId();
  const toast = useToast();
  const setPin = useSetAppLockPin();
  const disable = useDisableAppLock();
  const busy = setPin.isPending || disable.isPending;
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !busy });
  const steps = stepsFor(mode, recentlySignedIn);
  const [step, setStep] = useState<Step>(steps[0] ?? "choose");
  const [length, setLength] = useState<PinLength>(DEFAULT_PIN_LENGTH);
  const [currentPin, setCurrentPin] = useState<string | null>(null);
  const [firstPin, setFirstPin] = useState("");
  const [rejection, setRejection] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function go(next: Step, error: string | null = null) {
    setStep(next);
    setMessage(error);
    setRejection((count) => (error ? count + 1 : 0));
  }

  function succeed(text: string) {
    setDone(true);
    window.setTimeout(() => {
      toast.show({ message: text });
      close();
    }, SUCCESS_MS);
  }

  /** The API refused the current PIN: ask for it again, with the tries left. */
  function refused(reason: unknown, fallback: string) {
    if (reason instanceof ApiError && reason.status === 401) return;
    const text = describeApiError(reason, fallback);
    const aboutCurrent =
      reason instanceof ApiError && reason.status === 422 && /current PIN|Incorrect PIN/.test(text);
    if (aboutCurrent && steps.includes("current")) go("current", text);
    else {
      setMessage(text);
      setRejection((count) => count + 1);
    }
  }

  function turnOff(pin: string | null) {
    setMessage(null);
    disable.mutateAsync(pin).then(
      () => succeed("App lock is off."),
      (reason: unknown) => refused(reason, "Couldn’t turn off app lock. Try again."),
    );
  }

  function onPin(pin: string) {
    if (step === "current") {
      if (mode === "disable") {
        turnOff(pin);
        return;
      }
      setCurrentPin(pin);
      go("choose");
    } else if (step === "choose") {
      setFirstPin(pin);
      go("confirm");
    } else if (step === "confirm") {
      if (pin !== firstPin) {
        go("choose", "Those PINs didn’t match. Choose your PIN again.");
        return;
      }
      setMessage(null);
      setPin.mutateAsync({ pin, currentPin }).then(
        () => succeed(mode === "enable" ? "App lock is on." : "Your PIN was changed."),
        (reason: unknown) => refused(reason, "Couldn’t save your PIN. Try again."),
      );
    }
  }

  const position = steps.indexOf(step);
  const heading: Record<Step, { title: string; text: ReactNode; icon: ReactNode }> = {
    current: {
      title: "Enter your current PIN",
      text:
        mode === "disable"
          ? "Confirm it’s you before turning the lock off."
          : "Confirm it’s you before choosing a new one.",
      icon: <KeyRound aria-hidden="true" className="size-5" />,
    },
    choose: {
      title: mode === "enable" ? "Choose a PIN" : "Choose a new PIN",
      text: "Pick digits that are easy for you to remember and hard for others to guess.",
      icon: <LockKeyhole aria-hidden="true" className="size-5" />,
    },
    confirm: {
      title: "Enter it once more",
      text: "Type the same PIN again to confirm it.",
      icon: <ShieldCheck aria-hidden="true" className="size-5" />,
    },
    "confirm-off": {
      title: "Turn off app lock?",
      text: "You signed in moments ago, so your PIN isn’t needed. Orbit will stop locking when idle, and devices set up for Touch ID or Windows Hello are removed.",
      icon: <LockKeyholeOpen aria-hidden="true" className="size-5" />,
    },
  };
  const current = heading[step];
  const padLength =
    step === "current" ? (currentLength ?? 4) : step === "confirm" ? firstPin.length : length;

  return (
    <Dialog {...dialogProps} aria-labelledby={`${id}-title`} className="mt-[8vh] max-w-sm">
      <div className="space-y-5 p-5">
        <DialogHeader titleId={`${id}-title`} title={titles[mode]} onClose={close} />

        {steps.length > 1 ? (
          <ol className="flex items-center justify-center gap-1.5" aria-label="Steps">
            {steps.map((item, index) => (
              <li
                key={item}
                aria-current={item === step ? "step" : undefined}
                className={cn(
                  "h-1.5 rounded-full transition-[width,background-color] duration-200",
                  index === position ? "w-6 bg-brand" : "w-1.5",
                  index < position ? "bg-brand/60" : index > position && "bg-muted-foreground/25",
                )}
              >
                <span className="sr-only">
                  Step {index + 1} of {steps.length}
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        <div key={step} className="flex animate-page-in flex-col items-center text-center">
          <span className="grid size-11 place-items-center rounded-2xl bg-brand-subtle text-brand">
            {current.icon}
          </span>
          <p className="mt-3 text-base font-semibold">{current.title}</p>
          <p
            role={message ? "alert" : undefined}
            className={cn(
              "mt-1 min-h-10 text-sm text-pretty",
              message ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {message ?? current.text}
          </p>
        </div>

        {step === "confirm-off" ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={close} disabled={busy}>
              Keep it on
            </Button>
            <Button variant="destructive" onClick={() => turnOff(null)} disabled={busy || done}>
              {busy ? "Turning off…" : "Turn off app lock"}
            </Button>
          </div>
        ) : (
          <>
            {step === "choose" ? (
              <div
                role="radiogroup"
                aria-label="PIN length"
                className="mx-auto flex w-fit rounded-full bg-muted/60 p-1 text-sm"
              >
                {PIN_LENGTHS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={length === option}
                    onClick={() => setLength(option)}
                    className={cn(
                      "rounded-full px-3.5 py-1 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      length === option
                        ? "bg-card text-foreground shadow-elevation-1"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option} digits
                  </button>
                ))}
              </div>
            ) : null}
            <div className="pb-1">
              <PinPad
                key={`${step}-${padLength}`}
                size="md"
                length={padLength}
                label={current.title}
                busy={busy}
                accepted={done}
                rejection={rejection}
                onComplete={onPin}
              />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
