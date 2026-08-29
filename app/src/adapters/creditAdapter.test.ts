// src/adapters/creditAdapter.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { testDb, resetTestDb } from "@/lib/testDb";
import { holdCreditEnvelope, releaseCreditEnvelope } from "./creditAdapter";
import { ToolError } from "@/lib/types";
import { deriveIdempotencyKey } from "@/policy/idempotency";
import { toJsonColumn } from "@/lib/json-column";

async function seedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({
    data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" },
  });
  const customer = await testDb.customer.create({
    data: {
      companyId: company.id,
      name: "Beacon Electronics",
      creditLimitMinor: 200_000_000,
      currentExposureMinor: 0,
      overdueReceivablesMinor: 0,
      allowedPaymentTerms: toJsonColumn(["ADVANCE_30", "OTHER_BOUNDED"]),
      policyVersion: "credit-policy-v1",
    },
  });
  return { dealCase, customer };
}

describe("holdCreditEnvelope", () => {
  beforeEach(resetTestDb);

  it("holds the envelope and raises current exposure when within policy", async () => {
    const { dealCase, customer } = await seedCase();
    const reservation = await holdCreditEnvelope(testDb, {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1",
      customerId: customer.id, paymentTerms: "ADVANCE_30", exposureMinor: 102_900_000, ttlSeconds: 600,
    });
    expect(reservation.status).toBe("held");
    expect(reservation.limitMinor).toBe(102_900_000);

    const reloaded = await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(reloaded.currentExposureMinor).toBe(102_900_000);
  });

  it("refuses NET_60 when it is outside the customer's allowed payment terms", async () => {
    const { dealCase, customer } = await seedCase();
    await expect(
      holdCreditEnvelope(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "NET_60", exposureMinor: 147_000_000, ttlSeconds: 600 }),
    ).rejects.toThrow(ToolError);
  });

  it("refuses exposure that would exceed the credit limit", async () => {
    const { dealCase, customer } = await seedCase();
    await expect(
      holdCreditEnvelope(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "ADVANCE_30", exposureMinor: 250_000_000, ttlSeconds: 600 }),
    ).rejects.toThrow(ToolError);
  });

  it("is idempotent under retry with the same case, version, and resource", async () => {
    const { dealCase, customer } = await seedCase();
    const args = { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "ADVANCE_30" as const, exposureMinor: 80_000_000, ttlSeconds: 600 };
    const first = await holdCreditEnvelope(testDb, args);
    const second = await holdCreditEnvelope(testDb, args);
    expect(second.id).toBe(first.id);

    const reloaded = await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(reloaded.currentExposureMinor).toBe(80_000_000); // incremented once, not twice
  });

  it("does not double-increment exposure when two callers race with the same idempotency key", async () => {
    const { dealCase, customer } = await seedCase();
    const args = { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "ADVANCE_30" as const, exposureMinor: 80_000_000, ttlSeconds: 600 };

    const [first, second] = await Promise.all([holdCreditEnvelope(testDb, args), holdCreditEnvelope(testDb, args)]);
    expect(second.id).toBe(first.id);

    const reloaded = await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(reloaded.currentExposureMinor).toBe(80_000_000); // incremented once, not twice, despite the race
  });

  it("returns the winner's row when the DB rejects a duplicate idempotency key (P2002)", async () => {
    // This branch only fires under true concurrent execution with weaker isolation than
    // SQLite's serialized transactions give us (e.g. a future Postgres swap) — it can't
    // be reached through this app's real DB today, so it's exercised here with a stubbed
    // client instead of the real testDb, per the code review that asked for this.
    const { dealCase, customer } = await seedCase();
    const args = { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "ADVANCE_30" as const, exposureMinor: 80_000_000, ttlSeconds: 600 };
    const idempotencyKey = deriveIdempotencyKey({
      caseId: args.caseId,
      caseVersion: args.caseVersion,
      actionType: "hold_credit_envelope",
      resourceRef: `CUSTOMER:${args.customerId}`,
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

    const result = await holdCreditEnvelope(fakeDb, args);

    expect(result).toBe(winnerRow);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("releases a held reservation and restores exposure", async () => {
    const { dealCase, customer } = await seedCase();
    const reservation = await holdCreditEnvelope(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "ADVANCE_30", exposureMinor: 80_000_000, ttlSeconds: 600 });
    await releaseCreditEnvelope(testDb, reservation.id);
    const reloaded = await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(reloaded.currentExposureMinor).toBe(0);
  });

  it("does not double-restore exposure when released twice", async () => {
    const { dealCase, customer } = await seedCase();
    const reservation = await holdCreditEnvelope(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "ADVANCE_30", exposureMinor: 80_000_000, ttlSeconds: 600 });
    await releaseCreditEnvelope(testDb, reservation.id);
    await releaseCreditEnvelope(testDb, reservation.id);
    const reloaded = await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(reloaded.currentExposureMinor).toBe(0);
  });
});
