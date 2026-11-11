/** How achievements and store items look. The API knows items only by key; their colors live
 * here. An unknown key (an item added to the API before the web) falls back to plain. */

import type { AchievementArea, AchievementTier } from "@orbit/contracts";
import {
  AlarmClock,
  Bookmark,
  CalendarDays,
  CheckSquare,
  Clapperboard,
  FileLock2,
  HeartPulse,
  type LucideIcon,
  MapPinned,
  NotebookPen,
  Orbit,
  Repeat2,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import type { CSSProperties } from "react";

/** The same icons as the sidebar, so a badge says where it came from. */
export const AREA_ICONS: Record<AchievementArea, LucideIcon> = {
  tasks: CheckSquare,
  habits: Repeat2,
  notes: NotebookPen,
  shopping: ShoppingCart,
  reminders: AlarmClock,
  calendar: CalendarDays,
  documents: FileLock2,
  places: MapPinned,
  watchlist: Clapperboard,
  saved: Bookmark,
  finance: Wallet,
  health: HeartPulse,
  orbit: Orbit,
};

/** Medallion, chip, and accent classes per tier, written out in full so Tailwind sees them. */
export const TIER_STYLES: Record<
  AchievementTier,
  { medal: string; chip: string; bar: string; glow: string }
> = {
  easy: {
    medal:
      "bg-linear-to-br from-event-teal/25 to-event-green/35 text-event-teal ring-event-teal/30",
    chip: "bg-event-teal/12 text-event-teal",
    bar: "bg-event-teal",
    glow: "",
  },
  medium: {
    medal:
      "bg-linear-to-br from-event-blue/25 to-event-violet/30 text-event-blue ring-event-blue/30",
    chip: "bg-event-blue/12 text-event-blue",
    bar: "bg-event-blue",
    glow: "",
  },
  hard: {
    medal:
      "bg-linear-to-br from-event-amber/30 to-event-orange/40 text-event-orange ring-event-amber/40",
    chip: "bg-event-amber/15 text-event-orange",
    bar: "bg-event-amber",
    glow: "shadow-[0_0_24px_-6px] shadow-event-amber/50",
  },
  legendary: {
    medal:
      "bg-linear-to-br from-event-rose/30 via-event-violet/30 to-event-blue/30 text-event-violet ring-event-violet/40",
    chip: "bg-event-violet/12 text-event-violet",
    bar: "bg-linear-to-r from-event-rose via-event-violet to-event-blue",
    glow: "shadow-[0_0_28px_-6px] shadow-event-violet/60",
  },
};

// Avatar frames

type FrameLook = {
  background: string;
  /** Turns slowly; off under reduced motion like every animation. */
  spin?: boolean;
  glow?: string;
  /** A second, thin ring outside the first. */
  halo?: string;
};

const FRAMES: Record<string, FrameLook> = {
  frame_sunrise: { background: "conic-gradient(from 200deg, #fdba74, #fde047, #fb7185, #fdba74)" },
  frame_ocean: { background: "conic-gradient(from 90deg, #38bdf8, #1d4ed8, #22d3ee, #38bdf8)" },
  frame_forest: { background: "conic-gradient(from 30deg, #86efac, #15803d, #a3e635, #86efac)" },
  frame_rose: {
    background: "conic-gradient(from 0deg, #fbcfe8, #f472b6, #fda4af, #fbcfe8)",
    glow: "0 0 14px -2px #f472b6aa",
  },
  frame_aurora: {
    background: "conic-gradient(#34d399, #22d3ee, #a78bfa, #f472b6, #34d399)",
    spin: true,
    glow: "0 0 16px -2px #a78bfa99",
  },
  frame_laurel: {
    background: "conic-gradient(#fde68a, #d97706, #fef3c7, #b45309, #fde68a)",
    halo: "#f59e0b",
    glow: "0 0 14px -3px #f59e0bbb",
  },
  frame_constellation: {
    background:
      "radial-gradient(circle, #fff 0.8px, transparent 1.4px) 0 0 / 6px 6px, conic-gradient(#1e1b4b, #4338ca, #0f172a, #6366f1, #1e1b4b)",
    spin: true,
    glow: "0 0 16px -2px #6366f1aa",
  },
  frame_eclipse: {
    background: "conic-gradient(#0a0a0a, #27272a, #0a0a0a)",
    glow: "0 0 0 1px #fbbf2480, 0 0 22px 2px #fbbf24aa",
  },
};

export function frameLook(key: string | null | undefined): FrameLook | null {
  return key ? (FRAMES[key] ?? null) : null;
}

// Banners

const BANNERS: Record<string, { background: string; drift?: boolean }> = {
  banner_dawn: { background: "linear-gradient(120deg, #fed7aa, #fecdd3 45%, #c4b5fd)" },
  banner_meadow: { background: "linear-gradient(160deg, #fef9c3, #bbf7d0 50%, #4ade80)" },
  banner_dusk: { background: "linear-gradient(120deg, #7c3aed, #db2777 50%, #fb923c)" },
  banner_nebula: {
    background:
      "radial-gradient(circle at 20% 30%, #ec489988, transparent 40%), radial-gradient(circle at 75% 60%, #6366f188, transparent 45%), radial-gradient(circle at 50% 100%, #22d3ee66, transparent 50%), linear-gradient(135deg, #0f172a, #1e1b4b)",
    drift: true,
  },
  banner_borealis: {
    background: "linear-gradient(115deg, #052e16, #10b981, #0e7490, #7c3aed, #10b981, #052e16)",
    drift: true,
  },
};

/** The banner's inline style; with none worn, a soft wash of the brand color. */
export function bannerStyle(key: string | null | undefined): {
  style: CSSProperties;
  drift: boolean;
} {
  const look = key ? BANNERS[key] : undefined;
  if (!look) {
    return {
      style: {
        background:
          "radial-gradient(circle at 15% 20%, color-mix(in oklch, var(--color-brand) 28%, transparent), transparent 55%), radial-gradient(circle at 85% 80%, color-mix(in oklch, var(--color-event-violet) 22%, transparent), transparent 55%), var(--color-brand-subtle)",
      },
      drift: false,
    };
  }
  return {
    style: { background: look.background, backgroundSize: look.drift ? "200% 200%" : undefined },
    drift: Boolean(look.drift),
  };
}

// Confetti

/** Where each piece flies. Written out in full so Tailwind sees every class. */
const PIECES = [
  "[--confetti-x:-72px] [--confetti-y:-64px]",
  "[--confetti-x:-44px] [--confetti-y:-92px] delay-75",
  "[--confetti-x:-12px] [--confetti-y:-104px]",
  "[--confetti-x:20px] [--confetti-y:-96px] delay-75",
  "[--confetti-x:52px] [--confetti-y:-80px]",
  "[--confetti-x:80px] [--confetti-y:-56px] delay-100",
  "[--confetti-x:-96px] [--confetti-y:-28px] delay-100",
  "[--confetti-x:100px] [--confetti-y:-24px] delay-75",
] as const;

const PIECES_BIG = [
  "[--confetti-x:-128px] [--confetti-y:-88px] delay-150",
  "[--confetti-x:-84px] [--confetti-y:-128px] delay-200",
  "[--confetti-x:-32px] [--confetti-y:-140px] delay-150",
  "[--confetti-x:36px] [--confetti-y:-136px] delay-200",
  "[--confetti-x:88px] [--confetti-y:-120px] delay-150",
  "[--confetti-x:132px] [--confetti-y:-80px] delay-200",
  "[--confetti-x:-148px] [--confetti-y:-40px] delay-300",
  "[--confetti-x:150px] [--confetti-y:-36px] delay-300",
] as const;

type ConfettiLook = { shape: string; colors: readonly string[] };

const DEFAULT_CONFETTI: ConfettiLook = {
  shape: "size-2 rounded-[2px]",
  colors: [
    "bg-event-rose",
    "bg-event-amber",
    "bg-event-blue",
    "bg-event-green",
    "bg-event-violet",
    "bg-event-orange",
    "bg-event-teal",
  ],
};

const CONFETTI: Record<string, ConfettiLook> = {
  confetti_stars: {
    shape: "size-2 rotate-45 rounded-[1px] shadow-[0_0_6px] shadow-current",
    colors: [
      "bg-amber-300 text-amber-300",
      "bg-yellow-200 text-yellow-200",
      "bg-sky-200 text-sky-200",
    ],
  },
  confetti_petals: {
    shape: "h-2.5 w-1.5 rounded-[50%_0]",
    colors: ["bg-pink-300", "bg-rose-400", "bg-fuchsia-300", "bg-pink-200"],
  },
  confetti_gold: {
    shape: "size-2 rounded-full",
    colors: ["bg-amber-400", "bg-yellow-300", "bg-amber-600", "bg-yellow-500"],
  },
};

/** The burst of confetti behind a celebration, in the style the user wears. */
export function ConfettiBurst({ style, big = false }: { style: string | null; big?: boolean }) {
  const look = (style ? CONFETTI[style] : undefined) ?? DEFAULT_CONFETTI;
  const pieces = big ? [...PIECES, ...PIECES_BIG] : PIECES;
  return (
    <span aria-hidden="true" className="absolute top-1/2 left-1/2">
      {pieces.map((piece, index) => (
        <span
          key={piece}
          className={`absolute animate-confetti ${look.shape} ${look.colors[index % look.colors.length]} ${piece}`}
        />
      ))}
    </span>
  );
}
