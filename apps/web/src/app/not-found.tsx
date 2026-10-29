import { Compass } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="space-y-8">
      <PageHeader title="Page not found" description="The page you requested does not exist." />
      <EmptyState
        icon={Compass}
        title="Nothing at this address"
        description="Check the URL, or head back to the dashboard."
      >
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to dashboard
        </Link>
      </EmptyState>
    </div>
  );
}
