import { Prisma, type PrismaClient } from "@prisma/client";
import { ToolError } from "@/lib/types";
import { createHeldReservation } from "@/reservations/reservationStore";
import { deriveIdempotencyKey } from "@/policy/idempotency";

const SUPPLIER_POLICY_VERSION = "supplier-policy-v1";

export interface HoldSupplierOptionInput {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  supplierId: string;
  sku: string;
  quantity: number;
  maxUnitCostMinor: number;
  maxLeadDays: number;
  ttlSeconds: number;
}

// Refuses an unavailable or changed option (05-TOOL-CONTRACTS.md "hold_supplier_option"):
// re-reads current supplier state rather than trusting whatever the model last saw.
export async function holdSupplierOption(db: PrismaClient, input: HoldSupplierOptionInput) {
  const idempotencyKey = deriveIdempotencyKey({
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "hold_supplier_option",
    resourceRef: `SUPPLIER:${input.supplierId}:${input.sku}`,
  });
  const existing = await db.reservation.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  try {
    return await db.$transaction(async (tx) => {
      // Re-check inside the transaction: a concurrent caller with the identical
      // idempotency key may have committed between the pre-check above and acquiring
      // the lock here. If so, stop before touching supplier availability at all —
      // idempotency must cover the decrement side effect, not just the reservation
      // row, or a losing racer would silently double-decrement even though only one
      // row ever gets created.
      const alreadyHeld = await tx.reservation.findUnique({ where: { idempotencyKey } });
      if (alreadyHeld) return alreadyHeld;

      const option = await tx.supplierOption.findFirst({ where: { supplierId: input.supplierId, sku: input.sku } });
      if (!option || option.status !== "available") {
        throw new ToolError("RESOURCE_UNAVAILABLE", `Supplier ${input.supplierId} option for ${input.sku} is not available`, false);
      }
      if (option.unitCostMinor > input.maxUnitCostMinor || option.leadDays > input.maxLeadDays) {
        throw new ToolError("POLICY_VIOLATION", `Supplier ${input.supplierId} option no longer matches required cost or lead time`, false);
      }
      const decremented = await tx.supplierOption.updateMany({
        where: { id: option.id, availableQuantity: { gte: input.quantity } },
        data: { availableQuantity: { decrement: input.quantity } },
      });
      if (decremented.count === 0) {
        throw new ToolError(
          "RESOURCE_UNAVAILABLE",
          `Only ${option.availableQuantity} of ${input.quantity} units available from ${input.supplierId}`,
          false,
        );
      }
      return createHeldReservation(tx, {
        caseId: input.caseId,
        caseVersion: input.caseVersion,
        termsHash: input.termsHash,
        domain: "supplier",
        resourceRef: `SUPPLIER:${input.supplierId}:${input.sku}`,
        quantityMinor: input.quantity,
        limitMinor: null,
        policyVersion: SUPPLIER_POLICY_VERSION,
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

export async function cancelSupplierOptionHold(db: PrismaClient, reservationId: string) {
  return db.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (reservation.status !== "held" && reservation.status !== "committed") return reservation;
    // resourceRef is "SUPPLIER:<supplierId>:<sku>" — 3 parts. Other domains use fewer;
    // don't copy this arity onto a resourceRef shaped differently, since a mismatched
    // split() yields `undefined` fields that Prisma silently drops from `where` instead
    // of erroring, turning a bug into an unintended broad update.
    const [, supplierId, sku] = reservation.resourceRef.split(":");
    await tx.supplierOption.updateMany({ where: { supplierId, sku }, data: { availableQuantity: { increment: reservation.quantityMinor ?? 0 } } });
    return tx.reservation.update({ where: { id: reservationId }, data: { status: "released" } });
  });
}
