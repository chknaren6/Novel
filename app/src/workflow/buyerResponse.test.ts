import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "./dealSubmitted";
import { runBuyerResponse, type BuyerResponseResult } from "./buyerResponse";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_FEASIBLE_AFTER_ADVANCE } from "@/fixtures/definitions";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { RoleModelOutput } from "@/lib/types";

const SECRET = "test-secret";
const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

function script(input: RoleRunInput) {
  switch (input.role) {
    case "finance":
      if (input.contextSummary.requestedPaymentTerms === "NET_60") {
        return {
          toolCall: null,
          output: {
            decision: "counter" as const,
            constraints: [{ domain: "finance" as const, code: "CREDIT_POLICY_BREACH", severity: "blocking" as const, message: "Net-60 exceeds policy.", evidenceRefs: ["EVID-FIN"] }],
            reservationRequests: [],
            counterterms: [{ field: "payment_terms" as const, proposedValue: "ADVANCE_30", rationale: "Net-60 breaches credit policy." }],
            evidenceRefs: ["EVID-FIN"],
            explanation: "Net-60 breaches policy.",
          },
        };
      }
      return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 102_900_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "Advance payment keeps exposure within policy.") };
    case "inventory":
      return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Partial coverage."), decision: "counter" as const } };
    case "procurement":
      return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2003", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2003 covers the shortfall.") };
    case "logistics":
      return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the deadline.") };
    case "sales":
    case "risk":
    default:
      return { toolCall: null, output: APPROVE([`EVID-${input.role.toUpperCase()}`], "OK.") };
  }
}

describe("runBuyerResponse", () => {
  beforeEach(resetTestDb);

  it("commits the case when the buyer accepts the 30% advance counteroffer", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const result = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2", buyerLinkSigningSecret: SECRET });

    expect(result.status).toBe("committed");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("committed");
    expect(reloaded.activeTermsVersion).toBe(2);
  });

  it("moves the case to cannot_commit when the buyer rejects", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const result = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "reject", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2", buyerLinkSigningSecret: SECRET });
    expect(result.status).toBe("cannot_commit");
  });

  it("fails closed on a tampered token without mutating the case", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const tampered = submitted.buyerToken.slice(0, -1) + (submitted.buyerToken.endsWith("a") ? "b" : "a");
    const result = await runBuyerResponse(testDb, gateway, { buyerToken: tampered, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2", buyerLinkSigningSecret: SECRET });
    expect(result.status).toBe("invalid_or_expired");

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("negotiating"); // unchanged
  });

  it("is idempotent on a duplicate acceptance request", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const first = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2", buyerLinkSigningSecret: SECRET });
    const second = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-3", buyerLinkSigningSecret: SECRET });
    expect(first.status).toBe("committed");
    expect(second).toEqual(first);
  });

  it("reports in_progress rather than cannot_commit when a retry lands mid-evaluation", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    // Simulate a concurrent/retried request landing mid-evaluation: the counteroffer
    // is already recorded as accepted, but the case hasn't reached a terminal status
    // yet (evaluateAndRoute occupies "evaluating" for the entire duration of its six
    // role/model calls).
    const counteroffer = await testDb.counteroffer.findFirstOrThrow({ where: { caseId: dealCase.id, status: "sent" } });
    await testDb.counteroffer.update({ where: { id: counteroffer.id }, data: { status: "accepted", respondedAt: new Date() } });
    await testDb.dealCase.update({ where: { id: dealCase.id }, data: { status: "evaluating" } });

    const result = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2", buyerLinkSigningSecret: SECRET });

    expect(result.status).not.toBe("cannot_commit");
    expect(result).toEqual({ status: "in_progress" });
  });

  it("resolves both calls gracefully under a concurrent accept/accept race on the same token", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const call = (traceId: string) =>
      runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId, buyerLinkSigningSecret: SECRET });

    // Promise.allSettled (not Promise.all): before the fix, the losing call threw an
    // unhandled ToolError("STALE_CASE_VERSION") instead of resolving, which would
    // reject the whole Promise.all and hide the actual per-call outcomes.
    const settled = await Promise.allSettled([call("trace-2a"), call("trace-2b")]);

    for (const outcome of settled) {
      expect(outcome.status).toBe("fulfilled");
    }
    const results = settled.map((outcome) => (outcome as PromiseFulfilledResult<BuyerResponseResult>).value);

    // The loser of the race must resolve honestly ("in_progress") rather than either
    // throwing or claiming a terminal status it can't back up; the winner drives the
    // case all the way to "committed". Both are valid, non-contradictory outcomes.
    for (const result of results) {
      expect(["committed", "in_progress"]).toContain(result.status);
    }
    expect(results.some((result) => result.status === "committed")).toBe(true);

    // The specific split the reviewer's live probe found: counteroffer.status and
    // dealCase.status must never disagree about what happened to this event. Only one
    // of the two calls may ever have won the guarded write, so exactly one outcome is
    // possible here, not two inconsistent rows.
    const counteroffer = await testDb.counteroffer.findFirstOrThrow({ where: { caseId: dealCase.id } });
    const reloadedCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(counteroffer.status).toBe("accepted");
    expect(reloadedCase.status).toBe("committed");
  });

  it("resolves both calls consistently under a concurrent accept/reject race on the same token", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const acceptCall = runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-3a", buyerLinkSigningSecret: SECRET });
    const rejectCall = runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "reject", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-3b", buyerLinkSigningSecret: SECRET });

    const settled = await Promise.allSettled([acceptCall, rejectCall]);
    for (const outcome of settled) {
      expect(outcome.status).toBe("fulfilled");
    }

    // Whichever side actually wins the guarded write, the persisted counteroffer and
    // case must describe the same outcome: a "rejected" counteroffer beside a
    // "committed" case (the reviewer's probe result) must never happen.
    const counteroffer = await testDb.counteroffer.findFirstOrThrow({ where: { caseId: dealCase.id } });
    const reloadedCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    if (counteroffer.status === "accepted") {
      expect(reloadedCase.status).toBe("committed");
    } else {
      expect(counteroffer.status).toBe("rejected");
      expect(reloadedCase.status).toBe("cannot_commit");
    }
  });
});
