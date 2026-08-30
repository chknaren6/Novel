import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "@/workflow/dealSubmitted";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_DESK_COMMITTED, FIXTURE_DESK_NEGOTIATING, FIXTURE_DESK_CANNOT_COMMIT } from "@/fixtures/deskDemoDefinitions";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { FakeRoleScript } from "@/gateway/fakeGateway";
import type { RoleModelOutput } from "@/lib/types";

const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

// FIXTURE_DESK_COMMITTED: ADVANCE_30 from the start, and on-hand inventory (100 units
// at WH-DESK-1) alone covers the full 40-unit request. Every role's honest read of the
// real fixture data supports a clean approve:
//  - finance: exposureIfApproved = totalValueMinor(14,000,000) - 30% deposit(4,200,000)
//    = 9,800,000, nowhere near the Rs 10L (100,000,000) credit limit -> approve + hold.
//  - inventory: 100 available >= 40 requested -> approve + hold the full 40.
//  - procurement: sees VEND-DESK-1 (50 available) but — per dealSubmitted.ts's own
//    documented design — decides using only {sku, requestedQuantity}, with no
//    visibility into whether inventory alone already covers the request. Holding the
//    option as a hedge is exactly the scenario dealSubmitted.test.ts's own
//    "excludes an unneeded held supplier reservation..." test documents as expected,
//    real procurement behavior; the workflow ends up not requiring the "supplier"
//    domain here (inventory already covers the full quantity) and releases this hold.
//  - logistics: RT-DESK-1 delivers exactly 40 units in 5 days, well inside the 21-day
//    deadline -> approve + hold.
//  - risk: every other role's evidence is fresh, consistent, and unanimous -> approve.
function scriptForCommitted(): FakeRoleScript {
  return (input: RoleRunInput) => {
    switch (input.role) {
      case "sales":
        return { toolCall: null, output: APPROVE(["EVID-SALES"], "Normalized buyer request.") };
      case "finance":
        return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 9_800_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "30% advance keeps exposure well within the Rs 10L limit.") };
      case "inventory":
        return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-DESK-1", quantity: 40, ttlSeconds: 900 } }, output: APPROVE(["EVID-INV"], "Full 40 units available from WH-DESK-1.") };
      case "procurement":
        return {
          toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-DESK-1", quantity: 40, maxUnitCostMinor: 300_000, maxLeadDays: 10, ttlSeconds: 900 } },
          output: APPROVE(["EVID-PROC"], "VEND-DESK-1 option held as a hedge, without knowing inventory already covers the request."),
        };
      case "logistics":
        return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-DESK-1", quantity: 40, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "RT-DESK-1 delivers the full 40 units in 5 days, inside the 21-day deadline.") };
      case "risk":
      default:
        return { toolCall: null, output: APPROVE(["EVID-RISK"], "Evidence is fresh and coverage matches decisions.") };
    }
  };
}

// FIXTURE_DESK_NEGOTIATING: same credit-breach shape as definitions.ts's proven
// FIXTURE_FEASIBLE_AFTER_ADVANCE (Rs 20L limit, Rs 7.43L existing exposure, requesting
// Rs 14.7L on NET_60 -> Rs 22.13L total, over the limit by a wide margin), cloned onto
// SKU-DESK-MCB-32A / WH-DESK-2 / VEND-DESK-2 / RT-DESK-2:
//  - finance: NET_60 -> creditExposureMinor = full revenue (147,000,000); existing
//    exposure (74,346,569) + that pushes total to 221,346,569, over the Rs 20L
//    (200,000,000) limit -> counters with the one supported counterterm, ADVANCE_30.
//  - inventory: 199 available at WH-DESK-2 < 350 requested -> counters, holding the
//    199 it actually has.
//  - procurement: VEND-DESK-2 has exactly 151 available (the 350-199 shortfall) ->
//    approves and holds all 151.
//  - logistics: RT-DESK-2 delivers the full 350 units (split shipment) in 20 days,
//    inside the 21-day deadline -> approves and holds 350.
//  - risk: evidence is fresh and consistent (a real shortfall, a real credit breach,
//    both backed by held reservations) -> approve, not veto — the case should reach
//    negotiating on the missing-credit-only branch, not on a risk veto.
function scriptForNegotiating(): FakeRoleScript {
  return (input: RoleRunInput) => {
    switch (input.role) {
      case "sales":
        return { toolCall: null, output: APPROVE(["EVID-SALES"], "Normalized buyer request.") };
      case "finance":
        return {
          toolCall: null,
          output: {
            decision: "counter" as const,
            constraints: [{ domain: "finance" as const, code: "CREDIT_POLICY_BREACH", severity: "blocking" as const, message: "Net-60 exceeds policy.", evidenceRefs: ["EVID-FIN"] }],
            reservationRequests: [],
            counterterms: [{ field: "payment_terms" as const, proposedValue: "ADVANCE_30", rationale: "Net-60 breaches credit policy; a 30% advance would pass." }],
            evidenceRefs: ["EVID-FIN"],
            explanation: "Net-60 pushes total exposure to Rs 22.13L, over the Rs 20L limit; 30% advance would pass.",
          },
        };
      case "inventory":
        return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-DESK-2", quantity: 199, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Only 199 of 350 units currently available."), decision: "counter" } };
      case "procurement":
        return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-DESK-2", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-DESK-2 option covers the 151-unit shortfall.") };
      case "logistics":
        return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-DESK-2", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the 21-day deadline.") };
      case "risk":
      default:
        return { toolCall: null, output: APPROVE(["EVID-RISK"], "Evidence is fresh and coverage matches decisions.") };
    }
  };
}

