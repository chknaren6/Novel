import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "./dealSubmitted";
import { runBuyerResponse } from "./buyerResponse";
import { runSupplierDisruption } from "./supplierDisrupted";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_POST_COMMIT_DISRUPTION } from "@/fixtures/definitions";
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
      if (input.contextSummary.excludedSupplierId) {
        return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2005", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2005 replaces the disrupted option.") };
      }
      return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2003", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2003 covers the shortfall.") };
    case "logistics":
      if (input.contextSummary.requestedQuantity === 151) {
        return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-CHE", quantity: 151, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Repair plan covers VEND-2005's leg.") };
      }
      return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the deadline.") };
    case "sales":
    case "risk":
    default:
      return { toolCall: null, output: APPROVE([`EVID-${input.role.toUpperCase()}`], "OK.") };
  }
}

// Vetoes Risk specifically on the repair round. RoleRunInput carries no caseVersion (see
// gateway/modelGateway.ts), so the repair round is detected by contextSummary shape
// instead: the initial evaluateAndRoute call feeds Risk {financeDecision,
// inventoryDecision, procurementDecision, logisticsDecision}, while
// runSupplierDisruption's repair round feeds it only {procurementDecision,
// logisticsDecision} (no financeDecision) — see supplierDisrupted.ts's `runRole("risk", ...)` call.
function scriptWithRepairRiskVeto(input: RoleRunInput) {
  if (input.role === "risk" && !("financeDecision" in input.contextSummary)) {
    return { toolCall: null, output: { ...APPROVE(["EVID-RISK"], "Repair plan rejected."), decision: "veto" as const } };
  }
  return script(input);
}

async function commitFixtureCase() {
  const { dealCase } = await seedFixture(testDb, FIXTURE_POST_COMMIT_DISRUPTION);
  const gateway = new FakeModelGateway(script);
  const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t1", buyerLinkSigningSecret: SECRET });
  if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");
  const accepted = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t2", buyerLinkSigningSecret: SECRET });
  if (accepted.status !== "committed") throw new Error("fixture setup expected committed");
  return { dealCase, gateway };
}

describe("runSupplierDisruption", () => {
  beforeEach(resetTestDb);

  it("repairs the case with VEND-2005 after VEND-2003 is disrupted", async () => {
    const { dealCase, gateway } = await commitFixtureCase();

    const result = await runSupplierDisruption(testDb, gateway, { caseId: dealCase.id, disruptedSupplierId: "VEND-2003", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t3" });
    expect(result.status).toBe("repaired");

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("repaired");
    expect(reloaded.activeTermsVersion).toBe(3);

    if (result.status !== "repaired") throw new Error("expected repaired");
    const originalCert = await testDb.commitCertificate.findFirstOrThrow({ where: { caseId: dealCase.id, id: { not: result.certificateId } } });
    expect(originalCert.status).toBe("broken");

    const repairedCert = await testDb.commitCertificate.findUniqueOrThrow({ where: { id: result.certificateId } });
    expect(repairedCert.supersedesCertificateId).toBe(originalCert.id);

    const order = await testDb.sandboxOrder.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(order.status).toBe("repaired");

    const messages = await testDb.outboxMessage.findMany({ where: { caseId: dealCase.id } });
    expect(messages.some((m) => m.messageType === "correction")).toBe(true);
  });

  it("compensates each affected domain exactly once", async () => {
    const { dealCase, gateway } = await commitFixtureCase();
    await runSupplierDisruption(testDb, gateway, { caseId: dealCase.id, disruptedSupplierId: "VEND-2003", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t3" });

    const supplierReceipts = await testDb.actionReceipt.findMany({ where: { caseId: dealCase.id, actionType: "supplier.cancel_option" } });
    const logisticsReceipts = await testDb.actionReceipt.findMany({ where: { caseId: dealCase.id, actionType: "logistics.release_slot" } });
    expect(supplierReceipts).toHaveLength(1);
    expect(logisticsReceipts).toHaveLength(1);
  });

  it("fails closed to cannot_commit (not escalated) when the repair re-evaluation is vetoed", async () => {
    const { dealCase } = await commitFixtureCase();
    const vetoGateway = new FakeModelGateway(scriptWithRepairRiskVeto);

    const result = await runSupplierDisruption(testDb, vetoGateway, { caseId: dealCase.id, disruptedSupplierId: "VEND-2003", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t3" });
    expect(result.status).toBe("cannot_commit");
    if (result.status !== "cannot_commit") throw new Error("expected cannot_commit");
    expect(result.reason).toBe("risk_veto");
    expect((result as { status: string }).status).not.toBe("escalated");

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");

    const events = await testDb.caseEvent.findMany({ where: { caseId: dealCase.id } });
    expect(events.some((e) => e.eventType === "case.cannot_commit")).toBe(true);
    expect(events.some((e) => e.eventType === "case.escalated")).toBe(false);
  });
});
