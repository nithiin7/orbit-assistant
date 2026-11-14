import type { Metadata } from "next";

import { FinancePanel } from "@/components/finance/finance-view";

export const metadata: Metadata = {
  title: "Finance",
  description:
    "Accounts, transactions, budgets, bills, savings goals, and investments in one private ledger.",
};

/** The page header lives in the panel, because its "Record" menu opens the panel's dialogs. */
export default function FinancePage() {
  return <FinancePanel />;
}
