import type { Metadata } from "next";

import { FinancePanel } from "@/components/finance/finance-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Finance" };

export default function FinancePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Finance"
        description="Track accounts, income, spending, and transfers in this workspace. Entered by hand and private to you; Orbit never connects to your bank."
      />
      <FinancePanel />
    </div>
  );
}
