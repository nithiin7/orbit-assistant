import type { AiProposal } from "@orbit/contracts";

/**
 * What to say after an answer that proposed actions. A single pending proposal is read back
 * and can be answered by voice (the server decides whether a spoken yes is enough); several are
 * left for the screen, so a "yes" can never be ambiguous about which action it approves.
 */
export function proposalPrompt(proposals: AiProposal[]): {
  text: string;
  awaiting: AiProposal | null;
} | null {
  const pending = proposals.filter((p) => p.status === "pending");
  if (pending.length === 0) return null;
  if (pending.length > 1) {
    return {
      text: `I've prepared ${pending.length} actions. Please review them on screen.`,
      awaiting: null,
    };
  }
  const [proposal] = pending;
  if (!proposal) return null;
  return { text: `I've prepared this: ${proposal.summary}. Shall I go ahead?`, awaiting: proposal };
}
