import type { RoleRunInput } from "./modelGateway";
import type { FakeRoleScript } from "./fakeGateway";
import type { RoleModelOutput } from "@/lib/types";
import { FIXTURE_DESK_COMMITTED, FIXTURE_DESK_NEGOTIATING, FIXTURE_DESK_CANNOT_COMMIT } from "@/fixtures/deskDemoDefinitions";

// Honest, evidence-based role scripts for the three seeded Commitment Desk demo
// fixtures — extracted here (out of deskDemoDefinitions.test.ts, which imports them
// back) so the exact same test-verified behavior is available to a real, non-test
// gateway (see demoModelGateway.ts) for local preview without a live model call. Every
// line mirrors the real fixture data — see deskDemoDefinitions.ts's own comments for why
// each role's answer is the honest one, not a rigged one.

const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({
  decision: "approve",
  constraints: [],
  reservationRequests: [],
  counterterms: [],
  evidenceRefs,
  explanation,
});

export const scriptForCommitted: FakeRoleScript = (input: RoleRunInput) => {
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

export const scriptForNegotiating: FakeRoleScript = (input: RoleRunInput) => {
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

export const scriptForCannotCommit: FakeRoleScript = (input: RoleRunInput) => {
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

// Keyed by SKU rather than fixtureId: the submit route only has the case's current
// TermsVersion (and therefore its sku) to look up by — it doesn't carry a fixtureId.
// Each desk demo fixture uses a unique SKU (deskDemoDefinitions.ts), so this is an
// unambiguous lookup for exactly the three seeded demo cases.
const SCRIPTS_BY_SKU: Record<string, FakeRoleScript> = {
  [FIXTURE_DESK_COMMITTED.initialTerms.sku]: scriptForCommitted,
  [FIXTURE_DESK_NEGOTIATING.initialTerms.sku]: scriptForNegotiating,
  [FIXTURE_DESK_CANNOT_COMMIT.initialTerms.sku]: scriptForCannotCommit,
};

// Returns null for any sku outside the three seeded demo fixtures — callers must decide
// how to fail (there is no honest script to fall back to for an unknown case).
export function pickDeskDemoScript(sku: string): FakeRoleScript | null {
  return SCRIPTS_BY_SKU[sku] ?? null;
}
