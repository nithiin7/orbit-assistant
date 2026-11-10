"use client";

import { Star } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";

import { ratingLabel } from "@/lib/watchlist";
import { cn } from "@/utils/common";

const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** Five stars, read-only, filled to `rating` (half stars out of five, 1 to 10). */
export function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`Rated ${ratingLabel(rating)}`}
      className={cn("inline-flex items-center gap-0.5 text-event-amber", className)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <StarShape key={star} fill={Math.max(0, Math.min(1, (rating - (star - 1) * 2) / 2))} />
      ))}
    </span>
  );
}

function StarShape({ fill, className }: { fill: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative inline-block size-3.5", className)}>
      <Star className="absolute inset-0 size-full text-muted-foreground/40" />
      {fill > 0 ? (
        <span
          className="absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: `${fill * 100}%` }}
        >
          <Star className="absolute top-0 left-0 aspect-square h-full w-auto max-w-none fill-current" />
        </span>
      ) : null}
    </span>
  );
}

/**
 * A rating picker in half stars (the ARIA radio group pattern). Each star has a left half and a
 * right half; arrow keys move by half a star. Choosing the current rating again clears it.
 */
export function StarRating({
  value,
  onChange,
  disabled = false,
  label = "Your rating",
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = hover ?? value ?? 0;
  // The roving tab stop: the chosen value, or the first half star.
  const focusable = value ?? 1;

  function move(event: KeyboardEvent<HTMLButtonElement>, current: number) {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(10, current + 1);
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(1, current - 1);
    if (event.key === "Home") next = 1;
    if (event.key === "End") next = 10;
    if (next === null) return;
    event.preventDefault();
    onChange(next);
    radios.current[next - 1]?.focus();
  }

  return (
    <div className="flex items-center gap-3">
      <div
        role="radiogroup"
        aria-label={label}
        className="flex items-center"
        onMouseLeave={() => setHover(null)}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <span key={star} className="relative inline-flex size-8 items-center justify-center">
            <StarShape
              fill={Math.max(0, Math.min(1, (shown - (star - 1) * 2) / 2))}
              className={cn(
                "size-6 transition-transform duration-150 motion-reduce:transition-none",
                hover !== null && Math.ceil(hover / 2) === star && "scale-110",
                "text-event-amber",
              )}
            />
            {VALUES.slice((star - 1) * 2, star * 2).map((half) => (
              <button
                key={half}
                ref={(node) => {
                  radios.current[half - 1] = node;
                }}
                type="button"
                role="radio"
                aria-checked={value === half}
                aria-label={ratingLabel(half)}
                tabIndex={half === focusable ? 0 : -1}
                disabled={disabled}
                onMouseEnter={() => setHover(half)}
                onFocus={() => setHover(half)}
                onBlur={() => setHover(null)}
                onKeyDown={(event) => move(event, half)}
                onClick={() => onChange(value === half ? null : half)}
                className={cn(
                  "absolute inset-y-0 w-1/2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                  half % 2 === 1 ? "left-0" : "right-0",
                )}
              />
            ))}
          </span>
        ))}
      </div>
      <span className="text-sm text-muted-foreground tabular-nums" aria-hidden="true">
        {shown ? `${shown / 2} / 5` : "Not rated"}
      </span>
    </div>
  );
}
