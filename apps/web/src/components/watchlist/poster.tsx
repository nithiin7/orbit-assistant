"use client";

import type { WatchItem, WatchKind } from "@orbit/contracts";
import { Clapperboard, Tv } from "lucide-react";
import { useEffect, useRef } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useSearchPoster, useWatchPoster } from "@/hooks/use-watchlist";
import { cn } from "@/utils/common";

/** Warm gradients for titles without a poster, picked by title so each keeps its own. */
const FALLBACKS = [
  "from-event-rose/80 to-event-amber/70",
  "from-event-violet/80 to-event-blue/70",
  "from-event-teal/80 to-event-green/70",
  "from-event-orange/80 to-event-rose/70",
  "from-event-blue/80 to-event-teal/70",
  "from-event-amber/80 to-event-orange/70",
] as const;

function fallbackFor(title: string): string {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) | 0;
  return FALLBACKS[Math.abs(hash) % FALLBACKS.length] ?? FALLBACKS[0];
}

/** A generated cover: the title on a gradient, for titles entered by hand. */
export function PosterFallback({
  title,
  kind,
  compact = false,
  className,
}: {
  title: string;
  kind: WatchKind;
  compact?: boolean;
  className?: string;
}) {
  const Icon = kind === "series" ? Tv : Clapperboard;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex size-full flex-col justify-between bg-gradient-to-br p-2.5 text-white",
        fallbackFor(title),
        className,
      )}
    >
      <Icon className={cn("opacity-80", compact ? "size-3.5" : "size-4")} />
      {compact ? null : (
        <span className="line-clamp-4 text-sm leading-tight font-semibold text-balance drop-shadow-sm">
          {title}
        </span>
      )}
    </div>
  );
}

/** An image from a Blob, shown through an object URL that is revoked when it changes. */
function BlobImage({ blob, className }: { blob: Blob; className?: string }) {
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return (
    // An object URL can't go through the Next.js image loader. The title is beside the poster,
    // so the image itself is decorative.
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={image} alt="" className={cn("size-full object-cover", className)} />
  );
}

/** A title's poster at 2:3, filling its box; a generated cover when it has none. */
export function WatchPoster({
  workspaceId,
  item,
  compact = false,
  className,
}: {
  workspaceId: string;
  item: WatchItem;
  compact?: boolean;
  className?: string;
}) {
  const poster = useWatchPoster(workspaceId, item);
  let content;
  if (item.has_poster && poster.isPending)
    content = <Skeleton className="size-full rounded-none" />;
  else if (poster.data) content = <BlobImage blob={poster.data} />;
  else content = <PosterFallback title={item.title} kind={item.kind} compact={compact} />;
  return (
    <div className={cn("relative aspect-[2/3] overflow-hidden bg-muted", className)}>{content}</div>
  );
}

/** A search result's thumbnail, fetched through the API. */
export function SearchPoster({
  workspaceId,
  path,
  title,
  kind,
}: {
  workspaceId: string;
  path: string | null;
  title: string;
  kind: WatchKind;
}) {
  const poster = useSearchPoster(workspaceId, path);
  let content;
  if (path !== null && poster.isPending) content = <Skeleton className="size-full rounded-none" />;
  else if (poster.data) content = <BlobImage blob={poster.data} />;
  else content = <PosterFallback title={title} kind={kind} compact />;
  return (
    <div className="aspect-[2/3] w-11 shrink-0 overflow-hidden rounded-md bg-muted">{content}</div>
  );
}
