"use client";

import type { Place } from "@orbit/contracts";
import { X } from "lucide-react";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog } from "@/components/ui/dialog";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { countryName } from "@/lib/places";

import { CountryFlag } from "./country-flag";

/** Moves a place from the wishlist to Visited, asking (optionally) when the visit was. */
export function MarkVisitedDialog({
  place,
  onConfirm,
  onClose,
}: {
  place: Place;
  /** `visitedOn` is `YYYY-MM-DD`, or `null` when skipped. */
  onConfirm: (visitedOn: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      await onConfirm(date || null);
      close();
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t update the place. Try again."));
      setSaving(false);
    }
  }

  return (
    <Dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="mt-[12vh] max-w-sm rounded-2xl"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <CountryFlag code={place.country_code} size="xl" />
            <div className="min-w-0">
              <h2 id={`${id}-heading`} className="text-base font-semibold">
                You made it to {place.name}
              </h2>
              <p className="truncate text-sm text-muted-foreground">
                {countryName(place.country_code)}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mt-1.5 -mr-1.5 size-8"
            aria-label="Close"
            onClick={close}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-date`} className="block text-sm font-medium">
            When did you go? <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <DatePicker
            id={`${id}-date`}
            value={date}
            onValueChange={setDate}
            placeholder="Pick a date"
            clearable
          />
        </div>
        <FormAlert message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void confirm()}>
            {saving ? "Saving…" : "Mark as visited"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
