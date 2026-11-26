"use client";

import type { PushStatus } from "@orbit/contracts";
import { Bell, Smartphone } from "lucide-react";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import {
  PrivacyNote,
  SettingsCard,
  SettingsLoading,
  SettingsSwitch,
} from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import {
  useDevicePush,
  usePushStatus,
  useSendPushTest,
  useToggleDevicePush,
  useUpdatePushPreferences,
} from "@/hooks/use-push";
import { PushPermissionError, pushSupport } from "@/lib/push";
import { settingsSectionsClassName } from "@/lib/settings";

const BLOCKED =
  "Notifications are blocked for Orbit in this browser. Allow them in the browser’s site settings, then try again.";

/** Push notifications: on or off for this device, and what the person receives. */
export function NotificationSettings() {
  const status = usePushStatus();

  if (status.status === "error") return <FormAlert message={status.message} />;
  if (status.status === "loading") {
    return <SettingsLoading label="Loading notification settings…" className="h-64" />;
  }
  if (!status.data.available) {
    return (
      <p className="rounded-2xl border border-dashed bg-card/60 px-4 py-6 text-center text-sm text-pretty text-muted-foreground sm:px-5">
        Push notifications aren’t available on this server. Whoever runs it can set them up in the
        server’s configuration. Reminders still appear in Orbit’s notification list.
      </p>
    );
  }
  return (
    <div className={settingsSectionsClassName}>
      <DeviceCard publicKey={status.data.public_key} />
      <PreferencesCard status={status.data} />
    </div>
  );
}

function DeviceCard({ publicKey }: { publicKey: string | null }) {
  const id = useId();
  const support = pushSupport();
  const device = useDevicePush(publicKey);
  const toggle = useToggleDevicePush(publicKey);
  const test = useSendPushTest();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const enabled = device.data === true;

  function change(next: boolean) {
    setError(null);
    setResult(null);
    toggle.mutateAsync(next).catch((reason: unknown) => {
      setError(
        reason instanceof PushPermissionError
          ? BLOCKED
          : describeApiError(reason, "Couldn’t change notifications on this device. Try again."),
      );
    });
  }

  function sendTest() {
    setError(null);
    setResult(null);
    test
      .mutateAsync()
      .then(({ sent }) =>
        sent > 0
          ? setResult("Test sent. It should appear in a few seconds.")
          : setError("The test didn’t reach any device. Turn notifications off and on again."),
      )
      .catch((reason: unknown) =>
        setError(describeApiError(reason, "Couldn’t send the test. Try again.")),
      );
  }

  return (
    <SettingsCard
      titleId={`${id}-title`}
      icon={Smartphone}
      title="This device"
      description="Get notified even when Orbit isn’t open. Off until you turn it on, for each device."
    >
      {support === "supported" ? (
        <>
          <SettingsSwitch
            label="Push notifications"
            hint="Your browser asks for permission the first time."
            checked={enabled}
            disabled={device.isPending || toggle.isPending}
            onCheckedChange={change}
          />
          {enabled ? (
            <Button variant="soft" size="sm" disabled={test.isPending} onClick={sendTest}>
              {test.isPending ? "Sending…" : "Send a test notification"}
            </Button>
          ) : null}
          <p role="status" className="text-sm text-muted-foreground empty:hidden">
            {result}
          </p>
          <FormAlert message={error} />
        </>
      ) : (
        <p className="text-sm text-pretty text-muted-foreground">
          {support === "needs-install"
            ? "On iPhone and iPad, add Orbit to your Home Screen first: tap Share, then Add to Home Screen. Open Orbit from there and come back to this page."
            : "This browser can’t receive push notifications here. They need a current browser and Orbit served over HTTPS."}
        </p>
      )}
    </SettingsCard>
  );
}

function PreferencesCard({ status }: { status: PushStatus }) {
  const id = useId();
  const update = useUpdatePushPreferences();
  const [error, setError] = useState<string | null>(null);
  const current = {
    reminders: status.reminders,
    briefing: status.briefing,
    show_details: status.show_details,
  };

  function change(changes: Partial<typeof current>) {
    setError(null);
    update
      .mutateAsync({ ...current, ...changes })
      .catch((reason: unknown) => setError(describeApiError(reason, "Couldn’t save. Try again.")));
  }

  return (
    <SettingsCard
      titleId={`${id}-title`}
      icon={Bell}
      title="What to send"
      description="Applies to every device with notifications turned on."
    >
      <SettingsSwitch
        label="Reminders"
        hint="When a reminder is due, including calendar, habit, bill, and document alerts."
        checked={status.reminders}
        disabled={update.isPending}
        onCheckedChange={(reminders) => change({ reminders })}
      />
      <SettingsSwitch
        label="Daily briefing"
        hint="When your briefing is prepared. Choose its time in the briefing settings on the dashboard."
        checked={status.briefing}
        disabled={update.isPending}
        onCheckedChange={(briefing) => change({ briefing })}
      />
      <SettingsSwitch
        label="Show reminder details"
        hint="Show the reminder’s title and message. Off, notifications only say you have a reminder."
        checked={status.show_details}
        disabled={update.isPending}
        onCheckedChange={(show_details) => change({ show_details })}
      />
      <FormAlert message={error} />
      <PrivacyNote>
        Notifications travel through your browser maker’s push service, such as Apple, Google, or
        Mozilla. Their content is encrypted so that service can’t read it, but details can appear on
        your lock screen.
      </PrivacyNote>
    </SettingsCard>
  );
}
