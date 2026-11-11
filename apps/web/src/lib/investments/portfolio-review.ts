import type { AiPortfolioHoldingNote, AiPortfolioImprovement } from "@orbit/contracts";

export type ReviewVerdict = AiPortfolioHoldingNote["verdict"];
export type ReviewPriority = AiPortfolioImprovement["priority"];
export type ScoreBand = "strong" | "fair" | "weak";

/** How a review's score reads: 75 and up is strong, 50 and up fair, anything lower weak. */
export function scoreBand(score: number): ScoreBand {
  return score >= 75 ? "strong" : score >= 50 ? "fair" : "weak";
}

export const SCORE_BAND_LABELS: Record<ScoreBand, string> = {
  strong: "In good shape",
  fair: "Room to improve",
  weak: "Needs attention",
};

export const VERDICT_LABELS: Record<ReviewVerdict, string> = {
  keep: "Keep",
  watch: "Watch",
  review: "Review",
};

export const PRIORITY_LABELS: Record<ReviewPriority, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};

/** A share Orbit measured (`"64.29"`) for display, to one decimal: `"64.3%"`. */
export function formatShare(share: string | null): string {
  if (share === null) return "—";
  const value = Number(share);
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
}
