import { describe, expect, it } from "vitest";
import { deriveMarketState } from "./deriveMarketState";
import { toJsonColumn } from "@/lib/json-column";

function event(eventType: string, payload: unknown = {}) {
  return { eventType, payload: toJsonColumn(payload) };
}

describe("deriveMarketState", () => {
  it("is awaiting_buyer_response right after a quote is sent, before any buyer action", () => {
    const state = deriveMarketState({ status: "evaluating" }, [event("b2c.requirement_parsed")], 1_325_000);
    expect(state.stage).toBe("awaiting_buyer_response");
    expect(state.sellPriceMinor).toBe(1_325_000);
  });

  it("is preparing once the buyer has accepted but before commit completes", () => {
    const state = deriveMarketState(
      { status: "evaluating" },
      [event("b2c.requirement_parsed"), event("b2c.quote_accepted"), event("case.prepared")],
      1_325_000,
    );
    expect(state.stage).toBe("preparing");
  });

  it("is committed when the case status says so, regardless of event history", () => {
    const state = deriveMarketState(
      { status: "committed" },
      [event("b2c.requirement_parsed"), event("case.committed")],
      1_325_000,
    );
    expect(state.stage).toBe("committed");
    expect(state.certificateReady).toBe(true);
  });

  it("is declined when the buyer rejected the quote", () => {
    const state = deriveMarketState(
      { status: "cannot_commit" },
      [event("b2c.requirement_parsed"), event("b2c.quote_rejected")],
      1_325_000,
    );
    expect(state.stage).toBe("declined");
    expect(state.sellPriceMinor).toBeNull();
  });

  it("is escalated and surfaces the recorded reason when the commit fails after the supplier already committed", () => {
    const state = deriveMarketState(
      { status: "escalated" },
      [event("case.escalated", { reason: "PARTIAL_COMMIT: sandbox order failed" })],
      1_325_000,
    );
    expect(state.stage).toBe("escalated");
    expect(state.reason).toBe("PARTIAL_COMMIT: sandbox order failed");
  });

  it("falls back to a generic reason when an escalated case has no case.escalated event on record", () => {
    const state = deriveMarketState({ status: "escalated" }, [], 1_325_000);
    expect(state.stage).toBe("escalated");
    expect(state.reason).toBe("Unknown reason");
  });

  it("is escalated (rolling back) when a commit attempt is actively being aborted, distinct from a fully escalated case", () => {
    const state = deriveMarketState({ status: "aborting" }, [], 1_325_000);
    expect(state.stage).toBe("escalated");
    expect(state.reason).toBe("Rolling back after a failed commit attempt.");
  });

  it("documents the known crash-window limitation: a prepared case with no case.prepared event yet still reads as awaiting_buyer_response", () => {
    // Mirrors the same gap buyerResponse.ts's accepted-replay branch already documents:
    // transitionCase(...->"prepared") and emitCaseEvent(case.prepared) are two separate
    // non-transactional statements, so a crash between them leaves this exact
    // combination. Locking in current (imprecise but not incorrect-looking) behavior
    // rather than leaving it untested.
    const state = deriveMarketState({ status: "prepared" }, [], 1_325_000);
    expect(state.stage).toBe("awaiting_buyer_response");
  });

  it("is preparing for a committing case, because case.prepared is always recorded before runB2CCommit is ever called", () => {
    // buyerResponse.ts awaits emitCaseEvent("case.prepared") to completion before calling
    // runB2CCommit, and commit.ts only transitions prepared->committing inside
    // runB2CCommit — so a "committing" case is caught by the eventTypes.has("case.prepared")
    // check above, not by the default fallback.
    const state = deriveMarketState({ status: "committing" }, [event("case.prepared")], 1_325_000);
    expect(state.stage).toBe("preparing");
  });
});
