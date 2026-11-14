import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { ShoppingPanel } from "@/components/shopping/shopping-view";

export const metadata: Metadata = {
  title: "Shopping",
  description: "Shopping lists you can check off as you go.",
};

export default function ShoppingPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Shopping"
        description="Keep lists of what to buy, from weekly groceries to one-off purchases. Lists stay private to you."
      />
      <ShoppingPanel />
    </div>
  );
}
