import type { Metadata } from "next";
import { Suspense } from "react";

import { AssistMenu } from "@/components/ai/assist-menu";
import { HealthPanel } from "@/components/fitness/health-view";
import { PageHeader } from "@/components/page-header";
import { ASSIST_ACTIONS } from "@/lib/ai";

export const metadata: Metadata = { title: "Health" };

/** The view, workout, exercise, or goal lives in the URL, read on the client. */
export default function HealthPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Health"
        description="Log workouts, track measurements, food, water, and activity, and work toward your goals. A personal tracker, not medical advice."
        actions={<AssistMenu module="health" actions={ASSIST_ACTIONS.health} variant="outline" />}
      />
      <Suspense>
        <HealthPanel />
      </Suspense>
    </div>
  );
}
