import type { Metadata } from "next";
import { Suspense } from "react";

import { AssistMenu } from "@/components/ai/assist-menu";
import { HealthPanel } from "@/components/fitness/health-view";
import { PageHeader } from "@/components/page-header";
import { ASSIST_ACTIONS } from "@/lib/ai";

export const metadata: Metadata = {
  title: "Health",
  description: "Track workouts, activity, steps, nutrition, water, sleep, and body measurements.",
};

/** The view, workout, exercise, or goal lives in the URL, read on the client. */
export default function HealthPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Health"
        description="Train, track what matters to you, and see your progress. A personal tracker, not medical advice."
        actions={<AssistMenu module="health" actions={ASSIST_ACTIONS.health} variant="outline" />}
      />
      <Suspense>
        <HealthPanel />
      </Suspense>
    </div>
  );
}
