import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runB2BEvaluation } from "./runB2BEvaluation";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_FEASIBLE_AFTER_ADVANCE } from "@/fixtures/definitions";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { FakeRoleScript } from "@/gateway/fakeGateway";
import type { RoleModelOutput } from "@/lib/types";

const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

// Same scripting pattern as dealSubmitted.test.ts's scriptFor — kept local (rather than
// imported) since it is not exported from dealSubmitted.test.ts.
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

describe("runB2BEvaluation", () => {
  beforeEach(resetTestDb);

  it("commits immediately when the case is feasible from the start (prepared -> committed, no separate approval gate)", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    await testDb.termsVersion.update({ where: { caseId_version: { caseId: dealCase.id, version: 1 } }, data: { paymentTerms: "ADVANCE_30" } });
    const gateway = new FakeModelGateway(scriptFor("ADVANCE_30"));

    const result = await runB2BEvaluation(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("expected committed");
    expect(result.certificateId).toBeTruthy();
    expect(result.depositMinor).toBeGreaterThan(0);

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("committed");
  });

  it("returns the negotiating result unchanged and never invokes runCommit when only credit is missing", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(scriptFor("NET_60"));

    const result = await runB2BEvaluation(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("negotiating");
    if (result.status !== "negotiating") throw new Error("expected negotiating");
    expect(result.counterofferId).toBeTruthy();
    expect(result.buyerToken).toBeTruthy();
    expect(result.salesExplanation).toBeTruthy();

    // Critical assertion: if runB2BEvaluation mistakenly called runCommit regardless of
    // status, runCommit would attempt (and fail, or worse succeed against a bogus
    // "prepared" expectation) a transition out of "negotiating" — either way the case's
    // real DB status would NOT still read "negotiating". This is what would catch a bug
    // that always calls runCommit.
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("negotiating");
  });

  it("returns the cannot_commit result unchanged and never invokes runCommit when Risk vetoes", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    await testDb.termsVersion.update({ where: { caseId_version: { caseId: dealCase.id, version: 1 } }, data: { paymentTerms: "ADVANCE_30" } });
    const gateway = new FakeModelGateway(scriptFor("ADVANCE_30", true));

    const result = await runB2BEvaluation(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("cannot_commit");
    if (result.status !== "cannot_commit") throw new Error("expected cannot_commit");
    expect(result.reason).toBe("risk_veto");

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");
  });
});
