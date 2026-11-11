"use client";

import type { AchievementProfile, RewardItem } from "@orbit/contracts";
import { Check, Gem, Lock, Play, Sparkles, Store } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { bannerStyle, ConfettiBurst } from "@/components/achievements/cosmetics";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { useRewardStore } from "@/hooks/use-achievements";
import { profileHref, rewardState, SLOT_LABELS, SLOTS } from "@/lib/achievements";
import { useCurrentUser } from "@/providers/auth";
import { cn } from "@/utils/common";

/**
 * Store items by slot. `store` shows everything to buy; `collection` shows what the user owns,
 * to wear or take off.
 */
export function RewardShelf({
  profile,
  mode,
}: {
  profile: AchievementProfile;
  mode: "store" | "collection";
}) {
  const store = useRewardStore();
  const { confirm, confirmDialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const items = mode === "store" ? profile.store : profile.store.filter((item) => item.owned);
  const pending = store.isPending ? store.variables : undefined;
  const pendingKey = pending && pending.kind !== "unequip" ? pending.itemKey : null;

  async function act(item: RewardItem) {
    setError(null);
    const state = rewardState(item, profile);
    if (state === "available") {
      const confirmed = await confirm({
        title: `Buy ${item.name}?`,
        description: `It costs ${item.cost.toLocaleString()} XP, leaving ${(profile.balance - item.cost).toLocaleString()}. Your level stays the same.`,
        confirmLabel: `Buy for ${item.cost.toLocaleString()} XP`,
      });
      if (!confirmed) return;
    }
    const action =
      state === "available"
        ? ({ kind: "buy", itemKey: item.key } as const)
        : state === "owned"
          ? ({ kind: "equip", itemKey: item.key } as const)
          : state === "equipped"
            ? ({ kind: "unequip", slot: item.slot } as const)
            : null;
    if (!action) return;
    store.mutate(action, {
      onError: (reason) => setError(describeApiError(reason, "Couldn’t update your items.")),
    });
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Gem}
        title="Nothing in your collection yet"
        description="Spend the XP you earn from achievements on frames, banners, titles, and confetti."
      >
        <Link href={profileHref("store")} className={buttonVariants({ variant: "soft" })}>
          <Store aria-hidden="true" />
          Visit the store
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-8">
      {mode === "store" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Gem className="size-4 text-brand" aria-hidden="true" />
          You have
          <span className="font-semibold text-foreground tabular-nums">
            {profile.balance.toLocaleString()} XP
          </span>
          to spend. Buying never lowers your level.
        </p>
      ) : null}
      <FormAlert message={error} />

      {SLOTS.map((slot) => {
        const inSlot = items.filter((item) => item.slot === slot);
        if (inSlot.length === 0) return null;
        return (
          <section key={slot} aria-labelledby={`slot-${slot}`} className="space-y-3">
            <div>
              <h3 id={`slot-${slot}`} className="font-semibold">
                {SLOT_LABELS[slot].label}
              </h3>
              <p className="text-sm text-muted-foreground">{SLOT_LABELS[slot].description}</p>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
              {inSlot.map((item) => (
                <RewardCard
                  key={item.key}
                  item={item}
                  profile={profile}
                  busy={pendingKey === item.key}
                  onAct={() => void act(item)}
                />
              ))}
            </div>
          </section>
        );
      })}
      {confirmDialog}
    </div>
  );
}

function RewardCard({
  item,
  profile,
  busy,
  onAct,
}: {
  item: RewardItem;
  profile: AchievementProfile;
  busy: boolean;
  onAct: () => void;
}) {
  const state = rewardState(item, profile);

  return (
    <article
      aria-label={item.name}
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-card transition duration-200 hover:shadow-elevation-2",
        state === "equipped" && "border-brand/50 ring-1 ring-brand/30",
      )}
    >
      <RewardPreview item={item} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold">{item.name}</h4>
            {state === "equipped" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-medium text-brand">
                <Check className="size-3" aria-hidden="true" />
                Wearing
              </span>
            ) : state === "owned" ? (
              <span className="rounded-full bg-success/12 px-2 py-0.5 text-xs font-medium text-success">
                Owned
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums">
                <Gem className="size-3.5 text-brand" aria-hidden="true" />
                {item.cost.toLocaleString()}
              </span>
            )}
          </div>
          <p className="text-sm text-pretty text-muted-foreground">{item.description}</p>
        </div>
        <RewardAction state={state} item={item} profile={profile} busy={busy} onAct={onAct} />
      </div>
    </article>
  );
}

function RewardAction({
  state,
  item,
  profile,
  busy,
  onAct,
}: {
  state: ReturnType<typeof rewardState>;
  item: RewardItem;
  profile: AchievementProfile;
  busy: boolean;
  onAct: () => void;
}) {
  switch (state) {
    case "locked":
      return (
        <p className="flex h-8 items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          Reach level {item.min_level}
        </p>
      );
    case "short":
      return (
        <p className="flex h-8 items-center text-sm text-muted-foreground tabular-nums">
          {(item.cost - profile.balance).toLocaleString()} more XP needed
        </p>
      );
    case "available":
      return (
        <Button size="sm" variant="soft" onClick={onAct} disabled={busy}>
          {busy ? "Buying…" : "Buy"}
        </Button>
      );
    case "owned":
      return (
        <Button size="sm" variant="soft" onClick={onAct} disabled={busy}>
          {busy ? "Putting on…" : "Wear"}
        </Button>
      );
    case "equipped":
      return (
        <Button size="sm" variant="ghost" onClick={onAct} aria-label={`Take off ${item.name}`}>
          Take off
        </Button>
      );
  }
}

function RewardPreview({ item }: { item: RewardItem }) {
  const user = useCurrentUser();
  const [burst, setBurst] = useState(0);

  return (
    <div className="relative flex h-28 items-center justify-center overflow-hidden border-b bg-muted/40">
      {item.slot === "frame" ? <UserAvatar size="lg" frame={item.key} /> : null}
      {item.slot === "banner" ? <BannerPreview itemKey={item.key} /> : null}
      {item.slot === "title" ? (
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-sm font-semibold">{user.display_name}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-2.5 py-0.5 text-sm font-medium text-brand">
            <Sparkles className="size-3.5" aria-hidden="true" />
            {item.name}
          </span>
        </div>
      ) : null}
      {item.slot === "confetti" ? (
        <>
          {burst > 0 ? <ConfettiBurst key={burst} style={item.key} big /> : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBurst(burst + 1)}
            aria-label={`Preview ${item.name}`}
          >
            <Play aria-hidden="true" />
            Preview
          </Button>
        </>
      ) : null}
    </div>
  );
}

function BannerPreview({ itemKey }: { itemKey: string }) {
  const banner = bannerStyle(itemKey);
  return (
    <div
      aria-hidden="true"
      className={cn("absolute inset-0", banner.drift && "animate-drift")}
      style={banner.style}
    />
  );
}
