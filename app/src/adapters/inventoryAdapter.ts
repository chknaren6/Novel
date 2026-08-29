import type { PrismaClient } from "@prisma/client";
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

  return db.$transaction(async (tx) => {
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
