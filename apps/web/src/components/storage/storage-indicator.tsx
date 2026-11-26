"use client";

import { Cloud, HardDrive, type LucideIcon, TriangleAlert, Unplug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useStorageStatus } from "@/hooks/use-storage-status";
import { storageModes, type StorageStatus } from "@/lib/storage";
import { cn } from "@/utils/common";

type Presentation = { icon: LucideIcon | null; label: string; detail: string; tone?: string };

const modeIcons = { local: HardDrive, cloud: Cloud } as const;

export function presentStorage(status: StorageStatus): Presentation {
  switch (status.state) {
    case "loading":
      return { icon: null, label: "Checking storage…", detail: "Asking the Orbit API." };
    case "ready":
      return { icon: modeIcons[status.mode], ...storageModes[status.mode] };
    case "unavailable":
      return {
        icon: TriangleAlert,
        label: "Database unavailable",
        detail: "The Orbit API is running but cannot reach its database.",
        tone: "text-warning",
      };
    case "unreachable":
      return {
        icon: Unplug,
        label: "API not reachable",
        detail: "Start the Orbit API to see where your data is stored.",
        tone: "text-destructive",
      };
  }
}

/** Compact badge showing which database the API stores data in. */
export function StorageIndicator({ className }: { className?: string }) {
  const { icon: Icon, label, detail, tone } = presentStorage(useStorageStatus());

  return (
    <p role="status" className={className} title={detail}>
      <Badge variant="outline" className={cn("gap-1.5 py-1", tone)}>
        {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
        <span className="sr-only">Storage: </span>
        {label}
      </Badge>
    </p>
  );
}

/** Larger status block for the settings page. */
export function StorageStatusCard() {
  const { icon: Icon, label, detail, tone } = presentStorage(useStorageStatus());

  return (
    <div
      role="status"
      className="flex items-center gap-3.5 rounded-2xl border bg-linear-to-br from-event-slate/8 via-card to-card p-4 shadow-elevation-1 sm:p-5"
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border/50",
          tone,
        )}
      >
        {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-base font-semibold tracking-tight">
          <span className="sr-only">Storage: </span>
          {label}
        </p>
        <p className="text-sm text-pretty text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
