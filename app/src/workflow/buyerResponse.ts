import type { PrismaClient } from "@prisma/client";
import type { ModelGateway } from "@/gateway/modelGateway";
import { ToolError } from "@/lib/types";
import { hashBuyerToken, verifyBuyerToken } from "@/lib/hash";
import { transitionCase, assertValidTransition } from "@/state/transitions";
import { emitCaseEvent } from "./events";
import { evaluateAndRoute } from "./dealSubmitted";
import { runCommit } from "./commit";

export interface RunBuyerResponseInput {
  buyerToken: string;
  response: "accept" | "reject";
  modelId: string;
  timeoutMs: number;
  traceId: string;
  buyerLinkSigningSecret: string;
}

export type BuyerResponseResult =
  | { status: "invalid_or_expired" }
  | { status: "cannot_commit" }
  | { status: "prepared"; certificateId: string }
  | { status: "negotiating"; counterofferId: string }
  | { status: "committed"; certificateId: string }
  | { status: "escalated"; reason: string }
  // The counteroffer was already accepted, but the case has not yet reached a
  // terminal status (evaluating/committing, or negotiating as a defensive guard
  // even though dealSubmitted.ts's business rules don't currently route an
  // already-accepted counteroffer's case back through negotiating). This is
  // deliberately distinct from "cannot_commit": the caller (an ordinary retry, or
  // the loser of a concurrent accept race) must not be told the deal is dead when
  // it may still resolve to "committed" moments later.
  | { status: "in_progress" };

// Idempotent-replay logic for an already-"accepted" counteroffer: re-derives what the
// original accept call did (or is still doing) purely by reading current case/
// certificate state, without repeating any of the transition/evaluation/commit work.
// Shared by the top-of-function replay check and by the loser side of the
// updateMany race guards below, so both paths report the exact same outcome for the
// exact same persisted state instead of maintaining two copies of this logic.
async function resolveAcceptedCounteroffer(db: PrismaClient, caseId: string): Promise<BuyerResponseResult> {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: caseId } });
  if (dealCase.status === "committed") {
    const certificate = await db.commitCertificate.findFirstOrThrow({ where: { caseId: dealCase.id, status: "consumed" } });
    return { status: "committed", certificateId: certificate.id };
  }
  if (dealCase.status === "prepared") {
    const certificate = await db.commitCertificate.findFirstOrThrow({ where: { caseId: dealCase.id, status: "valid" } });
    return { status: "prepared", certificateId: certificate.id };
  }
  if (dealCase.status === "escalated") return { status: "escalated", reason: "duplicate_accept_after_escalation" };
  if (dealCase.status === "evaluating" || dealCase.status === "committing" || dealCase.status === "negotiating") {
    return { status: "in_progress" };
  }
  return { status: "cannot_commit" };
}

