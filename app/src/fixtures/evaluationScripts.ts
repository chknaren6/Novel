import type { RoleRunInput } from "@/gateway/modelGateway";
import type { FakeRoleScript } from "@/gateway/fakeGateway";
import type { RoleModelOutput } from "@/lib/types";

const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({
  decision: "approve",
  constraints: [],
  reservationRequests: [],
  counterterms: [],
  evidenceRefs,
  explanation,
});

export interface BuildEvaluationScriptOptions {
  // TTL (in seconds) Procurement requests when holding VEND-2003's supplier option.
  // Defaults to 900 (15 minutes), a normal, unexpired hold. Pass 0 specifically for
  // CASE-STALE-SUPPLIER-HOLD to reproduce its deliberate staleness — a real LLM cannot
  // be scripted to request ttlSeconds: 0, so this harness intentionally drives the
  // deterministic FakeModelGateway (not a live gateway) for this fixture. This is a
  // known, pre-existing, and correct limitation of the harness, not a shortcoming to
  // fix: see src/workflow/staleSupplierHold.test.ts, which exercises the identical
  // scripted shape this generalizes.
  supplierTtlSeconds?: number;
}

// A deterministic scripted FakeRoleScript generalizing the exact role behavior already
// proven correct by this codebase's own tests (dealSubmitted.test.ts,
// buyerResponse.test.ts, supplierDisrupted.test.ts, staleSupplierHold.test.ts), so it
// deterministically drives all three fixtures through their real, already-proven
// execution paths:
//
// 1. Every fixture's initial terms are NET_60 (see fixtures/definitions.ts's shared
//    INITIAL_TERMS) — Finance always counters with no tool call on the first pass,
//    routing the case to "negotiating" with a 30% advance counteroffer.
// 2. Once the buyer accepts (ADVANCE_30), Finance approves and holds a credit
//    envelope; Inventory holds its partial 199-unit position at WH-BLR (a "counter"
//    decision, since it's short of the full 350); Procurement holds the 151-unit
//    shortfall from VEND-2003 (at `supplierTtlSeconds`); Logistics holds the
//    RT-BLR-HYD split-shipment plan; Risk approves — routing to "prepared" and then
//    (via runCommit) "committed" (except for the stale-hold fixture, whose
//    prepareCommitCertificate call fails closed on the expired hold).
// 3. If a supplier-disruption repair round runs (contextSummary carries
//    `excludedSupplierId` for Procurement, or a requestedQuantity of 151 for
//    Logistics — the two ways runSupplierDisruption's re-evaluation is distinguishable
//    from the initial evaluation, since RoleRunInput carries no caseVersion),
//    Procurement holds VEND-2005 in place of the disrupted VEND-2003, and Logistics
//    holds the RT-BLR-CHE repair plan.
//
// Every branch cites at least one non-empty evidenceRefs entry, so a scripted role
// output is never mistaken for a hallucination by metrics.ts's hallucinationRate.
export function buildEvaluationScript(options?: BuildEvaluationScriptOptions): FakeRoleScript {
  const supplierTtlSeconds = options?.supplierTtlSeconds ?? 900;

  return (input: RoleRunInput) => {
    switch (input.role) {
      case "sales":
        return { toolCall: null, output: APPROVE(["EVID-SALES"], "Normalized buyer request.") };

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
              explanation: "Net-60 breaches policy; 30% advance would pass.",
            },
          };
        }
        return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 102_900_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "Advance payment keeps exposure within policy.") };

      case "inventory":
        return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Only 199 of 350 units currently available."), decision: "counter" as const } };

      case "procurement":
        if (input.contextSummary.excludedSupplierId) {
          return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2005", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2005 replaces the disrupted option.") };
        }
        return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2003", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: supplierTtlSeconds } }, output: APPROVE(["EVID-PROC"], "VEND-2003 option covers the shortfall.") };

      case "logistics":
        if (input.contextSummary.requestedQuantity === 151) {
          return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-CHE", quantity: 151, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Repair plan covers the replacement supplier's leg.") };
        }
        return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the 21-day deadline.") };

      case "risk":
      default:
        return { toolCall: null, output: APPROVE(["EVID-RISK"], "Evidence is fresh and coverage matches decisions.") };
    }
  };
}
