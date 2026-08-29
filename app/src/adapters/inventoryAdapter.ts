import { Prisma, type PrismaClient } from "@prisma/client";
import { ToolError } from "@/lib/types";
import { createHeldReservation } from "@/reservations/reservationStore";
import { deriveIdempotencyKey } from "@/policy/idempotency";

const INVENTORY_POLICY_VERSION = "inventory-policy-v1";

export interface HoldInventoryInput {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  sku: string;
  warehouseId: string;
  quantity: number;
  ttlSeconds: number;
}

// Atomic availability check and decrement-to-held transition
// (02-TECHNICAL-SPEC.md "Reservation coordinator").
export async function holdInventory(db: PrismaClient, input: HoldInventoryInput) {
  const idempotencyKey = deriveIdempotencyKey({
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "hold_inventory",
    resourceRef: `SKU:${input.sku}:${input.warehouseId}`,
  });
  const existing = await db.reservation.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  try {
    return await db.$transaction(async (tx) => {
      // Re-check inside the transaction: a concurrent caller with the identical
      // idempotency key may have committed between the pre-check above and acquiring
      // the lock here. If so, stop before touching inventory at all — idempotency must
      // cover the decrement side effect, not just the reservation row, or a losing
      // racer would silently double-decrement even though only one row ever gets
      // created.
      const alreadyHeld = await tx.reservation.findUnique({ where: { idempotencyKey } });
      if (alreadyHeld) return alreadyHeld;

      const position = await tx.inventoryPosition.findFirst({ where: { sku: input.sku, warehouseId: input.warehouseId } });
      if (!position) {
        throw new ToolError("RESOURCE_UNAVAILABLE", `No inventory position for ${input.sku} at ${input.warehouseId}`, false);
      }
      const decremented = await tx.inventoryPosition.updateMany({
        where: { id: position.id, availableQuantity: { gte: input.quantity } },
        data: { availableQuantity: { decrement: input.quantity } },
      });
      if (decremented.count === 0) {
        throw new ToolError(
          "RESOURCE_UNAVAILABLE",
          `Only ${position.availableQuantity} of ${input.quantity} units available for ${input.sku}`,
          false,
        );
      }
      return createHeldReservation(tx, {
        caseId: input.caseId,
        caseVersion: input.caseVersion,
        termsHash: input.termsHash,
        domain: "inventory",
        resourceRef: `SKU:${input.sku}:${input.warehouseId}`,
        quantityMinor: input.quantity,
        limitMinor: null,
        policyVersion: INVENTORY_POLICY_VERSION,
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

export async function releaseInventoryHold(db: PrismaClient, reservationId: string) {
  return db.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (reservation.status !== "held") return reservation;
    const [, sku, warehouseId] = reservation.resourceRef.split(":");
    await tx.inventoryPosition.updateMany({
      where: { sku, warehouseId },
      data: { availableQuantity: { increment: reservation.quantityMinor ?? 0 } },
    });
    return tx.reservation.update({ where: { id: reservationId }, data: { status: "released" } });
  });
}
