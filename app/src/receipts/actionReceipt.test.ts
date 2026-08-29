// src/receipts/actionReceipt.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runReceiptedAction } from "./actionReceipt";
import { ToolError } from "@/lib/types";

async function seedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  return testDb.dealCase.create({ data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "committing", createdBy: "seed" } });
}

describe("runReceiptedAction", () => {
  beforeEach(resetTestDb);

  it("records a succeeded receipt and returns the adapter's data", async () => {
    const dealCase = await seedCase();
    const result = await runReceiptedAction(testDb, {
      caseId: dealCase.id, caseVersion: 1, actionType: "sandbox_order.create", resourceRef: "ORDER:1", provider: "sandbox_erp",
      idempotencyKey: "key-1", requestHash: "req-1",
      execute: async () => ({ providerRef: "SO-1001", data: { orderId: "SO-1001" } }),
    });
    expect(result.status).toBe("succeeded");

    const receipt = await testDb.actionReceipt.findUniqueOrThrow({ where: { idempotencyKey: "key-1" } });
    expect(receipt.status).toBe("succeeded");
    expect(receipt.attemptCount).toBe(1);
  });

  it("records a failed receipt when the adapter throws, and does not swallow the error", async () => {
    const dealCase = await seedCase();
    await expect(
      runReceiptedAction(testDb, {
        caseId: dealCase.id, caseVersion: 1, actionType: "sandbox_order.create", resourceRef: "ORDER:2", provider: "sandbox_erp",
        idempotencyKey: "key-2", requestHash: "req-2",
        execute: async () => { throw new Error("adapter unavailable"); },
      }),
    ).rejects.toThrow("adapter unavailable");

    const receipt = await testDb.actionReceipt.findUniqueOrThrow({ where: { idempotencyKey: "key-2" } });
    expect(receipt.status).toBe("failed");
  });

  it("returns the existing receipt on retry instead of re-running the adapter", async () => {
    const dealCase = await seedCase();
    let calls = 0;
    const input = {
      caseId: dealCase.id, caseVersion: 1, actionType: "sandbox_order.create", resourceRef: "ORDER:3", provider: "sandbox_erp" as const,
      idempotencyKey: "key-3", requestHash: "req-3",
      execute: async () => { calls += 1; return { providerRef: "SO-1003", data: { orderId: "SO-1003" } }; },
    };
    await runReceiptedAction(testDb, input);
    await runReceiptedAction(testDb, input);
    expect(calls).toBe(1);
  });

  it("does not double-invoke execute when two callers race with the same idempotency key", async () => {
    // Real (non-mocked) concurrency: caller A creates the "pending" receipt and is
    // mid-execute() when caller B retries with the identical idempotencyKey. Before
    // the fix, B's findUnique would see A's row, treat "pending" as safe to fall
    // through, and call execute() a second time concurrently with A.
    const dealCase = await seedCase();
    let calls = 0;
    const input = {
      caseId: dealCase.id, caseVersion: 1, actionType: "sandbox_order.create", resourceRef: "ORDER:6", provider: "sandbox_erp" as const,
      idempotencyKey: "key-race",
      requestHash: "req-6",
      execute: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 50));
        return { providerRef: "SO-1006", data: { orderId: "SO-1006" } };
      },
    };

    const [first, second] = await Promise.allSettled([
      runReceiptedAction(testDb, input),
      runReceiptedAction(testDb, input),
    ]);

    const settled = [first, second];
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof runReceiptedAction>>>).value.status).toBe("succeeded");
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ToolError);
    expect(((rejected[0] as PromiseRejectedResult).reason as ToolError).code).toBe("IDEMPOTENCY_CONFLICT");
    expect(calls).toBe(1);
  });

  it("returns the winning succeeded receipt on a P2002 collision, without calling execute", async () => {
    // Simulates a crash-and-retry race: another caller's create() for the same
    // idempotencyKey has already committed and succeeded by the time our create()
    // hits the unique constraint. We must not invoke the external effect ourselves.
    const idempotencyKey = "key-p2002-succeeded";
    const winnerRow = { id: "winner-id", idempotencyKey, status: "succeeded" };
    const execute = vi.fn().mockResolvedValue({ providerRef: "SO-X", data: {} });

    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null) // pre-check: no receipt yet
      .mockResolvedValueOnce(winnerRow); // post-catch refetch: winner has since succeeded

    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`idempotencyKey`)", {
      code: "P2002",
      clientVersion: "test",
    });

    const fakeDb = {
      actionReceipt: {
        findUnique,
        create: vi.fn().mockRejectedValue(p2002),
        update: vi.fn(),
      },
    } as unknown as PrismaClient;

    const result = await runReceiptedAction(fakeDb, {
      caseId: "case-1", caseVersion: 1, actionType: "sandbox_order.create", resourceRef: "ORDER:4", provider: "sandbox_erp",
      idempotencyKey, requestHash: "req-4",
      execute,
    });

    expect(result).toBe(winnerRow);
    expect(execute).not.toHaveBeenCalled();
  });

  it("throws a pending-conflict error (not the raw P2002) when the winning receipt is still pending", async () => {
    // Another caller is still mid-execute() for the same idempotencyKey. We must not
    // proceed to call execute() ourselves in parallel with that in-flight attempt.
    const idempotencyKey = "key-p2002-pending";
    const winnerRow = { id: "winner-id", idempotencyKey, status: "pending" };
    const execute = vi.fn().mockResolvedValue({ providerRef: "SO-X", data: {} });

    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null) // pre-check: no receipt yet
      .mockResolvedValueOnce(winnerRow); // post-catch refetch: winner is still pending

    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`idempotencyKey`)", {
      code: "P2002",
      clientVersion: "test",
    });

    const fakeDb = {
      actionReceipt: {
        findUnique,
        create: vi.fn().mockRejectedValue(p2002),
        update: vi.fn(),
      },
    } as unknown as PrismaClient;

    const promise = runReceiptedAction(fakeDb, {
      caseId: "case-1", caseVersion: 1, actionType: "sandbox_order.create", resourceRef: "ORDER:5", provider: "sandbox_erp",
      idempotencyKey, requestHash: "req-5",
      execute,
    });

    await expect(promise).rejects.toBeInstanceOf(ToolError);
    await expect(promise).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(execute).not.toHaveBeenCalled();
  });
});
