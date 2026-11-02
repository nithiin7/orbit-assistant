import type { IntegrationProviderId } from "@orbit/contracts";
import { LayoutGrid } from "lucide-react";

import { brandLogo } from "@/lib/brand-logos";
import { cn } from "@/utils/common";

/** The provider's mark: Google's bundled logo, a neutral tile for Microsoft. Decorative. */
export function ProviderMark({
  provider,
  className,
}: {
  provider: IntegrationProviderId;
  className?: string;
}) {
  const logo = provider === "google" ? brandLogo("Google") : null;
  if (logo) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-border",
          className,
        )}
        style={{ backgroundColor: logo.background, color: logo.foreground }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-4.5">
          <path d={logo.path} />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand",
        className,
      )}
    >
      <LayoutGrid className="size-4.5" />
    </span>
  );
}
