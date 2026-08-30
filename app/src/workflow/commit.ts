import type { PrismaClient } from "@prisma/client";
import type { PaymentTerms } from "@/lib/types";
import { transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "./events";
import { calculateDealEconomics, SKU_UNIT_COST_MINOR, ADVANCE_DEPOSIT_BPS } from "@/policy/economics";
import { commitOrder, abortCommitment } from "@/reservations/coordinator";

export interface RunCommitInput {
  caseId: string;
  traceId: string;
}

// Consumes a `prepared` case's valid certificate and completes the required protected
// actions. The case becomes `committed` only after commitOrder's required receipts
// succeed; any failure routes through `aborting` to `escalated` rather than leaving
// the case in an ambiguous state. Standalone and reusable: called both by the
// direct-feasible branch and, later, by buyer-acceptance.
export async function runCommit(db: PrismaClient, input: RunCommitInput) {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: input.caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId: input.caseId, version: dealCase.activeTermsVersion } });
  const certificate = await db.commitCertificate.findFirstOrThrow({ where: { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion, status: "valid" } });

  const economics = calculateDealEconomics({
    totalValueMinor: terms.totalValueMinor,
    discountBps: terms.discountBps,
    quantity: terms.quantity,
    unitCostMinor: SKU_UNIT_COST_MINOR[terms.sku] ?? 0,
    paymentTerms: terms.paymentTerms as PaymentTerms,
    depositBps: ADVANCE_DEPOSIT_BPS,
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
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "committing", expectedVersion: dealCase.activeTermsVersion, nextStatus: "aborting" });
    await abortCommitment(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion });
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "aborting", expectedVersion: dealCase.activeTermsVersion, nextStatus: "escalated" });
    const message = error instanceof Error ? error.message : String(error);
    await emitCaseEvent(db, { caseId: input.caseId, eventType: "case.escalated", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { reason: message }, traceId: input.traceId });
    return { status: "escalated" as const, reason: message };
  }
}
