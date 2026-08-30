import { Prisma, type PrismaClient } from "@prisma/client";
import { ToolError } from "@/lib/types";
import { createHeldReservation } from "@/reservations/reservationStore";
import { deriveIdempotencyKey } from "@/policy/idempotency";

const LOGISTICS_POLICY_VERSION = "logistics-policy-v1";

export interface HoldDeliverySlotInput {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  planId: string;
  quantity: number;
  ttlSeconds: number;
}

// Verifies the plan references backed origins and current slot capacity
// (05-TOOL-CONTRACTS.md "hold_delivery_slot"). The plan itself (which origins it draws
// from) is computed by the deterministic logistics read tool in a later task, not chosen
// here — this function only reserves capacity on an already-selected plan.
export async function holdDeliverySlot(db: PrismaClient, input: HoldDeliverySlotInput) {
  const idempotencyKey = deriveIdempotencyKey({
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "hold_delivery_slot",
    resourceRef: `PLAN:${input.planId}`,
  });
  const existing = await db.reservation.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  try {
    return await db.$transaction(async (tx) => {
      // Re-check inside the transaction: a concurrent caller with the identical
      // idempotency key may have committed between the pre-check above and acquiring
      // the lock here. If so, stop before touching plan capacity at all — idempotency
      // must cover the decrement side effect, not just the reservation row, or a losing
      // racer would silently double-decrement even though only one row ever gets created.
      const alreadyHeld = await tx.reservation.findUnique({ where: { idempotencyKey } });
      if (alreadyHeld) return alreadyHeld;

      const plan = await tx.deliveryPlanOption.findUnique({ where: { planId: input.planId } });
      if (!plan) {
        throw new ToolError("RESOURCE_UNAVAILABLE", `Delivery plan ${input.planId} not found`, false);
      }
      const decremented = await tx.deliveryPlanOption.updateMany({
        where: { planId: input.planId, capacityRemaining: { gte: input.quantity } },
        data: { capacityRemaining: { decrement: input.quantity } },
      });
      if (decremented.count === 0) {
        throw new ToolError("RESOURCE_UNAVAILABLE", `Delivery plan ${input.planId} cannot cover ${input.quantity} units`, false);
      }
      return createHeldReservation(tx, {
        caseId: input.caseId,
        caseVersion: input.caseVersion,
        termsHash: input.termsHash,
        domain: "logistics",
        resourceRef: `PLAN:${input.planId}`,
        quantityMinor: input.quantity,
        limitMinor: null,
        policyVersion: LOGISTICS_POLICY_VERSION,
        ttlSeconds: input.ttlSeconds,
        idempotencyKey,
      });
    });
  } catch (error) {
    // Belt-and-suspenders for true concurrent execution under weaker isolation (e.g. a
    // future Postgres swap, where two transactions could both pass the re-check above
    // before either commits): if the DB's own unique constraint on idempotencyKey
    // rejects a duplicate create, the whole transaction rolls back — undoing this
    // call's decrement — and we return the winner's row instead of surfacing a raw
    // constraint error to the caller.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await db.reservation.findUnique({ where: { idempotencyKey } });
      if (winner) return winner;
    }
    throw error;
  }
}

export async function releaseDeliverySlot(db: PrismaClient, reservationId: string) {
  return db.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (reservation.status !== "held" && reservation.status !== "committed") return reservation;
    // resourceRef is "PLAN:<planId>" — 2 parts; other domains use 3, don't copy this
    // arity blind. A mismatched split() yields `undefined` fields that Prisma silently
    // drops from `where` instead of erroring, turning a bug into an unintended broad update.
    const [, planId] = reservation.resourceRef.split(":");
    await tx.deliveryPlanOption.updateMany({ where: { planId }, data: { capacityRemaining: { increment: reservation.quantityMinor ?? 0 } } });
    return tx.reservation.update({ where: { id: reservationId }, data: { status: "released" } });
  });
}
