import { Prisma, type PrismaClient } from "@prisma/client";
import { ToolError, type PaymentTerms } from "@/lib/types";
import { createHeldReservation } from "@/reservations/reservationStore";
import { deriveIdempotencyKey } from "@/policy/idempotency";
import { evaluateCreditPolicy } from "@/policy/credit";
import { fromJsonColumn } from "@/lib/json-column";

const CREDIT_POLICY_VERSION = "credit-policy-v1";

export interface HoldCreditEnvelopeInput {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  customerId: string;
  paymentTerms: PaymentTerms;
  exposureMinor: number;
  ttlSeconds: number;
}

// The server recomputes exposure and rejects mismatched policy or insufficient
// capacity (05-TOOL-CONTRACTS.md "hold_credit_envelope") — the model's decision is
// never trusted as the exposure calculation.
export async function holdCreditEnvelope(db: PrismaClient, input: HoldCreditEnvelopeInput) {
  const idempotencyKey = deriveIdempotencyKey({
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "hold_credit_envelope",
    resourceRef: `CUSTOMER:${input.customerId}`,
  });
  const existing = await db.reservation.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  try {
    return await db.$transaction(async (tx) => {
      // Re-check inside the transaction: see inventoryAdapter.ts for why (a concurrent
      // caller with the identical idempotency key may have committed between the
      // pre-check above and acquiring the lock here).
      const alreadyHeld = await tx.reservation.findUnique({ where: { idempotencyKey } });
      if (alreadyHeld) return alreadyHeld;

      const customer = await tx.customer.findUniqueOrThrow({ where: { id: input.customerId } });
      const policyResult = evaluateCreditPolicy({
        creditLimitMinor: customer.creditLimitMinor,
        currentExposureMinor: customer.currentExposureMinor,
        overdueReceivablesMinor: customer.overdueReceivablesMinor,
        // allowedPaymentTerms is stored as a JSON string in this SQLite column (see
        // prisma/schema.prisma and lib/json-column.ts), not a native Json/array type.
        allowedPaymentTerms: fromJsonColumn<string[]>(customer.allowedPaymentTerms),
        paymentTerms: input.paymentTerms,
        newExposureMinor: input.exposureMinor,
      });
      if (!policyResult.passed) {
        throw new ToolError("POLICY_VIOLATION", `Credit policy rejected exposure: ${policyResult.code}`, false, [`CUSTOMER:${input.customerId}`]);
      }

      // Atomic compare-and-swap on the row actually being mutated, not just the read
      // above: two concurrent holds could otherwise both pass the policy check against
      // the same pre-increment snapshot before either commits (e.g. under a future
      // Postgres swap with weaker isolation than SQLite's serialized transactions),
      // pushing combined exposure over the customer's credit limit even though neither
      // transaction's own view looked unsafe. Guarding the update itself means only one
      // of two racing holds can ever land; the loser gets a real error. This guard only
      // needs to cover the arithmetic limit check — the payment-terms and overdue-
      // receivables checks above are boolean, not arithmetic, and are already safely
      // re-evaluated fresh against the row just read.
      const maxExposureAfterHold = customer.creditLimitMinor - input.exposureMinor;
      const updated = await tx.customer.updateMany({
        where: { id: input.customerId, currentExposureMinor: { lte: maxExposureAfterHold } },
        data: { currentExposureMinor: { increment: input.exposureMinor } },
      });
      if (updated.count === 0) {
        throw new ToolError("POLICY_VIOLATION", "Credit policy rejected exposure: CREDIT_LIMIT_EXCEEDED", false, [`CUSTOMER:${input.customerId}`]);
      }

      return createHeldReservation(tx, {
        caseId: input.caseId,
        caseVersion: input.caseVersion,
        termsHash: input.termsHash,
        domain: "credit",
        resourceRef: `CUSTOMER:${input.customerId}`,
        quantityMinor: null,
        limitMinor: input.exposureMinor,
        policyVersion: CREDIT_POLICY_VERSION,
        ttlSeconds: input.ttlSeconds,
        idempotencyKey,
      });
    });
  } catch (error) {
    // Belt-and-suspenders for true concurrent execution under weaker isolation — see
    // inventoryAdapter.ts for the full rationale.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await db.reservation.findUnique({ where: { idempotencyKey } });
      if (winner) return winner;
    }
    throw error;
  }
}

export async function releaseCreditEnvelope(db: PrismaClient, reservationId: string) {
  return db.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (reservation.status !== "held") return reservation;
    // resourceRef is "CUSTOMER:<customerId>" — 2 parts; other domains use 3, don't
    // copy this arity blind. A mismatched split() yields `undefined` fields that
    // Prisma silently drops from `where` instead of erroring.
    const [, customerId] = reservation.resourceRef.split(":");
    await tx.customer.updateMany({ where: { id: customerId }, data: { currentExposureMinor: { decrement: reservation.limitMinor ?? 0 } } });
    return tx.reservation.update({ where: { id: reservationId }, data: { status: "released" } });
  });
}
