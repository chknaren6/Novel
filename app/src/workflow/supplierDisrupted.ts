import type { PrismaClient } from "@prisma/client";
import type { ModelGateway } from "@/gateway/modelGateway";
import { ToolError, type PaymentTerms, type ReservationDomain } from "@/lib/types";
import { assertValidTransition, transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "./events";
import { runRoleAgent } from "@/roles/roleRuntime";
import { deriveIdempotencyKey } from "@/policy/idempotency";
import { breakCertificate, compensateCommitment, prepareCommitCertificate, abortCommitment } from "@/reservations/coordinator";
import { runReceiptedAction } from "@/receipts/actionReceipt";
import { markSandboxOrderRepaired, updateCrmStage } from "@/adapters/sandboxErpAdapter";
import { sendCorrection } from "@/adapters/outboxAdapter";
import { fromJsonColumn } from "@/lib/json-column";

export interface RunSupplierDisruptionInput {
  caseId: string;
  disruptedSupplierId: string;
  modelId: string;
  timeoutMs: number;
  traceId: string;
}

export type RunSupplierDisruptionResult =
  | { status: "repaired"; certificateId: string }
  // No legitimate "escalated" outcome exists on this path: by the time Procurement/
  // Logistics/Risk are re-run the case is already at "evaluating", and per
  // transitions.ts's ALLOWED_TRANSITIONS there is no "evaluating" -> "escalated" edge
  // — so a risk veto, an unresolved missing domain, OR any later uncaught failure
  // (prepareCommitCertificate, the reservation-commit loop, either repair receipted
  // action) all fail closed to "cannot_commit", matching dealSubmitted.ts's
  // evaluateAndRoute. `partialRepair`/`committedReservationIds`/
  // `receiptedActionsExecuted` mirror commit.ts's `escalated` diagnostics: they read as
  // the safe empty case for a clean veto/missing-domain failure, and as real detail
  // when a later step already produced irreversible side effects before failing.
  | { status: "cannot_commit"; reason: string; partialRepair: boolean; committedReservationIds: string[]; receiptedActionsExecuted: string[] };

const DESTINATION_ID = "ZONE-SOUTH";
const REQUIRED_DOMAINS: ReservationDomain[] = ["credit", "inventory", "supplier", "logistics"];

// Break the consumed certificate, compensate affected effects exactly once, rerun
// only Procurement/Logistics/Risk against a new case version, and issue a repaired
// certificate or fail closed to cannot_commit.
export async function runSupplierDisruption(db: PrismaClient, gateway: ModelGateway, input: RunSupplierDisruptionInput): Promise<RunSupplierDisruptionResult> {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: input.caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId: input.caseId, version: dealCase.activeTermsVersion } });
  const customer = await db.customer.findUniqueOrThrow({ where: { id: dealCase.customerId } });
  // Known, documented gap (matching actionReceipt.ts's requestHash-not-validated-on-retry
  // comment): retrying runSupplierDisruption after a partial-repair "cannot_commit" (see
  // the catch block below) is NOT supported in this P0 build. This lookup picks the
  // most-recently-consumed certificate for the case, but a failed repair attempt can
  // leave a newly-consumed repaired certificate on the books whose reservation set no
  // longer contains the originally-disrupted supplier's reservation — a retry would
  // latch onto that wrong certificate and fail with a confusing error rather than
  // recovering. Out of scope for this pass; a stuck "cannot_commit" case requires manual
  // reconciliation, not an automatic retry of this function.
  const certificate = await db.commitCertificate.findFirstOrThrow({ where: { caseId: input.caseId, status: "consumed" } });

  await emitCaseEvent(db, { caseId: input.caseId, eventType: "supplier.disrupted", caseVersion: dealCase.activeTermsVersion, actorType: "adapter", actorRef: input.disruptedSupplierId, payload: { certificateId: certificate.id }, traceId: input.traceId });
  await breakCertificate(db, { certificateId: certificate.id });

  // reservationIds is a JSON-in-TEXT column (SQLite has no native Json type; see
  // prisma/schema.prisma and lib/json-column.ts) — must go through fromJsonColumn,
  // never a bare `as string[]` cast (matching coordinator.ts's commitOrder).
  const certifiedReservationIds = fromJsonColumn<string[]>(certificate.reservationIds);
  const certifiedReservations = await db.reservation.findMany({ where: { id: { in: certifiedReservationIds } } });
  // resourceRef for a supplier reservation is "SUPPLIER:<supplierId>:<sku>" (3 parts;
  // see supplierAdapter.ts) — compare the exact supplierId segment rather than a
  // substring `.includes()` check, which would be fragile if one supplier id were ever
  // a substring of another (not the case for VEND-2003/VEND-2005, but not guaranteed
  // in general).
  const disruptedSupplierReservation = certifiedReservations.find((r) => {
    if (r.domain !== "supplier") return false;
    const [, supplierId] = r.resourceRef.split(":");
    return supplierId === input.disruptedSupplierId;
  });
  if (!disruptedSupplierReservation) {
    throw new ToolError("INVALID_INPUT", `No supplier reservation for ${input.disruptedSupplierId} in certificate ${certificate.id}`, false);
  }
  const affectedLogisticsReservationIds = certifiedReservations.filter((r) => r.domain === "logistics").map((r) => r.id);
  const reusableReservations = certifiedReservations.filter((r) => r.domain === "credit" || r.domain === "inventory");

  await transitionCase(db, { caseId: input.caseId, expectedStatus: "committed", expectedVersion: dealCase.activeTermsVersion, nextStatus: "repair_needed" });
  await transitionCase(db, { caseId: input.caseId, expectedStatus: "repair_needed", expectedVersion: dealCase.activeTermsVersion, nextStatus: "compensating" });

  const newVersion = dealCase.activeTermsVersion + 1;
  await compensateCommitment(db, {
    caseId: input.caseId,
    caseVersion: newVersion,
    brokenCertificateId: certificate.id,
    disruptedSupplierReservationId: disruptedSupplierReservation.id,
    affectedLogisticsReservationIds,
  });

  await db.termsVersion.create({
    data: { caseId: input.caseId, version: newVersion, parentVersion: dealCase.activeTermsVersion, source: "repair", termsHash: terms.termsHash, sku: terms.sku, quantity: terms.quantity, totalValueMinor: terms.totalValueMinor, discountBps: terms.discountBps, paymentTerms: terms.paymentTerms, deliveryDeadline: terms.deliveryDeadline },
  });
  // transitionCase alone can't atomically combine this status change with the version
  // bump (its SET never touches activeTermsVersion — see transitions.ts), so this raw
  // updateMany does both in one write. Validate the edge is legal first via the same
  // pure check transitionCase itself runs internally — matching buyerResponse.ts's
  // identical "negotiating" -> "evaluating" atomic status+version bump.
  assertValidTransition("compensating", "evaluating");
  const advanced = await db.dealCase.updateMany({ where: { id: input.caseId, status: "compensating", activeTermsVersion: dealCase.activeTermsVersion }, data: { status: "evaluating", activeTermsVersion: newVersion } });
  if (advanced.count === 0) throw new ToolError("STALE_CASE_VERSION", `Case ${input.caseId} could not advance to the repair version`, true);

  const toolContext = { customerId: customer.id, sku: terms.sku, destinationId: DESTINATION_ID, paymentTerms: terms.paymentTerms as PaymentTerms };
  const shortfallQuantity = disruptedSupplierReservation.quantityMinor ?? 0;
  const runRole = (role: "procurement" | "logistics" | "risk", contextSummary: Record<string, unknown>) =>
    runRoleAgent(db, gateway, { role, caseId: input.caseId, caseVersion: newVersion, termsHash: terms.termsHash, contextSummary, toolContext, traceId: input.traceId, timeoutMs: input.timeoutMs }, input.modelId);

  // Everything from here through the final "repaired" transition runs against a case
  // already advanced to "evaluating" at newVersion. Per transitions.ts's
  // ALLOWED_TRANSITIONS there is no "evaluating" -> "escalated" edge, so any uncaught
  // throw in this section (Procurement/Logistics/Risk reruns, prepareCommitCertificate,
  // the reservation-commit loop, or either repair receipted action) must still land the
  // case on the one legal exit, "cannot_commit" — never leave it stuck at "evaluating".
  // Mirrors commit.ts's try/catch around commitOrder: on failure, re-read actual DB
  // state (not the thrown error's shape) to tell a clean failure apart from one that
  // already did partial, irreversible repair work.
  try {
    const [procurementDecision, logisticsDecision] = await Promise.all([
      runRole("procurement", { sku: terms.sku, requestedQuantity: shortfallQuantity, excludedSupplierId: input.disruptedSupplierId }),
      runRole("logistics", { destinationId: DESTINATION_ID, deadline: terms.deliveryDeadline.toISOString(), requestedQuantity: shortfallQuantity }),
    ]);
    const riskDecision = await runRole("risk", {
      procurementDecision: { decision: procurementDecision.decision, evidenceRefs: procurementDecision.evidenceRefs },
      logisticsDecision: { decision: logisticsDecision.decision, evidenceRefs: logisticsDecision.evidenceRefs },
    });

    const freshReservations = await db.reservation.findMany({ where: { caseId: input.caseId, caseVersion: newVersion, termsHash: terms.termsHash, status: "held" } });
    const coveredDomains = new Set([...reusableReservations.map((r) => r.domain), ...freshReservations.map((r) => r.domain)]);
    const missingDomains = REQUIRED_DOMAINS.filter((d) => !coveredDomains.has(d));

    if (riskDecision.decision === "veto" || missingDomains.length > 0) {
      await abortCommitment(db, { caseId: input.caseId, caseVersion: newVersion });
      await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: newVersion, nextStatus: "cannot_commit" });
      const reason = riskDecision.decision === "veto" ? "risk_veto" : `unresolved_domains:${missingDomains.join(",")}`;
      await emitCaseEvent(db, { caseId: input.caseId, eventType: "case.cannot_commit", caseVersion: newVersion, actorType: "coordinator", actorRef: "workflow", payload: { reason, partialRepair: false, committedReservationIds: [], receiptedActionsExecuted: [] }, traceId: input.traceId });
      return { status: "cannot_commit" as const, reason, partialRepair: false, committedReservationIds: [], receiptedActionsExecuted: [] };
    }

    const certificateReservationIds = [...reusableReservations.map((r) => r.id), ...freshReservations.map((r) => r.id)];
    const repairedCertificate = await prepareCommitCertificate(db, { caseId: input.caseId, caseVersion: newVersion, termsHash: terms.termsHash, reservationIds: certificateReservationIds, requiredDomains: REQUIRED_DOMAINS });
    await db.commitCertificate.update({ where: { id: repairedCertificate.id }, data: { supersedesCertificateId: certificate.id } });

    for (const reservationId of certificateReservationIds) {
      await db.reservation.updateMany({ where: { id: reservationId, status: { not: "committed" } }, data: { status: "committed" } });
    }
    await db.commitCertificate.update({ where: { id: repairedCertificate.id }, data: { status: "consumed", consumedAt: new Date() } });

    const key = (actionType: string) => deriveIdempotencyKey({ caseId: input.caseId, caseVersion: newVersion, actionType, resourceRef: repairedCertificate.id });
    await runReceiptedAction(db, {
      caseId: input.caseId, caseVersion: newVersion, actionType: "sandbox_order.repair", resourceRef: repairedCertificate.id, provider: "sandbox_erp",
      idempotencyKey: key("sandbox_order.repair"), requestHash: repairedCertificate.certificateHash,
      execute: async () => {
        await markSandboxOrderRepaired(db, input.caseId, repairedCertificate.id);
        await updateCrmStage(db, { caseId: input.caseId, stage: "repaired", note: `Certificate ${repairedCertificate.id} repairs ${certificate.id}` });
        return { providerRef: null, data: {} };
      },
    });
    const originalMessage = await db.outboxMessage.findFirstOrThrow({ where: { caseId: input.caseId, messageType: "backed_promise" } });
    await runReceiptedAction(db, {
      caseId: input.caseId, caseVersion: newVersion, actionType: "outbox.send_correction", resourceRef: repairedCertificate.id, provider: "outbox",
      idempotencyKey: key("outbox.send_correction"), requestHash: repairedCertificate.certificateHash,
      execute: async () => {
        const message = await sendCorrection(db, { caseId: input.caseId, certificateId: repairedCertificate.id, correctsId: originalMessage.id, payload: { reason: "supplier disruption repaired" } });
        return { providerRef: message.id, data: {} };
      },
    });

    await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: newVersion, nextStatus: "repaired", isRepairVersion: true });
    await emitCaseEvent(db, { caseId: input.caseId, eventType: "repair.requested", caseVersion: newVersion, actorType: "coordinator", actorRef: "workflow", payload: { repairedCertificateId: repairedCertificate.id, brokenCertificateId: certificate.id }, traceId: input.traceId });

    return { status: "repaired" as const, certificateId: repairedCertificate.id };
  } catch (error) {
    // Best-effort cleanup first: release anything still "held" at newVersion. This
    // scopes to exactly this attempt's fresh procurement/logistics holds — the reused
    // Finance/Inventory reservations are "committed" (not "held") and belong to the OLD
    // caseVersion, so abortCommitment's `{caseId, caseVersion, status: "held"}` query
    // (coordinator.ts) can never touch them.
    await abortCommitment(db, { caseId: input.caseId, caseVersion: newVersion });

    // Determine what actually happened by re-reading DB state — not by branching on the
    // thrown error's shape — exactly like commit.ts's Class A/B distinction. A repaired
    // certificate consumed at newVersion, any reservation actually committed at
    // newVersion, or either repair receipted action already succeeding all mean real,
    // possibly-irreversible work happened before the failure.
    const repairedCertificateRecord = await db.commitCertificate.findFirst({ where: { caseId: input.caseId, caseVersion: newVersion } });
    const repairedCertificateConsumed = repairedCertificateRecord?.status === "consumed";
    const committedReservations = await db.reservation.findMany({ where: { caseId: input.caseId, caseVersion: newVersion, status: "committed" } });
    const committedReservationIds = committedReservations.map((r) => r.id);
    const succeededReceipts = await db.actionReceipt.findMany({ where: { caseId: input.caseId, caseVersion: newVersion, actionType: { in: ["sandbox_order.repair", "outbox.send_correction"] }, status: "succeeded" } });
    const receiptedActionsExecuted = succeededReceipts.map((r) => r.actionType);
    const partialRepair = repairedCertificateConsumed || committedReservationIds.length > 0 || receiptedActionsExecuted.length > 0;

    await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: newVersion, nextStatus: "cannot_commit" });
    const message = error instanceof Error ? error.message : String(error);
    const reason = partialRepair ? `PARTIAL_REPAIR: ${message}` : message;
    await emitCaseEvent(db, {
      caseId: input.caseId,
      eventType: "case.cannot_commit",
      caseVersion: newVersion,
      actorType: "coordinator",
      actorRef: "workflow",
      payload: { reason, partialRepair, committedReservationIds, receiptedActionsExecuted, repairedCertificateId: repairedCertificateRecord?.id ?? null, repairedCertificateConsumed },
      traceId: input.traceId,
    });
    return { status: "cannot_commit" as const, reason, partialRepair, committedReservationIds, receiptedActionsExecuted };
  }
}
