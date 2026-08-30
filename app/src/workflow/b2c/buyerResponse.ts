import type { PrismaClient } from "@prisma/client";
import { hashBuyerToken, verifyBuyerToken } from "@/lib/hash";
import { transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "../events";
import { prepareCommitCertificate, abortCommitment } from "@/reservations/coordinator";
import { runB2CCommit } from "./commit";
import { B2C_REQUIRED_DOMAINS } from "./constants";

export interface RunB2CBuyerResponseInput {
  buyerToken: string;
  response: "accept" | "reject";
  buyerLinkSigningSecret: string;
  traceId: string;
}

export type B2CBuyerResponseResult =
  | { status: "invalid_or_expired" }
  | { status: "cannot_commit" }
  | { status: "committed"; certificateId: string }
  | { status: "escalated"; reason: string };

// Unlike B2B's buyer-response flow, B2C's terms never change between being quoted and
// being accepted — the buy price was already negotiated and locked before the quote was
// ever sent — so accept needs no version bump and no re-evaluation. It goes straight
// from the held reservation to a certificate to commit.
export async function runB2CBuyerResponse(db: PrismaClient, input: RunB2CBuyerResponseInput): Promise<B2CBuyerResponseResult> {
  const verified = verifyBuyerToken(input.buyerToken, input.buyerLinkSigningSecret);
  if (!verified) return { status: "invalid_or_expired" };

  const counteroffer = await db.counteroffer.findUnique({ where: { tokenHash: hashBuyerToken(input.buyerToken) } });
  if (!counteroffer) return { status: "invalid_or_expired" };

  // Replaying an accepted token when the case is already `committed` or `escalated`
  // returns the prior outcome instead of re-mutating (see tests below). Any other
  // dealCase.status here (e.g. `prepared`/`committing`, reachable only if a prior
  // invocation crashed mid-function after transitioning but before runB2CCommit
  // finished) falls through to `cannot_commit` below — a rare crash-window
  // mislabeling, not a normal-path outcome. Left as a known limitation rather than a
  // new result variant, since no code path in this plan can currently produce it.
  if (counteroffer.status === "accepted") {
    const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: counteroffer.caseId } });
    if (dealCase.status === "committed") {
      const certificate = await db.commitCertificate.findFirstOrThrow({ where: { caseId: dealCase.id, status: "consumed" } });
      return { status: "committed", certificateId: certificate.id };
    }
    if (dealCase.status === "escalated") return { status: "escalated", reason: "duplicate_accept_after_escalation" };
    return { status: "cannot_commit" };
  }
  if (counteroffer.status === "rejected") return { status: "cannot_commit" };
  if (counteroffer.status !== "sent" || counteroffer.expiresAt <= new Date()) return { status: "invalid_or_expired" };

  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: counteroffer.caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId: dealCase.id, version: counteroffer.proposedTermsVersion } });

  if (input.response === "reject") {
    await db.counteroffer.update({ where: { id: counteroffer.id }, data: { status: "rejected", respondedAt: new Date() } });
    await transitionCase(db, { caseId: dealCase.id, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "cannot_commit" });
    await abortCommitment(db, { caseId: dealCase.id, caseVersion: dealCase.activeTermsVersion });
    await emitCaseEvent(db, { caseId: dealCase.id, eventType: "b2c.quote_rejected", caseVersion: dealCase.activeTermsVersion, actorType: "buyer", actorRef: "buyer", payload: { counterofferId: counteroffer.id }, traceId: input.traceId });
    return { status: "cannot_commit" };
  }

  await db.counteroffer.update({ where: { id: counteroffer.id }, data: { status: "accepted", respondedAt: new Date() } });
  await emitCaseEvent(db, { caseId: dealCase.id, eventType: "b2c.quote_accepted", caseVersion: dealCase.activeTermsVersion, actorType: "buyer", actorRef: "buyer", payload: { counterofferId: counteroffer.id }, traceId: input.traceId });

  const heldReservations = await db.reservation.findMany({ where: { caseId: dealCase.id, caseVersion: dealCase.activeTermsVersion, termsHash: terms.termsHash, status: "held" } });
  const certificate = await prepareCommitCertificate(db, {
    caseId: dealCase.id,
    caseVersion: dealCase.activeTermsVersion,
    termsHash: terms.termsHash,
    reservationIds: heldReservations.map((r) => r.id),
    requiredDomains: B2C_REQUIRED_DOMAINS,
  });
  await transitionCase(db, { caseId: dealCase.id, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "prepared" });
  await emitCaseEvent(db, { caseId: dealCase.id, eventType: "case.prepared", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { certificateId: certificate.id }, traceId: input.traceId });

  const commitResult = await runB2CCommit(db, { caseId: dealCase.id, traceId: input.traceId });
  if (commitResult.status === "committed") return { status: "committed", certificateId: commitResult.certificateId };
  return { status: "escalated", reason: commitResult.reason };
}
