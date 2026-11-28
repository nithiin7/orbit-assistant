"use client";

import type { AppLockDevice, AppLockStatus } from "@orbit/contracts";
import {
  Clock,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { PinFlowDialog, type PinFlowMode } from "@/components/app-lock/pin-flow-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-field";
import { PrivacyNote, SettingsCard, SettingsLoading } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Select } from "@/components/ui/select";
import {
  LOCK_SHORTCUT_KEY,
  useAddAppLockDevice,
  useAppLockStatus,
  useDeviceUnlockAvailable,
  useLockApp,
  useRemoveAppLockDevice,
  useUpdateAppLockTiming,
} from "@/hooks/use-app-lock";
import {
  DeviceUnlockError,
  deviceUnlockName,
  durationLabel,
  lockAfterOptions,
  NEVER,
  ownDeviceIds,
  signOutAfterFor,
  signOutAfterOptions,
} from "@/lib/app-lock";
import { settingsSectionsClassName } from "@/lib/settings";
import { isMacPlatform, modShiftKeyLabel } from "@/utils/keyboard";

/** App lock: the PIN, how soon Orbit locks and signs out, and devices that unlock it. */
export function AppLockSettings() {
  const status = useAppLockStatus();
  const [flow, setFlow] = useState<PinFlowMode | null>(null);

  if (status.status === "error") return <FormAlert message={status.message} />;
  if (status.status === "loading") {
    return <SettingsLoading label="Loading app lock…" className="h-64" />;
  }
  const lock = status.data;
  return (
    <div className={settingsSectionsClassName}>
      {lock.enabled ? (
        <>
          <LockCard status={lock} onFlow={setFlow} />
          <TimingCard status={lock} />
          <DevicesCard status={lock} />
        </>
      ) : (
        <IntroCard onEnable={() => setFlow("enable")} />
      )}
      {flow ? (
        <PinFlowDialog
          mode={flow}
          recentlySignedIn={lock.recently_signed_in}
          currentLength={lock.pin_length}
          onClose={() => setFlow(null)}
        />
      ) : null}
    </div>
  );
}

const features = [
  {
    icon: Clock,
    title: "Locks when you step away",
    text: "After the idle time you choose, in every tab, even if the browser was closed.",
  },
  {
    icon: Fingerprint,
    title: "Unlocks in a touch",
    text: "With your PIN, or Touch ID or Windows Hello on this device.",
  },
  {
    icon: LogOut,
    title: "Signs out when it should",
    text: "After a longer idle time, if you like, and after 5 wrong PINs.",
  },
] as const;

function IntroCard({ onEnable }: { onEnable: () => void }) {
  const id = useId();
  return (
    <SettingsCard
      titleId={`${id}-title`}
      icon={LockKeyhole}
      title="App lock"
      description="Ask for a PIN when you come back to Orbit, so no one else can open it on this computer."
    >
      <ul className="grid gap-3 @lg/panel:grid-cols-3">
        {features.map(({ icon: Icon, title, text }) => (
          <li key={title} className="rounded-xl border border-border/60 bg-muted/30 p-3.5">
            <Icon aria-hidden="true" className="size-5 text-brand" />
            <p className="mt-2 text-sm font-medium">{title}</p>
            <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{text}</p>
          </li>
        ))}
      </ul>
      <Button onClick={onEnable}>
        <LockKeyhole aria-hidden="true" />
        Turn on app lock
      </Button>
    </SettingsCard>
  );
}

function LockCard({
  status,
  onFlow,
}: {
  status: AppLockStatus;
  onFlow: (mode: PinFlowMode) => void;
}) {
  const id = useId();
  const lock = useLockApp();
  const [error, setError] = useState<string | null>(null);

  function lockNow() {
    setError(null);
    lock
      .mutateAsync()
      .catch((reason: unknown) => setError(describeApiError(reason, "Couldn’t lock. Try again.")));
  }

  return (
    <SettingsCard
      titleId={`${id}-title`}
      icon={LockKeyhole}
      title="App lock"
      description={`${status.pin_length ?? 4}-digit PIN · locks after ${durationLabel(status.lock_after_minutes)} idle`}
      action={<Badge className="bg-success/15 text-success">On</Badge>}
    >
      <div className="flex flex-wrap gap-2">
        <Button onClick={lockNow} disabled={lock.isPending}>
          <LockKeyhole aria-hidden="true" />
          {lock.isPending ? "Locking…" : "Lock now"}
        </Button>
        <Button variant="soft" onClick={() => onFlow("change")}>
          <KeyRound aria-hidden="true" />
          Change PIN
        </Button>
        <Button variant="ghost" className="text-destructive" onClick={() => onFlow("disable")}>
          Turn off
        </Button>
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        Lock any time from the account menu, or press{" "}
        <Kbd>{modShiftKeyLabel(LOCK_SHORTCUT_KEY, isMacPlatform(navigator.userAgent))}</Kbd>.
      </p>
      {status.recently_signed_in ? (
        <p className="text-xs text-pretty text-muted-foreground">
          You signed in moments ago, so you can change or turn off the PIN without entering it.
        </p>
      ) : null}
      <FormAlert message={error} />
    </SettingsCard>
  );
}

