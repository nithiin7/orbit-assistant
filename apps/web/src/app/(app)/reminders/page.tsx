import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { RemindersPanel } from "@/components/reminders/reminders-view";

export const metadata: Metadata = {
  title: "Reminders",
  description: "Upcoming and past reminders, with in-app notifications when they're due.",
};

export default function RemindersPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Reminders"
        description="One-time and repeating reminders for this workspace. When one is due, it appears in your notifications."
      />
      <RemindersPanel />
    </div>
  );
}
