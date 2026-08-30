import { fromJsonColumn } from "@/lib/json-column";
import type { CaseStatus } from "@/lib/types";

export type MarketStage = "awaiting_buyer_response" | "preparing" | "committed" | "declined" | "escalated";

export interface MarketViewState {
  stage: MarketStage;
  label: string;
  certificateReady: boolean;
  sellPriceMinor: number | null;
  reason: string | null;
}

const STAGE_LABELS: Record<MarketStage, string> = {
  awaiting_buyer_response: "Quote sent — waiting for the buyer to respond.",
  preparing: "Buyer accepted — committing the supplier order.",
  committed: "Committed — the buyer has a dated certificate.",
  declined: "Declined — the buyer did not accept this quote.",
  escalated: "Needs attention — the commit did not complete cleanly.",
};

// The direct analog of the mockup's renderVals(), but computed from real DealCase +
// CaseEvent rows instead of a demo timer's this.state.mstage. Named stages instead of
// the mockup's raw 0-7 numbers: the real state machine doesn't partition into 8 equal
// buckets (escalated, in particular, isn't on the original happy-path spectrum at all).
export function deriveMarketState(
  dealCase: { status: CaseStatus },
  events: { eventType: string; payload: string }[],
  termsTotalValueMinor: number | null,
): MarketViewState {
  if (dealCase.status === "committed") {
    return { stage: "committed", label: STAGE_LABELS.committed, certificateReady: true, sellPriceMinor: termsTotalValueMinor, reason: null };
  }
  if (dealCase.status === "escalated") {
    const escalatedEvent = [...events].reverse().find((e) => e.eventType === "case.escalated");
    const reason = escalatedEvent ? (fromJsonColumn<{ reason?: string }>(escalatedEvent.payload).reason ?? "Unknown reason") : "Unknown reason";
    return { stage: "escalated", label: STAGE_LABELS.escalated, certificateReady: false, sellPriceMinor: null, reason };
  }
  if (dealCase.status === "aborting") {
    return { stage: "escalated", label: STAGE_LABELS.escalated, certificateReady: false, sellPriceMinor: null, reason: "Rolling back after a failed commit attempt." };
  }
  if (dealCase.status === "cannot_commit") {
    return { stage: "declined", label: STAGE_LABELS.declined, certificateReady: false, sellPriceMinor: null, reason: null };
  }
  const eventTypes = new Set(events.map((e) => e.eventType));
  if (eventTypes.has("case.prepared")) {
    return { stage: "preparing", label: STAGE_LABELS.preparing, certificateReady: false, sellPriceMinor: termsTotalValueMinor, reason: null };
  }
  // Reached by "intake" (a case that hasn't even been fully created yet — not
  // observable in practice, createB2CCase creates the row and the terms in one
  // transaction-adjacent sequence), "prepared"/"committing" before their case.prepared
  // event lands (buyerResponse.ts's own documented crash-window limitation — see its
  // comment above the accepted-replay branch), and "negotiating" (B2B-only, never
  // reachable for a B2C case). All fall back to the same "still in progress" label,
  // which is honest for "committing" and merely imprecise (not wrong) for the other two
  // rare/unreachable cases.
  return { stage: "awaiting_buyer_response", label: STAGE_LABELS.awaiting_buyer_response, certificateReady: false, sellPriceMinor: termsTotalValueMinor, reason: null };
}
