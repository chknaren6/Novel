import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "./dealSubmitted";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_FEASIBLE_AFTER_ADVANCE } from "@/fixtures/definitions";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { FakeRoleScript } from "@/gateway/fakeGateway";
import type { RoleModelOutput } from "@/lib/types";
import { toJsonColumn } from "@/lib/json-column";

const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

// Explicit `FakeRoleScript` return type (rather than letting it be inferred) gives the
// object literals below contextual typing, so overriding `decision` on a value spread
// from APPROVE(...) (e.g. `{ ...APPROVE(...), decision: "counter" }`) keeps the
// literal type "counter"/"veto" instead of widening to `string` — required for
// `npx tsc --noEmit` to pass since ScriptedRoleRun's `output.decision` is a literal
// union, not `string`.
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

describe("runDealSubmitted", () => {
  beforeEach(resetTestDb);

  it("moves to negotiating and creates a 30% advance counteroffer when only credit is missing", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(scriptFor("NET_60"));

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("negotiating");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("negotiating");

    const v2 = await testDb.termsVersion.findFirstOrThrow({ where: { caseId: dealCase.id, version: 2 } });
    expect(v2.paymentTerms).toBe("ADVANCE_30");

    const reservations = await testDb.reservation.findMany({ where: { caseId: dealCase.id } });
    expect(reservations.every((r) => r.status === "released")).toBe(true); // v1 holds released, not left dangling
  });

  it("reaches prepared and issues a certificate when the request is feasible from the start", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    await testDb.termsVersion.update({ where: { caseId_version: { caseId: dealCase.id, version: 1 } }, data: { paymentTerms: "ADVANCE_30" } });
    const gateway = new FakeModelGateway(scriptFor("ADVANCE_30"));

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("prepared");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("prepared");
  });

  it("reaches cannot_commit when Risk vetoes the request", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    await testDb.termsVersion.update({ where: { caseId_version: { caseId: dealCase.id, version: 1 } }, data: { paymentTerms: "ADVANCE_30" } });
    const gateway = new FakeModelGateway(scriptFor("ADVANCE_30", true));

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("cannot_commit");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");
  });

  // Not in the original spec — required because allowedPaymentTerms is a JSON-in-TEXT
  // column (see prisma/schema.prisma / lib/json-column.ts), not a native array. A
  // plain `["OTHER_BOUNDED"]` value would pass this test even under the buggy bare
  // cast, because `.includes("ADVANCE_30")` called on the *raw stored string*
  // `'["OTHER_BOUNDED"]'` does a substring search that happens to also return false
  // there — a vacuous pass that would mask the bug. "ADVANCE_30_PENDING_REVIEW" is
  // deliberately chosen so the raw JSON string DOES contain "ADVANCE_30" as a
  // substring (so a buggy string-based `.includes` wrongly returns true and would let
  // the deal proceed to negotiating) while the real deserialized array does NOT
  // contain the exact element "ADVANCE_30" (so a correct fromJsonColumn-based check
  // correctly returns false and routes to cannot_commit). This is what actually
  // distinguishes the fix from the bug.
  it("reaches cannot_commit with credit_policy_no_permitted_counterterm when ADVANCE_30 is not in the customer's allowed payment terms", async () => {
    const { dealCase, customer } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    await testDb.customer.update({ where: { id: customer.id }, data: { allowedPaymentTerms: toJsonColumn(["ADVANCE_30_PENDING_REVIEW"]) } });
    const gateway = new FakeModelGateway(scriptFor("NET_60"));

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("cannot_commit");
    if (result.status === "cannot_commit") {
      expect(result.reason).toBe("credit_policy_no_permitted_counterterm");
    }
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");
    // No counteroffer/version-2 terms should have been created for a permitted term
    // that doesn't actually exist for this customer.
    const v2 = await testDb.termsVersion.findFirst({ where: { caseId: dealCase.id, version: 2 } });
    expect(v2).toBeNull();
  });
});
