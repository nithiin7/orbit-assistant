"use client";

import { createContext, type ReactNode, useContext } from "react";

const HiddenAmountsContext = createContext(false);

/** Hides money amounts in the dashboard's widgets, for screens other people can see. */
export function HiddenAmountsProvider({
  hidden,
  children,
}: {
  hidden: boolean;
  children: ReactNode;
}) {
  return <HiddenAmountsContext.Provider value={hidden}>{children}</HiddenAmountsContext.Provider>;
}

/** What a hidden amount shows instead. */
export const HIDDEN_AMOUNT = "••••";

/**
 * Whether amounts are hidden, and a way to show one: `show(formatted)` returns the amount, or
 * dots when hidden. Outside the dashboard amounts are never hidden.
 */
export function useAmounts(): { hidden: boolean; show: (formatted: string) => string } {
  const hidden = useContext(HiddenAmountsContext);
  return { hidden, show: (formatted) => (hidden ? HIDDEN_AMOUNT : formatted) };
}
