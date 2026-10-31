import type { Metadata } from "next";

import { FinancePanel } from "@/components/finance/finance-view";

export const metadata: Metadata = { title: "Finance" };

/** The page header lives in the panel, because its "Record" menu opens the panel's dialogs. */
export default function FinancePage() {
  return <FinancePanel />;
}
