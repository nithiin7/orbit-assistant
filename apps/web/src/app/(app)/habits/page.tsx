import type { Metadata } from "next";
import { Suspense } from "react";

import { HabitsPanel } from "@/components/habits/habits-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Habits" };

/** The view, habit, or routine lives in the URL, read on the client. */
export default function HabitsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Habits"
        description="Small things, done often. Check them off each day, run your routines, and see how they build over time."
      />
      <Suspense>
        <HabitsPanel />
      </Suspense>
    </div>
  );
}
