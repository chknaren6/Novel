// src/adapters/logisticsAdapter.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { testDb, resetTestDb } from "@/lib/testDb";
import { holdDeliverySlot } from "./logisticsAdapter";
import { ToolError } from "@/lib/types";
import { deriveIdempotencyKey } from "@/policy/idempotency";

async function seedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({
    data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" },
  });
  await testDb.deliveryPlanOption.create({
    data: { planId: "RT-BLR-HYD", originWarehouseId: "WH-BLR", destinationId: "ZONE-SOUTH", deliveredQuantity: 350, deliveryDate: new Date("2026-09-12"), costMinor: 4_00_000, splitShipment: true, capacityRemaining: 350 },
  });
  return dealCase;
}

describe("holdDeliverySlot", () => {
  beforeEach(resetTestDb);

  it("holds capacity on an existing plan", async () => {
    const dealCase = await seedCase();
    const reservation = await holdDeliverySlot(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 });
    expect(reservation.status).toBe("held");

    const plan = await testDb.deliveryPlanOption.findUniqueOrThrow({ where: { planId: "RT-BLR-HYD" } });
    expect(plan.capacityRemaining).toBe(0);
  });

  it("refuses a plan with insufficient remaining capacity", async () => {
    const dealCase = await seedCase();
    await expect(
      holdDeliverySlot(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", planId: "RT-BLR-HYD", quantity: 500, ttlSeconds: 900 }),
    ).rejects.toThrow(ToolError);
  });

  it("refuses an unknown plan id", async () => {
    const dealCase = await seedCase();
    await expect(
      holdDeliverySlot(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", planId: "PLAN-MISSING", quantity: 1, ttlSeconds: 900 }),
    ).rejects.toThrow(ToolError);
  });

  it("does not double-decrement when two callers race with the same idempotency key", async () => {
    const dealCase = await seedCase();
    const args = {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1",
      planId: "RT-BLR-HYD", quantity: 150, ttlSeconds: 900,
    };

    const [first, second] = await Promise.all([holdDeliverySlot(testDb, args), holdDeliverySlot(testDb, args)]);
    expect(second.id).toBe(first.id);

    const plan = await testDb.deliveryPlanOption.findUniqueOrThrow({ where: { planId: "RT-BLR-HYD" } });
    expect(plan.capacityRemaining).toBe(350 - 150); // decremented once, not twice, despite the race
  });

  it("returns the winner's row when the DB rejects a duplicate idempotency key (P2002)", async () => {
    // This branch only fires under true concurrent execution with weaker isolation than
    // SQLite's serialized transactions give us (e.g. a future Postgres swap) — it can't
    // be reached through this app's real DB today, so it's exercised here with a stubbed
    // client instead of the real testDb, per the code review that asked for this.
    const dealCase = await seedCase();
    const args = {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1",
      planId: "RT-BLR-HYD", quantity: 150, ttlSeconds: 900,
    };
    const idempotencyKey = deriveIdempotencyKey({
      caseId: args.caseId,
      caseVersion: args.caseVersion,
      actionType: "hold_delivery_slot",
      resourceRef: `PLAN:${args.planId}`,
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

    const result = await holdDeliverySlot(fakeDb, args);

    expect(result).toBe(winnerRow);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
