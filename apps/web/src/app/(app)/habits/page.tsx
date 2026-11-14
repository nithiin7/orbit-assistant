import type { Metadata } from "next";
import { Suspense } from "react";

import { AssistMenu } from "@/components/ai/assist-menu";
import { HabitsPanel } from "@/components/habits/habits-view";
import { PageHeader } from "@/components/page-header";
import { ASSIST_ACTIONS } from "@/lib/ai";

export const metadata: Metadata = {
  title: "Habits",
  description: "Build habits and routines with daily check-ins, streaks, and reminders.",
};

/** The view, habit, or routine lives in the URL, read on the client. */
export default function HabitsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Habits"
        description="Small things, done often. Check them off each day, run your routines, and see how they build over time."
        actions={<AssistMenu module="habits" actions={ASSIST_ACTIONS.habits} variant="outline" />}
      />
      <Suspense>
        <HabitsPanel />
      </Suspense>
    </div>
  );
}
