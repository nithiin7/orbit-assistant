import type { Metadata } from "next";
import { Suspense } from "react";

import { InboxButton } from "@/components/integrations/inbox-sheet";
import { PageHeader } from "@/components/page-header";
import { TasksPanel } from "@/components/tasks/tasks-view";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Tasks"
        description="Plan and track what needs doing in this workspace. Tasks stay private to you."
        actions={
          // Connected mail opens beside the list; it reads `?inbox=` from the address.
          <Suspense fallback={null}>
            <InboxButton />
          </Suspense>
        }
      />
      <TasksPanel />
    </div>
  );
}
