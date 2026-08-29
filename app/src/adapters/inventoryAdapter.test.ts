// src/adapters/inventoryAdapter.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { holdInventory, releaseInventoryHold } from "./inventoryAdapter";
import { ToolError } from "@/lib/types";

async function seedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({
    data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" },
  });
  await testDb.inventoryPosition.create({ data: { sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 199 } });
  return dealCase;
}

describe("holdInventory", () => {
  beforeEach(resetTestDb);

  it("decrements availability and creates a held reservation", async () => {
    const dealCase = await seedCase();
    const reservation = await holdInventory(testDb, {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1",
      sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 600,
    });
    expect(reservation.status).toBe("held");
    expect(reservation.quantityMinor).toBe(199);

    const position = await testDb.inventoryPosition.findFirstOrThrow({ where: { sku: "MAT-10001" } });
    expect(position.availableQuantity).toBe(0);
  });

  it("refuses to hold more than is available", async () => {
    const dealCase = await seedCase();
    await expect(
      holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 350, ttlSeconds: 600 }),
    ).rejects.toThrow(ToolError);
  });

  it("is idempotent under retry with the same case, version, and resource", async () => {
    const dealCase = await seedCase();
    const first = await holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 80, ttlSeconds: 600 });
    const second = await holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 80, ttlSeconds: 600 });
    expect(second.id).toBe(first.id);

    const position = await testDb.inventoryPosition.findFirstOrThrow({ where: { sku: "MAT-10001" } });
    expect(position.availableQuantity).toBe(199 - 80); // decremented once, not twice
  });

  it("releases a held reservation and restores availability", async () => {
    const dealCase = await seedCase();
    const reservation = await holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 80, ttlSeconds: 600 });
    await releaseInventoryHold(testDb, reservation.id);
    const position = await testDb.inventoryPosition.findFirstOrThrow({ where: { sku: "MAT-10001" } });
    expect(position.availableQuantity).toBe(199);
  });
});
