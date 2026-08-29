import { Prisma, type PrismaClient } from "@prisma/client";
import type { ReceiptProvider } from "@/lib/types";
import { ToolError } from "@/lib/types";
import { toJsonColumn } from "@/lib/json-column";

export interface RunReceiptedActionInput<T> {
  caseId: string;
  caseVersion: number;
  actionType: string;
  resourceRef: string;
  provider: ReceiptProvider;
  idempotencyKey: string;
  // Captured and stored on the receipt row, but NOT currently validated against a
  // colliding existing receipt on retry: if a caller ever reuses the same
  // idempotencyKey for a materially different request, this function has no way to
  // detect that mismatch today. Known, documented gap — out of scope for now.
  requestHash: string;
  execute: () => Promise<{ providerRef: string | null; data: T }>;
}

// Thrown when idempotencyKey already resolves to a "pending" receipt: another
// caller is either still mid-execute() for this exact key right now, or a prior
// attempt crashed after creating the receipt but before execute() resolved. Either
// way, calling execute() ourselves here would risk invoking the external effect a
// second time, concurrently with (or in place of) whatever produced the pending
// row. Non-retryable-by-this-function: a higher-level retry policy — not a guess
// made here — decides whether/when to retry.
function pendingReceiptConflict(idempotencyKey: string): ToolError {
  return new ToolError(
    "IDEMPOTENCY_CONFLICT",
    `Receipt for idempotencyKey "${idempotencyKey}" is already pending`,
    false,
  );
}

// Create one action_receipt row before attempting an effect; mark it succeeded or
// failed after the adapter returns; retries reuse the same idempotency key
// (02-TECHNICAL-SPEC.md "Transaction strategy"). Unlike reservations, a receipt is
// created eagerly as `pending` (not skipped on first sight) so a crash between
// "receipt created" and "adapter responded" is visible instead of silently retried
// as if nothing happened.
export async function runReceiptedAction<T>(db: PrismaClient, input: RunReceiptedActionInput<T>) {
  const existing = await db.actionReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.status === "succeeded") return existing;
    // "failed" is safe to fall through and retry execute() below. "pending" is not:
    // see pendingReceiptConflict().
    if (existing.status === "pending") throw pendingReceiptConflict(input.idempotencyKey);
  }

  let receipt = existing;
  if (!receipt) {
    try {
      receipt = await db.actionReceipt.create({
        data: {
          caseId: input.caseId,
          caseVersion: input.caseVersion,
          actionType: input.actionType,
          resourceRef: input.resourceRef,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          status: "pending",
          provider: input.provider,
          responsePayload: toJsonColumn({}),
        },
      });
    } catch (error) {
      // execute() below is an arbitrary external effect (e.g. an HTTP call to a mock
      // ERP/Stripe adapter) that must never run inside a Prisma $transaction — that
      // would hold a DB connection/lock open across network I/O. Without a transaction
      // wrapping execute(), the reservation-adapters' "re-check then proceed" pattern
      // doesn't transport here: if a concurrent duplicate create() loses this race
      // while the winner is still mid-execute() (status "pending"), blindly calling
      // execute() ourselves too would double-invoke the external effect — worse than a
      // clean error. So: a "succeeded" winner is returned (crash-and-retry after the
      // original actually completed); a "pending" winner produces the same clear
      // conflict error as the pre-check above; anything else (e.g. a non-P2002 error)
      // is rethrown for the caller to handle.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await db.actionReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (winner?.status === "succeeded") return winner;
        if (winner?.status === "pending") throw pendingReceiptConflict(input.idempotencyKey);
      }
      throw error;
    }
  }

  try {
    const result = await input.execute();
    return db.actionReceipt.update({
      where: { id: receipt.id },
      data: {
        status: "succeeded",
        providerReceiptRef: result.providerRef,
        responsePayload: toJsonColumn(result.data),
        attemptCount: { increment: existing ? 1 : 0 },
      },
    });
  } catch (error) {
    await db.actionReceipt.update({
      where: { id: receipt.id },
      data: { status: "failed", attemptCount: { increment: existing ? 1 : 0 } },
    });
    throw error;
  }
}
