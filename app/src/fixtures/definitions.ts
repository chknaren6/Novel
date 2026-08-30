import type { CaseStatus, PaymentTerms } from "@/lib/types";

export interface FixtureDefinition {
  fixtureId: string;
  companyName: string;
  customer: {
    name: string;
    creditLimitMinor: number;
    currentExposureMinor: number;
    overdueReceivablesMinor: number;
    allowedPaymentTerms: string[];
    policyVersion: string;
  };
  inventory: Array<{ sku: string; warehouseId: string; availableQuantity: number }>;
  supplierOptions: Array<{ supplierId: string; sku: string; availableQuantity: number; unitCostMinor: number; leadDays: number; optionTtlSeconds: number; status: string }>;
  deliveryPlans: Array<{ planId: string; originWarehouseId: string; destinationId: string; deliveredQuantity: number; deliveryDateOffsetDays: number; costMinor: number; splitShipment: boolean; capacityRemaining: number }>;
  initialTerms: { sku: string; quantity: number; totalValueMinor: number; discountBps: number; paymentTerms: PaymentTerms; deliveryDeadlineOffsetDays: number };
  unitCostMinor: number;
  expectedTerminalState: CaseStatus;
}

// Every literal below is sourced from the real ERP extracts in
// /Users/eidoviscontact/Documents/Novel/Data/*.csv (MARA, MARD, MBEW, LFA1, KNKK,
// TVRO) rather than an invented fixture — see the provenance comment on each field.
const CUSTOMER = {
  name: "Beacon Electronics", // this build's display name for KNKK.KUNNR = CUST-1010
  creditLimitMinor: 200_000_000, // Rs 20L — KNKK.KLIMK for CUST-1010 = 2,000,000 rupees; see Task 6/7 for how this makes NET_60 breach and ADVANCE_30 pass
  currentExposureMinor: 74_346_569, // KNKK.SKFOR for CUST-1010 = Rs 7,43,465.69 in paise
  overdueReceivablesMinor: 0,
  allowedPaymentTerms: ["ADVANCE_30", "OTHER_BOUNDED"],
  policyVersion: "credit-policy-v1",
};

const INITIAL_TERMS = {
  sku: "MAT-10001", // MARA.MATNR — "Schneider Electric MCB 32A"
  quantity: 350,
  totalValueMinor: 147_000_000, // 350 x MARA.NETPR (Rs 4,200) x 100 = Rs 14,70,000
  discountBps: 1000,
  paymentTerms: "NET_60" as PaymentTerms,
  deliveryDeadlineOffsetDays: 21,
};

export const FIXTURE_FEASIBLE_AFTER_ADVANCE: FixtureDefinition = {
  fixtureId: "CASE-FEASIBLE-AFTER-ADVANCE",
  companyName: "Acme Distribution — Feasible After Advance",
  customer: CUSTOMER,
  // MARD.LABST for MAT-10001 at plant PL03 (warehouse WH-BLR) = 199 units
  inventory: [{ sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 199 }],
  // LFA1: VEND-2003 = Siemens Ltd India, NETPR=2891.37 -> 289_137 paise, WEBAZ=18 lead
  // days. Real LFA1.AVAIL_CAP is 221; sized here to the 350-199=151 shortfall so the
  // "decrements to zero" assertions elsewhere in this plan stay exact.
  supplierOptions: [{ supplierId: "VEND-2003", sku: "MAT-10001", availableQuantity: 151, unitCostMinor: 289_137, leadDays: 18, optionTtlSeconds: 900, status: "available" }],
  // TVRO: RT-BLR-HYD, carrier BlueDart, TTIME=1 day transit from WH-BLR to ZONE-SOUTH.
  // deliveryDateOffsetDays (20) covers VEND-2003's 18-day lead plus 1-day transit,
  // inside the 21-day deadline.
  deliveryPlans: [{ planId: "RT-BLR-HYD", originWarehouseId: "WH-BLR", destinationId: "ZONE-SOUTH", deliveredQuantity: 350, deliveryDateOffsetDays: 20, costMinor: 400_000, splitShipment: true, capacityRemaining: 350 }],
  initialTerms: INITIAL_TERMS,
  unitCostMinor: 293_312, // MBEW.STPRS for MAT-10001 (Rs 2,933.12)
  expectedTerminalState: "committed",
};

export const FIXTURE_STALE_SUPPLIER_HOLD: FixtureDefinition = {
  ...FIXTURE_FEASIBLE_AFTER_ADVANCE,
  fixtureId: "CASE-STALE-SUPPLIER-HOLD",
  companyName: "Acme Distribution — Stale Supplier Hold",
  expectedTerminalState: "cannot_commit",
};

export const FIXTURE_POST_COMMIT_DISRUPTION: FixtureDefinition = {
  fixtureId: "CASE-POST-COMMIT-DISRUPTION",
  companyName: "Acme Distribution — Post-Commit Disruption",
  customer: CUSTOMER,
  inventory: [{ sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 199 }],
  supplierOptions: [
    { supplierId: "VEND-2003", sku: "MAT-10001", availableQuantity: 151, unitCostMinor: 289_137, leadDays: 18, optionTtlSeconds: 900, status: "available" },
    // LFA1: VEND-2005 = L&T Electrical & Automation, NETPR=2922.42 -> 292_242 paise,
    // WEBAZ=16 lead days. Real AVAIL_CAP is 375; sized here to the same 151-unit
    // shortfall this idle option replaces after VEND-2003 is disrupted.
    { supplierId: "VEND-2005", sku: "MAT-10001", availableQuantity: 151, unitCostMinor: 292_242, leadDays: 16, optionTtlSeconds: 900, status: "available" },
  ],
  deliveryPlans: [
    { planId: "RT-BLR-HYD", originWarehouseId: "WH-BLR", destinationId: "ZONE-SOUTH", deliveredQuantity: 350, deliveryDateOffsetDays: 20, costMinor: 400_000, splitShipment: true, capacityRemaining: 350 },
    // TVRO: RT-BLR-CHE, carrier FedEx, TTIME=1 day transit, VSTEL=WH-BLR (same origin
    // shipping point as RT-BLR-HYD). Idle until the repair workflow (a later task)
    // reserves it for VEND-2005's 16-day lead + 1-day transit, inside the 21-day deadline.
    { planId: "RT-BLR-CHE", originWarehouseId: "WH-BLR", destinationId: "ZONE-SOUTH", deliveredQuantity: 151, deliveryDateOffsetDays: 18, costMinor: 450_000, splitShipment: true, capacityRemaining: 151 },
  ],
  initialTerms: INITIAL_TERMS,
  unitCostMinor: 293_312,
  expectedTerminalState: "repaired",
};

export const ALL_FIXTURES: FixtureDefinition[] = [FIXTURE_FEASIBLE_AFTER_ADVANCE, FIXTURE_STALE_SUPPLIER_HOLD, FIXTURE_POST_COMMIT_DISRUPTION];
