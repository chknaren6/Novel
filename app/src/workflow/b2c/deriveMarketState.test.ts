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
});
