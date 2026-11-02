import type { AiCitation } from "@orbit/contracts";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { Markdown } from "@/components/markdown/markdown";
import { recordHref, recordKindLabel, splitCitations } from "@/lib/ai";
import { formatCalendarDate } from "@/utils/dates";

type AnswerProps = {
  /** Distinguishes this answer's source anchors from others on the page. */
  id: string;
  text: string;
  citations: readonly AiCitation[];
};

/** An answer with its `[S1]` markers rendered as links to the numbered sources below it. */
export function Answer({ id, text, citations }: AnswerProps) {
  const byNumber = new Map(citations.map((c) => [c.number, c]));
  return (
    <Markdown
      text={text}
      renderText={(run, key) => (
        <Fragment key={key}>
          {splitCitations(run).map((part, index) =>
            part.type === "text" ? (
              part.text
            ) : (
              <span key={index} className="whitespace-nowrap">
                {part.numbers.map((number) => {
                  const citation = byNumber.get(number);
                  if (!citation) return null;
                  return (
                    <a
                      key={number}
                      href={`#${id}-source-${number}`}
                      aria-label={`Source ${number}: ${citation.ref.title}`}
                      className="mx-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-brand-subtle px-1.5 text-[0.7rem] font-semibold text-brand no-underline outline-none hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {number}
                    </a>
                  );
                })}
              </span>
            ),
          )}
        </Fragment>
      )}
    />
  );
}

type SourcesProps = { id: string; citations: readonly AiCitation[] };

/**
 * The Orbit records an answer drew on. Cited sources show first; the rest were given to the
 * model but not cited. A summary marked "Calculated by Orbit" was computed by the app, not the
 * model.
 */
export function Sources({ id, citations }: SourcesProps) {
  const [showAll, setShowAll] = useState(false);
  const cited = citations.filter((c) => c.cited);
  const shown = showAll || cited.length === 0 ? citations : cited;
  if (citations.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No Orbit records were used. This answer comes from general knowledge.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Sources from your Orbit data
      </h4>
      <ol className="space-y-1">
        {shown.map((citation) => {
          const href = recordHref(citation.ref);
          const date = citation.ref.day ? formatCalendarDate(citation.ref.day) : null;
          const label = (
            <>
              <span className="font-semibold text-brand tabular-nums">{citation.number}</span>
              <span className="truncate font-medium text-foreground">{citation.ref.title}</span>
              <span className="shrink-0 text-muted-foreground">
                {recordKindLabel(citation.ref.kind)}
                {date ? ` · ${date}` : ""}
                {citation.ref.detail && citation.ref.kind !== "event"
                  ? ` · ${citation.ref.detail}`
                  : ""}
              </span>
            </>
          );
          return (
            <li
              key={citation.number}
              id={`${id}-source-${citation.number}`}
              className="scroll-mt-24"
            >
              {href ? (
                <Link
                  href={href}
                  className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {label}
                  <ExternalLink
                    className="ml-auto size-3 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              ) : (
                <div className="flex min-w-0 items-center gap-2 px-1.5 py-1 text-xs">{label}</div>
              )}
            </li>
          );
        })}
      </ol>
      {cited.length > 0 && cited.length < citations.length ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="rounded px-1.5 text-xs font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showAll ? "Show cited sources only" : `Show all ${citations.length} sources`}
        </button>
      ) : null}
    </div>
  );
}
