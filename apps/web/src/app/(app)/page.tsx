import Link from "next/link";

import { OrbitMark } from "@/components/logo";
import { PageHeader } from "@/components/page-header";
import { ShoppingOverview } from "@/components/shopping/shopping-overview";
import { StorageIndicator } from "@/components/storage/storage-indicator";
import { TaskOverview } from "@/components/tasks/task-overview";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceOverview } from "@/components/workspace/workspace-overview";
import { sectionItems } from "@/lib/navigation";

export default function DashboardPage() {
  // Sections that are still placeholders; built modules summarize themselves above.
  const modules = sectionItems.filter((item) => item.group === "workspace");

  return (
    <div className="space-y-10">
      <PageHeader
        title="Dashboard"
        description="Your private, local-first assistant."
        actions={<StorageIndicator />}
      />

      <div className="grid gap-4 xl:grid-cols-2 2xl:gap-6">
        <WorkspaceOverview />

        <section aria-labelledby="status-heading">
          <Card className="flex h-full flex-col gap-4 p-5 shadow-elevation-1 sm:flex-row sm:items-start">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-subtle">
              <OrbitMark className="size-6" />
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="status-heading" className="text-base font-semibold">
                  Orbit is in early development
                </h2>
                <Badge variant="brand">Preview</Badge>
              </div>
              <p className="max-w-prose text-sm text-pretty text-muted-foreground">
                Tasks and Shopping are built, and their summaries are below. The other modules are
                planned; as each one is built, a summary of it will appear here too.
              </p>
            </div>
          </Card>
        </section>
      </div>

      <TaskOverview />

      <ShoppingOverview />

      <section aria-labelledby="modules-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="modules-heading" className="text-base font-semibold">
            Planned modules
          </h2>
          <p className="text-sm text-muted-foreground">
            Each opens a placeholder page describing what it will do.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 2xl:gap-4">
          {modules.map(({ title, href, icon: Icon, description }) => (
            <li key={href}>
              <Link
                href={href}
                className="group block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Card className="h-full transition-[border-color,box-shadow] duration-150 group-hover:border-foreground/15 group-hover:shadow-elevation-2">
                  <CardHeader className="gap-3">
                    <div className="flex items-center justify-between">
                      <span className="flex size-8 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors duration-150 group-hover:text-foreground">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <Badge variant="outline">Planned</Badge>
                    </div>
                    <div className="space-y-1.5">
                      <CardTitle>{title}</CardTitle>
                      <CardDescription>{description}</CardDescription>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
