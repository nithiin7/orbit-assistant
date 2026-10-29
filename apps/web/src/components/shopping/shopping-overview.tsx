"use client";

import type { ShoppingListOverview } from "@orbit/contracts";
import { ArrowRight, ShoppingCart } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaceResource } from "@/hooks/use-workspace-resource";
import { listShoppingLists } from "@/lib/api";

async function loadShoppingLists(
  workspaceId: string,
  token: string,
  signal: AbortSignal,
): Promise<ShoppingListOverview[]> {
  return (await listShoppingLists(token, workspaceId, { signal })).lists;
}

/** How many items are still to buy on each list in the active workspace, for the dashboard. */
export function ShoppingOverview() {
  const { resource, reload } = useWorkspaceResource(loadShoppingLists);

  return (
    <section aria-labelledby="shopping-overview-heading">
      <Card className="shadow-elevation-1" aria-busy={resource.status === "loading"}>
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2
            id="shopping-overview-heading"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <ShoppingCart className="size-4 text-muted-foreground" aria-hidden="true" />
            Shopping
          </h2>
          <Link href="/shopping" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Open shopping
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>

        {resource.status === "loading" ? (
          <div className="space-y-2 p-5">
            <span className="sr-only">Loading shopping lists…</span>
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : resource.status === "error" ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-muted-foreground">{resource.message}</p>
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="p-5">
            <ul className="divide-y rounded-lg border">
              {resource.data.map((list) => (
                <li key={list.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{list.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {list.needed_count === 0 ? "Nothing to buy" : `${list.needed_count} to buy`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}
