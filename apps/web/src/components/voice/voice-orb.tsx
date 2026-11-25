import type { VoicePhase } from "@/lib/voice";
import { cn } from "@/utils/common";

const tone: Readonly<Record<VoicePhase, string>> = {
  idle: "bg-muted text-muted-foreground",
  connecting: "bg-brand-subtle text-brand",
  listening: "bg-brand text-primary-foreground",
  processing: "bg-brand-subtle text-brand",
  speaking: "bg-primary text-primary-foreground",
  interrupted: "bg-warning/20 text-warning",
  reconnecting: "bg-warning/20 text-warning",
  error: "bg-destructive/15 text-destructive",
};

/**
 * Decorative: grows with the microphone's level while listening and pulses while Orbit speaks or
 * thinks. The phase is always also shown as text beside it; motion stops with reduced motion.
 */
export function VoiceOrb({
  phase,
  level,
  muted,
}: {
  phase: VoicePhase;
  level: number;
  muted: boolean;
}) {
  const listening = phase === "listening" && !muted;
  const scale = listening ? 1 + Math.min(level, 1) * 0.35 : 1;
  return (
    <div aria-hidden="true" className="relative flex size-36 items-center justify-center">
      <span
        className={cn(
          "absolute inset-0 rounded-full opacity-25 transition-transform duration-100 motion-reduce:transition-none",
          tone[phase],
          (phase === "speaking" || phase === "processing" || phase === "connecting") &&
            "animate-pulse motion-reduce:animate-none",
        )}
        style={{ transform: `scale(${scale})` }}
      />
      <span
        className={cn(
          "relative flex size-24 items-center justify-center rounded-full shadow-elevation-2 transition-colors",
          muted ? "bg-muted text-muted-foreground" : tone[phase],
        )}
      >
        <span className="flex h-8 items-end gap-1">
          {[0.6, 1, 0.75, 0.9, 0.5].map((weight, index) => (
            <span
              key={index}
              className="w-1.5 rounded-full bg-current transition-[height] duration-100 motion-reduce:transition-none"
              style={{
                height: `${Math.round(8 + (listening ? level * weight : phase === "speaking" ? 0.5 * weight : 0.1) * 24)}px`,
              }}
            />
          ))}
        </span>
      </span>
    </div>
  );
}
