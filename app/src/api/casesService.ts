import type { PrismaClient } from "@prisma/client";
import { fromJsonColumn } from "@/lib/json-column";

export async function listCases(db: PrismaClient) {
  return db.dealCase.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getCaseDetail(db: PrismaClient, caseId: string) {
  const dealCase = await db.dealCase.findUnique({ where: { id: caseId } });
  if (!dealCase) return null;
  const [termsVersions, rawDecisions, reservations, rawCertificates, rawReceipts, rawEvents] = await Promise.all([
    db.termsVersion.findMany({ where: { caseId }, orderBy: { version: "asc" } }),
    db.domainDecision.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } }),
    db.reservation.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } }),
    db.commitCertificate.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } }),
    db.actionReceipt.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } }),
    db.caseEvent.findMany({ where: { caseId }, orderBy: { sequence: "asc" } }),
  ]);

  // DomainDecision.payload/evidenceRefs, CommitCertificate.reservationIds/policyVersions,
  // ActionReceipt.responsePayload, and CaseEvent.payload are all JSON-in-TEXT columns
  // (SQLite has no native Json type; see prisma/schema.prisma and lib/json-column.ts).
  // Every other consumer of these fields in this codebase (coordinator.ts, commit.ts,
  // supplierDisrupted.ts, roleRuntime.ts, readTools.ts) deserializes them via
  // fromJsonColumn rather than passing the raw TEXT value along — this is the first HTTP
  // boundary in the codebase, so it must do the same rather than handing an API consumer
  // an opaque JSON string where it expects a value.
  const decisions = rawDecisions.map((d) => ({
    ...d,
    payload: fromJsonColumn<unknown>(d.payload),
    evidenceRefs: fromJsonColumn<string[]>(d.evidenceRefs),
  }));
  const certificates = rawCertificates.map((c) => ({
    ...c,
    reservationIds: fromJsonColumn<string[]>(c.reservationIds),
    policyVersions: fromJsonColumn<unknown>(c.policyVersions),
  }));
  const receipts = rawReceipts.map((r) => ({
    ...r,
    responsePayload: fromJsonColumn<unknown>(r.responsePayload),
  }));
  const events = rawEvents.map((e) => ({
    ...e,
    payload: fromJsonColumn<unknown>(e.payload),
  }));

  return { case: dealCase, termsVersions, decisions, reservations, certificates, receipts, events };
}

export type SendQuoteResult =
  | { ok: true; mode: "backed_commitment"; certificateId: string; outboxMessageId: string | null }
  | { ok: true; mode: "non_binding_counteroffer"; counterofferId: string; binding: false }
  | { ok: false; code: "POLICY_VIOLATION" | "INVALID_INPUT"; message: string };

// The Protected Promise API's core rule: `backed_commitment` requires a valid
// (consumed) certificate for the current version; `non_binding_counteroffer` requires
// a current counteroffer and is always labeled non-binding. Any mismatch returns a
// typed denial and creates no business mutation.
export async function sendQuote(db: PrismaClient, caseId: string, mode: string): Promise<SendQuoteResult> {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: caseId } });

  if (mode === "backed_commitment") {
    const certificate = await db.commitCertificate.findFirst({ where: { caseId, caseVersion: dealCase.activeTermsVersion, status: "consumed" } });
    if (!certificate) return { ok: false, code: "POLICY_VIOLATION", message: "No valid certificate for the current case version; a backed commitment cannot be sent." };
    const message = await db.outboxMessage.findFirst({ where: { caseId, certificateId: certificate.id, messageType: "backed_promise" } });
    return { ok: true, mode: "backed_commitment", certificateId: certificate.id, outboxMessageId: message?.id ?? null };
  }

  if (mode === "non_binding_counteroffer") {
    const counteroffer = await db.counteroffer.findFirst({ where: { caseId, sourceTermsVersion: dealCase.activeTermsVersion } });
    if (!counteroffer) return { ok: false, code: "POLICY_VIOLATION", message: "No current counteroffer to send as non-binding." };
    return { ok: true, mode: "non_binding_counteroffer", counterofferId: counteroffer.id, binding: false };
  }

  return { ok: false, code: "INVALID_INPUT", message: "mode must be 'non_binding_counteroffer' or 'backed_commitment'" };
}
