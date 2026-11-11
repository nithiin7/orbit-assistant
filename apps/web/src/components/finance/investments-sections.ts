import type { Deposit, Holding, HoldingKind, InvestmentAccount, SipPlan } from "@orbit/contracts";
import {
  Boxes,
  CandlestickChart,
  History,
  Layers,
  LayoutDashboard,
  type LucideIcon,
  PiggyBank,
  Sparkles,
} from "lucide-react";

import { type DepositAction, type TradeType } from "./investment-dialogs";

export type Range = "ytd" | "12" | "all";

export const RANGES: { value: Range; label: string }[] = [
  { value: "ytd", label: "This year" },
  { value: "12", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

/** The view's tabs: a summary, one per kind of holding, deposits, and activity. */
export type Section = "overview" | HoldingKind | "deposits" | "activity" | "review";

export const SECTIONS: readonly { id: Section; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "mutual_fund", label: "Mutual funds" },
  { id: "stock", label: "Stocks" },
  { id: "etf", label: "ETFs" },
  { id: "deposits", label: "Deposits" },
  { id: "activity", label: "Activity" },
  { id: "review", label: "AI review" },
];

export const SECTION_ICONS: Record<Section, LucideIcon> = {
  overview: LayoutDashboard,
  mutual_fund: Layers,
  stock: CandlestickChart,
  etf: Boxes,
  deposits: PiggyBank,
  activity: History,
  review: Sparkles,
};

/** Each kind of holding as its tab names it, and as one of it is called. */
export const HOLDING_SECTIONS: readonly { kind: HoldingKind; label: string; one: string }[] = [
  { kind: "mutual_fund", label: "Mutual funds", one: "a mutual fund" },
  { kind: "stock", label: "Stocks", one: "a stock" },
  { kind: "etf", label: "ETFs", one: "an ETF" },
];

export type Dialog =
  | { kind: "account"; account?: InvestmentAccount }
  | { kind: "add"; holdingKind: HoldingKind }
  | { kind: "holding"; holding: Holding }
  | { kind: "trade"; holding: Holding; type: TradeType; sip?: SipPlan }
  | { kind: "price"; holding: Holding }
  | { kind: "sip"; holding: Holding; plan?: SipPlan }
  | { kind: "deposit"; deposit?: Deposit }
  | { kind: "deposit-action"; deposit: Deposit; action: DepositAction };
