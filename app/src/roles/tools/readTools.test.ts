import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { toJsonColumn } from "@/lib/json-column";
import { getDealContext, getCustomerCredit, getInventoryPositions, getSupplierOptions, getDeliveryOptions } from "./readTools";

describe("readTools", () => {
  beforeEach(resetTestDb);

  it("getDealContext returns the current active terms version, not a stale one", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const dealCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 2, status: "evaluating", createdBy: "seed" } });
    await testDb.termsVersion.create({ data: { caseId: dealCase.id, version: 1, source: "buyer_request", termsHash: "hash-1", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "NET_60", deliveryDeadline: new Date("2026-09-12") } });
    await testDb.termsVersion.create({ data: { caseId: dealCase.id, version: 2, source: "counteroffer", termsHash: "hash-2", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "ADVANCE_30", deliveryDeadline: new Date("2026-09-12") } });

    const evidence = await getDealContext(testDb, dealCase.id);
    expect(evidence.data.currentTerms.paymentTerms).toBe("ADVANCE_30");
    expect(evidence.evidenceId).toMatch(/^EVID-/);
  });

  it("getCustomerCredit returns the customer's current policy fields", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const customer = await testDb.customer.create({ data: { companyId: company.id, name: "Beacon", creditLimitMinor: 200_000_000, currentExposureMinor: 0, overdueReceivablesMinor: 0, allowedPaymentTerms: toJsonColumn(["ADVANCE_30"]), policyVersion: "credit-policy-v1" } });
    const evidence = await getCustomerCredit(testDb, customer.id);
    expect(evidence.data.creditLimitMinor).toBe(200_000_000);
  });

  it("getInventoryPositions returns every warehouse position for the SKU", async () => {
    await testDb.inventoryPosition.create({ data: { sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 199 } });
    const evidence = await getInventoryPositions(testDb, "MAT-10001");
    expect(evidence.data.positions).toHaveLength(1);
    expect(evidence.data.positions[0]!.availableQuantity).toBe(199);
  });

  it("getSupplierOptions returns every option for the SKU", async () => {
    await testDb.supplierOption.create({ data: { supplierId: "VEND-2003", sku: "MAT-10001", availableQuantity: 151, unitCostMinor: 289_137, leadDays: 18, optionTtlSeconds: 900, status: "available" } });
    const evidence = await getSupplierOptions(testDb, "MAT-10001");
    expect(evidence.data.options).toHaveLength(1);
    expect(evidence.data.options[0]!.supplierId).toBe("VEND-2003");
  });

  it("getDeliveryOptions returns every plan for the destination", async () => {
    await testDb.deliveryPlanOption.create({ data: { planId: "RT-BLR-HYD", originWarehouseId: "WH-BLR", destinationId: "ZONE-SOUTH", deliveredQuantity: 350, deliveryDate: new Date("2026-09-12"), costMinor: 400_000, splitShipment: true, capacityRemaining: 350 } });
    const evidence = await getDeliveryOptions(testDb, "ZONE-SOUTH");
    expect(evidence.data.plans).toHaveLength(1);
    expect(evidence.data.plans[0]!.splitShipment).toBe(true);
  });
});
