import type { RoleId } from "@/lib/types";

// A canonical expected trajectory for one fixture: the ordered stages evaluateAndRoute
// (src/workflow/dealSubmitted.ts) and, where applicable, runSupplierDisruption
// (src/workflow/supplierDisrupted.ts) actually run, and — for any role in a stage that
// is expected to issue a mutation tool call — the exact tool name plus the ONE
// resource-identifying argument to check (e.g. supplierId/warehouseId/planId). Policy
// parameters like ttlSeconds/quantity/maxUnitCostMinor/maxLeadDays/exposureMinor are
// deliberately excluded from the match — they are not identity.
export interface CanonicalStage {
  roles: RoleId[];
  expectedToolCalls: Partial<Record<RoleId, { name: string; resourceArgKey: string; resourceArgValue: unknown }>>;
}

export interface CanonicalTrajectory {
  fixtureId: string;
  stages: CanonicalStage[];
}

// Every fixture's flow starts NET_60 (see src/fixtures/definitions.ts's shared
// INITIAL_TERMS): Finance always counters on the first evaluateAndRoute pass with no
// tool call (a "counter" decision short-circuits straight to negotiating, per
// dealSubmitted.ts — no reservation is ever held on this pass), so this initial
// "negotiating" stage set is identical and reused across all three fixtures.
const NEGOTIATING_STAGES: CanonicalStage[] = [
  { roles: ["sales"], expectedToolCalls: {} },
  // Finance is deliberately omitted from expectedToolCalls even where it approves
  // and calls hold_credit_envelope elsewhere in this file: hold_credit_envelope's only
  // args are exposureMinor and ttlSeconds, both policy parameters, not a
  // resource-identifying value (credit is already scoped to the one customer on the
  // case via context, unlike a supplier/warehouse/delivery-plan choice) — there is no
  // honest identity argument to assert on for this tool.
  { roles: ["finance", "inventory", "procurement", "logistics"], expectedToolCalls: {} },
  { roles: ["risk"], expectedToolCalls: {} },
];

// After the buyer accepts the 30% advance counteroffer, runBuyerResponse re-runs
// evaluateAndRoute at ADVANCE_30: Finance now approves and holds credit (no
// identity arg, see above), Inventory holds its partial 199 units at WH-BLR,
// Procurement holds the 151-unit shortfall from VEND-2003, Logistics holds the
// RT-BLR-HYD split-shipment plan, and Risk approves — see
// src/workflow/dealSubmitted.test.ts / buyerResponse.test.ts / staleSupplierHold.test.ts
// for the identical scripted shapes this mirrors.
const ADVANCE_EVALUATION_STAGES: CanonicalStage[] = [
  { roles: ["sales"], expectedToolCalls: {} },
  {
    roles: ["finance", "inventory", "procurement", "logistics"],
    expectedToolCalls: {
      inventory: { name: "hold_inventory", resourceArgKey: "warehouseId", resourceArgValue: "WH-BLR" },
      procurement: { name: "hold_supplier_option", resourceArgKey: "supplierId", resourceArgValue: "VEND-2003" },
      logistics: { name: "hold_delivery_slot", resourceArgKey: "planId", resourceArgValue: "RT-BLR-HYD" },
    },
  },
  { roles: ["risk"], expectedToolCalls: {} },
];

// CASE-FEASIBLE-AFTER-ADVANCE: negotiating stages, then the ADVANCE_30 re-evaluation
// stages that succeed and lead to prepared -> committed.
export const TRAJECTORY_FEASIBLE_AFTER_ADVANCE: CanonicalTrajectory = {
  fixtureId: "CASE-FEASIBLE-AFTER-ADVANCE",
  stages: [...NEGOTIATING_STAGES, ...ADVANCE_EVALUATION_STAGES],
};

// CASE-STALE-SUPPLIER-HOLD: identical role/tool trajectory to the feasible case up
// through the ADVANCE_30 re-evaluation stages (Procurement still calls
// hold_supplier_option with supplierId VEND-2003 — its staleness is a ttlSeconds:0
// policy parameter, invisible to trajectory/tool-call matching by design, and is only
// caught later by prepareCommitCertificate's expiry check, not by anything this
// canonical trajectory records).
export const TRAJECTORY_STALE_SUPPLIER_HOLD: CanonicalTrajectory = {
  fixtureId: "CASE-STALE-SUPPLIER-HOLD",
  stages: [...NEGOTIATING_STAGES, ...ADVANCE_EVALUATION_STAGES],
};

// CASE-POST-COMMIT-DISRUPTION: the same negotiating + ADVANCE_30 evaluation stages as
// above (which lead to committed), followed by runSupplierDisruption's repair round —
// Procurement and Logistics rerun CONCURRENTLY (Promise.all in supplierDisrupted.ts),
// then Risk alone; Finance/Inventory are NOT rerun (their original reservations are
// reused untouched). Procurement now holds VEND-2005 (replacing disrupted VEND-2003)
// and Logistics holds the RT-BLR-CHE repair plan for the 151-unit shortfall — see
// src/workflow/supplierDisrupted.test.ts's `script`.
export const TRAJECTORY_POST_COMMIT_DISRUPTION: CanonicalTrajectory = {
  fixtureId: "CASE-POST-COMMIT-DISRUPTION",
  stages: [
    ...NEGOTIATING_STAGES,
    ...ADVANCE_EVALUATION_STAGES,
    {
      roles: ["procurement", "logistics"],
      expectedToolCalls: {
        procurement: { name: "hold_supplier_option", resourceArgKey: "supplierId", resourceArgValue: "VEND-2005" },
        logistics: { name: "hold_delivery_slot", resourceArgKey: "planId", resourceArgValue: "RT-BLR-CHE" },
      },
    },
    { roles: ["risk"], expectedToolCalls: {} },
  ],
};

export const ALL_CANONICAL_TRAJECTORIES: CanonicalTrajectory[] = [
  TRAJECTORY_FEASIBLE_AFTER_ADVANCE,
  TRAJECTORY_STALE_SUPPLIER_HOLD,
  TRAJECTORY_POST_COMMIT_DISRUPTION,
];