// Verifies a signed buyer token, expiry, offer status, and case version before
// persisting anything. A tampered signature, an already-resolved offer, or an offer
// whose case has moved on all fail closed with no mutation.
export async function runBuyerResponse(db: PrismaClient, gateway: ModelGateway, input: RunBuyerResponseInput): Promise<BuyerResponseResult> {
  const verified = verifyBuyerToken(input.buyerToken, input.buyerLinkSigningSecret);
  if (!verified) return { status: "invalid_or_expired" };

  const counteroffer = await db.counteroffer.findUnique({ where: { tokenHash: hashBuyerToken(input.buyerToken) } });
  if (!counteroffer) return { status: "invalid_or_expired" };

  if (counteroffer.status === "accepted") return resolveAcceptedCounteroffer(db, counteroffer.caseId);
  if (counteroffer.status === "rejected") return { status: "cannot_commit" };
  if (counteroffer.status !== "sent" || counteroffer.expiresAt <= new Date()) return { status: "invalid_or_expired" };

  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: counteroffer.caseId } });
  if (dealCase.activeTermsVersion !== counteroffer.sourceTermsVersion) return { status: "invalid_or_expired" };

  if (input.response === "reject") {
    // Atomic guard, not a plain update: a concurrent caller could resolve this same
    // counteroffer (accept or reject) between the "sent" check above and this write —
    // see src/reservations/coordinator.ts's breakCertificate for why this codebase
    // treats every status-transition write this way, not just the read-then-branch.
    const rejectUpdate = await db.counteroffer.updateMany({ where: { id: counteroffer.id, status: "sent" }, data: { status: "rejected", respondedAt: new Date() } });
    if (rejectUpdate.count === 0) {
      // Lost the race — someone else already resolved this counteroffer first. Route
      // through the same replay logic a duplicate request would hit, rather than
      // touching dealCase/emitCaseEvent on behalf of a write that never happened.
      const current = await db.counteroffer.findUniqueOrThrow({ where: { id: counteroffer.id } });
      if (current.status === "accepted") return resolveAcceptedCounteroffer(db, current.caseId);
      return { status: "cannot_commit" };
    }
    await transitionCase(db, { caseId: dealCase.id, expectedStatus: "negotiating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "cannot_commit" });
    await emitCaseEvent(db, { caseId: dealCase.id, eventType: "buyer.counterterm_rejected", caseVersion: dealCase.activeTermsVersion, actorType: "buyer", actorRef: "buyer", payload: { counterofferId: counteroffer.id }, traceId: input.traceId });
    return { status: "cannot_commit" };
  }

  // Same guard on the accept path: only the caller that actually wins this CAS write
  // is allowed to drive the dealCase transition, evaluateAndRoute, and runCommit below
  // — a loser must never execute any of that on behalf of the winner.
  const acceptUpdate = await db.counteroffer.updateMany({ where: { id: counteroffer.id, status: "sent" }, data: { status: "accepted", respondedAt: new Date() } });
  if (acceptUpdate.count === 0) {
    const current = await db.counteroffer.findUniqueOrThrow({ where: { id: counteroffer.id } });
    if (current.status === "accepted") return resolveAcceptedCounteroffer(db, current.caseId);
    return { status: "cannot_commit" };
  }

  // transitionCase only ever swaps `status` (its WHERE/SET both key on status +
  // activeTermsVersion, but its SET never touches activeTermsVersion itself — see
  // src/state/transitions.ts), so it cannot atomically both move the case to
  // "evaluating" AND advance activeTermsVersion to the counteroffer's proposed version
  // in one write. Doing those as two separate updateMany calls would open a window
  // where a concurrent reader could observe "evaluating" at the stale version. Instead,
  // validate the edge is legal via the same pure check transitionCase itself runs
  // internally, then perform both column changes in a single atomic updateMany keyed on
  // the same optimistic-concurrency predicate transitionCase would have used.
  assertValidTransition("negotiating", "evaluating");
  const advanced = await db.dealCase.updateMany({
    where: { id: dealCase.id, status: "negotiating", activeTermsVersion: counteroffer.sourceTermsVersion },
    data: { activeTermsVersion: counteroffer.proposedTermsVersion, status: "evaluating" },
  });
  if (advanced.count === 0) {
    throw new ToolError("STALE_CASE_VERSION", `Case ${dealCase.id} is not in status "negotiating" at version ${counteroffer.sourceTermsVersion}`, true);
  }
  await emitCaseEvent(db, { caseId: dealCase.id, eventType: "buyer.counterterm_accepted", caseVersion: counteroffer.proposedTermsVersion, actorType: "buyer", actorRef: "buyer", payload: { counterofferId: counteroffer.id }, traceId: input.traceId });

  const evaluation = await evaluateAndRoute(db, gateway, { caseId: dealCase.id, modelId: input.modelId, timeoutMs: input.timeoutMs, traceId: input.traceId, buyerLinkSigningSecret: input.buyerLinkSigningSecret });

  if (evaluation.status === "prepared") {
    const commitResult = await runCommit(db, { caseId: dealCase.id, traceId: input.traceId });
    if (commitResult.status === "committed") return { status: "committed", certificateId: commitResult.certificateId };
    return { status: "escalated", reason: commitResult.reason };
  }
  if (evaluation.status === "negotiating") return { status: "negotiating", counterofferId: evaluation.counterofferId };
  return { status: "cannot_commit" };
}
