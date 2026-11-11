"use client";

import type {
  AiPortfolioFacts,
  AiPortfolioHoldingNote,
  AiPortfolioImprovement,
  AiPortfolioReview,
  Currency,
} from "@orbit/contracts";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Eye,
  Layers,
  Loader2,
  PieChart,
  Repeat,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAiReady, useAiSettings, type useReviewPortfolio } from "@/hooks/use-ai";
import { processingLabel } from "@/lib/ai";
import {
  formatPercent,
  formatShare,
  holdingKindLabel,
  PRIORITY_LABELS,
  type ReviewPriority,
  type ReviewVerdict,
  SCORE_BAND_LABELS,
  type ScoreBand,
  scoreBand,
  VERDICT_LABELS,
} from "@/lib/investments";
import { settingsHref } from "@/lib/settings";
import { cn } from "@/utils/common";

import { ProportionBars } from "./investment-parts";
import { Panel } from "./panel";
import { StatGrid, StatTile } from "./stat-tile";

const BAND_STROKE: Record<ScoreBand, string> = {
  strong: "stroke-success",
  fair: "stroke-warning",
  weak: "stroke-destructive",
};

const BAND_TEXT: Record<ScoreBand, string> = {
  strong: "text-success",
  fair: "text-warning",
  weak: "text-destructive",
};

const VERDICT_STYLES: Record<ReviewVerdict, string> = {
  keep: "bg-success/12 text-success",
  watch: "bg-warning/15 text-warning",
  review: "bg-destructive/10 text-destructive",
};

const PRIORITY_STYLES: Record<ReviewPriority, string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-warning/15 text-warning",
  low: "bg-muted text-muted-foreground",
};

/**
 * An AI review of the portfolio in one currency: a score and summary, what looks good, what
 * needs attention, and a word on each holding, beside facts Orbit measured itself. The mutation
 * lives in the parent, so the review survives moving between the investment tabs.
 */
export function PortfolioReview({
  currency,
  review,
}: {
  currency: Currency;
  review: ReturnType<typeof useReviewPortfolio>;
}) {
  const id = useId();
  const settings = useAiSettings();
  const ready = useAiReady("finance");
  const [focus, setFocus] = useState("");

  if (settings.status === "loading") return <ReviewSkeleton />;
  if (!ready) return <TurnOnAi />;

  // A review of another currency doesn't describe what's shown.
  const result = review.data?.currency === currency ? review.data : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    review.mutate({ currency, focus: focus.trim() });
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={submit}
        aria-labelledby={`${id}-title`}
        className="rounded-xl border bg-linear-to-br from-brand-subtle/60 to-card p-5 shadow-elevation-1"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand"
          >
            <Sparkles className="size-[1.125rem]" />
          </span>
          <div className="min-w-0 space-y-1">
            <h3 id={`${id}-title`} className="text-sm font-semibold">
              Portfolio review
            </h3>
            <p className="max-w-prose text-sm text-pretty text-muted-foreground">
              AI looks at how your {currency} investments are spread, where they overlap, and what
              could be better. It sees weights and returns, never amounts, folios, or notes.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 @3xl/list:flex-row">
          <label htmlFor={`${id}-focus`} className="sr-only">
            Anything to keep in mind
          </label>
          <Input
            id={`${id}-focus`}
            value={focus}
            maxLength={300}
            disabled={review.isPending}
            placeholder="Optional: your horizon, goals, or appetite for risk"
            onChange={(event) => setFocus(event.target.value)}
          />
          <Button type="submit" disabled={review.isPending} className="shrink-0">
            {review.isPending ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Sparkles aria-hidden="true" />
            )}
            {result ? "Review again" : "Review my portfolio"}
          </Button>
        </div>
      </form>

      <FormAlert
        message={
          review.error
            ? describeApiError(review.error, "Couldn’t review the portfolio. Try again.")
            : null
        }
      />

      {review.isPending ? (
        <div aria-busy="true" aria-label="Reviewing your portfolio" className="space-y-4">
          <ReviewSkeleton />
        </div>
      ) : result ? (
        <ReviewResult review={result} />
      ) : null}
    </div>
  );
}

