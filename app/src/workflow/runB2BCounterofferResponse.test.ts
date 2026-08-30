import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "./dealSubmitted";
import { runB2BCounterofferResponse } from "./runB2BCounterofferResponse";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_FEASIBLE_AFTER_ADVANCE } from "@/fixtures/definitions";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { FakeRoleScript } from "@/gateway/fakeGateway";
import type { RoleModelOutput } from "@/lib/types";

const SIGNING_SECRET = "test-secret";

const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

// Same scripting pattern as dealSubmitted.test.ts's / runB2BEvaluation.test.ts's
// scriptFor — kept local since it is not exported from either file.
function scriptFor(paymentTerms: string, riskVeto = false): FakeRoleScript {
  return (input: RoleRunInput) => {
    switch (input.role) {
      case "sales":
        return { toolCall: null, output: APPROVE(["EVID-SALES"], "Normalized buyer request.") };
      case "finance":
        if (paymentTerms === "NET_60") {
          return {
            toolCall: null,
            output: {
              decision: "counter" as const,
              constraints: [{ domain: "finance" as const, code: "CREDIT_POLICY_BREACH", severity: "blocking" as const, message: "Net-60 exceeds policy.", evidenceRefs: ["EVID-FIN"] }],
              reservationRequests: [],
              counterterms: [{ field: "payment_terms" as const, proposedValue: "ADVANCE_30", rationale: "Net-60 breaches credit policy." }],
              evidenceRefs: ["EVID-FIN"],
              explanation: "Net-60 breaches policy; 30% advance would pass.",
            },
          };
        }
        return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 102_900_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "Advance payment keeps exposure within policy.") };
      case "inventory":
        return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Only 199 of 350 units currently available."), decision: "counter" } };
      case "procurement":
        return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2003", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2003 option covers the shortfall.") };
      case "logistics":
        return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the 21-day deadline.") };
      case "risk":
      default:
        return { toolCall: null, output: riskVeto ? { ...APPROVE(["EVID-RISK"], "Unsupported evidence."), decision: "veto" as const } : APPROVE(["EVID-RISK"], "Evidence is fresh and coverage matches decisions.") };
    }
  };
}

// Drives a fresh fixture case to "negotiating" via the same path a real B2B submission
// takes (NET_60 initial terms -> finance counters ADVANCE_30 -> counteroffer created),
// capturing the buyer token the (real, un-mocked) createCounteroffer call produced.
async function seedNegotiatingCase() {
  const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
  const gateway = new FakeModelGateway(scriptFor("NET_60"));
  const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SIGNING_SECRET });
  if (result.status !== "negotiating") throw new Error(`expected negotiating, got ${result.status}`);
  return { dealCase, buyerToken: result.buyerToken, counterofferId: result.counterofferId };
}

describe("runB2BCounterofferResponse", () => {
  beforeEach(resetTestDb);

  it("accepting a negotiating case re-evaluates the new terms and commits", async () => {
    const { dealCase, buyerToken } = await seedNegotiatingCase();
    const gateway = new FakeModelGateway(scriptFor("ADVANCE_30"));

    const result = await runB2BCounterofferResponse(testDb, gateway, { buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2" });

    expect(result.status).toBe("committed");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("committed");
    expect(reloaded.activeTermsVersion).toBe(2);

    const counteroffer = await testDb.counteroffer.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(counteroffer.status).toBe("accepted");
    expect(counteroffer.respondedAt).not.toBeNull();
  });

  it("rejecting a negotiating case fails it closed without touching activeTermsVersion", async () => {
    const { dealCase, buyerToken } = await seedNegotiatingCase();
    const gateway = new FakeModelGateway(scriptFor("ADVANCE_30"));

    const result = await runB2BCounterofferResponse(testDb, gateway, { buyerToken, response: "reject", buyerLinkSigningSecret: SIGNING_SECRET, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2" });

    expect(result).toEqual({ status: "cannot_commit", reason: "counteroffer_declined" });
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");
    expect(reloaded.activeTermsVersion).toBe(1);

    const counteroffer = await testDb.counteroffer.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(counteroffer.status).toBe("declined");
    expect(counteroffer.respondedAt).not.toBeNull();

    const event = await testDb.caseEvent.findFirst({ where: { caseId: dealCase.id, eventType: "case.cannot_commit" } });
    expect(event).not.toBeNull();
  });

  it("an expired counteroffer is invalid_or_expired with no case mutation", async () => {
    const { dealCase, buyerToken } = await seedNegotiatingCase();
    await testDb.counteroffer.updateMany({ where: { caseId: dealCase.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const gateway = new FakeModelGateway(scriptFor("ADVANCE_30"));

    const result = await runB2BCounterofferResponse(testDb, gateway, { buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2" });

    expect(result).toEqual({ status: "invalid_or_expired" });
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("negotiating");
    expect(reloaded.activeTermsVersion).toBe(1);
  });

  it("a tampered token is invalid_or_expired with no case mutation", async () => {
    const { dealCase, buyerToken } = await seedNegotiatingCase();
    const gateway = new FakeModelGateway(scriptFor("ADVANCE_30"));

    const result = await runB2BCounterofferResponse(testDb, gateway, { buyerToken: `${buyerToken}-tampered`, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2" });

    expect(result).toEqual({ status: "invalid_or_expired" });
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("negotiating");
  });

  it("replaying an already-accepted token is rejected and does not re-process the case", async () => {
    const { dealCase, buyerToken } = await seedNegotiatingCase();

    const first = await runB2BCounterofferResponse(testDb, new FakeModelGateway(scriptFor("ADVANCE_30")), { buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2" });
    expect(first.status).toBe("committed");

    // A second gateway that would blow up if it were ever invoked again — the replay
    // must be rejected before any re-evaluation happens, not merely produce the same
    // outcome by re-running everything a second time.
    const explodingGateway = new FakeModelGateway(() => {
      throw new Error("must not be called on a replayed response");
    });
    const second = await runB2BCounterofferResponse(testDb, explodingGateway, { buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-3" });

    expect(second).toEqual({ status: "invalid_or_expired" });
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("committed");
    expect(reloaded.activeTermsVersion).toBe(2);

    const counteroffer = await testDb.counteroffer.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(counteroffer.status).toBe("accepted");
  });

  it("a stale case version at response time throws STALE_CASE_VERSION instead of corrupting state", async () => {
    const { dealCase, buyerToken } = await seedNegotiatingCase();
    // Simulate a concurrent modification: something else already moved the case out of
    // "negotiating" (e.g. a racing response, or an operator action) before this one runs.
    await testDb.dealCase.update({ where: { id: dealCase.id }, data: { status: "cannot_commit" } });

    const gateway = new FakeModelGateway(scriptFor("ADVANCE_30"));
    await expect(
      runB2BCounterofferResponse(testDb, gateway, { buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2" }),
    ).rejects.toMatchObject({ code: "STALE_CASE_VERSION" });

    // Not silently corrupted: the Counteroffer row must still be unresponded, and the
    // case status must be exactly what it was set to above — no partial mutation from
    // the failed accept attempt leaked through before the throw.
    const counteroffer = await testDb.counteroffer.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(counteroffer.status).toBe("sent");
    expect(counteroffer.respondedAt).toBeNull();
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");
    expect(reloaded.activeTermsVersion).toBe(1);
  });
});
