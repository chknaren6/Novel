import type { PrismaClient } from "@prisma/client";
import { fromJsonColumn } from "@/lib/json-column";
import type { CaseStatus } from "@/lib/types";

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

// Case statuses under which a `consumed` certificate at the current version reflects a
// genuinely live, successfully-resolved deal. Certificate/child-table state alone is not
// sufficient to gate `backed_commitment` (see below), so this list was derived by tracing
// every place a certificate is marked `consumed` against the case status active at that
// moment:
//   - "committed": the normal path (commit.ts's runCommit / reservations/coordinator.ts's
//     commitOrder) — commitOrder marks the certificate `consumed` last of all, and
//     runCommit transitions the case to "committed" immediately afterward.
//   - "repaired": the supplier-disruption repair path (supplierDisrupted.ts) marks the
//     repaired certificate `consumed` mid-function, then only reaches its one legal
//     terminal exit, "repaired", if every remaining step (both repair receipted actions,
//     the final transitionCase) succeeds.
// Critically, a certificate can ALSO be left `consumed` at the current version while the
// case ends up somewhere else, because both of the above paths mark it consumed before
// their own final steps can still fail:
//   - "cannot_commit": supplierDisrupted.ts's catch block re-reads DB state after any
//     failure past that point (e.g. the second repair receipted action,
//     outbox.send_correction) and fails the case closed to "cannot_commit" — but the
//     already-consumed repaired certificate is not rolled back. This is Bug 1: the
//     documented "partial repair" scenario.
//   - "escalated": commit.ts's own catch block can be reached by a failing final
//     transitionCase("committing" -> "committed") even after commitOrder's certificate
//     consumption already succeeded, landing the case on "escalated" via aborting.
// Neither "cannot_commit" nor "escalated" (nor any other status) is a state where the
// system considers the deal live, so both must be excluded even though a `consumed`
// certificate exists.
const BACKED_COMMITMENT_LIVE_STATUSES: CaseStatus[] = ["committed", "repaired"];

// The Protected Promise API's core rule: `backed_commitment` requires a valid
// (consumed) certificate for the current version; `non_binding_counteroffer` requires
// a current counteroffer and is always labeled non-binding. Any mismatch returns a
// typed denial and creates no business mutation.
//
// Child-table artifact state (CommitCertificate.status / Counteroffer existence) is
// necessary but not sufficient: dealCase.status is this codebase's actual source of
// truth for whether the deal is still live, so both branches also gate on it.
export async function sendQuote(db: PrismaClient, caseId: string, mode: string): Promise<SendQuoteResult> {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: caseId } });

  if (mode === "backed_commitment") {
    if (!BACKED_COMMITMENT_LIVE_STATUSES.includes(dealCase.status as CaseStatus)) {
      return { ok: false, code: "POLICY_VIOLATION", message: `Case is not in a state that permits a backed commitment (status=${dealCase.status}).` };
    }
    const certificate = await db.commitCertificate.findFirst({ where: { caseId, caseVersion: dealCase.activeTermsVersion, status: "consumed" } });
    if (!certificate) return { ok: false, code: "POLICY_VIOLATION", message: "No valid certificate for the current case version; a backed commitment cannot be sent." };
    const message = await db.outboxMessage.findFirst({ where: { caseId, certificateId: certificate.id, messageType: "backed_promise" } });
    return { ok: true, mode: "backed_commitment", certificateId: certificate.id, outboxMessageId: message?.id ?? null };
  }

  if (mode === "non_binding_counteroffer") {
    // "negotiating" is the only status under which a counteroffer is actually pending:
    // dealSubmitted.ts's createCounteroffer call site creates the Counteroffer row and
    // transitions the case to "negotiating" together. Once the buyer responds, the case
    // moves on ("cannot_commit" on reject, "evaluating"+ on accept) while the
    // Counteroffer row itself keeps matching `sourceTermsVersion` (buyerResponse.ts's
    // reject path deliberately leaves activeTermsVersion unchanged) — so the row alone
    // is not sufficient (Bug 2).
    if (dealCase.status !== "negotiating") {
      return { ok: false, code: "POLICY_VIOLATION", message: `Case is not in a state that permits a non-binding counteroffer (status=${dealCase.status}).` };
    }
    const counteroffer = await db.counteroffer.findFirst({ where: { caseId, sourceTermsVersion: dealCase.activeTermsVersion } });
    if (!counteroffer) return { ok: false, code: "POLICY_VIOLATION", message: "No current counteroffer to send as non-binding." };
    return { ok: true, mode: "non_binding_counteroffer", counterofferId: counteroffer.id, binding: false };
  }

  return { ok: false, code: "INVALID_INPUT", message: "mode must be 'non_binding_counteroffer' or 'backed_commitment'" };
}
