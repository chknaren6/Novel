// src/adapters/supplierAdapter.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { testDb, resetTestDb } from "@/lib/testDb";
import { holdSupplierOption } from "./supplierAdapter";
import { ToolError } from "@/lib/types";
import { deriveIdempotencyKey } from "@/policy/idempotency";

async function seedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({
    data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" },
  });
  await testDb.supplierOption.create({
    data: { supplierId: "VEND-2003", sku: "MAT-10001", availableQuantity: 151, unitCostMinor: 289_137, leadDays: 18, optionTtlSeconds: 900, status: "available" },
  });
  return dealCase;
}

describe("holdSupplierOption", () => {
  beforeEach(resetTestDb);

  it("holds the option when cost and lead time are within policy", async () => {
    const dealCase = await seedCase();
    const reservation = await holdSupplierOption(testDb, {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1",
      supplierId: "VEND-2003", sku: "MAT-10001", quantity: 151,
      maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900,
    });
    expect(reservation.status).toBe("held");
    expect(reservation.quantityMinor).toBe(151);
  });

  it("refuses an option that exceeds the maximum permitted unit cost", async () => {
    const dealCase = await seedCase();
    await expect(
      holdSupplierOption(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", supplierId: "VEND-2003", sku: "MAT-10001", quantity: 151, maxUnitCostMinor: 250_000, maxLeadDays: 21, ttlSeconds: 900 }),
    ).rejects.toThrow(ToolError);
  });

  it("refuses an option marked unavailable", async () => {
    const dealCase = await seedCase();
    await testDb.supplierOption.updateMany({ where: { supplierId: "VEND-2003" }, data: { status: "unavailable" } });
    await expect(
      holdSupplierOption(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", supplierId: "VEND-2003", sku: "MAT-10001", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 }),
    ).rejects.toThrow(ToolError);
  });

  it("does not double-decrement when two callers race with the same idempotency key", async () => {
    const dealCase = await seedCase();
    const args = {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1",
      supplierId: "VEND-2003", sku: "MAT-10001", quantity: 80,
      maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900,
    };

    const [first, second] = await Promise.all([holdSupplierOption(testDb, args), holdSupplierOption(testDb, args)]);
    expect(second.id).toBe(first.id);

    const option = await testDb.supplierOption.findFirstOrThrow({ where: { supplierId: "VEND-2003", sku: "MAT-10001" } });
    expect(option.availableQuantity).toBe(151 - 80); // decremented once, not twice, despite the race
  });

  it("returns the winner's row when the DB rejects a duplicate idempotency key (P2002)", async () => {
    // This branch only fires under true concurrent execution with weaker isolation than
    // SQLite's serialized transactions give us (e.g. a future Postgres swap) — it can't
    // be reached through this app's real DB today, so it's exercised here with a stubbed
    // client instead of the real testDb, per the code review that asked for this.
    const dealCase = await seedCase();
    const args = {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1",
      supplierId: "VEND-2003", sku: "MAT-10001", quantity: 80,
      maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900,
    };
    const idempotencyKey = deriveIdempotencyKey({
      caseId: args.caseId,
      caseVersion: args.caseVersion,
      actionType: "hold_supplier_option",
      resourceRef: `SUPPLIER:${args.supplierId}:${args.sku}`,
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

    const result = await holdSupplierOption(fakeDb, args);

    expect(result).toBe(winnerRow);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
