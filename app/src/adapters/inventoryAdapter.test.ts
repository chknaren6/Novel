// src/adapters/inventoryAdapter.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { testDb, resetTestDb } from "@/lib/testDb";
import { holdInventory, releaseInventoryHold } from "./inventoryAdapter";
import { ToolError } from "@/lib/types";
import { deriveIdempotencyKey } from "@/policy/idempotency";

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

  it("does not double-restore availability when released twice", async () => {
    const dealCase = await seedCase();
    const reservation = await holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 80, ttlSeconds: 600 });
    await releaseInventoryHold(testDb, reservation.id);
    await releaseInventoryHold(testDb, reservation.id);
    const position = await testDb.inventoryPosition.findFirstOrThrow({ where: { sku: "MAT-10001" } });
    expect(position.availableQuantity).toBe(199);
  });

  it("does not double-decrement when two callers race with the same idempotency key", async () => {
    const dealCase = await seedCase();
    const args = { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 80, ttlSeconds: 600 };

    const [first, second] = await Promise.all([holdInventory(testDb, args), holdInventory(testDb, args)]);
    expect(second.id).toBe(first.id);

    const position = await testDb.inventoryPosition.findFirstOrThrow({ where: { sku: "MAT-10001" } });
    expect(position.availableQuantity).toBe(199 - 80); // decremented once, not twice, despite the race
  });

  it("returns the winner's row when the DB rejects a duplicate idempotency key (P2002)", async () => {
    // This branch only fires under true concurrent execution with weaker isolation than
    // SQLite's serialized transactions give us (e.g. a future Postgres swap) — it can't
    // be reached through this app's real DB today, so it's exercised here with a stubbed
    // client instead of the real testDb, per the code review that asked for this.
    const dealCase = await seedCase();
    const args = { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 80, ttlSeconds: 600 };
    const idempotencyKey = deriveIdempotencyKey({
      caseId: args.caseId,
      caseVersion: args.caseVersion,
      actionType: "hold_inventory",
      resourceRef: `SKU:${args.sku}:${args.warehouseId}`,
    });
    const winnerRow = { id: "winner-reservation-id", idempotencyKey, status: "held" };

    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null) // pre-transaction check: no reservation yet
      .mockResolvedValueOnce(winnerRow); // post-catch refetch: the real winner has since committed

    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`idempotencyKey`)", {
      code: "P2002",
      clientVersion: "test",
    });

    const fakeDb = {
      reservation: { findUnique },
      $transaction: vi.fn().mockRejectedValue(p2002),
    } as unknown as PrismaClient;

    const result = await holdInventory(fakeDb, args);

    expect(result).toBe(winnerRow);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
