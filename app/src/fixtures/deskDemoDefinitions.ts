import type { FixtureDefinition } from "./definitions";

// Three pending cases for one distributor's Commitment Desk, each engineered from
// unambiguous numbers (not scripted role behavior) so a REAL model reliably reaches a
// different one of the three real evaluateAndRoute outcomes — committed, negotiating,
// and cannot_commit — during a live demo. Unlike definitions.ts's fixtures (built for
// FakeModelGateway-scripted unit tests), these are meant to be seeded once and driven
// through /desk with a real LLM, so "reliably" here means "the correct answer for every
// role is unambiguous from the evidence," not "guaranteed" the way a scripted fake is.
//
// All three share the display name "Aravali Electricals" (the distributor whose ERP
// data this is) but — following seedFixture()'s one-company-per-fixture design — each
// is its own Company/Customer row; a shared display name is all the demo UI needs.
// SKUs/warehouseIds/supplierIds/planIds are unique per fixture and disjoint from every
// other fixture in this codebase (definitions.ts's MAT-10001 family) and from the B2C
// demo seed (prisma/seedB2cDemo.ts's SKU-COPPER-4MM), so seeding all three demo sets
// side by side in one shared dev database never collides.

const COMPANY_NAME = "Aravali Electricals";

// Case 1 — reaches "committed": ADVANCE_30 from the start (no credit breach to
// negotiate), and on-hand inventory alone covers the full request (no shortfall, so
// procurement/supplier coverage is never even required) — the one domain most likely
// to introduce a real model's judgment call (credit) and the one most likely to
// introduce a supplier-negotiation subplot (shortfall) are both removed by the numbers
// themselves, not by scripting the agents.
export const FIXTURE_DESK_COMMITTED: FixtureDefinition = {
  fixtureId: "DESK-DEMO-COMMITTED",
  companyName: COMPANY_NAME,
  customer: {
    name: "Sundara Electricals",
    creditLimitMinor: 100_000_000, // Rs 10L
    currentExposureMinor: 0,
    overdueReceivablesMinor: 0,
    allowedPaymentTerms: ["ADVANCE_30", "NET_60", "OTHER_BOUNDED"],
    policyVersion: "credit-policy-v1",
  },
  inventory: [{ sku: "SKU-DESK-PANEL-100A", warehouseId: "WH-DESK-1", availableQuantity: 100 }], // covers the full 40-unit request alone
  supplierOptions: [{ supplierId: "VEND-DESK-1", sku: "SKU-DESK-PANEL-100A", availableQuantity: 50, unitCostMinor: 300_000, leadDays: 10, optionTtlSeconds: 900, status: "available" }],
  deliveryPlans: [{ planId: "RT-DESK-1", originWarehouseId: "WH-DESK-1", destinationId: "ZONE-SOUTH", deliveredQuantity: 40, deliveryDateOffsetDays: 5, costMinor: 50_000, splitShipment: false, capacityRemaining: 40 }],
  initialTerms: {
    sku: "SKU-DESK-PANEL-100A",
    quantity: 40,
    totalValueMinor: 14_000_000, // 40 x Rs 3,500
    discountBps: 0,
    paymentTerms: "ADVANCE_30",
    deliveryDeadlineOffsetDays: 21,
  },
  unitCostMinor: 280_000,
  expectedTerminalState: "committed",
};

// Case 2 — reaches "negotiating": same credit-breach shape as definitions.ts's proven
// FIXTURE_FEASIBLE_AFTER_ADVANCE numbers (Rs 20L limit, Rs 7.43L existing exposure,
// requesting Rs 14.7L on NET_60 -> Rs 22.13L total, over the limit by a wide, obvious
// margin) — cloned onto a fresh SKU/customer so this demo case is fully isolated from
// definitions.ts's own test fixtures and from the other two cases here.
export const FIXTURE_DESK_NEGOTIATING: FixtureDefinition = {
  fixtureId: "DESK-DEMO-NEGOTIATING",
  companyName: COMPANY_NAME,
  customer: {
    name: "Krishna Hardware",
    creditLimitMinor: 200_000_000, // Rs 20L
    currentExposureMinor: 74_346_569, // Rs 7,43,465.69 already held
    overdueReceivablesMinor: 0,
    allowedPaymentTerms: ["ADVANCE_30", "OTHER_BOUNDED"], // NET_60 not permitted, forcing the ADVANCE_30 counterterm
    policyVersion: "credit-policy-v1",
  },
  inventory: [{ sku: "SKU-DESK-MCB-32A", warehouseId: "WH-DESK-2", availableQuantity: 199 }],
  supplierOptions: [{ supplierId: "VEND-DESK-2", sku: "SKU-DESK-MCB-32A", availableQuantity: 151, unitCostMinor: 289_137, leadDays: 18, optionTtlSeconds: 900, status: "available" }],
  deliveryPlans: [{ planId: "RT-DESK-2", originWarehouseId: "WH-DESK-2", destinationId: "ZONE-SOUTH", deliveredQuantity: 350, deliveryDateOffsetDays: 20, costMinor: 400_000, splitShipment: true, capacityRemaining: 350 }],
  initialTerms: {
    sku: "SKU-DESK-MCB-32A",
    quantity: 350,
    totalValueMinor: 147_000_000, // Rs 14,70,000
    discountBps: 1000,
    paymentTerms: "NET_60",
    deliveryDeadlineOffsetDays: 21,
  },
  unitCostMinor: 293_312,
  expectedTerminalState: "negotiating",
};

// Case 3 — reaches "cannot_commit": a shortfall no supplier option exists to cover at
// all (inventory has 50 of 1000 requested; supplierOptions is empty for this SKU), so
// the request fails on unresolvable supply, not on payment terms — isolates this
// outcome from the credit-negotiation path Case 2 already demonstrates. ADVANCE_30 is
// used here specifically so a credit counterterm can't appear to "fix" this the way it
// does for Case 2.
export const FIXTURE_DESK_CANNOT_COMMIT: FixtureDefinition = {
  fixtureId: "DESK-DEMO-CANNOT-COMMIT",
  companyName: COMPANY_NAME,
  customer: {
    name: "Deepak Steel Traders",
    creditLimitMinor: 100_000_000, // Rs 10L
    currentExposureMinor: 0,
    overdueReceivablesMinor: 0,
    allowedPaymentTerms: ["ADVANCE_30", "NET_60", "OTHER_BOUNDED"],
    policyVersion: "credit-policy-v1",
  },
  inventory: [{ sku: "SKU-DESK-STEEL-ROD", warehouseId: "WH-DESK-3", availableQuantity: 50 }], // 950 short of the 1000 requested
  supplierOptions: [], // no option anywhere to cover the shortfall
  deliveryPlans: [{ planId: "RT-DESK-3", originWarehouseId: "WH-DESK-3", destinationId: "ZONE-SOUTH", deliveredQuantity: 50, deliveryDateOffsetDays: 5, costMinor: 60_000, splitShipment: false, capacityRemaining: 50 }],
  initialTerms: {
    sku: "SKU-DESK-STEEL-ROD",
    quantity: 1000,
    totalValueMinor: 50_000_000, // 1000 x Rs 500
    discountBps: 0,
    paymentTerms: "ADVANCE_30",
    deliveryDeadlineOffsetDays: 21,
  },
  unitCostMinor: 420_000,
  expectedTerminalState: "cannot_commit",
};

export const ALL_DESK_DEMO_FIXTURES: FixtureDefinition[] = [FIXTURE_DESK_COMMITTED, FIXTURE_DESK_NEGOTIATING, FIXTURE_DESK_CANNOT_COMMIT];
