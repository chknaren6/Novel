import type { PrismaClient } from "@prisma/client";
import type { PaymentTerms } from "@/lib/types";
import { transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "../events";
import { calculateDealEconomics } from "@/policy/economics";
import { commitOrder, abortCommitment } from "@/reservations/coordinator";
import { fromJsonColumn } from "@/lib/json-column";

export interface RunB2CCommitInput {
  caseId: string;
  traceId: string;
}

// B2C-flavored mirror of runCommit (src/workflow/commit.ts) — identical transition
// sequence and error handling, but sources its economics from the terms row itself
// (confirmedBuyPriceMinor/advanceBps, negotiated per order) rather than B2B's
// SKU_UNIT_COST_MINOR/ADVANCE_DEPOSIT_BPS constants.
export async function runB2CCommit(db: PrismaClient, input: RunB2CCommitInput) {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: input.caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId: input.caseId, version: dealCase.activeTermsVersion } });
  const certificate = await db.commitCertificate.findFirstOrThrow({ where: { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion, status: "valid" } });

  // Snapshot each reservation's status before commitOrder runs, so a failure partway
  // through commitOrder's per-reservation commit loop can be told apart from one that
  // preceded that loop entirely (see the catch block below).
  const certificateReservationIds = fromJsonColumn<string[]>(certificate.reservationIds);
  const preAttemptReservationStatus = new Map(
    (await db.reservation.findMany({ where: { id: { in: certificateReservationIds } } })).map((r) => [r.id, r.status]),
  );

  if (terms.confirmedBuyPriceMinor == null || terms.advanceBps == null) {
    throw new Error(`runB2CCommit: terms ${terms.id} is missing negotiated economics (confirmedBuyPriceMinor/advanceBps) — a B2C case should never reach commit without these set`);
  }
  const economics = calculateDealEconomics({
    totalValueMinor: terms.totalValueMinor,
    discountBps: terms.discountBps,
    quantity: terms.quantity,
    unitCostMinor: terms.confirmedBuyPriceMinor,
    paymentTerms: terms.paymentTerms as PaymentTerms,
    depositBps: terms.advanceBps,
  });

  await transitionCase(db, { caseId: input.caseId, expectedStatus: "prepared", expectedVersion: dealCase.activeTermsVersion, nextStatus: "committing" });
  await emitCaseEvent(db, { caseId: input.caseId, eventType: "commit.requested", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { certificateId: certificate.id }, traceId: input.traceId });

  try {
    const receipts = await commitOrder(db, {
      caseId: input.caseId,
      caseVersion: dealCase.activeTermsVersion,
      certificateId: certificate.id,
      certificateHash: certificate.certificateHash,
      sku: terms.sku,
      quantity: terms.quantity,
      totalValueMinor: terms.totalValueMinor,
      depositMinor: economics.depositMinor,
    });
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "committing", expectedVersion: dealCase.activeTermsVersion, nextStatus: "committed" });
    await emitCaseEvent(db, { caseId: input.caseId, eventType: "case.committed", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { certificateId: certificate.id }, traceId: input.traceId });
    return { status: "committed" as const, certificateId: certificate.id, receipts, depositMinor: economics.depositMinor };
  } catch (error) {
    // Class A vs Class B: distinguish "commitOrder failed before doing anything" from
    // "commitOrder already produced real, irreversible side effects" by directly
    // re-reading what actually happened in the database — NOT by branching on the
    // thrown error's ToolError code. commitOrder's top-of-function certificate-validity
    // guards (POLICY_VIOLATION / TERMS_HASH_MISMATCH / RESERVATION_EXPIRED, all thrown
    // before any receipt or reservation-commit work runs) and its mid-loop
    // assertValidReservationTransition guard (also POLICY_VIOLATION, thrown AFTER all
    // three receipts and possibly some reservation commits have already happened) are
    // not distinguishable by code alone — both can surface as the identical
    // ToolError("POLICY_VIOLATION", ...). What IS a real, verifiable signal is: did any
    // of this certificate's reservations newly become "committed", and did any of its
    // receipted actions (sandbox order/CRM, Stripe checkout, outbox) succeed? Either one
    // means irreversible work already happened, regardless of what the error looks like.
    const postAttemptReservations = await db.reservation.findMany({ where: { id: { in: certificateReservationIds } } });
    const committedReservationIds = postAttemptReservations
      .filter((r) => r.status === "committed" && preAttemptReservationStatus.get(r.id) !== "committed")
      .map((r) => r.id);
    const succeededReceipts = await db.actionReceipt.findMany({ where: { caseId: input.caseId, resourceRef: certificate.id, status: "succeeded" } });
    const partialCommit = committedReservationIds.length > 0 || succeededReceipts.length > 0;

    // Still correct in both classes: release whatever is genuinely still `held` and
    // unconsumed. It does not touch the reservations already stuck `committed` above —
    // there is no transition back to `released`/`expired` for those (reservationLifecycle.ts) —
    // those require the manual reconciliation this event's payload is meant to enable.
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "committing", expectedVersion: dealCase.activeTermsVersion, nextStatus: "aborting" });
    await abortCommitment(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion });
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "aborting", expectedVersion: dealCase.activeTermsVersion, nextStatus: "escalated" });
    const message = error instanceof Error ? error.message : String(error);
    const reason = partialCommit ? `PARTIAL_COMMIT: ${message}` : message;
    await emitCaseEvent(db, {
      caseId: input.caseId,
      eventType: "case.escalated",
      caseVersion: dealCase.activeTermsVersion,
      actorType: "coordinator",
      actorRef: "workflow",
      payload: { reason, partialCommit, committedReservationIds, receiptedActionsExecuted: succeededReceipts.map((r) => r.actionType) },
      traceId: input.traceId,
    });
    return { status: "escalated" as const, reason, partialCommit, committedReservationIds, receiptedActionsExecuted: succeededReceipts.map((r) => r.actionType) };
  }
}