// FIXTURE_DESK_CANNOT_COMMIT: inventory has only 50 of the 1000 requested units, and
// supplierOptions is empty for SKU-DESK-STEEL-ROD — there is no option anywhere to
// cover the 950-unit shortfall:
//  - finance: ADVANCE_30 from the start, exposureIfApproved = 50,000,000 - 30% deposit
//    (15,000,000) = 35,000,000, nowhere near the Rs 10L limit -> approve + hold. (Using
//    ADVANCE_30 here, per the fixture's own comment, means credit can't appear to
//    "fix" this the way a counterterm does for the negotiating fixture.)
//  - inventory: only 50 of 1000 available at WH-DESK-3 -> counters, holding the 50 it
//    actually has.
//  - procurement: get_supplier_options returns zero options for this SKU — there is
//    nothing to hold and nothing to counter with -> the honest decision is veto, not
//    approve (RoleConfig's PROMPT_RULES: "Missing or stale evidence must produce
//    decision=unavailable or decision=veto, never approve").
//  - logistics: RT-DESK-3 only has capacity/deliveredQuantity for the 50 units
//    inventory actually backs -> counters, holding the 50 it can actually deliver.
//  - risk: every role's evidence is itself fresh and internally consistent (nobody is
//    lying about what they can offer) — the deal fails on unresolved supply, not on
//    falsified evidence, so risk approves rather than vetoes. This isolates the
//    "unresolved_domains" cannot_commit branch from the "risk_veto" one.
function scriptForCannotCommit(): FakeRoleScript {
  return (input: RoleRunInput) => {
    switch (input.role) {
      case "sales":
        return { toolCall: null, output: APPROVE(["EVID-SALES"], "Normalized buyer request.") };
      case "finance":
        return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 35_000_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "30% advance keeps exposure well within the Rs 10L limit.") };
      case "inventory":
        return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-DESK-3", quantity: 50, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Only 50 of 1000 units currently available."), decision: "counter" } };
      case "procurement":
        return {
          toolCall: null,
          output: {
            decision: "veto" as const,
            constraints: [{ domain: "procurement" as const, code: "NO_SUPPLIER_COVERAGE", severity: "blocking" as const, message: "No supplier option exists for this SKU.", evidenceRefs: ["EVID-PROC"] }],
            reservationRequests: [],
            counterterms: [],
            evidenceRefs: ["EVID-PROC"],
            explanation: "get_supplier_options returned zero options for SKU-DESK-STEEL-ROD; the 950-unit shortfall cannot be covered.",
          },
        };
      case "logistics":
        return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-DESK-3", quantity: 50, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-LOG"], "RT-DESK-3 can only deliver the 50 units inventory actually backs."), decision: "counter" } };
      case "risk":
      default:
        return { toolCall: null, output: APPROVE(["EVID-RISK"], "Every role's evidence is fresh and internally consistent; the shortfall itself is unresolved, not falsified.") };
    }
  };
}

describe("desk demo fixtures reach their documented terminal state under honest role behavior", () => {
  beforeEach(resetTestDb);

  it("FIXTURE_DESK_COMMITTED reaches prepared (runDealSubmitted's own terminal state for a feasible-from-the-start case; the fixture's 'committed' label refers to the separate commit step run afterward)", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_DESK_COMMITTED);
    const gateway = new FakeModelGateway(scriptForCommitted());

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-desk-committed", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("prepared");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("prepared");
  });

  it("FIXTURE_DESK_NEGOTIATING reaches negotiating with a 30% advance counteroffer", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_DESK_NEGOTIATING);
    const gateway = new FakeModelGateway(scriptForNegotiating());

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-desk-negotiating", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("negotiating");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("negotiating");

    const v2 = await testDb.termsVersion.findFirstOrThrow({ where: { caseId: dealCase.id, version: 2 } });
    expect(v2.paymentTerms).toBe("ADVANCE_30");
  });

  it("FIXTURE_DESK_CANNOT_COMMIT reaches cannot_commit on the unresolved-domains branch (no supplier coverage exists for the 950-unit shortfall)", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_DESK_CANNOT_COMMIT);
    const gateway = new FakeModelGateway(scriptForCannotCommit());

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-desk-cannot-commit", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("cannot_commit");
    if (result.status === "cannot_commit") {
      // Confirms this hits dealSubmitted.ts's early missingDomains hard-fail branch
      // (reason "unresolved_domains:supplier"), not the later
      // prepareCommitCertificate try/catch branch or a risk_veto.
      expect(result.reason).toBe("unresolved_domains:supplier");
    }
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");
  });
});
