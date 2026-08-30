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

  const certificateReservationIds = fromJsonColumn<string[]>(certificate.reservationIds);
  const preAttemptReservationStatus = new Map(
    (await db.reservation.findMany({ where: { id: { in: certificateReservationIds } } })).map((r) => [r.id, r.status]),
  );

  const economics = calculateDealEconomics({
    totalValueMinor: terms.totalValueMinor,
    discountBps: terms.discountBps,
    quantity: terms.quantity,
    unitCostMinor: terms.confirmedBuyPriceMinor ?? 0,
    paymentTerms: terms.paymentTerms as PaymentTerms,
    depositBps: terms.advanceBps ?? 0,
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
    const postAttemptReservations = await db.reservation.findMany({ where: { id: { in: certificateReservationIds } } });
    const committedReservationIds = postAttemptReservations
      .filter((r) => r.status === "committed" && preAttemptReservationStatus.get(r.id) !== "committed")
      .map((r) => r.id);
    const succeededReceipts = await db.actionReceipt.findMany({ where: { caseId: input.caseId, resourceRef: certificate.id, status: "succeeded" } });
    const partialCommit = committedReservationIds.length > 0 || succeededReceipts.length > 0;

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
