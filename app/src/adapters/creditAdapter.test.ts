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

  it("refuses a customerId that does not exist", async () => {
    const { dealCase } = await seedCase();
    await expect(
      holdCreditEnvelope(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: "CUST-DOES-NOT-EXIST", paymentTerms: "ADVANCE_30", exposureMinor: 80_000_000, ttlSeconds: 600 }),
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

  it("rejects via the updateMany guard when a concurrent racer already consumed the headroom", async () => {
    // evaluateCreditPolicy is a plain boolean/arithmetic check against a snapshot read
    // before the transaction's own atomic updateMany guard runs, so a customer row that
    // would pass evaluateCreditPolicy can still fail the updateMany guard if another
    // transaction consumed the headroom in between. Under SQLite's serialized
    // transactions this can't actually happen through the real DB, so — per the code
    // review that asked for this coverage — it's exercised here with a stubbed client
    // that runs the real transaction body against fake `tx` methods instead.
    const idempotencyKey = deriveIdempotencyKey({
      caseId: "CASE-1",
      caseVersion: 1,
      actionType: "hold_credit_envelope",
      resourceRef: "CUSTOMER:CUST-1",
    });
    const customerRow = {
      id: "CUST-1",
      creditLimitMinor: 200_000_000,
      currentExposureMinor: 0,
      overdueReceivablesMinor: 0,
      allowedPaymentTerms: toJsonColumn(["ADVANCE_30"]),
    };

    const fakeTx = {
      reservation: { findUnique: vi.fn().mockResolvedValue(null) },
      customer: {
        findUnique: vi.fn().mockResolvedValue(customerRow),
        // Simulates a concurrent racer having already consumed the headroom between
        // this transaction's read of `customerRow` and its own updateMany guard.
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const fakeDb = {
      reservation: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(fakeTx)),
    } as unknown as PrismaClient;

    const args = {
      caseId: "CASE-1", caseVersion: 1, termsHash: "hash-1",
      customerId: customerRow.id, paymentTerms: "ADVANCE_30" as const, exposureMinor: 80_000_000, ttlSeconds: 600,
    };

    let thrown: unknown;
    try {
      await holdCreditEnvelope(fakeDb, args);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ToolError);
    expect((thrown as ToolError).code).toBe("POLICY_VIOLATION");
    expect((thrown as ToolError).message).toContain("CREDIT_LIMIT_EXCEEDED");
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
