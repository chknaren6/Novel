import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { findSupplierCandidates } from "./check";

describe("findSupplierCandidates", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns only options with enough available quantity, ranked by cost then lead time", async () => {
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-1", availableQuantity: 100, unitCostMinor: 300, leadDays: 10, optionTtlSeconds: 900, status: "available" } });
    await testDb.supplierOption.create({ data: { supplierId: "VEND-B", sku: "SKU-1", availableQuantity: 100, unitCostMinor: 200, leadDays: 15, optionTtlSeconds: 900, status: "available" } });
    await testDb.supplierOption.create({ data: { supplierId: "VEND-C", sku: "SKU-1", availableQuantity: 5, unitCostMinor: 100, leadDays: 5, optionTtlSeconds: 900, status: "available" } });

    const candidates = await findSupplierCandidates(testDb, { sku: "SKU-1", quantity: 50 });
    expect(candidates.map((c) => c.supplierId)).toEqual(["VEND-B", "VEND-A"]);
  });

  it("flags a tier3 option as stale when lastVerifiedAt is more than 20 hours old", async () => {
    const staleDate = new Date(Date.now() - 21 * 60 * 60 * 1000);
    await testDb.supplierOption.create({ data: { supplierId: "VEND-D", sku: "SKU-2", availableQuantity: 100, unitCostMinor: 100, leadDays: 5, optionTtlSeconds: 900, status: "available", freshnessTier: "tier3", lastVerifiedAt: staleDate } });

    const candidates = await findSupplierCandidates(testDb, { sku: "SKU-2", quantity: 10 });
    expect(candidates[0]!.isStale).toBe(true);
  });

  it("does not flag a fresh tier1 option as stale", async () => {
    await testDb.supplierOption.create({ data: { supplierId: "VEND-E", sku: "SKU-3", availableQuantity: 100, unitCostMinor: 100, leadDays: 5, optionTtlSeconds: 900, status: "available", freshnessTier: "tier1", lastVerifiedAt: new Date() } });

    const candidates = await findSupplierCandidates(testDb, { sku: "SKU-3", quantity: 10 });
    expect(candidates[0]!.isStale).toBe(false);
  });

  it("returns an empty array when no supplier can fulfill", async () => {
    const candidates = await findSupplierCandidates(testDb, { sku: "SKU-NONEXISTENT", quantity: 10 });
    expect(candidates).toEqual([]);
  });
});
