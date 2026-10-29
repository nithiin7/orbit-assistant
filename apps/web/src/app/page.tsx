import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sectionItems } from "@/lib/navigation";

export default function DashboardPage() {
  const modules = sectionItems.filter((item) => item.href !== "/settings");

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" description="Welcome to Orbit." />

      <section aria-labelledby="getting-started" className="space-y-2">
        <h2 id="getting-started" className="text-base font-semibold">
          Nothing here yet
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Orbit is in early development. As modules are built, a summary of each will appear on this
          dashboard.
        </p>
      </section>

      <section aria-labelledby="modules" className="space-y-3">
        <h2 id="modules" className="text-base font-semibold">
          Modules
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map(({ title, href, icon: Icon, description }) => (
            <li key={href}>
              <Link
                href={href}
                className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="h-full transition-colors group-hover:bg-accent/50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                      <ArrowUpRight
                        className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                        aria-hidden="true"
                      />
                    </div>
                    <CardTitle className="pt-2">{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
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