function ReviewResult({ review }: { review: AiPortfolioReview }) {
  return (
    <div className="animate-page-in space-y-6">
      <ScoreCard review={review} />
      <AtAGlance facts={review.facts} />

      <div className="grid gap-4 @4xl/list:grid-cols-2">
        <Panel
          title="What looks good"
          description={review.strengths.length === 0 ? "Nothing stood out this time." : undefined}
        >
          {review.strengths.length > 0 ? (
            <ul className="space-y-3">
              {review.strengths.map((point, index) => (
                <li key={index} className="flex gap-3">
                  <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{point.title}</p>
                    {point.detail ? (
                      <p className="text-sm text-pretty text-muted-foreground">{point.detail}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
        <Panel
          title="Needs attention"
          description={
            review.improvements.length === 0
              ? "Nothing pressing right now."
              : "Most pressing first."
          }
        >
          {review.improvements.length > 0 ? (
            <ul className="space-y-3">
              {review.improvements.map((improvement, index) => (
                <ImprovementItem key={index} improvement={improvement} />
              ))}
            </ul>
          ) : null}
        </Panel>
      </div>

      {review.holdings.length > 0 ? (
        <Panel title="Holding by holding" flush>
          <ul className="divide-y border-t">
            {review.holdings.map((note) => (
              <HoldingNoteRow key={note.holding_id} note={note} />
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Allocation" description="Measured by Orbit, idle cash included.">
        <ProportionBars
          slices={review.facts.allocation}
          currency={review.currency}
          label="Allocation by asset class"
        />
      </Panel>

      <p className="flex gap-2 text-xs text-pretty text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
        <span>
          Written by {review.provider_name} ({processingLabel(review.processing)}). AI can be wrong
          and isn’t financial advice; check the numbers before you act. Nothing is saved.
        </span>
      </p>
    </div>
  );
}

function ScoreCard({ review }: { review: AiPortfolioReview }) {
  const band = review.score === null ? null : scoreBand(review.score);
  return (
    <Card className="flex flex-col gap-5 p-5 shadow-elevation-1 @3xl/list:flex-row @3xl/list:items-center">
      {review.score !== null && band ? <ScoreRing score={review.score} band={band} /> : null}
      <div className="min-w-0 space-y-2">
        {band ? (
          <p className={cn("text-xs font-medium tracking-wide uppercase", BAND_TEXT[band])}>
            {SCORE_BAND_LABELS[band]}
          </p>
        ) : null}
        {review.headline ? (
          <p className="text-lg font-semibold tracking-tight text-balance">{review.headline}</p>
        ) : null}
        {review.summary ? (
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">{review.summary}</p>
        ) : null}
      </div>
    </Card>
  );
}

function ScoreRing({ score, band }: { score: number; band: ScoreBand }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      role="img"
      aria-label={`Score ${score} out of 100`}
      className="relative size-28 shrink-0 self-center"
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="9" className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          className={cn(BAND_STROKE[band], "transition-[stroke-dashoffset] duration-700")}
        />
      </svg>
      <div
        aria-hidden="true"
        className="absolute inset-0 flex flex-col items-center justify-center"
      >
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{score}</span>
        <span className="text-xs text-muted-foreground">of 100</span>
      </div>
    </div>
  );
}

function AtAGlance({ facts }: { facts: AiPortfolioFacts }) {
  const overlaps = facts.overlaps.map((overlap) => `${overlap.category} (${overlap.funds})`);
  return (
    <section aria-label="At a glance" className="space-y-3">
      <StatGrid>
        <StatTile
          label="Largest holding"
          value={formatShare(facts.largest_share)}
          icon={Target}
          accent="brand"
        >
          {facts.largest_holding ?? "No holdings"}
        </StatTile>
        <StatTile
          label="Five largest"
          value={formatShare(facts.top_five_share)}
          icon={PieChart}
          accent="neutral"
        >
          of the portfolio
        </StatTile>
        <StatTile
          label="Overall return"
          value={formatPercent(facts.return_percent)}
          icon={TrendingUp}
          tone={
            facts.return_percent === null
              ? "default"
              : facts.return_percent.startsWith("-")
                ? "negative"
                : "positive"
          }
          accent="positive"
        >
          on everything put in
        </StatTile>
        <StatTile
          label="Overlapping categories"
          value={overlaps.length}
          icon={Layers}
          tone={overlaps.length > 0 ? "warning" : "default"}
          accent="neutral"
        >
          {overlaps.length > 0 ? overlaps.join(", ") : "Each fund in its own category"}
        </StatTile>
        <StatTile label="Active SIPs" value={facts.active_sips} icon={Repeat} accent="income">
          {facts.fund_houses === 1 ? "1 fund house" : `${facts.fund_houses} fund houses`}
        </StatTile>
      </StatGrid>
      {facts.unpriced > 0 ? (
        <p className="flex items-center gap-2 text-xs text-warning">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          {facts.unpriced === 1
            ? "1 holding has no current price, so it was valued at cost."
            : `${facts.unpriced} holdings have no current price, so they were valued at cost.`}
        </p>
      ) : null}
    </section>
  );
}

function ImprovementItem({ improvement }: { improvement: AiPortfolioImprovement }) {
  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium">{improvement.title}</p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            PRIORITY_STYLES[improvement.priority],
          )}
        >
          {PRIORITY_LABELS[improvement.priority]}
        </span>
      </div>
      {improvement.detail ? (
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{improvement.detail}</p>
      ) : null}
      {improvement.action ? (
        <p className="mt-2 flex gap-1.5 text-sm text-brand">
          <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{improvement.action}</span>
        </p>
      ) : null}
    </li>
  );
}

function HoldingNoteRow({ note }: { note: AiPortfolioHoldingNote }) {
  return (
    <li className="flex flex-col gap-1 px-5 py-3 @3xl/list:flex-row @3xl/list:items-start @3xl/list:gap-4">
      <div className="min-w-0 @3xl/list:w-64 @3xl/list:shrink-0">
        <p className="truncate text-sm font-medium">{note.name}</p>
        <p className="text-xs text-muted-foreground">{holdingKindLabel(note.kind)}</p>
      </div>
      <p className="min-w-0 flex-1 text-sm text-pretty text-muted-foreground">{note.note}</p>
      <span
        className={cn(
          "self-start rounded-full px-2.5 py-0.5 text-xs font-medium",
          VERDICT_STYLES[note.verdict],
        )}
      >
        {VERDICT_LABELS[note.verdict]}
      </span>
    </li>
  );
}

function TurnOnAi() {
  return (
    <Card className="flex flex-col items-start gap-3 p-6 shadow-elevation-1">
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-lg bg-brand-subtle text-brand"
      >
        <Eye className="size-5" />
      </span>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Let AI review your portfolio</h3>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Turn on AI and allow it to read Finance in Settings → AI. It sees what you hold, its
          weights and returns; never amounts, folios, or notes.
        </p>
      </div>
      <Link href={settingsHref("ai")} className={buttonVariants({ variant: "soft" })}>
        Open AI settings
      </Link>
    </Card>
  );
}

function ReviewSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-36 w-full rounded-xl" />
      <div className="grid gap-4 @4xl/list:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </div>
  );
}
