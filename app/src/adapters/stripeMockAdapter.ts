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
    throw new ToolError(
      "PROVIDER_UNAVAILABLE",
      "Cannot expire a completed test checkout; this build has no idempotent test-mode refund path (04-DATA-AND-STATE-SPEC.md)",
      false,
    );
  }
  return db.stripeCheckoutMock.update({ where: { id: checkoutId }, data: { status: "expired" } });
}
