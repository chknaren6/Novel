import type { PrismaClient } from "@prisma/client";
import type { ModelGateway } from "@/gateway/modelGateway";
import { ToolError } from "@/lib/types";
import { verifyBuyerToken, hashBuyerToken } from "@/lib/hash";
import { assertValidTransition, transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "./events";
import { evaluateAndRoute } from "./dealSubmitted";
import { runCommit } from "./commit";

export interface RunB2BCounterofferResponseInput {
  buyerToken: string;
  response: "accept" | "reject";
  buyerLinkSigningSecret: string;
  modelId: string;
  timeoutMs: number;
  traceId: string;
}

// evaluateAndRoute assumes the case is already sitting in "evaluating" (see its own doc
// comment in dealSubmitted.ts) — exactly the state this function's accept path produces
// by bumping negotiating -> evaluating itself. runB2BEvaluation.ts is NOT reusable here:
// it wraps runDealSubmitted, which unconditionally starts by transitioning the case from
// "intake", so calling it post-accept would try (and fail) to move an already-evaluating
// case out of "intake". This re-implements runB2BEvaluation's own "prepared -> runCommit"
// chaining directly on top of evaluateAndRoute instead, so accepting can still end in
// committed/escalated (via runCommit), not just stop at "prepared".
async function evaluateAndAutoCommit(
  db: PrismaClient,
  gateway: ModelGateway,
  input: { caseId: string; modelId: string; timeoutMs: number; traceId: string; buyerLinkSigningSecret: string },
) {
  const result = await evaluateAndRoute(db, gateway, input);
  if (result.status !== "prepared") return result;
  return runCommit(db, { caseId: input.caseId, traceId: input.traceId });
}

export type RunB2BCounterofferResponseResult =
  | { status: "invalid_or_expired" }
  | { status: "cannot_commit"; reason: string }
  | Awaited<ReturnType<typeof evaluateAndRoute>>
  | Awaited<ReturnType<typeof runCommit>>;

// The buyer's response to a B2B counteroffer link. Unlike B2C (buyerResponse.ts), terms
// really do change on accept — accepting moves the case onto the counteroffer's terms
// version and re-runs the full six-role evaluation against it, which can itself end in
// committed, escalated, cannot_commit, or even another round of negotiating.
export async function runB2BCounterofferResponse(
  db: PrismaClient,
  gateway: ModelGateway,
  input: RunB2BCounterofferResponseInput,
): Promise<RunB2BCounterofferResponseResult> {
  const verified = verifyBuyerToken(input.buyerToken, input.buyerLinkSigningSecret);
  if (!verified) return { status: "invalid_or_expired" };

  const counteroffer = await db.counteroffer.findUnique({ where: { tokenHash: hashBuyerToken(input.buyerToken) } });
  if (!counteroffer) return { status: "invalid_or_expired" };
  if (counteroffer.expiresAt <= new Date()) return { status: "invalid_or_expired" };
  // Already responded: treat as not replayable, same spirit as B2C's own replay
  // handling in buyerResponse.ts — but B2B returns invalid_or_expired rather than
  // replaying the prior outcome, since re-running evaluation is not idempotent the way
  // B2C's straight-to-commit path is.
  if (counteroffer.respondedAt !== null) return { status: "invalid_or_expired" };

  // Defense in depth: the signed token's offerId is "${caseId}:${proposedVersion}" (see
  // createCounteroffer in counteroffer.ts). A UUID caseId never contains a literal
  // colon, but splitting on the LAST colon is the robust choice regardless and costs
  // nothing. Confirm it agrees with the row actually found by tokenHash before trusting
  // either.
  const lastColon = verified.offerId.lastIndexOf(":");
  const parsedCaseId = lastColon === -1 ? null : verified.offerId.slice(0, lastColon);
  const parsedVersion = lastColon === -1 ? Number.NaN : Number(verified.offerId.slice(lastColon + 1));
  if (parsedCaseId !== counteroffer.caseId || parsedVersion !== counteroffer.proposedTermsVersion) {
    return { status: "invalid_or_expired" };
  }

  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: counteroffer.caseId } });

  if (input.response === "reject") {
    // Case-state mutation happens first; the Counteroffer row is only marked responded
    // once that succeeds (see the longer concurrency note on the accept path below —
    // the same reasoning applies symmetrically here). If transitionCase throws
    // (stale case), the Counteroffer row is left untouched, not falsely marked
    // "declined".
    await transitionCase(db, { caseId: dealCase.id, expectedStatus: "negotiating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "cannot_commit" });
    await emitCaseEvent(db, {
      caseId: dealCase.id,
      eventType: "case.cannot_commit",
      caseVersion: dealCase.activeTermsVersion,
      actorType: "buyer",
      actorRef: "buyer",
      payload: { reason: "counteroffer_declined", counterofferId: counteroffer.id },
      traceId: input.traceId,
    });
    await db.counteroffer.update({ where: { id: counteroffer.id }, data: { status: "declined", respondedAt: new Date() } });
    return { status: "cannot_commit", reason: "counteroffer_declined" };
  }

  // Accept: bump activeTermsVersion to the counteroffer's proposed version and move
  // negotiating -> evaluating in a single optimistic-concurrency update keyed on the OLD
  // version — the same WHERE-both-status-and-version pattern transitionCase itself uses,
  // but transitionCase can't be reused unchanged here since it only ever writes the
  // `status` column, never `activeTermsVersion`. assertValidTransition is still called
  // explicitly so the legality check isn't silently skipped just because this bypasses
  // transitionCase.
  //
  // Concurrency: this guarded updateMany is what actually prevents two concurrent accept
  // attempts (or an accept racing a reject) from both succeeding — only one request's
  // WHERE clause (status="negotiating" AND activeTermsVersion=<old>) can still match
  // after the first writer commits its update, so the loser's `count` is 0 and it throws
  // STALE_CASE_VERSION below instead of silently re-applying the bump or double-marking
  // the Counteroffer row. The Counteroffer row is deliberately marked "accepted" only
  // *after* this update succeeds, not before: marking it first (claiming the row via a
  // WHERE-respondedAt-is-null guard before touching the case) would leave the
  // Counteroffer permanently mislabeled "accepted" if this update then failed — worse
  // than the gap it would close, since a request that throws here never touches the
  // Counteroffer row at all, so a retry with the same token still correctly sees
  // `respondedAt: null` rather than a case stuck disagreeing with its own counteroffer.
  assertValidTransition("negotiating", "evaluating");
  const bump = await db.dealCase.updateMany({
    where: { id: dealCase.id, status: "negotiating", activeTermsVersion: dealCase.activeTermsVersion },
    data: { status: "evaluating", activeTermsVersion: counteroffer.proposedTermsVersion },
  });
  if (bump.count === 0) {
    throw new ToolError(
      "STALE_CASE_VERSION",
      `Case ${dealCase.id} is not in status "negotiating" at version ${dealCase.activeTermsVersion}`,
      true,
    );
  }

  await emitCaseEvent(db, {
    caseId: dealCase.id,
    eventType: "counteroffer.accepted",
    caseVersion: counteroffer.proposedTermsVersion,
    actorType: "buyer",
    actorRef: "buyer",
    payload: { counterofferId: counteroffer.id },
    traceId: input.traceId,
  });
  await db.counteroffer.update({ where: { id: counteroffer.id }, data: { status: "accepted", respondedAt: new Date() } });

  return evaluateAndAutoCommit(db, gateway, {
    caseId: dealCase.id,
    modelId: input.modelId,
    timeoutMs: input.timeoutMs,
    traceId: input.traceId,
    buyerLinkSigningSecret: input.buyerLinkSigningSecret,
  });
}
