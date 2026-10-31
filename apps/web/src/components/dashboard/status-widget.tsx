import { OrbitMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/** What Orbit can do so far. */
export function StatusWidget() {
  return (
    <section aria-labelledby="status-heading" className="h-full">
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
            Tasks, Reminders, Shopping, Finance, and Notes are built. The calendar and the assistant
            are planned.
          </p>
        </div>
      </Card>
    </section>
  );
}