function TimingCard({ status }: { status: AppLockStatus }) {
  const id = useId();
  const update = useUpdateAppLockTiming();
  const [error, setError] = useState<string | null>(null);
  const lockAfter = status.lock_after_minutes;
  const signOutAfter = status.sign_out_after_minutes;

  function save(lock: number, signOut: number | null) {
    setError(null);
    update
      .mutateAsync({ lock_after_minutes: lock, sign_out_after_minutes: signOut })
      .catch((reason: unknown) => setError(describeApiError(reason, "Couldn’t save. Try again.")));
  }

  return (
    <SettingsCard
      titleId={`${id}-title`}
      icon={Clock}
      title="When Orbit is idle"
      description="Idle means no typing, clicking, or scrolling in any Orbit tab in this browser."
    >
      <div className="grid gap-4 @lg/panel:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-lock`} className="text-sm font-medium">
            Ask for the PIN
          </label>
          <Select
            id={`${id}-lock`}
            value={String(lockAfter)}
            options={lockAfterOptions(lockAfter)}
            disabled={update.isPending}
            aria-describedby={`${id}-lock-hint`}
            onValueChange={(value) => {
              const next = Number(value);
              save(next, signOutAfterFor(next, signOutAfter));
            }}
          />
          <p id={`${id}-lock-hint`} className="text-xs text-muted-foreground">
            Orbit locks and hides everything until it’s unlocked.
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-sign-out`} className="text-sm font-medium">
            Sign out
          </label>
          <Select
            id={`${id}-sign-out`}
            value={signOutAfter === null ? NEVER : String(signOutAfter)}
            options={signOutAfterOptions(lockAfter, signOutAfter)}
            disabled={update.isPending}
            aria-describedby={`${id}-sign-out-hint`}
            onValueChange={(value) => save(lockAfter, value === NEVER ? null : Number(value))}
          />
          <p id={`${id}-sign-out-hint`} className="text-xs text-muted-foreground">
            After this, signing in again needs your password.
          </p>
        </div>
      </div>
      <FormAlert message={error} />
    </SettingsCard>
  );
}

function DevicesCard({ status }: { status: AppLockStatus }) {
  const id = useId();
  const available = useDeviceUnlockAvailable();
  const add = useAddAppLockDevice();
  const [ownDevices, setOwnDevices] = useState(ownDeviceIds);
  const [error, setError] = useState<string | null>(null);
  const name = deviceUnlockName(navigator.userAgent);
  const thisDevice = status.devices.find((device) => ownDevices.includes(device.credential_id));

  function addThisDevice() {
    setError(null);
    add.mutateAsync().then(
      () => setOwnDevices(ownDeviceIds()),
      (reason: unknown) => {
        if (reason instanceof DeviceUnlockError) {
          if (reason.reason !== "cancelled") setError(reason.message);
          return;
        }
        setError(describeApiError(reason, `Couldn’t set up ${name}. Try again.`));
      },
    );
  }

  return (
    <SettingsCard
      titleId={`${id}-title`}
      icon={Fingerprint}
      title={name === "your device" ? "Fingerprint and face unlock" : `Unlock with ${name}`}
      description="Skip the PIN on devices that can recognize you."
    >
      {available ? (
        thisDevice ? (
          <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3.5 py-3 text-sm">
            <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
            This device unlocks Orbit with {name}.
          </p>
        ) : (
          <Button variant="soft" onClick={addThisDevice} disabled={add.isPending}>
            <Fingerprint aria-hidden="true" />
            {add.isPending ? "Waiting for your device…" : `Use ${name} on this device`}
          </Button>
        )
      ) : (
        <p className="text-sm text-pretty text-muted-foreground">
          This browser can’t use a fingerprint or face here. It needs a device with Touch ID or
          Windows Hello, and Orbit opened at <span className="font-medium">localhost</span> or over
          HTTPS. The PIN always works.
        </p>
      )}
      <FormAlert message={error} />
      {status.devices.length > 0 ? (
        <DeviceList devices={status.devices} thisDeviceId={thisDevice?.id ?? null} />
      ) : null}
      <PrivacyNote>
        Your fingerprint or face never leaves your device; Orbit keeps only a public key for it.
        Your PIN is stored only as a secure hash.
      </PrivacyNote>
    </SettingsCard>
  );
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function DeviceList({
  devices,
  thisDeviceId,
}: {
  devices: AppLockDevice[];
  thisDeviceId: string | null;
}) {
  const remove = useRemoveAppLockDevice();
  const { confirm, confirmDialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);

  async function removeDevice(device: AppLockDevice) {
    const confirmed = await confirm({
      title: `Remove ${device.label}?`,
      description: "It will need the PIN to unlock Orbit until it’s set up again.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!confirmed) return;
    setError(null);
    remove
      .mutateAsync(device.id)
      .catch((reason: unknown) =>
        setError(describeApiError(reason, "Couldn’t remove the device. Try again.")),
      );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        Devices that can unlock Orbit
      </p>
      <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
        {devices.map((device) => (
          <li key={device.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <MonitorSmartphone
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate">{device.label}</span>
                {device.id === thisDeviceId ? <Badge>This device</Badge> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                Added {dateFormat.format(new Date(device.created_at))}
                {device.last_used_at
                  ? ` · last used ${dateFormat.format(new Date(device.last_used_at))}`
                  : ""}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${device.label}`}
              disabled={remove.isPending}
              onClick={() => void removeDevice(device)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <FormAlert message={error} />
      {confirmDialog}
    </div>
  );
}
