import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { SettingsCard } from "@/components/settings/settings-card";

/** A settings card keyed by `id`: the shared settings look, used by Backup and Integrations. */
export function Section({
  id,
  icon,
  title,
  description,
  action,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingsCard
      id={id}
      titleId={`${id}-title`}
      icon={icon}
      title={title}
      description={description}
      action={action}
      bodyClassName="space-y-4"
    >
      {children}
    </SettingsCard>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
