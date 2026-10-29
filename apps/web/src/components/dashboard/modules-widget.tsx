import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sectionItems } from "@/lib/navigation";

/** Sections that are still placeholders; built modules have widgets of their own. */
const modules = sectionItems.filter((item) => item.group === "workspace");

/** Links to the placeholder page of every planned module. */
export function ModulesWidget() {
  return (
    // A container, so the grid follows the widget's width (half or full), not the viewport's.
    <section aria-labelledby="modules-heading" className="@container space-y-4">
      <div className="space-y-1">
        <h2 id="modules-heading" className="text-base font-semibold">
          Planned modules
        </h2>
        <p className="text-sm text-muted-foreground">
          Each opens a placeholder page describing what it will do.
        </p>
      </div>
      <ul className="grid gap-3 @lg:grid-cols-2 @3xl:grid-cols-3 @7xl:grid-cols-5 @7xl:gap-4">
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
  );
}
