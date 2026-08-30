import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "./dealSubmitted";
import { runBuyerResponse } from "./buyerResponse";
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
});
