import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ToolError } from "@/lib/types";

export interface CreateDepositCheckoutInput {
  caseId: string;
  certificateId: string;
  amountMinor: number;
}

// Mock Stripe test-mode checkout: no real credentials were provided (locked scope
// decision), so this simulates the session shape a real `stripe.checkout.sessions.create`
// call would return. Swapping to real Stripe later means replacing this file only.
export async function createDepositCheckout(db: PrismaClient, input: CreateDepositCheckoutInput) {
  return db.stripeCheckoutMock.create({
    data: {
      caseId: input.caseId,
      certificateId: input.certificateId,
      amountMinor: input.amountMinor,
      status: "created",
      stripeSessionId: `cs_test_mock_${randomUUID()}`,
    },
  });
}

export async function expireCheckout(db: PrismaClient, checkoutId: string) {
  const checkout = await db.stripeCheckoutMock.findUniqueOrThrow({ where: { id: checkoutId } });
  if (checkout.status === "expired") return checkout;
  if (checkout.status === "completed") {
    // This is a state-transition conflict, not a provider outage — POLICY_VIOLATION is
    // the closest fit in the current error taxonomy.
    throw new ToolError(
      "POLICY_VIOLATION",
      "Cannot expire a completed test checkout; this build has no idempotent test-mode refund path (04-DATA-AND-STATE-SPEC.md)",
      false,
    );
  }
  // Atomic guarded update, mirroring inventoryAdapter.ts's compare-and-swap pattern:
  // the plain read above is not the source of truth for the write. If the checkout
  // transitions to "completed" between the read and this update (a real commit
  // workflow racing this call), the guard stops the update from silently clobbering
  // "completed" back to "expired".
  const updated = await db.stripeCheckoutMock.updateMany({
    where: { id: checkoutId, status: { not: "completed" } },
    data: { status: "expired" },
  });
  if (updated.count === 0) {
    // Lost the race: the row flipped to "completed" between our read above and this
    // write. Surface that as the same conflict we'd have thrown had we seen it first.
    throw new ToolError(
      "POLICY_VIOLATION",
      `Cannot expire checkout ${checkoutId}: it was completed concurrently`,
      false,
    );
  }
  return db.stripeCheckoutMock.findUniqueOrThrow({ where: { id: checkoutId } });
}
